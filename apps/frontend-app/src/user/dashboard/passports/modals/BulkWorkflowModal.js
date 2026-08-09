import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { authHeaders, fetchWithAuth } from "../../../../shared/api/authHeaders";
import { isEditablePassportStatus } from "../../../../passports/utils/passportStatus";
import AppSelect from "../../../../shared/components/AppSelect";
import { useI18n } from "../../../../app/providers/i18n";

const api = import.meta.env.VITE_API_URL || "";

export function BulkWorkflowModal({ companyId, user, selectedList, onClose, onDone }) {
  const { t } = useI18n();
  const [teamUsers, setTeamUsers] = useState([]);
  const [reviewerId, setReviewerId] = useState("");
  const [approverId, setApproverId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchWithAuth(`${api}/api/companies/${companyId}/users`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((data) => {
        setTeamUsers(data
          .filter((member) => (member.role === "editor" || member.role === "companyAdmin") && member.id !== user?.id));
      })
      .catch((error) => console.warn("Ignored async error", error));

    fetchWithAuth(`${api}/api/users/me`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        if (d.defaultReviewerId) setReviewerId(String(d.defaultReviewerId));
        if (d.defaultApproverId) setApproverId(String(d.defaultApproverId));
      })
      .catch((error) => console.warn("Ignored async error", error));
  }, [companyId, user?.id]);

  const handleSubmit = async () => {
    if (!reviewerId && !approverId) {
      setError(t("selectReviewerOrApprover"));
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const items = selectedList.map((passport) => ({ dppId: passport.dppId, passportType: passport.passportType }));
      const r = await fetchWithAuth(`${api}/api/companies/${companyId}/passports/bulk-workflow`, {
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
      onDone(t("workflowSummary", { submitted: d.summary?.submitted || 0, skipped: d.summary?.skipped || 0 }));
    } catch (e) {
      setError(e.message);
      setSubmitting(false);
    }
  };

  const editableCount = selectedList.filter((passport) => isEditablePassportStatus(passport.releaseStatus)).length;

  return createPortal(
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-box">
        <div className="modal-header">
          <h3>{t("sendCountToWorkflow", { count: editableCount, suffix: editableCount !== 1 ? "s" : "" })}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <p className="modal-hint">
            {t("workflowDraftNotice")}
          </p>
          {error && <div className="alert alert-error dashboard-alert-inline">{error}</div>}
          <div className="wf-select-group">
            <label>{t("reviewer")} <span className="wf-opt">({t("reviewerOptional")})</span></label>
            <AppSelect value={reviewerId} onChange={(e) => setReviewerId(e.target.value)} disabled={submitting} aria-label={t("reviewer")}>
              <option value="">— {t("skipReview")} —</option>
              {teamUsers.map((member) => <option key={member.id} value={member.id}>{member.firstName} {member.lastName} — {member.role}</option>)}
            </AppSelect>
          </div>
          <div className="wf-select-group">
            <label>{t("approver")} <span className="wf-opt">({t("approverOptional")})</span></label>
            <AppSelect value={approverId} onChange={(e) => setApproverId(e.target.value)} disabled={submitting} aria-label={t("approver")}>
              <option value="">— {t("skipApproval")} —</option>
              {teamUsers.map((member) => <option key={member.id} value={member.id}>{member.firstName} {member.lastName} — {member.role}</option>)}
            </AppSelect>
          </div>
        </div>
        <div className="modal-footer dashboard-modal-actions dashboard-modal-actions-end">
          <button
            className="dashboard-btn dashboard-btn-primary"
            disabled={submitting || (!reviewerId && !approverId)}
            onClick={handleSubmit}
          >
            {submitting ? t("submitting") : t("submitCountToWorkflow", { count: editableCount })}
          </button>
          <button className="dashboard-btn dashboard-btn-ghost" onClick={onClose} disabled={submitting}>{t("cancel")}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
