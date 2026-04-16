import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { authHeaders } from "../../../../shared/api/authHeaders";
import { isEditablePassportStatus } from "../../../../passports/utils/passportStatus";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

export function BulkWorkflowModal({ companyId, user, selectedList, onClose, onDone }) {
  const [teamUsers, setTeamUsers] = useState([]);
  const [reviewerId, setReviewerId] = useState("");
  const [approverId, setApproverId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${API}/api/companies/${companyId}/users`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((data) => {
        setTeamUsers(data.filter((member) => (member.role === "editor" || member.role === "company_admin") && member.id !== user?.id));
      })
      .catch(() => {});

    fetch(`${API}/api/users/me`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        if (d.default_reviewer_id) setReviewerId(String(d.default_reviewer_id));
        if (d.default_approver_id) setApproverId(String(d.default_approver_id));
      })
      .catch(() => {});
  }, [companyId, user?.id]);

  const handleSubmit = async () => {
    if (!reviewerId && !approverId) {
      setError("Select at least one reviewer or approver.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const items = selectedList.map((passport) => ({ guid: passport.guid, passportType: passport.passport_type || passport.passportType }));
      const r = await fetch(`${API}/api/companies/${companyId}/passports/bulk-workflow`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          items,
          reviewerId: reviewerId ? parseInt(reviewerId, 10) : null,
          approverId: approverId ? parseInt(approverId, 10) : null,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      onDone(`Workflow: ${d.summary?.submitted || 0} submitted, ${d.summary?.skipped || 0} skipped`);
    } catch (e) {
      setError(e.message);
      setSubmitting(false);
    }
  };

  const editableCount = selectedList.filter((passport) => isEditablePassportStatus(passport.release_status)).length;

  return createPortal(
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-box">
        <div className="modal-header">
          <h3>Send {editableCount} Passport{editableCount !== 1 ? "s" : ""} to Workflow</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <p className="modal-hint">
            Only draft and in-revision passports will be submitted. Released passports will be skipped.
          </p>
          {error && <div className="alert alert-error dashboard-alert-inline">{error}</div>}
          <div className="wf-select-group">
            <label>Reviewer <span className="wf-opt">(optional if approver selected)</span></label>
            <select value={reviewerId} onChange={(e) => setReviewerId(e.target.value)} disabled={submitting}>
              <option value="">— Skip review —</option>
              {teamUsers.map((member) => <option key={member.id} value={member.id}>{member.first_name} {member.last_name} — {member.role}</option>)}
            </select>
          </div>
          <div className="wf-select-group">
            <label>Approver <span className="wf-opt">(optional if reviewer selected)</span></label>
            <select value={approverId} onChange={(e) => setApproverId(e.target.value)} disabled={submitting}>
              <option value="">— Skip approval —</option>
              {teamUsers.map((member) => <option key={member.id} value={member.id}>{member.first_name} {member.last_name} — {member.role}</option>)}
            </select>
          </div>
        </div>
        <div className="modal-footer">
          <button className="submit-btn" disabled={submitting || (!reviewerId && !approverId)} onClick={handleSubmit}>
            {submitting ? "Submitting…" : `Submit ${editableCount} to Workflow`}
          </button>
          <button className="cancel-btn" onClick={onClose} disabled={submitting}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
