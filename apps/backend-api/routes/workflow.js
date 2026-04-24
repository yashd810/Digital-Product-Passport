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
}) {
  const enrichWorkflowRows = async (rows) => {
    const enriched = [];
    for (const row of rows) {
      let info = {
        model_name: row.passport_guid?.substring(0, 8) || "?",
        version_number: 1,
        product_id: null,
        release_status: null,
      };
      try {
        const regRow = await pool.query(
          "SELECT passport_type FROM passport_registry WHERE guid = $1 LIMIT 1",
          [row.passport_guid]
        );
        const actualType = regRow.rows[0]?.passport_type || row.passport_type;
        const tableName = getTable(actualType);
        const r = await pool.query(
          `SELECT model_name, version_number, product_id, release_status
           FROM ${tableName}
           WHERE guid = $1
           ORDER BY version_number DESC
           LIMIT 1`,
          [row.passport_guid]
        );
        if (r.rows.length) info = r.rows[0];
      } catch {}
      enriched.push({ ...row, ...info });
    }
    return enriched;
  };

  app.post("/api/companies/:companyId/passports/:guid/submit-review", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId, guid } = req.params;
      const { passportType, reviewerId, approverId } = req.body;
      if (!passportType) return res.status(400).json({ error: "passportType required" });
      if (!reviewerId && !approverId) {
        return res.status(400).json({ error: "Select at least one reviewer or approver for workflow submission." });
      }

      const result = await submitPassportToWorkflow({
        companyId,
        guid,
        passportType,
        userId: req.user.userId,
        reviewerId,
        approverId,
      });
      res.json({ success: true, workflowId: result.workflowId });
    } catch (e) {
      console.error("Submit review error:", e.message);
      res.status(500).json({ error: "Failed" });
    }
  });

  app.delete("/api/passports/:guid/workflow", authenticateToken, async (req, res) => {
    try {
      const { guid } = req.params;
      const userId = req.user.userId;

      const wfRes = await pool.query(
        "SELECT * FROM passport_workflow WHERE passport_guid = $1 ORDER BY created_at DESC LIMIT 1",
        [guid]
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
        "SELECT passport_type FROM passport_registry WHERE guid = $1 LIMIT 1",
        [guid]
      );
      const passportType = regRes.rows[0]?.passport_type || wf.passport_type;

      if (passportType) {
        const tableName = getTable(passportType);
        const originalStatus = wf.previous_release_status || "in_revision";
        await pool.query(
          `UPDATE ${tableName} SET release_status=$1, updated_at=NOW() WHERE guid=$2`,
          [originalStatus, guid]
        );
      }

      await pool.query("DELETE FROM passport_workflow WHERE id = $1", [wf.id]);
      res.json({ success: true, message: "Workflow removed and passport reverted to revision" });
    } catch (e) {
      console.error("Remove workflow error:", e.message);
      res.status(500).json({ error: "Failed to remove workflow" });
    }
  });

  app.post("/api/passports/:guid/workflow/:action", authenticateToken, async (req, res) => {
    try {
      const { guid, action } = req.params;
      const { comment, passportType } = req.body;
      const userId = req.user.userId;

      if (!["approve", "reject"].includes(action)) {
        return res.status(400).json({ error: "Invalid action" });
      }

      const wfRes = await pool.query(
        "SELECT * FROM passport_workflow WHERE passport_guid = $1 AND overall_status = 'in_progress' ORDER BY created_at DESC LIMIT 1",
        [guid]
      );
      if (!wfRes.rows.length) return res.status(404).json({ error: "No active workflow found for this passport" });
      const wf = wfRes.rows[0];

      const regRes = await pool.query(
        "SELECT passport_type FROM passport_registry WHERE guid = $1 LIMIT 1",
        [guid]
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
      const pRes = await pool.query(
        `SELECT p.model_name, p.product_id, p.version_number, c.company_name
         FROM ${tableName} p
         LEFT JOIN companies c ON c.id = p.company_id
         WHERE p.guid = $1
         ORDER BY p.version_number DESC
         LIMIT 1`,
        [guid]
      );
      const pInfo = pRes.rows[0] || { model_name: guid.substring(0, 8), product_id: null, version_number: 1, company_name: "" };

      if (action === "reject") {
        const col = isReviewer ? "review_status" : "approval_status";
        const commentCol = isReviewer ? "reviewer_comment" : "approver_comment";
        await pool.query(
          `UPDATE passport_workflow SET ${col}='rejected', ${commentCol}=$1, rejected_at=NOW(), overall_status='rejected', updated_at=NOW() WHERE id=$2`,
          [comment || null, wf.id]
        );
        await pool.query(
          `UPDATE ${tableName}
           SET release_status = $2, updated_at = NOW()
           WHERE guid=$1 AND release_status='in_review'`,
          [guid, pInfo.version_number > 1 ? IN_REVISION_STATUS : "draft"]
        );
        if (wf.submitted_by) {
          const actor = await pool.query("SELECT first_name, last_name FROM users WHERE id=$1", [userId]);
          const actorName = `${actor.rows[0]?.first_name || ""} ${actor.rows[0]?.last_name || ""}`.trim() || "Reviewer";
          await createNotification(
            wf.submitted_by,
            "workflow_rejected",
            `❌ ${pInfo.model_name} was rejected`,
            `${isReviewer ? "Review" : "Approval"} rejected by ${actorName}${comment ? ` — ${comment.substring(0, 80)}` : ""}`,
            guid,
            `/dashboard/passports/${resolvedPassportType}`
          );
        }
        return res.json({ success: true, status: "rejected" });
      }

      if (isReviewer) {
        await pool.query(
          "UPDATE passport_workflow SET review_status='approved', reviewer_comment=$1, reviewed_at=NOW(), updated_at=NOW() WHERE id=$2",
          [comment || null, wf.id]
        );
        if (!wf.approver_id || wf.approval_status === "skipped") {
          const relRes = await pool.query(
            `UPDATE ${tableName} SET release_status='released', updated_at=NOW() WHERE guid=$1 AND release_status='in_review' RETURNING *`,
            [guid]
          );
          if (relRes.rows.length) {
            const released = relRes.rows[0];
            const typeRes = await pool.query("SELECT * FROM passport_types WHERE type_name = $1", [resolvedPassportType]);
            const sigData = await signPassport({ ...released, passport_type: resolvedPassportType }, typeRes.rows[0] || null);
            if (sigData) {
              await pool.query(
                `INSERT INTO passport_signatures (passport_guid, version_number, data_hash, signature, algorithm, signing_key_id, released_at, vc_json)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (passport_guid, version_number) DO NOTHING`,
                [guid, released.version_number, sigData.dataHash, sigData.signature, sigData.legacyAlgorithm, sigData.keyId, sigData.releasedAt, sigData.vcJson || null]
              );
            }
            await markOlderVersionsObsolete(tableName, guid, released.version_number);
            await logAudit(
              wf.company_id,
              userId,
              "RELEASE",
              tableName,
              guid,
              { release_status: "in_review" },
              { release_status: "released", via: "workflow_review" }
            );
          }
          await pool.query("UPDATE passport_workflow SET overall_status='approved', updated_at=NOW() WHERE id=$1", [wf.id]);
          if (wf.submitted_by) {
            const releasePath = buildCurrentPublicPassportPath({
              companyName: pInfo.company_name,
              modelName: pInfo.model_name,
              productId: pInfo.product_id || guid,
            });
            await createNotification(
              wf.submitted_by,
              "workflow_approved",
              `✅ ${pInfo.model_name} reviewed and released!`,
              null,
              guid,
              releasePath
            );
          }
        } else {
          await createNotification(
            wf.approver_id,
            "workflow_approval",
            `Approval needed: ${pInfo.model_name}`,
            "Review passed — your approval is required",
            guid,
            "/dashboard/workflow"
          );
        }
      } else if (isApprover) {
        await pool.query(
          "UPDATE passport_workflow SET approval_status='approved', approver_comment=$1, approved_at=NOW(), overall_status='approved', updated_at=NOW() WHERE id=$2",
          [comment || null, wf.id]
        );
        const relRes = await pool.query(
          `UPDATE ${tableName} SET release_status='released', updated_at=NOW() WHERE guid=$1 AND release_status='in_review' RETURNING *`,
          [guid]
        );
        if (relRes.rows.length) {
          const released = relRes.rows[0];
          const typeRes = await pool.query("SELECT * FROM passport_types WHERE type_name = $1", [resolvedPassportType]);
          const sigData = await signPassport({ ...released, passport_type: resolvedPassportType }, typeRes.rows[0] || null);
          if (sigData) {
            await pool.query(
              `INSERT INTO passport_signatures (passport_guid, version_number, data_hash, signature, algorithm, signing_key_id, released_at, vc_json)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (passport_guid, version_number) DO NOTHING`,
              [guid, released.version_number, sigData.dataHash, sigData.signature, sigData.legacyAlgorithm, sigData.keyId, sigData.releasedAt, sigData.vcJson || null]
            );
          }
          await markOlderVersionsObsolete(tableName, guid, released.version_number);
          await logAudit(
            wf.company_id,
            userId,
            "RELEASE",
            tableName,
            guid,
            { release_status: "in_review" },
            { release_status: "released", via: "workflow_approval" }
          );
        }
        if (wf.submitted_by) {
          const releasePath = buildCurrentPublicPassportPath({
            companyName: pInfo.company_name,
            modelName: pInfo.model_name,
            productId: pInfo.product_id || guid,
          });
          await createNotification(
            wf.submitted_by,
            "workflow_approved",
            `🚀 ${pInfo.model_name} approved and released!`,
            null,
            guid,
            releasePath
          );
        }
      }

      res.json({ success: true, status: "approved" });
    } catch (e) {
      console.error("Workflow action error:", e.message);
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
        history: await enrichWorkflowRows(history.rows),
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
