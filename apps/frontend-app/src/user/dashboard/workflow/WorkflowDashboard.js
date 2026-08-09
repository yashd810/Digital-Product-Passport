import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate, NavLink, useParams } from "react-router";
import { applyTableControls, getNextSortDirection, sortIndicator } from "../../../shared/table/tableControls";
import { authHeaders, fetchWithAuth } from "../../../shared/api/authHeaders";
import { isObsoletePassportStatus, normalizePassportStatus } from "../../../passports/utils/passportStatus";
import { buildInactivePassportPath, buildPreviewPassportPath, buildPublicPassportPath } from "../../../passports/utils/passportRoutes";
import { buildPublicViewerUrl } from "../../../passports/utils/publicViewerUrl";
import { extractComplianceError } from "../../../shared/utils/complianceErrors";
import { buildDashboardPath } from "../utils/dashboardRoutes";
import { safeWindowOpen } from "../../../shared/security/urlSafety";
import AppSelect from "../../../shared/components/AppSelect";
import { useI18n } from "../../../app/providers/i18n";
import "../../../admin/styles/AdminDashboard.css";

const api = import.meta.env.VITE_API_URL || "";

const statusMap = {
  submittedForReview:    { label:"In Review",   icon:"🔍" },
  submittedForApproval:  { label:"In Approval", icon:"📋" },
  released:                { label:"Released",    icon:"✅" },
  rejected:                { label:"Rejected",    icon:"❌" },
};

const getWorkflowPassportId = (wf) => wf?.passportDppId || null;
const getWorkflowPassportType = (wf) => wf?.passportType || "";
const getWorkflowModelName = (wf) => wf?.modelName || "";
const getWorkflowVersionNumber = (wf) => wf?.versionNumber;
const getWorkflowReleaseStatus = (wf) => wf?.releaseStatus || "";
const getWorkflowCreatedAt = (wf) => wf?.createdAt || "";

function WorkflowBadge({ status }) {
  const s = statusMap[status] || { label: status, icon:"📄" };
  return (
    <span className={`wf-badge ${status || "default"}`}>
      {s.icon} {s.label}
    </span>
  );
}

