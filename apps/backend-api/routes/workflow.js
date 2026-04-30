const logger = require("../services/logger");

module.exports = function registerWorkflowRoutes(app, {
  pool,
  authenticateToken,
  checkCompanyAccess,
  requireEditor,
  submitPassportToWorkflow,
  getTable,
  IN_REVISION_STATUS,
  signPassport,
  markOlderVersionsObsolete,
  logAudit,
  buildCurrentPublicPassportPath,
  createNotification,
  complianceService,
  archivePassportSnapshot
}) {
  const getActorIdentifier = (user) =>
    user?.actorIdentifier ||
    user?.globallyUniqueOperatorId ||
    user?.operatorIdentifier ||
    user?.economicOperatorId ||
    user?.email ||
    (user?.userId ? `user:${user.userId}` : null);

  const loadLivePassportRow = async ({ companyId, dppId: dppId, passportType, status = null }) => {
    const tableName = getTable(passportType);
    const params = [dppId];
    let companyFilter = "";
    let statusFilter = "";
    if (companyId !== null && companyId !== undefined) {
      params.push(companyId);
      companyFilter = ` AND company_id = $${params.length}`;
    }
    if (status) {
      params.push(status);
      statusFilter = ` AND release_status = $${params.length}`;
    }

    const result = await pool.query(
      `SELECT *
       FROM ${tableName}
       WHERE dpp_id = $1${companyFilter}${statusFilter}
       ORDER BY version_number DESC
       LIMIT 1`,
      params
    );
    return result.rows[0] || null;
  };

  const evaluateWorkflowReleaseCompliance = async ({ companyId, dppId: dppId, passportType, status = null }) => {
    const passport = await loadLivePassportRow({ companyId, dppId: dppId, passportType, status });
    if (!passport) return null;
    const compliance = await complianceService.evaluatePassport(
      { ...passport, passport_type: passportType },
      passportType
    );
    return { passport, compliance };
  };

  const enrichWorkflowRows = async (rows) => {
    const enriched = [];
    for (const row of rows) {
      let info = {
        model_name: row.passport_dpp_id?.substring(0, 8) || "?",
        version_number: 1,
        product_id: null,
        release_status: null
      };
      try {
        const regRow = await pool.query(
          "SELECT passport_type FROM passport_registry WHERE dpp_id = $1 LIMIT 1",
          [row.passport_dpp_id]
        );
        const actualType = regRow.rows[0]?.passport_type || row.passport_type;
        const tableName = getTable(actualType);
        const r = await pool.query(
          `SELECT model_name, version_number, product_id, release_status
           FROM ${tableName}
           WHERE dpp_id = $1
           ORDER BY version_number DESC
           LIMIT 1`,
          [row.passport_dpp_id]
        );
        if (r.rows.length) info = r.rows[0];
      } catch {}
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
      if (!workflowTarget.compliance.workflowReleaseAllowed) {
        return res.status(422).json({
          error: "Passport failed compliance validation. Fix the blocking issues before submitting it to workflow.",
          code: "PASSPORT_COMPLIANCE_FAILED",
          compliance: workflowTarget.compliance
        });
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
        "SELECT * FROM passport_workflow WHERE passport_dpp_id = $1 ORDER BY created_at DESC LIMIT 1",
        [dppId]
      );
      if (!wfRes.rows.length) return res.status(404).json({ error: "No workflow found" });
      const wf = wfRes.rows[0];

      const userRes = await pool.query("SELECT role FROM users WHERE id = $1", [userId]);
      const userRole = userRes.rows[0]?.role;
      const isCreator = wf.submitted_by === userId;
      const isAdmin = ["company_admin", "super_admin"].includes(userRole);
      if (!isCreator && !isAdmin) {
        return res.status(403).json({ error: "Only the creator or admin can remove workflow" });
      }

      const regRes = await pool.query(
        "SELECT passport_type FROM passport_registry WHERE dpp_id = $1 LIMIT 1",
        [dppId]
      );
      const passportType = regRes.rows[0]?.passport_type || wf.passport_type;

      if (passportType) {
        const tableName = getTable(passportType);
        const originalStatus = wf.previous_release_status || "in_revision";
        const currentPassport = await loadLivePassportRow({ dppId, passportType });
        if (currentPassport) {
          await archivePassportSnapshot({
            passport: currentPassport,
            passportType,
            archivedBy: userId,
            actorIdentifier: getActorIdentifier(req.user),
            snapshotReason: "before_workflow_remove_revert",
          });
        }
        await pool.query(
          `UPDATE ${tableName} SET release_status=$1, updated_at=NOW() WHERE dpp_id=$2`,
          [originalStatus, dppId]
        );
        const revertedPassport = await loadLivePassportRow({ dppId, passportType });
        if (revertedPassport) {
          await archivePassportSnapshot({
            passport: revertedPassport,
            passportType,
            archivedBy: userId,
            actorIdentifier: getActorIdentifier(req.user),
            snapshotReason: "after_workflow_remove_revert",
          });
        }
      }

      await pool.query("DELETE FROM passport_workflow WHERE id = $1", [wf.id]);
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
        "SELECT * FROM passport_workflow WHERE passport_dpp_id = $1 AND overall_status = 'in_progress' ORDER BY created_at DESC LIMIT 1",
        [dppId]
      );
      if (!wfRes.rows.length) return res.status(404).json({ error: "No active workflow found for this passport" });
      const wf = wfRes.rows[0];

      const regRes = await pool.query(
        "SELECT passport_type FROM passport_registry WHERE dpp_id = $1 LIMIT 1",
        [dppId]
      );
      const resolvedPassportType = regRes.rows[0]?.passport_type || wf.passport_type || passportType;
      if (!resolvedPassportType) return res.status(400).json({ error: "passportType required" });

      const uid = parseInt(userId, 10);
      const isReviewer = parseInt(wf.reviewer_id, 10) === uid && wf.review_status === "pending";
      const isApprover = parseInt(wf.approver_id, 10) === uid && wf.approval_status === "pending" && wf.review_status !== "pending";
      if (!isReviewer && !isApprover) {
        return res.status(403).json({ error: "You are not the reviewer or approver for this passport" });
      }

      const tableName = getTable(resolvedPassportType);
      const currentPassport = await loadLivePassportRow({ dppId, passportType: resolvedPassportType });
      const pRes = await pool.query(
        `SELECT p.model_name, p.product_id, p.version_number, c.company_name
         FROM ${tableName} p
         LEFT JOIN companies c ON c.id = p.company_id
         WHERE p.dpp_id = $1
         ORDER BY p.version_number DESC
         LIMIT 1`,
        [dppId]
      );
      const pInfo = pRes.rows[0] || { model_name: dppId.substring(0, 8), product_id: null, version_number: 1, company_name: "" };

      if (action === "reject") {
        const col = isReviewer ? "review_status" : "approval_status";
        const commentCol = isReviewer ? "reviewer_comment" : "approver_comment";
        await pool.query(
          `UPDATE passport_workflow SET ${col}='rejected', ${commentCol}=$1, rejected_at=NOW(), overall_status='rejected', updated_at=NOW() WHERE id=$2`,
          [comment || null, wf.id]
        );
        if (currentPassport) {
          await archivePassportSnapshot({
            passport: currentPassport,
            passportType: resolvedPassportType,
            archivedBy: userId,
            actorIdentifier: getActorIdentifier(req.user),
            snapshotReason: "before_workflow_reject_revert",
          });
        }
        await pool.query(
          `UPDATE ${tableName}
           SET release_status = $2, updated_at = NOW()
           WHERE dpp_id=$1 AND release_status='in_review'`,
          [dppId, pInfo.version_number > 1 ? IN_REVISION_STATUS : "draft"]
        );
        const revertedPassport = await loadLivePassportRow({ dppId, passportType: resolvedPassportType });
        if (revertedPassport) {
          await archivePassportSnapshot({
            passport: revertedPassport,
            passportType: resolvedPassportType,
            archivedBy: userId,
            actorIdentifier: getActorIdentifier(req.user),
            snapshotReason: "after_workflow_reject_revert",
          });
        }
        if (wf.submitted_by) {
          const actor = await pool.query("SELECT first_name, last_name FROM users WHERE id=$1", [userId]);
          const actorName = `${actor.rows[0]?.first_name || ""} ${actor.rows[0]?.last_name || ""}`.trim() || "Reviewer";
          await createNotification(
            wf.submitted_by,
            "workflow_rejected",
            `❌ ${pInfo.model_name} was rejected`,
            `${isReviewer ? "Review" : "Approval"} rejected by ${actorName}${comment ? ` — ${comment.substring(0, 80)}` : ""}`,
            dppId,
            `/dashboard/passports/${resolvedPassportType}`
          );
        }
        return res.json({ success: true, status: "rejected" });
      }

      if (isReviewer) {
        if (!wf.approver_id || wf.approval_status === "skipped") {
          const reviewReleaseTarget = await evaluateWorkflowReleaseCompliance({
            companyId: wf.company_id,
            dppId: dppId,
            passportType: resolvedPassportType,
            status: "in_review"
          });
          if (!reviewReleaseTarget?.passport) {
            return res.status(404).json({ error: "Passport not found" });
          }
          if (!reviewReleaseTarget.compliance.workflowReleaseAllowed) {
            return res.status(422).json({
              error: "Passport still has blocking compliance issues. Fix them before final approval and release.",
              code: "PASSPORT_COMPLIANCE_FAILED",
              compliance: reviewReleaseTarget.compliance
            });
          }
        }

        await pool.query(
          "UPDATE passport_workflow SET review_status='approved', reviewer_comment=$1, reviewed_at=NOW(), updated_at=NOW() WHERE id=$2",
          [comment || null, wf.id]
        );
        if (!wf.approver_id || wf.approval_status === "skipped") {
          const beforeReleasePassport = await loadLivePassportRow({ dppId, passportType: resolvedPassportType, status: "in_review" });
          if (beforeReleasePassport) {
            await archivePassportSnapshot({
              passport: beforeReleasePassport,
              passportType: resolvedPassportType,
              archivedBy: userId,
              actorIdentifier: getActorIdentifier(req.user),
              snapshotReason: "before_workflow_review_release",
            });
          }
          const relRes = await pool.query(
            `UPDATE ${tableName} SET release_status='released', updated_at=NOW() WHERE dpp_id=$1 AND release_status='in_review' RETURNING *`,
            [dppId]
          );
          if (relRes.rows.length) {
            const released = relRes.rows[0];
            await archivePassportSnapshot({
              passport: released,
              passportType: resolvedPassportType,
              archivedBy: userId,
              actorIdentifier: getActorIdentifier(req.user),
              snapshotReason: "after_workflow_review_release",
            });
            const typeDef = await complianceService.loadPassportTypeDefinition(resolvedPassportType);
            const sigData = await signPassport({ ...released, passport_type: resolvedPassportType }, typeDef || null);
            if (sigData) {
              await pool.query(
                `INSERT INTO passport_signatures (passport_dpp_id, version_number, data_hash, signature, algorithm, signing_key_id, released_at, vc_json)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (passport_dpp_id, version_number) DO NOTHING`,
                [dppId, released.version_number, sigData.dataHash, sigData.signature, sigData.legacyAlgorithm, sigData.keyId, sigData.releasedAt, sigData.vcJson || null]
              );
              await logAudit(
                wf.company_id,
                userId,
                "SIGN_PASSPORT",
                "passport_signatures",
                dppId,
                null,
                {
                  version_number: released.version_number,
                  signing_key_id: sigData.keyId,
                  signature_algorithm: sigData.signatureAlgorithm,
                  via: "workflow_review"
                }
              );
            }
            await markOlderVersionsObsolete(tableName, dppId, released.version_number, resolvedPassportType);
            await logAudit(
              wf.company_id,
              userId,
              "RELEASE",
              tableName,
              dppId,
              { release_status: "in_review" },
              { release_status: "released", via: "workflow_review" }
            );
          }
          await pool.query("UPDATE passport_workflow SET overall_status='approved', updated_at=NOW() WHERE id=$1", [wf.id]);
          if (wf.submitted_by) {
            const releasePath = buildCurrentPublicPassportPath({
              companyName: pInfo.company_name,
              modelName: pInfo.model_name,
              productId: pInfo.product_id || dppId
            });
            await createNotification(
              wf.submitted_by,
              "workflow_approved",
              `✅ ${pInfo.model_name} reviewed and released!`,
              null,
              dppId,
              releasePath
            );
          }
        } else {
          await createNotification(
            wf.approver_id,
            "workflow_approval",
            `Approval needed: ${pInfo.model_name}`,
            "Review passed — your approval is required",
            dppId,
            "/dashboard/workflow"
          );
        }
      } else if (isApprover) {
        const approvalReleaseTarget = await evaluateWorkflowReleaseCompliance({
          companyId: wf.company_id,
          dppId: dppId,
          passportType: resolvedPassportType,
          status: "in_review"
        });
        if (!approvalReleaseTarget?.passport) {
          return res.status(404).json({ error: "Passport not found" });
        }
        if (!approvalReleaseTarget.compliance.workflowReleaseAllowed) {
          return res.status(422).json({
            error: "Passport still has blocking compliance issues. Fix them before approval and release.",
            code: "PASSPORT_COMPLIANCE_FAILED",
            compliance: approvalReleaseTarget.compliance
          });
        }

        await pool.query(
          "UPDATE passport_workflow SET approval_status='approved', approver_comment=$1, approved_at=NOW(), overall_status='approved', updated_at=NOW() WHERE id=$2",
          [comment || null, wf.id]
        );
        const beforeReleasePassport = await loadLivePassportRow({ dppId, passportType: resolvedPassportType, status: "in_review" });
        if (beforeReleasePassport) {
          await archivePassportSnapshot({
            passport: beforeReleasePassport,
            passportType: resolvedPassportType,
            archivedBy: userId,
            actorIdentifier: getActorIdentifier(req.user),
            snapshotReason: "before_workflow_approval_release",
          });
        }
        const relRes = await pool.query(
          `UPDATE ${tableName} SET release_status='released', updated_at=NOW() WHERE dpp_id=$1 AND release_status='in_review' RETURNING *`,
          [dppId]
        );
        if (relRes.rows.length) {
          const released = relRes.rows[0];
          await archivePassportSnapshot({
            passport: released,
            passportType: resolvedPassportType,
            archivedBy: userId,
            actorIdentifier: getActorIdentifier(req.user),
            snapshotReason: "after_workflow_approval_release",
          });
          const typeDef = await complianceService.loadPassportTypeDefinition(resolvedPassportType);
          const sigData = await signPassport({ ...released, passport_type: resolvedPassportType }, typeDef || null);
          if (sigData) {
            await pool.query(
              `INSERT INTO passport_signatures (passport_dpp_id, version_number, data_hash, signature, algorithm, signing_key_id, released_at, vc_json)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (passport_dpp_id, version_number) DO NOTHING`,
              [dppId, released.version_number, sigData.dataHash, sigData.signature, sigData.legacyAlgorithm, sigData.keyId, sigData.releasedAt, sigData.vcJson || null]
            );
            await logAudit(
              wf.company_id,
              userId,
              "SIGN_PASSPORT",
              "passport_signatures",
              dppId,
              null,
              {
                version_number: released.version_number,
                signing_key_id: sigData.keyId,
                signature_algorithm: sigData.signatureAlgorithm,
                via: "workflow_approval"
              }
            );
          }
          await markOlderVersionsObsolete(tableName, dppId, released.version_number, resolvedPassportType);
          await logAudit(
            wf.company_id,
            userId,
            "RELEASE",
            tableName,
            dppId,
            { release_status: "in_review" },
            { release_status: "released", via: "workflow_approval" }
          );
        }
        if (wf.submitted_by) {
          const releasePath = buildCurrentPublicPassportPath({
            companyName: pInfo.company_name,
            modelName: pInfo.model_name,
            productId: pInfo.product_id || dppId
          });
          await createNotification(
            wf.submitted_by,
            "workflow_approved",
            `🚀 ${pInfo.model_name} approved and released!`,
            null,
            dppId,
            releasePath
          );
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
           CONCAT(ur.first_name,' ',ur.last_name) AS reviewer_name,
           CONCAT(ua.first_name,' ',ua.last_name) AS approver_name
         FROM passport_workflow pw
         LEFT JOIN users ur ON ur.id = pw.reviewer_id
         LEFT JOIN users ua ON ua.id = pw.approver_id
         WHERE pw.company_id = $1 AND pw.overall_status = 'in_progress' AND pw.submitted_by = $2
         ORDER BY pw.created_at DESC`,
        [companyId, userId]
      );
      const history = await pool.query(
        `SELECT pw.*,
           CONCAT(ur.first_name,' ',ur.last_name) AS reviewer_name,
           CONCAT(ua.first_name,' ',ua.last_name) AS approver_name
         FROM passport_workflow pw
         LEFT JOIN users ur ON ur.id = pw.reviewer_id
         LEFT JOIN users ua ON ua.id = pw.approver_id
         WHERE pw.company_id = $1 AND pw.overall_status != 'in_progress' AND pw.submitted_by = $2
         ORDER BY pw.updated_at DESC LIMIT 50`,
        [companyId, userId]
      );

      res.json({
        inProgress: await enrichWorkflowRows(inProgress.rows),
        history: await enrichWorkflowRows(history.rows)
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
           CONCAT(ur.first_name,' ',ur.last_name) AS reviewer_name,
           CONCAT(ua.first_name,' ',ua.last_name) AS approver_name
         FROM passport_workflow pw
         LEFT JOIN users ur ON ur.id = pw.reviewer_id
         LEFT JOIN users ua ON ua.id = pw.approver_id
         WHERE pw.overall_status = 'in_progress'
           AND (
             (pw.reviewer_id = $1 AND pw.review_status = 'pending') OR
             (pw.approver_id = $1 AND pw.approval_status = 'pending' AND pw.review_status != 'pending')
           )
         ORDER BY pw.created_at ASC`,
        [userId]
      );

      res.json({ backlog: await enrichWorkflowRows(r.rows) });
    } catch {
      res.status(500).json({ error: "Failed" });
    }
  });
};
