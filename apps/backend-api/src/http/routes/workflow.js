const logger = require("../../services/logger");
const { recordSignedDppRelease } = require("../../services/dpp-release-record-service");
const { buildDashboardPath } = require("../../shared/navigation/dashboard-paths");

function canAccessWorkflowCompany(user, workflowCompanyId) {
  if (user?.role === "superAdmin") return true;
  if (user?.companyId === null || user?.companyId === undefined) return false;
  if (workflowCompanyId === null || workflowCompanyId === undefined) return false;
  return String(user.companyId) === String(workflowCompanyId);
}

module.exports = function registerWorkflowRoutes(app, {
  pool,
  authenticateToken,
  checkCompanyAccess,
  requireEditor,
  submitPassportToWorkflow,
  getTable,
  inRevisionStatus,
  signPassport,
  markOlderVersionsObsolete,
  logAudit,
  buildCurrentPublicPassportPath,
  createNotification,
  complianceService,
  archivePassportSnapshot
}) {
  const runBestEffort = async (label, operation) => {
    try {
      return await operation();
    } catch (error) {
      logger.error(`${label}:`, error.message);
      return null;
    }
  };

  const getActorIdentifier = (user) =>
    user?.actorIdentifier ||
    user?.globallyUniqueOperatorId ||
    user?.operatorIdentifier ||
    user?.economicOperatorId ||
    user?.email ||
    (user?.userId ? `user:${user.userId}` : null);

  const mapWorkflowRow = (row = {}) => ({
    id: row.id ?? null,
    passportDppId: row.passportDppId ?? null,
    passportType: row.passportType ?? null,
    companyId: row.companyId ?? null,
    submittedBy: row.submittedBy ?? null,
    reviewerId: row.reviewerId ?? null,
    approverId: row.approverId ?? null,
    reviewStatus: row.reviewStatus ?? null,
    approvalStatus: row.approvalStatus ?? null,
    overallStatus: row.overallStatus ?? null,
    previousReleaseStatus: row.previousReleaseStatus ?? null,
    reviewerComment: row.reviewerComment ?? null,
    approverComment: row.approverComment ?? null,
    reviewedAt: row.reviewedAt ?? null,
    approvedAt: row.approvedAt ?? null,
    rejectedAt: row.rejectedAt ?? null,
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
    reviewerName: row.reviewerName ?? null,
    approverName: row.approverName ?? null,
    submitterName: row.submitterName ?? null,
    modelName: row.modelName ?? null,
    internalAliasId: row.internalAliasId ?? null,
    versionNumber: row.versionNumber ?? null,
    releaseStatus: row.releaseStatus ?? null,
    companyName: row.companyName ?? null,
  });

  const loadLivePassportRow = async ({ companyId, dppId: dppId, passportType, status = null }) => {
    const tableName = getTable(passportType);
    const params = [dppId];
    let companyFilter = "";
    let statusFilter = "";
    if (companyId !== null && companyId !== undefined) {
      params.push(companyId);
      companyFilter = ` AND "companyId" = $${params.length}`;
    }
    if (status) {
      params.push(status);
      statusFilter = ` AND "releaseStatus" = $${params.length}`;
    }

    const result = await pool.query(
      `SELECT *
       FROM ${tableName}
       WHERE "dppId" = $1${companyFilter}${statusFilter}
       ORDER BY "versionNumber" DESC
       LIMIT 1`,
      params
    );
    return result.rows[0] || null;
  };

  const evaluateWorkflowReleaseCompliance = async ({ companyId, dppId: dppId, passportType, status = null }) => {
    const passport = await loadLivePassportRow({ companyId, dppId: dppId, passportType, status });
    if (!passport) return null;
    const compliance = await complianceService.evaluatePassport(
      { ...passport, passportType },
      passportType
    );
    return { passport, compliance };
  };

  const enrichWorkflowRows = async (rows) => {
    const enriched = [];
    for (const row of rows) {
      let info = {
        modelName: row.passportDppId?.substring(0, 8) || "?",
        versionNumber: 1,
        internalAliasId: null,
        releaseStatus: null
      };
      try {
        const regRow = await pool.query(
          `SELECT "passportType" FROM "passportRegistry" WHERE "dppId" = $1 LIMIT 1`,
          [row.passportDppId]
        );
        const actualType = regRow.rows[0]?.passportType || row.passportType;
        const tableName = getTable(actualType);
        const r = await pool.query(
          `SELECT "modelName", "versionNumber", "internalAliasId", "releaseStatus"
           FROM ${tableName}
           WHERE "dppId" = $1
           ORDER BY "versionNumber" DESC
           LIMIT 1`,
          [row.passportDppId]
        );
        if (r.rows.length) info = r.rows[0];
      } catch (error) {
        logger.warn({ err: error, dppId: row.passportDppId }, "Failed to enrich workflow item with passport details");
      }
      enriched.push({ ...row, ...info });
    }
    return enriched;
  };

  app.post("/api/companies/:companyId/passports/:dppId/submit-review", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId, dppId: dppId } = req.params;
      const { passportType, reviewerId, approverId } = req.body;
      if (!passportType) return res.status(400).json({ error: "passportType required" });
      if (!reviewerId && !approverId) {
        return res.status(400).json({ error: "Select at least one reviewer or approver for workflow submission." });
      }

      const workflowTarget = await evaluateWorkflowReleaseCompliance({ companyId, dppId: dppId, passportType });
      if (!workflowTarget?.passport) {
        return res.status(404).json({ error: "Passport not found" });
      }

      const result = await submitPassportToWorkflow({
        companyId,
        dppId: dppId,
        passportType,
        userId: req.user.userId,
        reviewerId,
        approverId
      });
      res.json({ success: true, workflowId: result.workflowId, compliance: workflowTarget.compliance });
    } catch (e) {
      logger.error("Submit review error:", e.message);
      res.status(500).json({ error: "Failed" });
    }
  });

  app.delete("/api/passports/:dppId/workflow", authenticateToken, async (req, res) => {
    try {
      const { dppId: dppId } = req.params;
      const userId = req.user.userId;

      const wfRes = await pool.query(
        'SELECT * FROM "passportWorkflow" WHERE "passportDppId" = $1 ORDER BY "createdAt" DESC LIMIT 1',
        [dppId]
      );
      if (!wfRes.rows.length) return res.status(404).json({ error: "No workflow found" });
      const wf = mapWorkflowRow(wfRes.rows[0]);
      if (!canAccessWorkflowCompany(req.user, wf.companyId)) {
        return res.status(403).json({ error: "Unauthorised access to this company" });
      }

      const userRes = await pool.query("SELECT role FROM users WHERE id = $1", [userId]);
      const userRole = userRes.rows[0]?.role;
      const isCreator = Number(wf.submittedBy) === Number(userId);
      const isAdmin = ["companyAdmin", "superAdmin"].includes(userRole);
      if (!isCreator && !isAdmin) {
        return res.status(403).json({ error: "Only the creator or admin can remove workflow" });
      }

      const regRes = await pool.query(
        'SELECT "passportType" FROM "passportRegistry" WHERE "dppId" = $1 LIMIT 1',
        [dppId]
      );
      const passportType = regRes.rows[0]?.passportType || wf.passportType;

      if (passportType) {
        const tableName = getTable(passportType);
        const originalStatus = wf.previousReleaseStatus || "inRevision";
        const currentPassport = await loadLivePassportRow({ dppId, passportType });
        if (currentPassport) {
          await runBestEffort("Workflow remove archive before revert error", async () => archivePassportSnapshot({
            passport: currentPassport,
            passportType,
            archivedBy: userId,
            actorIdentifier: getActorIdentifier(req.user),
            snapshotReason: "beforeWorkflowRemoveRevert",
          }));
        }
        await pool.query(
          `UPDATE ${tableName} SET "releaseStatus"=$1, "updatedAt"=NOW() WHERE "dppId"=$2`,
          [originalStatus, dppId]
        );
        const revertedPassport = await loadLivePassportRow({ dppId, passportType });
        if (revertedPassport) {
          await runBestEffort("Workflow remove archive after revert error", async () => archivePassportSnapshot({
            passport: revertedPassport,
            passportType,
            archivedBy: userId,
            actorIdentifier: getActorIdentifier(req.user),
            snapshotReason: "afterWorkflowRemoveRevert",
          }));
        }
      }

      await pool.query("DELETE FROM \"passportWorkflow\" WHERE id = $1", [wf.id]);
      res.json({ success: true, message: "Workflow removed and passport reverted to revision" });
    } catch (e) {
      logger.error("Remove workflow error:", e.message);
      res.status(500).json({ error: "Failed to remove workflow" });
    }
  });

  app.post("/api/passports/:dppId/workflow/:action", authenticateToken, async (req, res) => {
    try {
      const { dppId: dppId, action } = req.params;
      const { comment, passportType } = req.body;
      const userId = req.user.userId;

      if (!["approve", "reject"].includes(action)) {
        return res.status(400).json({ error: "Invalid action" });
      }

      const wfRes = await pool.query(
        'SELECT * FROM "passportWorkflow" WHERE "passportDppId" = $1 AND "overallStatus" = \'inProgress\' ORDER BY "createdAt" DESC LIMIT 1',
        [dppId]
      );
      if (!wfRes.rows.length) return res.status(404).json({ error: "No active workflow found for this passport" });
      const wf = mapWorkflowRow(wfRes.rows[0]);
      if (!canAccessWorkflowCompany(req.user, wf.companyId)) {
        return res.status(403).json({ error: "Unauthorised access to this company" });
      }

      const regRes = await pool.query(
        'SELECT "passportType" FROM "passportRegistry" WHERE "dppId" = $1 LIMIT 1',
        [dppId]
      );
      const resolvedPassportType = regRes.rows[0]?.passportType || wf.passportType || passportType;
      if (!resolvedPassportType) return res.status(400).json({ error: "passportType required" });

      const uid = parseInt(userId, 10);
      const isReviewer = parseInt(wf.reviewerId, 10) === uid && wf.reviewStatus === "pending";
      const isApprover = parseInt(wf.approverId, 10) === uid && wf.approvalStatus === "pending" && wf.reviewStatus !== "pending";
      if (!isReviewer && !isApprover) {
        return res.status(403).json({ error: "You are not the reviewer or approver for this passport" });
      }

      const tableName = getTable(resolvedPassportType);
      const currentPassport = await loadLivePassportRow({ dppId, passportType: resolvedPassportType });
      const pRes = await pool.query(
        `SELECT p."modelName" AS "modelName", p."internalAliasId" AS "internalAliasId", p."versionNumber" AS "versionNumber", c."companyName" AS "companyName", c."didSlug" AS "didSlug"
         FROM ${tableName} p
         LEFT JOIN companies c ON c.id = p."companyId"
         WHERE p."dppId" = $1
         ORDER BY p."versionNumber" DESC
         LIMIT 1`,
        [dppId]
      );
      const pInfo = pRes.rows[0] || { modelName: dppId.substring(0, 8), internalAliasId: null, versionNumber: 1, companyName: "", didSlug: null };
      const companyDashboardPath = (subpath = "") => buildDashboardPath({
        companySlug: pInfo.didSlug,
        companyName: pInfo.companyName,
        companyId: wf.companyId,
        subpath,
      });

      if (action === "reject") {
        const col = isReviewer ? '"reviewStatus"' : '"approvalStatus"';
        const commentCol = isReviewer ? '"reviewerComment"' : '"approverComment"';
        await pool.query(
          `UPDATE "passportWorkflow" SET ${col}='rejected', ${commentCol}=$1, "rejectedAt"=NOW(), "overallStatus"='rejected', "updatedAt"=NOW() WHERE id=$2`,
          [comment || null, wf.id]
        );
        if (currentPassport) {
          await runBestEffort("Workflow reject archive before revert error", async () => archivePassportSnapshot({
            passport: currentPassport,
            passportType: resolvedPassportType,
            archivedBy: userId,
            actorIdentifier: getActorIdentifier(req.user),
            snapshotReason: "beforeWorkflowRejectRevert",
          }));
        }
        await pool.query(
          `UPDATE ${tableName}
           SET "releaseStatus" = $2, "updatedAt" = NOW()
           WHERE "dppId"=$1 AND "releaseStatus"='inReview'`,
          [dppId, pInfo.versionNumber > 1 ? inRevisionStatus : "draft"]
        );
        const revertedPassport = await loadLivePassportRow({ dppId, passportType: resolvedPassportType });
        if (revertedPassport) {
          await runBestEffort("Workflow reject archive after revert error", async () => archivePassportSnapshot({
            passport: revertedPassport,
            passportType: resolvedPassportType,
            archivedBy: userId,
            actorIdentifier: getActorIdentifier(req.user),
            snapshotReason: "afterWorkflowRejectRevert",
          }));
        }
        if (wf.submittedBy) {
          const actor = await pool.query('SELECT "firstName" AS "firstName", "lastName" AS "lastName" FROM users WHERE id=$1', [userId]);
          const actorName = `${actor.rows[0]?.firstName || ""} ${actor.rows[0]?.lastName || ""}`.trim() || "Reviewer";
          await runBestEffort("Workflow reject notification error", async () => createNotification(
            wf.submittedBy,
            "workflowRejected",
              `❌ ${pInfo.modelName} was rejected`,
              `${isReviewer ? "Review" : "Approval"} rejected by ${actorName}${comment ? ` — ${comment.substring(0, 80)}` : ""}`,
              dppId,
              companyDashboardPath(`passports/${resolvedPassportType}`)
            ));
        }
        return res.json({ success: true, status: "rejected" });
      }

      if (isReviewer) {
        if (!wf.approverId || wf.approvalStatus === "skipped") {
          const reviewReleaseTarget = await evaluateWorkflowReleaseCompliance({
            companyId: wf.companyId,
            dppId: dppId,
            passportType: resolvedPassportType,
            status: "inReview"
          });
          if (!reviewReleaseTarget?.passport) {
            return res.status(404).json({ error: "Passport not found" });
          }
        }

        await pool.query(
          'UPDATE "passportWorkflow" SET "reviewStatus"=\'approved\', "reviewerComment"=$1, "reviewedAt"=NOW(), "updatedAt"=NOW() WHERE id=$2',
          [comment || null, wf.id]
        );
        if (!wf.approverId || wf.approvalStatus === "skipped") {
          const beforeReleasePassport = await loadLivePassportRow({ dppId, passportType: resolvedPassportType, status: "inReview" });
          if (beforeReleasePassport) {
            await runBestEffort("Workflow review archive before release error", async () => archivePassportSnapshot({
              passport: beforeReleasePassport,
              passportType: resolvedPassportType,
              archivedBy: userId,
              actorIdentifier: getActorIdentifier(req.user),
              snapshotReason: "beforeWorkflowReviewRelease",
            }));
          }
          const relRes = await pool.query(
            `UPDATE ${tableName} SET "releaseStatus"='released', "updatedAt"=NOW() WHERE "dppId"=$1 AND "releaseStatus"='inReview' RETURNING *`,
            [dppId]
          );
          if (relRes.rows.length) {
            const released = relRes.rows[0];
            await runBestEffort("Workflow review archive after release error", async () => archivePassportSnapshot({
              passport: released,
              passportType: resolvedPassportType,
              archivedBy: userId,
              actorIdentifier: getActorIdentifier(req.user),
              snapshotReason: "afterWorkflowReviewRelease",
            }));
            const typeDef = await runBestEffort("Workflow review type definition load error", async () =>
              complianceService.loadPassportTypeDefinition(resolvedPassportType)
            );
            const sigData = await runBestEffort("Workflow review signing error", async () =>
              signPassport({ ...released, passportType: resolvedPassportType }, typeDef || null)
            );
            if (sigData) {
              await runBestEffort("Workflow review release record error", async () => recordSignedDppRelease(pool, {
                passportDppId: dppId,
                companyId: wf.companyId,
                releasedByUserId: userId,
                releasedByEmail: req.user.email,
                versionNumber: released.versionNumber,
                sigData,
                releaseNote: comment || null
              }));
              await runBestEffort("Workflow review sign audit error", async () => logAudit(
                wf.companyId,
                userId,
                "signPassport",
                "passportSignatures",
                dppId,
                null,
                {
                  versionNumber: released.versionNumber,
                  signingKeyId: sigData.keyId,
                  signatureAlgorithm: sigData.signatureAlgorithm,
                  via: "workflowReview"
                }
              ));
            }
            await runBestEffort("Workflow review obsolete version update error", async () =>
              markOlderVersionsObsolete(tableName, dppId, released.versionNumber, resolvedPassportType)
            );
            await runBestEffort("Workflow review release audit error", async () => logAudit(
              wf.companyId,
              userId,
              "release",
              tableName,
              dppId,
              { releaseStatus: "inReview" },
              { releaseStatus: "released", via: "workflowReview" }
            ));
          }
          await pool.query('UPDATE "passportWorkflow" SET "overallStatus"=\'approved\', "updatedAt"=NOW() WHERE id=$1', [wf.id]);
          if (wf.submittedBy) {
            const releasePath = buildCurrentPublicPassportPath({
              companyName: pInfo.companyName,
              modelName: pInfo.modelName,
              dppId
            });
            await runBestEffort("Workflow review approved notification error", async () => createNotification(
              wf.submittedBy,
              "workflowApproved",
              `✅ ${pInfo.modelName} reviewed and released!`,
              null,
              dppId,
              releasePath
            ));
          }
        } else {
          await runBestEffort("Workflow approval-request notification error", async () => createNotification(
            wf.approverId,
              "workflowApproval",
              `Approval needed: ${pInfo.modelName}`,
              "Review passed — your approval is required",
              dppId,
              companyDashboardPath("workflow/inprogress")
            ));
        }
      } else if (isApprover) {
        const approvalReleaseTarget = await evaluateWorkflowReleaseCompliance({
          companyId: wf.companyId,
          dppId: dppId,
          passportType: resolvedPassportType,
          status: "inReview"
        });
        if (!approvalReleaseTarget?.passport) {
          return res.status(404).json({ error: "Passport not found" });
        }
        await pool.query(
          'UPDATE "passportWorkflow" SET "approvalStatus"=\'approved\', "approverComment"=$1, "approvedAt"=NOW(), "overallStatus"=\'approved\', "updatedAt"=NOW() WHERE id=$2',
          [comment || null, wf.id]
        );
        const beforeReleasePassport = await loadLivePassportRow({ dppId, passportType: resolvedPassportType, status: "inReview" });
        if (beforeReleasePassport) {
          await runBestEffort("Workflow approval archive before release error", async () => archivePassportSnapshot({
            passport: beforeReleasePassport,
            passportType: resolvedPassportType,
            archivedBy: userId,
            actorIdentifier: getActorIdentifier(req.user),
            snapshotReason: "beforeWorkflowApprovalRelease",
          }));
        }
        const relRes = await pool.query(
          `UPDATE ${tableName} SET "releaseStatus"='released', "updatedAt"=NOW() WHERE "dppId"=$1 AND "releaseStatus"='inReview' RETURNING *`,
          [dppId]
        );
        if (relRes.rows.length) {
          const released = relRes.rows[0];
          await runBestEffort("Workflow approval archive after release error", async () => archivePassportSnapshot({
            passport: released,
            passportType: resolvedPassportType,
            archivedBy: userId,
            actorIdentifier: getActorIdentifier(req.user),
            snapshotReason: "afterWorkflowApprovalRelease",
          }));
          const typeDef = await runBestEffort("Workflow approval type definition load error", async () =>
            complianceService.loadPassportTypeDefinition(resolvedPassportType)
          );
          const sigData = await runBestEffort("Workflow approval signing error", async () =>
            signPassport({ ...released, passportType: resolvedPassportType }, typeDef || null)
          );
          if (sigData) {
            await runBestEffort("Workflow approval release record error", async () => recordSignedDppRelease(pool, {
              passportDppId: dppId,
              companyId: wf.companyId,
              releasedByUserId: userId,
              releasedByEmail: req.user.email,
              versionNumber: released.versionNumber,
              sigData,
              releaseNote: comment || null
            }));
            await runBestEffort("Workflow approval sign audit error", async () => logAudit(
              wf.companyId,
              userId,
              "signPassport",
              "passportSignatures",
              dppId,
              null,
              {
                versionNumber: released.versionNumber,
                  signingKeyId: sigData.keyId,
                  signatureAlgorithm: sigData.signatureAlgorithm,
                  via: "workflowApproval"
                }
              ));
          }
          await runBestEffort("Workflow approval obsolete version update error", async () =>
            markOlderVersionsObsolete(tableName, dppId, released.versionNumber, resolvedPassportType)
          );
          await runBestEffort("Workflow approval release audit error", async () => logAudit(
            wf.companyId,
            userId,
            "release",
            tableName,
            dppId,
            { releaseStatus: "inReview" },
            { releaseStatus: "released", via: "workflowApproval" }
          ));
        }
        if (wf.submittedBy) {
          const releasePath = buildCurrentPublicPassportPath({
            companyName: pInfo.companyName,
            modelName: pInfo.modelName,
            dppId
          });
          await runBestEffort("Workflow approval approved notification error", async () => createNotification(
            wf.submittedBy,
            "workflowApproved",
            `🚀 ${pInfo.modelName} approved and released!`,
            null,
            dppId,
            releasePath
          ));
        }
      }

      res.json({ success: true, status: "approved" });
    } catch (e) {
      logger.error("Workflow action error:", e.message);
      res.status(500).json({ error: "Failed" });
    }
  });

  app.get("/api/companies/:companyId/workflow", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { companyId } = req.params;
      const userId = req.user.userId;

      const inProgress = await pool.query(
        `SELECT pw.*,
           CONCAT(ur."firstName",' ',ur."lastName") AS "reviewerName",
           CONCAT(ua."firstName",' ',ua."lastName") AS "approverName",
           CONCAT(us."firstName",' ',us."lastName") AS "submitterName"
         FROM "passportWorkflow" pw
         LEFT JOIN users ur ON ur.id = pw."reviewerId"
         LEFT JOIN users ua ON ua.id = pw."approverId"
         LEFT JOIN users us ON us.id = pw."submittedBy"
         WHERE pw."companyId" = $1
           AND pw."overallStatus" = 'inProgress'
           AND (
             pw."submittedBy" = $2 OR
             pw."reviewerId" = $2 OR
             pw."approverId" = $2
           )
         ORDER BY pw."createdAt" DESC`,
        [companyId, userId]
      );
      const history = await pool.query(
        `SELECT pw.*,
           CONCAT(ur."firstName",' ',ur."lastName") AS "reviewerName",
           CONCAT(ua."firstName",' ',ua."lastName") AS "approverName",
           CONCAT(us."firstName",' ',us."lastName") AS "submitterName"
         FROM "passportWorkflow" pw
         LEFT JOIN users ur ON ur.id = pw."reviewerId"
         LEFT JOIN users ua ON ua.id = pw."approverId"
         LEFT JOIN users us ON us.id = pw."submittedBy"
         WHERE pw."companyId" = $1
           AND pw."overallStatus" != 'inProgress'
           AND (
             pw."submittedBy" = $2 OR
             pw."reviewerId" = $2 OR
             pw."approverId" = $2
           )
         ORDER BY pw."updatedAt" DESC LIMIT 50`,
        [companyId, userId]
      );

      res.json({
        inProgress: (await enrichWorkflowRows(inProgress.rows)).map(mapWorkflowRow),
        history: (await enrichWorkflowRows(history.rows)).map(mapWorkflowRow)
      });
    } catch {
      res.status(500).json({ error: "Failed" });
    }
  });

  app.get("/api/users/me/backlog", authenticateToken, async (req, res) => {
    try {
      const userId = req.user.userId;
      const r = await pool.query(
        `SELECT pw.*,
           CONCAT(ur."firstName",' ',ur."lastName") AS "reviewerName",
           CONCAT(ua."firstName",' ',ua."lastName") AS "approverName",
           CONCAT(us."firstName",' ',us."lastName") AS "submitterName"
         FROM "passportWorkflow" pw
         LEFT JOIN users ur ON ur.id = pw."reviewerId"
         LEFT JOIN users ua ON ua.id = pw."approverId"
         LEFT JOIN users us ON us.id = pw."submittedBy"
         WHERE pw."overallStatus" = 'inProgress'
           AND (
             (pw."reviewerId" = $1 AND pw."reviewStatus" = 'pending') OR
             (pw."approverId" = $1 AND pw."approvalStatus" = 'pending' AND pw."reviewStatus" != 'pending')
           )
         ORDER BY pw."createdAt" ASC`,
        [userId]
      );

      res.json({ backlog: (await enrichWorkflowRows(r.rows)).map(mapWorkflowRow) });
    } catch {
      res.status(500).json({ error: "Failed" });
    }
  });
};

module.exports.canAccessWorkflowCompany = canAccessWorkflowCompany;
