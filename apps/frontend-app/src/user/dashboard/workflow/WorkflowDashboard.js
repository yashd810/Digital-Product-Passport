import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate, NavLink, useParams } from "react-router-dom";
import { applyTableControls, getNextSortDirection, sortIndicator } from "../../../shared/table/tableControls";
import { authHeaders, fetchWithAuth } from "../../../shared/api/authHeaders";
import { isObsoletePassportStatus, normalizePassportStatus } from "../../../passports/utils/passportStatus";
import { buildInactivePassportPath, buildPreviewPassportPath, buildPublicPassportPath } from "../../../passports/utils/passportRoutes";
import { buildPublicViewerUrl } from "../../../passports/utils/publicViewerUrl";
import { extractComplianceError, formatComplianceIssueSummary } from "../../../shared/utils/complianceErrors";
import { getPassportSerialNumber } from "../passports/utils/passportListHelpers";
import { buildDashboardPath } from "../utils/dashboardRoutes";
import "../../../admin/styles/AdminDashboard.css";

const API = import.meta.env.VITE_API_URL || "";

const STATUS_MAP = {
  submitted_for_review:    { label:"In Review",   icon:"🔍" },
  submitted_for_approval:  { label:"In Approval", icon:"📋" },
  released:                { label:"Released",    icon:"✅" },
  rejected:                { label:"Rejected",    icon:"❌" },
};

const getWorkflowPassportId = (wf) => wf?.passportDppId || null;
const getWorkflowPassportType = (wf) => wf?.passportType || "";
const getWorkflowModelName = (wf) => wf?.modelName || "";
const getWorkflowVersionNumber = (wf) => wf?.versionNumber;
const getWorkflowInternalAliasId = (wf) => wf?.internalAliasId || "";
const getWorkflowReleaseStatus = (wf) => wf?.releaseStatus || "";
const getWorkflowCreatedAt = (wf) => wf?.createdAt || "";

function WorkflowBadge({ status }) {
  const s = STATUS_MAP[status] || { label: status, icon:"📄" };
  return (
    <span className={`wf-badge ${status || "default"}`}>
      {s.icon} {s.label}
    </span>
  );
}

