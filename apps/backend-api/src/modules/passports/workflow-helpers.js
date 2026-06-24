"use strict";

const { buildDashboardPath } = require("../../shared/navigation/dashboard-paths");

function createWorkflowHelpers({
  pool,
  logger,
  createTransporter,
  brandedEmail,
  renderInfoTable,
  getTable,
  normalizePassportRow,
  normalizeReleaseStatus,
  inRevisionStatus,
  editableReleaseStatusesSql,
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
       WHERE "dppId" = $1 AND "releaseStatus" IN ${editableReleaseStatusesSql} AND "deletedAt" IS NULL
       ORDER BY "versionNumber" DESC LIMIT 1`,
      [dppId]
    );
    if (!pRes.rows.length) throw new Error("Editable passport not found");
    const passport = normalizePassportRow(pRes.rows[0]);
    const previousReleaseStatus = normalizeReleaseStatus(passport.releaseStatus) || inRevisionStatus;

    await runBestEffort("Workflow archive before submit error", async () => archivePassportSnapshot({
      passport: pRes.rows[0],
      passportType,
      archivedBy: userId,
      snapshotReason: "beforeSubmitReview",
    }));

    const client = await pool.connect();
    let wfRes;
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE ${tableName} SET "releaseStatus" = 'inReview', "updatedAt" = NOW()
         WHERE "dppId" = $1 AND "releaseStatus" IN ${editableReleaseStatusesSql}`,
        [dppId]
      );

      wfRes = await client.query(
        `INSERT INTO "passportWorkflow"
           ("passportDppId", "passportType", "companyId", "submittedBy", "reviewerId", "approverId",
            "reviewStatus", "approvalStatus", "overallStatus", "previousReleaseStatus")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'inProgress',$9)
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
      await client.query("ROLLBACK").catch((rollbackError) => {
        logger.error({ err: rollbackError, dppId, passportType, companyId }, "Failed to roll back workflow submission transaction");
      });
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
        snapshotReason: "afterSubmitReview",
      }));
    }

    const appUrl = process.env.APP_URL || "http://localhost:3000";
    const companyDashboardWorkflowPath = buildDashboardPath({ companyId, subpath: "workflow/inprogress" });

    if (resolvedReviewerId) {
      await runBestEffort("Workflow reviewer notification error", async () => createNotification(
        resolvedReviewerId,
        "workflowReview",
        `Review requested: ${passport.internalAliasId}`,
        `v${passport.versionNumber} needs your review`,
        dppId,
        companyDashboardWorkflowPath
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
                ${renderInfoTable([
                  { label: "Internal Alias ID", value: passport.internalAliasId },
                  passport.modelName ? { label: "Model", value: passport.modelName } : null,
                  { label: "Version", value: `v${passport.versionNumber}` },
                  { label: "Type", value: passportType },
                ])}
                <div class="cta-wrap"><a href="${appUrl}${companyDashboardWorkflowPath}" class="cta-btn">🔍 Review Now →</a></div>`,
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
        "workflowApproval",
        `Approval requested: ${passport.internalAliasId}`,
        `v${passport.versionNumber} needs your approval`,
        dppId,
        companyDashboardWorkflowPath
      ));
    }

    await runBestEffort("Workflow submit audit error", async () => logAudit(companyId, userId, "submitReview", tableName, dppId, null, {
      reviewerId: resolvedReviewerId,
      approverId: resolvedApproverId,
      status: "inReview",
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
