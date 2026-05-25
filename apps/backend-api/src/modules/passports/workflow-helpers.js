"use strict";

function createWorkflowHelpers({
  pool,
  logger,
  createTransporter,
  brandedEmail,
  getTable,
  normalizePassportRow,
  normalizeReleaseStatus,
  IN_REVISION_STATUS,
  EDITABLE_RELEASE_STATUSES_SQL,
  archivePassportSnapshot,
  createNotification,
  logAudit,
}) {
  async function runBestEffort(label, operation) {
    try {
      return await operation();
    } catch (error) {
      logger.error(`${label}:`, error.message);
      return null;
    }
  }

  async function submitPassportToWorkflow({
    companyId,
    dppId = null,
    passportType,
    userId,
    reviewerId,
    approverId,
  }) {
    const tableName = getTable(passportType);
    const resolvedReviewerId = reviewerId ? parseInt(reviewerId, 10) : null;
    const resolvedApproverId = approverId ? parseInt(approverId, 10) : null;

    if (!resolvedReviewerId && !resolvedApproverId) {
      throw new Error("At least one reviewer or approver is required to submit a revision to workflow.");
    }

    const pRes = await pool.query(
      `SELECT * FROM ${tableName}
       WHERE "dppId" = $1 AND "releaseStatus" IN ${EDITABLE_RELEASE_STATUSES_SQL} AND "deletedAt" IS NULL
       ORDER BY "versionNumber" DESC LIMIT 1`,
      [dppId]
    );
    if (!pRes.rows.length) throw new Error("Editable passport not found");
    const passport = normalizePassportRow(pRes.rows[0]);
    const previousReleaseStatus = normalizeReleaseStatus(passport.releaseStatus) || IN_REVISION_STATUS;

    await runBestEffort("Workflow archive before submit error", async () => archivePassportSnapshot({
      passport: pRes.rows[0],
      passportType,
      archivedBy: userId,
      snapshotReason: "before_submit_review",
    }));

    const client = await pool.connect();
    let wfRes;
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE ${tableName} SET "releaseStatus" = 'in_review', "updatedAt" = NOW()
         WHERE "dppId" = $1 AND "releaseStatus" IN ${EDITABLE_RELEASE_STATUSES_SQL}`,
        [dppId]
      );

      wfRes = await client.query(
        `INSERT INTO passport_workflow
           ("passportDppId", "passportType", "companyId", "submittedBy", "reviewerId", "approverId",
            "reviewStatus", "approvalStatus", "overallStatus", "previousReleaseStatus")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'in_progress',$9)
         RETURNING id`,
        [
          dppId,
          passportType,
          companyId,
          userId,
          resolvedReviewerId,
          resolvedApproverId,
          resolvedReviewerId ? "pending" : "skipped",
          resolvedApproverId ? "pending" : "skipped",
          previousReleaseStatus,
        ]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }

    const updatedRes = await pool.query(
      `SELECT *
       FROM ${tableName}
       WHERE "dppId" = $1
       ORDER BY "versionNumber" DESC LIMIT 1`,
      [dppId]
    );
    if (updatedRes.rows.length) {
      await runBestEffort("Workflow archive after submit error", async () => archivePassportSnapshot({
        passport: updatedRes.rows[0],
        passportType,
        archivedBy: userId,
        snapshotReason: "after_submit_review",
      }));
    }

    const appUrl = process.env.APP_URL || "http://localhost:3000";

    if (resolvedReviewerId) {
      await runBestEffort("Workflow reviewer notification error", async () => createNotification(
        resolvedReviewerId,
        "workflow_review",
        `Review requested: ${passport.internalAliasId}`,
        `v${passport.versionNumber} needs your review`,
        dppId,
        "/dashboard/workflow"
      ));
      try {
        const reviewer = await pool.query('SELECT email, "firstName" AS "firstName" FROM users WHERE id = $1', [resolvedReviewerId]);
        const submitter = await pool.query('SELECT "firstName" AS "firstName", "lastName" AS "lastName", email FROM users WHERE id = $1', [userId]);
        if (reviewer.rows.length) {
          const reviewerName = reviewer.rows[0].firstName || "Reviewer";
          const submitterName =
            `${submitter.rows[0]?.firstName || ""} ${submitter.rows[0]?.lastName || ""}`.trim() ||
            submitter.rows[0]?.email ||
            "A colleague";
          await createTransporter().sendMail({
            from: process.env.EMAIL_FROM || "noreply@example.com",
            to: reviewer.rows[0].email,
            subject: `[DPP] Review requested — ${passport.internalAliasId}`,
            html: brandedEmail({
              preheader: `${submitterName} submitted a passport for your review`,
              bodyHtml: `
                <p>Hi <strong>${reviewerName}</strong>,</p>
                <p><strong>${submitterName}</strong> has submitted a passport for your review.</p>
                <div class="info-box">
                  <div class="info-row"><span class="info-label">Internal Alias ID</span><span class="info-value">${passport.internalAliasId}</span></div>
                  ${passport.modelName ? `<div class="info-row"><span class="info-label">Model</span><span class="info-value">${passport.modelName}</span></div>` : ""}
                  <div class="info-row"><span class="info-label">Version</span><span class="info-value">v${passport.versionNumber}</span></div>
                  <div class="info-row"><span class="info-label">Type</span><span class="info-value">${passportType}</span></div>
                </div>
                <div class="cta-wrap"><a href="${appUrl}/dashboard/workflow" class="cta-btn">🔍 Review Now →</a></div>`,
            }),
          });
        }
      } catch (e) {
        logger.error("Review email error:", e.message);
      }
    }

    if (resolvedApproverId && !resolvedReviewerId) {
      await runBestEffort("Workflow approver notification error", async () => createNotification(
        resolvedApproverId,
        "workflow_approval",
        `Approval requested: ${passport.internalAliasId}`,
        `v${passport.versionNumber} needs your approval`,
        dppId,
        "/dashboard/workflow"
      ));
    }

    await runBestEffort("Workflow submit audit error", async () => logAudit(companyId, userId, "SUBMIT_REVIEW", tableName, dppId, null, {
      reviewerId: resolvedReviewerId,
      approverId: resolvedApproverId,
      status: "in_review",
    }));

    return { workflowId: wfRes.rows[0].id };
  }

  return {
    submitPassportToWorkflow,
  };
}

module.exports = {
  createWorkflowHelpers,
};