function ComplianceFailureNotice({ error }) {
  if (!error?.message) return null;

  const blockingIssues = Array.isArray(error.blockingIssues) ? error.blockingIssues : [];
  const missingFields = Array.isArray(error.missingFields) ? error.missingFields : [];
  const mandatoryMissingFields = missingFields.filter((field) => field?.mandatory);

  return (
    <div className="alert alert-error dashboard-alert-inline wf-compliance-alert">
      <div className="wf-error-title">{error.message}</div>

      {blockingIssues.length > 0 && (
        <div className="wf-error-section">
          <div className="wf-error-heading">Blocking issues</div>
          <ul className="wf-error-list">
            {blockingIssues.map((issue, index) => (
              <li key={`${issue.code || "issue"}-${issue.key || index}`}>
                {formatComplianceIssueSummary(issue)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {mandatoryMissingFields.length > 0 && (
        <div className="wf-error-section">
          <div className="wf-error-heading">
            {error.workflowRequired ? "Missing fields before direct release" : "Missing required fields"}
          </div>
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

function VerificationCheckerNotice({ verification, compliance }) {
  if (!verification && !compliance) return null;

  const blockingIssues = Array.isArray(compliance?.blockingIssues) ? compliance.blockingIssues : [];
  const missingMandatoryFields = Array.isArray(compliance?.completeness?.missingMandatoryFields)
    ? compliance.completeness.missingMandatoryFields
    : [];
  const missingOptionalFields = Array.isArray(compliance?.completeness?.missingVoluntaryFields)
    ? compliance.completeness.missingVoluntaryFields
    : [];
  const passedChecks = Array.isArray(verification?.passedChecks) ? verification.passedChecks : [];

  return (
    <div className="wf-checker-panel">
      <div className="wf-checker-header">
        <div>
          <strong>Verification checker</strong>
          <div className="wf-checker-subtitle">
            Advisory only. This helps you see what is complete and what is still missing.
          </div>
        </div>
        <span className={`wf-checker-status ${verification?.status || "unknown"}`}>
          {verification?.status === "ready"
            ? "Ready"
            : verification?.status === "missing_optional_fields"
              ? "Missing optional fields"
              : verification?.status === "missing_required_fields"
                ? "Missing required fields"
                : verification?.status === "issues_found"
                  ? "Issues found"
                  : "Not run yet"}
        </span>
      </div>

      <div className="wf-checker-metrics">
        <div><span>Completeness</span><strong>{verification?.completenessPercentage ?? 0}%</strong></div>
        <div><span>Blocking issues</span><strong>{verification?.counts?.blockingIssues ?? blockingIssues.length}</strong></div>
        <div><span>Missing required</span><strong>{verification?.counts?.missingRequiredFields ?? missingMandatoryFields.length}</strong></div>
        <div><span>Missing optional</span><strong>{verification?.counts?.missingOptionalFields ?? missingOptionalFields.length}</strong></div>
      </div>

      {passedChecks.length > 0 && (
        <div className="wf-error-section">
          <div className="wf-error-heading">Good</div>
          <ul className="wf-error-list">
            {passedChecks.map((item, index) => <li key={`passed-${index}`}>{item}</li>)}
          </ul>
        </div>
      )}

      {blockingIssues.length > 0 && (
        <div className="wf-error-section">
          <div className="wf-error-heading">Needs attention</div>
          <ul className="wf-error-list">
            {blockingIssues.map((issue, index) => (
              <li key={`${issue.code || "issue"}-${issue.key || index}`}>
                {formatComplianceIssueSummary(issue)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {missingMandatoryFields.length > 0 && (
        <div className="wf-error-section">
          <div className="wf-error-heading">Missing required fields</div>
          <ul className="wf-error-list">
            {missingMandatoryFields.map((field, index) => (
              <li key={`${field.key || field.label || "required"}-${index}`}>
                {field.label || field.key}
                {field.section ? ` (${field.section})` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {missingOptionalFields.length > 0 && (
        <div className="wf-error-section">
          <div className="wf-error-heading">Missing optional fields</div>
          <ul className="wf-error-list">
            {missingOptionalFields.map((field, index) => (
              <li key={`${field.key || field.label || "optional"}-${index}`}>
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
  const [verification, setVerification] = useState(null);
  const [verificationLoading, setVerificationLoading] = useState(false);
  const checkerOnly = Boolean(passport?.checkerOnly);

  useEffect(() => {
    // Load eligible users (editors + admins)
    fetchWithAuth(`${API}/api/companies/${companyId}/users`, {
      headers: authHeaders()
    })
    .then(r => r.json())
    .then(data => {
      const eligible = data.filter(u =>
        (u.role === "editor" || u.role === "company_admin") && u.id !== user?.id
      );
      setTeamUsers(eligible);
    })
    .catch(() => {});

    // Pre-fill from user defaults
    fetchWithAuth(`${API}/api/users/me`, { headers: authHeaders() })
    .then(r => r.json())
    .then(d => {
      if (d.defaultReviewerId) setReviewerId(String(d.defaultReviewerId));
      if (d.defaultApproverId) setApproverId(String(d.defaultApproverId));
    })
    .catch(() => {});
  }, [companyId, user?.id]);

  const runVerificationCheck = useCallback(async () => {
    setVerificationLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ passportType: getWorkflowPassportType(passport) });
      const response = await fetchWithAuth(
        `${API}/api/companies/${companyId}/passports/${passport.dppId}/verification-check?${params.toString()}`,
        { headers: authHeaders() }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(extractComplianceError(data, "Failed to run verification check"));
        return;
      }
      setVerification(data);
    } catch (err) {
      setError({ message: err.message || "Failed to run verification check", blockingIssues: [], missingFields: [] });
    } finally {
      setVerificationLoading(false);
    }
  }, [companyId, passport.dppId, passport.passportType]);

  useEffect(() => {
    if (checkerOnly) {
      runVerificationCheck();
    }
  }, [checkerOnly, runVerificationCheck]);

  const handleRelease = async () => {
    setSubmitting(true); setError(null);
    const hasWorkflow = reviewerId || approverId;
    try {
      if (hasWorkflow) {
        // Submit to workflow
        const r = await fetchWithAuth(
          `${API}/api/companies/${companyId}/passports/${passport.dppId}/submit-review`,
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
        if (d?.compliance) {
          setVerification({
            success: true,
            compliance: d.compliance,
            verification: {
              status: d.compliance?.blockingIssues?.length
                ? "issues_found"
                : d.compliance?.completeness?.missingMandatoryFields?.length
                  ? "missing_required_fields"
                  : d.compliance?.completeness?.missingVoluntaryFields?.length
                    ? "missing_optional_fields"
                    : "ready",
              passedChecks: [],
              completenessPercentage: d.compliance?.completeness?.percentage ?? 0,
              counts: {
                blockingIssues: d.compliance?.blockingIssues?.length ?? 0,
                missingRequiredFields: d.compliance?.completeness?.missingMandatoryFields?.length ?? 0,
                missingOptionalFields: d.compliance?.completeness?.missingVoluntaryFields?.length ?? 0,
              },
            },
          });
        }
        onDone("Submitted for review/approval");
      } else {
        // Direct release (no workflow)
        const r = await fetchWithAuth(
          `${API}/api/companies/${companyId}/passports/${passport.dppId}/release`,
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
        if (d?.compliance || d?.verification) {
          setVerification({
            success: true,
            compliance: d.compliance || null,
            verification: d.verification || null,
          });
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
          <h3>{checkerOnly ? "🧪 Verification Check" : "🎯 Release Passport"}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <p className="modal-passport-name">
            <strong>{getWorkflowModelName(passport)}</strong>
            <span className="modal-version"> v{getWorkflowVersionNumber(passport)}</span>
          </p>
          <p className="modal-hint">
            {checkerOnly
              ? "Run the verification checker to see what is good, what is missing, and what may need attention."
              : "Optionally assign a reviewer and/or approver. Leave both empty to release immediately. Verification is advisory and does not block the workflow."}
          </p>

          <ComplianceFailureNotice error={error} />
          <VerificationCheckerNotice verification={verification?.verification} compliance={verification?.compliance} />

          <div className="wf-checker-actions">
            <button
              className="btn-cancel-wf"
              type="button"
              onClick={runVerificationCheck}
              disabled={verificationLoading || submitting}
            >
              {verificationLoading ? "Checking…" : verification ? "Run again" : "Run verification check"}
            </button>
          </div>

          {!checkerOnly && (
            <>
              <div className="wf-select-group">
                <label>🔍 Reviewer <span className="wf-opt">(optional)</span></label>
                <select value={reviewerId} onChange={e => setReviewerId(e.target.value)} disabled={submitting}>
                  <option value="">— Skip review —</option>
                  {teamUsers.map(u => (
                    <option key={u.id} value={u.id}>
                      {u.firstName} {u.lastName} — {u.role}
                    </option>
                  ))}
                </select>
              </div>

              <div className="wf-select-group">
                <label>✅ Approver <span className="wf-opt">(optional)</span></label>
                <select value={approverId} onChange={e => setApproverId(e.target.value)} disabled={submitting}>
                  <option value="">— Skip approval —</option>
                  {teamUsers.filter(u => !reviewerId || String(u.id) !== reviewerId).map(u => (
                    <option key={u.id} value={u.id}>
                      {u.firstName} {u.lastName} — {u.role}
                    </option>
                  ))}
                </select>
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
          )}
        </div>
        <div className="modal-footer">
          <button className="btn-cancel-wf" onClick={onClose} disabled={submitting}>Cancel</button>
          {!checkerOnly && (
            <button className="btn-release-wf" onClick={handleRelease} disabled={submitting}>
              {submitting ? "Submitting…" :
                reviewerId || approverId ? "Submit for Review" : "Release Now"}
            </button>
          )}
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
      const r = await fetchWithAuth(`${API}/api/passports/${workflowPassportId}/workflow/${action}`, {
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
        fetchWithAuth(`${API}/api/companies/${companyId}/workflow`, {
          headers: authHeaders()
        }),
        fetchWithAuth(`${API}/api/users/me/backlog`, {
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
      const r = await fetchWithAuth(`${API}/api/passports/${workflowPassportId}/workflow`, {
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
    { id:"inprogress", label:"In Progress",  count: data.inProgress.length },
    { id:"backlog",    label:"My Backlog",    count: data.backlog.length },
    { id:"history",    label:"History",       count: data.history.length },
  ];
  const openPassportViewer = (wf) => {
    const workflowPassportId = getWorkflowPassportId(wf);
    if (!workflowPassportId) return;
    const normalizedStatus = normalizePassportStatus(getWorkflowReleaseStatus(wf));
    const path = normalizedStatus === "released" && getWorkflowInternalAliasId(wf)
      ? buildPublicPassportPath({
          companyName: user?.companyName,
          modelName: getWorkflowModelName(wf),
          internalAliasId: getWorkflowInternalAliasId(wf),
        })
      : isObsoletePassportStatus(normalizedStatus) && getWorkflowInternalAliasId(wf) && getWorkflowVersionNumber(wf) != null
        ? buildInactivePassportPath({
            companyName: user?.companyName,
            modelName: getWorkflowModelName(wf),
            internalAliasId: getWorkflowInternalAliasId(wf),
            versionNumber: getWorkflowVersionNumber(wf),
          })
      : buildPreviewPassportPath({
          companyName: user?.companyName,
          modelName: getWorkflowModelName(wf),
          internalAliasId: getWorkflowInternalAliasId(wf),
          previewId: workflowPassportId,
        });
    if (!path) return;
    const url = normalizedStatus === "released" || isObsoletePassportStatus(normalizedStatus)
      ? buildPublicViewerUrl(path)
      : `${window.location.origin}${path}`;
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const renderRow = (wf, showActions, showActionColumn) => {
    const needsMyReview = showActions && String(wf.reviewerId) === String(user?.id) && wf.reviewStatus === "pending";
    const needsMyApproval = showActions && String(wf.approverId) === String(user?.id) && wf.approvalStatus === "pending" && wf.reviewStatus !== "pending";
    const workflowPassportId = getWorkflowPassportId(wf);
    const serialNumber = getPassportSerialNumber(wf);
    return (
      <tr key={wf.id}>
        <td>
          <button className="model-link-btn"
            onClick={() => openPassportViewer(wf)}>
            {serialNumber || getWorkflowModelName(wf) || workflowPassportId}
          </button>
          <div className="workflow-meta-copy">
            {getWorkflowPassportType(wf)} · v{getWorkflowVersionNumber(wf)}
          </div>
        </td>
        <td><WorkflowBadge status={
          wf.overallStatus === "rejected" ? "rejected" :
          wf.reviewStatus === "pending" ? "submitted_for_review" :
          wf.approvalStatus === "pending" ? "submitted_for_approval" :
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
                    ✅ Approve
                  </button>
                  <button className="wf-action-btn reject"
                    onClick={() => setModal({ wf, action:"reject" })}>
                    ❌ Reject
                  </button>
                </>
              )}
              <button className="wf-action-btn remove"
                onClick={() => setRemoveModal(wf)}
                title="Remove from workflow">
                🗑️ Remove
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
    { key: "serialNumber", type: "string", getValue: (wf) => getPassportSerialNumber(wf) },
    { key: "modelName", type: "string", getValue: (wf) => getWorkflowModelName(wf) },
    { key: "status", type: "string", getValue: (wf) => (
      wf.overallStatus === "rejected" ? "rejected" :
      wf.reviewStatus === "pending" ? "submitted_for_review" :
      wf.approvalStatus === "pending" ? "submitted_for_approval" :
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
        <h2>⚙️ Workflow</h2>
        <p>Track passport review and approval processes</p>
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
        <div className="loading">Loading workflow…</div>
      ) : currentData.length === 0 ? (
        <div className="empty-state">
          <p>{tab === "inprogress" ? "No passports currently in workflow."
            : tab === "backlog" ? "No passports waiting for your action."
            : "No workflow history yet."}</p>
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
            <h3 className="apt-modal-title">Remove from Workflow?</h3>
            <div className="apt-modal-warning">
              ⚠️ This will permanently remove <strong>{getWorkflowModelName(removeModal)}</strong> from the workflow.
              This action cannot be undone.
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