function ComplianceFailureNotice({ error }) {
  const { t } = useI18n();
  if (!error?.message) return null;

  const missingFields = Array.isArray(error.missingFields) ? error.missingFields : [];
  const mandatoryMissingFields = missingFields.filter((field) => field?.mandatory);

  return (
    <div className="alert alert-error dashboard-alert-inline wf-compliance-alert">
      <div className="wf-error-title">{error.message}</div>

      {mandatoryMissingFields.length > 0 && (
        <div className="wf-error-section">
          <div className="wf-error-heading">{t("missingRequiredFields")}</div>
          <ul className="wf-error-list">
            {mandatoryMissingFields.map((field, index) => (
              <li key={`${field.key || field.label || "missing"}-${index}`}>
                {field.label || field.key}
                {field.section ? ` (${field.section})` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Release Modal with reviewer + approver selection ──────────
export function ReleaseModal({ passport, companyId, user, onClose, onDone }) {
  const [teamUsers,    setTeamUsers]    = useState([]);
  const [reviewerId,   setReviewerId]   = useState("");
  const [approverId,   setApproverId]   = useState("");
  const [submitting,   setSubmitting]   = useState(false);
  const [error,        setError]        = useState(null);

  useEffect(() => {
    // Load eligible users (editors + admins)
    fetchWithAuth(`${api}/api/companies/${companyId}/users`, {
      headers: authHeaders()
    })
    .then(r => r.json())
    .then(data => {
      const eligible = data.filter(u =>
        (u.role === "editor" || u.role === "companyAdmin") && u.id !== user?.id
      );
      setTeamUsers(eligible);
    })
    .catch((error) => console.warn("Ignored async error", error));

    // Pre-fill from user defaults
    fetchWithAuth(`${api}/api/users/me`, { headers: authHeaders() })
    .then(r => r.json())
    .then(d => {
      if (d.defaultReviewerId) setReviewerId(String(d.defaultReviewerId));
      if (d.defaultApproverId) setApproverId(String(d.defaultApproverId));
    })
    .catch((error) => console.warn("Ignored async error", error));
  }, [companyId, user?.id]);

  const handleRelease = async () => {
    setSubmitting(true); setError(null);
    const hasWorkflow = reviewerId || approverId;
    try {
      if (hasWorkflow) {
        // Submit to workflow
        const r = await fetchWithAuth(
          `${api}/api/companies/${companyId}/passports/${passport.dppId}/submit-review`,
          {
            method: "POST",
            headers: authHeaders({ "Content-Type":"application/json" }),
            body: JSON.stringify({
              passportType: getWorkflowPassportType(passport),
              reviewerId:   reviewerId ? parseInt(reviewerId) : null,
              approverId:   approverId ? parseInt(approverId) : null,
            }),
          }
        );
        const d = await r.json();
        if (!r.ok) {
          setError(extractComplianceError(d, "Failed to submit passport to workflow"));
          setSubmitting(false);
          return;
        }
        onDone("Submitted for review/approval");
      } else {
        // Direct release (no workflow)
        const r = await fetchWithAuth(
          `${api}/api/companies/${companyId}/passports/${passport.dppId}/release`,
          {
            method: "PATCH",
            headers: authHeaders({ "Content-Type":"application/json" }),
            body: JSON.stringify({ passportType: getWorkflowPassportType(passport) }),
          }
        );
        const d = await r.json();
        if (!r.ok) {
          setError(extractComplianceError(d, "Failed to release passport"));
          setSubmitting(false);
          return;
        }
        onDone("Released");
      }
    } catch (err) {
      setError({ message: err.message || "Failed to complete release request", blockingIssues: [], missingFields: [] });
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box">
        <div className="modal-header">
          <h3>🎯 Release Passport</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <p className="modal-passport-name">
            <strong>{getWorkflowModelName(passport)}</strong>
            <span className="modal-version"> v{getWorkflowVersionNumber(passport)}</span>
          </p>
          <p className="modal-hint">
            Optionally assign a reviewer and/or approver. Leave both empty to release immediately.
          </p>

          <ComplianceFailureNotice error={error} />
          <>
              <div className="wf-select-group">
                <label>🔍 Reviewer <span className="wf-opt">(optional)</span></label>
                <AppSelect value={reviewerId} onChange={e => setReviewerId(e.target.value)} disabled={submitting} aria-label="Reviewer">
                  <option value="">— Skip review —</option>
                  {teamUsers.map(u => (
                    <option key={u.id} value={u.id}>
                      {u.firstName} {u.lastName} — {u.role}
                    </option>
                  ))}
                </AppSelect>
              </div>

              <div className="wf-select-group">
                <label>✅ Approver <span className="wf-opt">(optional)</span></label>
                <AppSelect value={approverId} onChange={e => setApproverId(e.target.value)} disabled={submitting} aria-label="Approver">
                  <option value="">— Skip approval —</option>
                  {teamUsers.filter(u => !reviewerId || String(u.id) !== reviewerId).map(u => (
                    <option key={u.id} value={u.id}>
                      {u.firstName} {u.lastName} — {u.role}
                    </option>
                  ))}
                </AppSelect>
              </div>

              {!reviewerId && !approverId && (
                <div className="wf-direct-note">
                  ⚡ No reviewer or approver selected — passport will be <strong>released immediately</strong>.
                </div>
              )}
              {reviewerId && (
                <div className="wf-flow-preview">
                  {reviewerId && <span className="wf-step">📤 Submitted</span>}
                  {reviewerId && <span className="wf-arrow">→</span>}
                  {reviewerId && <span className="wf-step">🔍 Review</span>}
                  {approverId && <span className="wf-arrow">→</span>}
                  {approverId && <span className="wf-step">✅ Approval</span>}
                  <span className="wf-arrow">→</span>
                  <span className="wf-step">🚀 Released</span>
                </div>
              )}
          </>
        </div>
        <div className="modal-footer">
          <button className="btn-cancel-wf" onClick={onClose} disabled={submitting}>Cancel</button>
          <button className="btn-release-wf" onClick={handleRelease} disabled={submitting}>
            {submitting ? "Submitting…" :
              reviewerId || approverId ? "Submit for Review" : "Release Now"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Approve / Reject modal ─────────────────────────────────────
function ActionModal({ wf, action, companyId, onClose, onDone }) {
  const [comment,   setComment]   = useState("");
  const [submitting,setSubmitting]= useState(false);
  const [error,     setError]     = useState(null);

  const handle = async () => {
    setSubmitting(true); setError(null);
    try {
      const workflowPassportId = getWorkflowPassportId(wf);
      if (!workflowPassportId) {
        setError({ message: "Workflow passport ID is missing", blockingIssues: [], missingFields: [] });
        setSubmitting(false);
        return;
      }
      const r = await fetchWithAuth(`${api}/api/passports/${workflowPassportId}/workflow/${action}`, {
        method: "POST",
        headers: authHeaders({ "Content-Type":"application/json" }),
        body: JSON.stringify({ comment, passportType: getWorkflowPassportType(wf) }),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(extractComplianceError(d, `Failed to ${action} passport`));
        setSubmitting(false);
        return;
      }
      onDone(`${action === "approve" ? "Approved" : "Rejected"} successfully`);
    } catch (err) {
      setError({ message: err.message || `Failed to ${action} passport`, blockingIssues: [], missingFields: [] });
      setSubmitting(false);
    }
  };

  const isApprove = action === "approve";
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box">
        <div className="modal-header">
          <h3>{isApprove ? "✅ Approve Passport" : "❌ Reject Passport"}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <p><strong>{getWorkflowModelName(wf)}</strong> v{getWorkflowVersionNumber(wf)}</p>
          <ComplianceFailureNotice error={error} />
          <div className="wf-select-group">
            <label>Comment <span className="wf-opt">(optional)</span></label>
            <textarea rows={3} value={comment} placeholder={isApprove ? "Add approval notes…" : "Reason for rejection…"}
              onChange={e => setComment(e.target.value)} disabled={submitting} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-cancel-wf" onClick={onClose} disabled={submitting}>Cancel</button>
          <button
            className={isApprove ? "btn-approve-wf" : "btn-reject-wf"}
            onClick={handle} disabled={submitting}>
            {submitting ? "…" : isApprove ? "✅ Approve" : "❌ Reject"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main WorkflowDashboard ─────────────────────────────────────
function WorkflowDashboard({ user, companyId, activeTab = "inprogress" }) {
  const { t } = useI18n();
  const navigate  = useNavigate();
  const { companySlug } = useParams();
  const tab = activeTab;
  const [data,    setData]    = useState({ inProgress:[], backlog:[], history:[] });
  const [loading, setLoading] = useState(true);
  const [modal,   setModal]   = useState(null); // {wf, action}
  const [removeModal, setRemoveModal] = useState(null); // {wf}
  const [flash,   setFlash]   = useState("");
  const [sortConfig, setSortConfig] = useState({ key: "createdAt", direction: "desc" });
  const [columnFilters, setColumnFilters] = useState({});
  const [showFilters, setShowFilters] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [wfRes, blRes] = await Promise.all([
        fetchWithAuth(`${api}/api/companies/${companyId}/workflow`, {
          headers: authHeaders()
        }),
        fetchWithAuth(`${api}/api/users/me/backlog`, {
          headers: authHeaders()
        }),
      ]);
      const wf = await wfRes.json();
      const bl = await blRes.json();
      setData({
        inProgress: (wf.inProgress || []),
        backlog:    (bl.backlog    || []),
        history:    (wf.history    || []),
      });
    } catch { }
    finally { setLoading(false); }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const handleDone = (msg) => {
    setModal(null);
    setFlash(msg);
    setTimeout(() => setFlash(""), 4000);
    load();
  };

  const handleRemove = async (wf) => {
    try {
      const workflowPassportId = getWorkflowPassportId(wf);
      if (!workflowPassportId) {
        setFlash("Error: Workflow passport ID is missing");
        setTimeout(() => setFlash(""), 4000);
        return;
      }
      const r = await fetchWithAuth(`${api}/api/passports/${workflowPassportId}/workflow`, {
        method: "DELETE",
        headers: authHeaders()
      });
      if (!r.ok) {
        const d = await r.json();
        setFlash(`Error: ${d.error || "Failed to remove workflow"}`);
        setTimeout(() => setFlash(""), 4000);
      } else {
        setRemoveModal(null);
        setFlash("Workflow removed successfully");
        setTimeout(() => setFlash(""), 4000);
        load();
      }
    } catch (e) {
      setFlash(`Error: ${e.message}`);
      setTimeout(() => setFlash(""), 4000);
    }
  };

  const tabs = [
    { id:"inprogress", label:t("inProgress"),  count: data.inProgress.length },
    { id:"backlog",    label:t("myBacklog"),    count: data.backlog.length },
    { id:"history",    label:t("history"),       count: data.history.length },
  ];
  const openPassportViewer = (wf) => {
    const workflowPassportId = getWorkflowPassportId(wf);
    if (!workflowPassportId) return;
    const normalizedStatus = normalizePassportStatus(getWorkflowReleaseStatus(wf));
    const path = normalizedStatus === "released"
      ? buildPublicPassportPath({
          companyName: user?.companyName,
          modelName: getWorkflowModelName(wf),
          dppId: workflowPassportId,
        })
      : isObsoletePassportStatus(normalizedStatus) && getWorkflowVersionNumber(wf) != null
        ? buildInactivePassportPath({
            companyName: user?.companyName,
            modelName: getWorkflowModelName(wf),
            dppId: workflowPassportId,
            versionNumber: getWorkflowVersionNumber(wf),
          })
      : buildPreviewPassportPath({
          companyName: user?.companyName,
          modelName: getWorkflowModelName(wf),
          previewId: workflowPassportId,
        });
    if (!path) return;
    const url = normalizedStatus === "released" || isObsoletePassportStatus(normalizedStatus)
      ? buildPublicViewerUrl(path)
      : `${window.location.origin}${path}`;
    if (!url) return;
    safeWindowOpen(url, {
      viewer: normalizedStatus === "released" || isObsoletePassportStatus(normalizedStatus),
    });
  };

  const renderRow = (wf, showActions, showActionColumn) => {
    const needsMyReview = showActions && String(wf.reviewerId) === String(user?.id) && wf.reviewStatus === "pending";
    const needsMyApproval = showActions && String(wf.approverId) === String(user?.id) && wf.approvalStatus === "pending" && wf.reviewStatus !== "pending";
    const workflowPassportId = getWorkflowPassportId(wf);
    const passportLabel = getWorkflowModelName(wf) || workflowPassportId;
    return (
      <tr key={wf.id}>
        <td>
          <button className="workflow-passport-link"
            onClick={() => openPassportViewer(wf)}>
            {passportLabel}
          </button>
          <div className="workflow-meta-copy">
            {getWorkflowPassportType(wf)} · v{getWorkflowVersionNumber(wf)}
          </div>
        </td>
        <td><WorkflowBadge status={
          wf.overallStatus === "rejected" ? "rejected" :
          wf.reviewStatus === "pending" ? "submittedForReview" :
          wf.approvalStatus === "pending" ? "submittedForApproval" :
          "released"
        } /></td>
        <td className="small-text">
          {wf.reviewerName || "—"}
          {wf.reviewStatus !== "pending" && (
            <span className={`step-status ${wf.reviewStatus}`}> ({wf.reviewStatus})</span>
          )}
        </td>
        <td className="small-text">
          {wf.approverName || "—"}
          {wf.approvalStatus !== "pending" && (
            <span className={`step-status ${wf.approvalStatus}`}> ({wf.approvalStatus})</span>
          )}
        </td>
        <td className="small-text">{new Date(getWorkflowCreatedAt(wf)).toLocaleDateString()}</td>
        {showActionColumn && (
          <td>
            <div className="workflow-action-group">
              {(needsMyReview || needsMyApproval) && (
                <>
                  <button className="wf-action-btn approve"
                    onClick={() => setModal({ wf, action:"approve" })}>
                    ✅ {t("approvePassport")}
                  </button>
                  <button className="wf-action-btn reject"
                    onClick={() => setModal({ wf, action:"reject" })}>
                    ❌ {t("rejectPassport")}
                  </button>
                </>
              )}
              <button className="wf-action-btn remove"
                onClick={() => setRemoveModal(wf)}
                title={t("removeFromWorkflow")}>
                🗑️ {t("remove")}
              </button>
            </div>
          </td>
        )}
      </tr>
    );
  };

  const currentData = tab === "inprogress" ? data.inProgress
                    : tab === "backlog"    ? data.backlog
                    : data.history;
  const showActionColumn = tab !== "history";

  const workflowColumns = useMemo(() => ([
    { key: "serialNumber", type: "string", getValue: (wf) => getWorkflowModelName(wf) || getWorkflowPassportId(wf) || "" },
    { key: "modelName", type: "string", getValue: (wf) => getWorkflowModelName(wf) },
    { key: "status", type: "string", getValue: (wf) => (
      wf.overallStatus === "rejected" ? "rejected" :
      wf.reviewStatus === "pending" ? "submittedForReview" :
      wf.approvalStatus === "pending" ? "submittedForApproval" :
      "released"
    ) },
    { key: "reviewerName", type: "string", getValue: (wf) => wf.reviewerName || "" },
    { key: "approverName", type: "string", getValue: (wf) => wf.approverName || "" },
    { key: "createdAt", type: "date", getValue: (wf) => getWorkflowCreatedAt(wf) },
  ]), []);

  const controlledData = useMemo(
    () => applyTableControls(currentData, workflowColumns, sortConfig, columnFilters),
    [currentData, workflowColumns, sortConfig, columnFilters]
  );

  const toggleSort = (key) => {
    const nextDirection = getNextSortDirection(sortConfig, key);
    setSortConfig(nextDirection ? { key, direction: nextDirection } : { key: "", direction: "" });
  };

  return (
    <div className="wf-page">
      <div className="wf-header">
        <h2>⚙️ {t("workflow")}</h2>
        <p>{t("workflowSubtitle")}</p>
      </div>

      {flash && <div className="alert alert-success">{flash}</div>}

      <div className="wf-tabs">
        {tabs.map(t => (
          <NavLink key={t.id}
            to={buildDashboardPath({
              companySlug,
              companyName: user?.companyName,
              companyId,
              subpath: `workflow/${t.id}`,
            })}
            className={({ isActive }) => `wf-tab${isActive ? " active" : ""}`}>
            {t.label}
            {t.count > 0 && <span className="wf-count">{t.count}</span>}
          </NavLink>
        ))}
      </div>

      {loading ? (
          <div className="loading">{t("loading")} {t("workflow").toLowerCase()}…</div>
      ) : currentData.length === 0 ? (
        <div className="empty-state">
          <p>{tab === "inprogress" ? t("noWorkflowInProgress")
            : tab === "backlog" ? t("noWorkflowBacklog")
            : t("noWorkflowHistory")}</p>
        </div>
      ) : (
        <>
          <div className="table-tools-row wf-tools-row">
            <button
              type="button"
              className={`table-filter-toggle-btn${showFilters ? " active" : ""}`}
              onClick={() => setShowFilters(prev => !prev)}
            >
              ⚙ Filter
            </button>
          </div>
          <div className="table-container">
          <div className="table-scroll-wrapper">
            <table className="passports-table">
              <thead>
                <tr>
                  <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("serialNumber")}>Passport{sortIndicator(sortConfig, "serialNumber") && ` ${sortIndicator(sortConfig, "serialNumber")}`}</button></th>
                  <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("status")}>Status{sortIndicator(sortConfig, "status") && ` ${sortIndicator(sortConfig, "status")}`}</button></th>
                  <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("reviewerName")}>Reviewer{sortIndicator(sortConfig, "reviewerName") && ` ${sortIndicator(sortConfig, "reviewerName")}`}</button></th>
                  <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("approverName")}>Approver{sortIndicator(sortConfig, "approverName") && ` ${sortIndicator(sortConfig, "approverName")}`}</button></th>
                  <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("createdAt")}>Submitted{sortIndicator(sortConfig, "createdAt") && ` ${sortIndicator(sortConfig, "createdAt")}`}</button></th>
                  {showActionColumn && <th>Actions</th>}
                </tr>
                {showFilters && <tr className="table-filter-row">
                  <th><input className="table-filter-input" value={columnFilters.serialNumber || ""} onChange={e => setColumnFilters(prev => ({ ...prev, serialNumber: e.target.value }))} placeholder="Filter" /></th>
                  <th><input className="table-filter-input" value={columnFilters.status || ""} onChange={e => setColumnFilters(prev => ({ ...prev, status: e.target.value }))} placeholder="Filter" /></th>
                  <th><input className="table-filter-input" value={columnFilters.reviewerName || ""} onChange={e => setColumnFilters(prev => ({ ...prev, reviewerName: e.target.value }))} placeholder="Filter" /></th>
                  <th><input className="table-filter-input" value={columnFilters.approverName || ""} onChange={e => setColumnFilters(prev => ({ ...prev, approverName: e.target.value }))} placeholder="Filter" /></th>
                  <th><input className="table-filter-input" value={columnFilters.createdAt || ""} onChange={e => setColumnFilters(prev => ({ ...prev, createdAt: e.target.value }))} placeholder="Filter" /></th>
                  {showActionColumn && <th></th>}
                </tr>}
              </thead>
              <tbody>
                {controlledData.map(wf => renderRow(wf, tab === "backlog", showActionColumn))}
              </tbody>
            </table>
          </div>
        </div>
        </>
      )}

      {modal && (
        <ActionModal
          wf={modal.wf} action={modal.action}
          companyId={companyId}
          onClose={() => setModal(null)}
          onDone={handleDone}
        />
      )}

      {removeModal && (
        <div className="apt-modal-overlay" onClick={() => setRemoveModal(null)}>
          <div className="apt-modal" onClick={e => e.stopPropagation()}>
            <h3 className="apt-modal-title">{t("removeFromWorkflow")}</h3>
            <div className="apt-modal-warning">
              ⚠️ {t("removeWorkflowMessage", { passport: getWorkflowModelName(removeModal) })}
              {" "}{t("cannotBeUndone")}
            </div>
            <div className="apt-modal-actions">
              <button className="cancel-btn" onClick={() => setRemoveModal(null)}>Cancel</button>
              <button className="apt-modal-delete-btn" onClick={() => handleRemove(removeModal)}>Remove</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default WorkflowDashboard;
