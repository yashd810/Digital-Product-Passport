import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate, NavLink } from "react-router-dom";
import { applyTableControls, getNextSortDirection, sortIndicator } from "../../../shared/table/tableControls";
import { authHeaders } from "../../../shared/api/authHeaders";
import { normalizePassportStatus } from "../../../passports/utils/passportStatus";
import { buildPreviewPassportPath, buildPublicPassportPath } from "../../../passports/utils/passportRoutes";
import "../../../admin/styles/AdminDashboard.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

const STATUS_MAP = {
  submitted_for_review:    { label:"In Review",   icon:"🔍" },
  submitted_for_approval:  { label:"In Approval", icon:"📋" },
  released:                { label:"Released",    icon:"✅" },
  rejected:                { label:"Rejected",    icon:"❌" },
};

function WorkflowBadge({ status }) {
  const s = STATUS_MAP[status] || { label: status, icon:"📄" };
  return (
    <span className={`wf-badge ${status || "default"}`}>
      {s.icon} {s.label}
    </span>
  );
}

// ── Release Modal with reviewer + approver selection ──────────
export function ReleaseModal({ passport, companyId, user, onClose, onDone }) {
  const [teamUsers,    setTeamUsers]    = useState([]);
  const [reviewerId,   setReviewerId]   = useState("");
  const [approverId,   setApproverId]   = useState("");
  const [submitting,   setSubmitting]   = useState(false);
  const [error,        setError]        = useState("");

  useEffect(() => {
    // Load eligible users (editors + admins)
    fetch(`${API}/api/companies/${companyId}/users`, {
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
    fetch(`${API}/api/users/me`, { headers: authHeaders() })
    .then(r => r.json())
    .then(d => {
      if (d.default_reviewer_id) setReviewerId(String(d.default_reviewer_id));
      if (d.default_approver_id) setApproverId(String(d.default_approver_id));
    })
    .catch(() => {});
  }, []);

  const handleRelease = async () => {
    setSubmitting(true); setError("");
    const hasWorkflow = reviewerId || approverId;
    try {
      if (hasWorkflow) {
        // Submit to workflow
        const r = await fetch(
          `${API}/api/companies/${companyId}/passports/${passport.guid}/submit-review`,
          {
            method: "POST",
            headers: authHeaders({ "Content-Type":"application/json" }),
            body: JSON.stringify({
              passportType: passport.passport_type,
              reviewerId:   reviewerId ? parseInt(reviewerId) : null,
              approverId:   approverId ? parseInt(approverId) : null,
            }),
          }
        );
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Failed");
        onDone("Submitted for review/approval");
      } else {
        // Direct release (no workflow)
        const r = await fetch(
          `${API}/api/companies/${companyId}/passports/${passport.guid}/release`,
          {
            method: "PATCH",
            headers: authHeaders({ "Content-Type":"application/json" }),
            body: JSON.stringify({ passportType: passport.passport_type }),
          }
        );
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Failed");
        onDone("Released");
      }
    } catch (err) {
      setError(err.message);
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
            <strong>{passport.model_name}</strong>
            <span className="modal-version"> v{passport.version_number}</span>
          </p>
          <p className="modal-hint">
            Optionally assign a reviewer and/or approver. Leave both empty to release immediately.
          </p>

          {error && <div className="alert alert-error dashboard-alert-inline">{error}</div>}

          <div className="wf-select-group">
            <label>🔍 Reviewer <span className="wf-opt">(optional)</span></label>
            <select value={reviewerId} onChange={e => setReviewerId(e.target.value)} disabled={submitting}>
              <option value="">— Skip review —</option>
              {teamUsers.map(u => (
                <option key={u.id} value={u.id}>
                  {u.first_name} {u.last_name} — {u.role}
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
                  {u.first_name} {u.last_name} — {u.role}
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
  const [error,     setError]     = useState("");

  const handle = async () => {
    setSubmitting(true); setError("");
    try {
      const r = await fetch(`${API}/api/passports/${wf.passport_guid}/workflow/${action}`, {
        method: "POST",
        headers: authHeaders({ "Content-Type":"application/json" }),
        body: JSON.stringify({ comment, passportType: wf.passport_type }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      onDone(`${action === "approve" ? "Approved" : "Rejected"} successfully`);
    } catch (err) {
      setError(err.message);
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
          <p><strong>{wf.model_name}</strong> v{wf.version_number}</p>
          {error && <div className="alert alert-error dashboard-alert-inline">{error}</div>}
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
  const tab = activeTab;
  const [data,    setData]    = useState({ inProgress:[], backlog:[], history:[] });
  const [loading, setLoading] = useState(true);
  const [modal,   setModal]   = useState(null); // {wf, action}
  const [removeModal, setRemoveModal] = useState(null); // {wf}
  const [flash,   setFlash]   = useState("");
  const [sortConfig, setSortConfig] = useState({ key: "created_at", direction: "desc" });
  const [columnFilters, setColumnFilters] = useState({});
  const [showFilters, setShowFilters] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [wfRes, blRes] = await Promise.all([
        fetch(`${API}/api/companies/${companyId}/workflow`, {
          headers: authHeaders()
        }),
        fetch(`${API}/api/users/me/backlog`, {
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
      const r = await fetch(`${API}/api/passports/${wf.passport_guid}/workflow`, {
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
    if (!wf?.passport_guid) return;
    const normalizedStatus = normalizePassportStatus(wf.release_status);
    const path = normalizedStatus === "released" && wf.product_id
      ? buildPublicPassportPath({
          companyName: user?.company_name,
          modelName: wf.model_name,
          productId: wf.product_id,
        })
      : buildPreviewPassportPath({
          companyName: user?.company_name,
          modelName: wf.model_name,
          productId: wf.product_id,
          previewId: wf.passport_guid,
        });
    if (!path) return;
    window.open(`${window.location.origin}${path}`, "_blank", "noopener,noreferrer");
  };

  const renderRow = (wf, showActions) => {
    const needsMyReview    = showActions && wf.reviewer_id === user?.id && wf.review_status === "pending";
    const needsMyApproval  = showActions && wf.approver_id === user?.id && wf.approval_status === "pending" && wf.review_status !== "pending";
    return (
      <tr key={wf.id}>
        <td>
          <button className="model-link-btn"
            onClick={() => openPassportViewer(wf)}>
            {wf.serial_number || wf.product_id || wf.passport_guid}
          </button>
          <div className="workflow-meta-copy">
            {wf.passport_type} · v{wf.version_number}
          </div>
        </td>
        <td><WorkflowBadge status={
          wf.overall_status === "rejected" ? "rejected" :
          wf.review_status === "pending" ? "submitted_for_review" :
          wf.approval_status === "pending" ? "submitted_for_approval" :
          "released"
        } /></td>
        <td className="small-text">
          {wf.reviewer_name || "—"}
          {wf.review_status !== "pending" && (
            <span className={`step-status ${wf.review_status}`}> ({wf.review_status})</span>
          )}
        </td>
        <td className="small-text">
          {wf.approver_name || "—"}
          {wf.approval_status !== "pending" && (
            <span className={`step-status ${wf.approval_status}`}> ({wf.approval_status})</span>
          )}
        </td>
        <td className="small-text">{new Date(wf.created_at).toLocaleDateString()}</td>
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
      </tr>
    );
  };

  const currentData = tab === "inprogress" ? data.inProgress
                    : tab === "backlog"    ? data.backlog
                    : data.history;

  const workflowColumns = useMemo(() => ([
    { key: "model_name", type: "string", getValue: (wf) => wf.model_name || "" },
    { key: "status", type: "string", getValue: (wf) => (
      wf.overall_status === "rejected" ? "rejected" :
      wf.review_status === "pending" ? "submitted_for_review" :
      wf.approval_status === "pending" ? "submitted_for_approval" :
      "released"
    ) },
    { key: "reviewer_name", type: "string", getValue: (wf) => wf.reviewer_name || "" },
    { key: "approver_name", type: "string", getValue: (wf) => wf.approver_name || "" },
    { key: "created_at", type: "date", getValue: (wf) => wf.created_at },
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
            to={`/dashboard/workflow/${t.id}`}
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
                  <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("serial_number")}>Passport{sortIndicator(sortConfig, "serial_number") && ` ${sortIndicator(sortConfig, "serial_number")}`}</button></th>
                  <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("status")}>Status{sortIndicator(sortConfig, "status") && ` ${sortIndicator(sortConfig, "status")}`}</button></th>
                  <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("reviewer_name")}>Reviewer{sortIndicator(sortConfig, "reviewer_name") && ` ${sortIndicator(sortConfig, "reviewer_name")}`}</button></th>
                  <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("approver_name")}>Approver{sortIndicator(sortConfig, "approver_name") && ` ${sortIndicator(sortConfig, "approver_name")}`}</button></th>
                  <th><button type="button" className="table-sort-btn" onClick={() => toggleSort("created_at")}>Submitted{sortIndicator(sortConfig, "created_at") && ` ${sortIndicator(sortConfig, "created_at")}`}</button></th>
                  <th>Actions</th>
                </tr>
                {showFilters && <tr className="table-filter-row">
                  <th><input className="table-filter-input" value={columnFilters.serial_number || ""} onChange={e => setColumnFilters(prev => ({ ...prev, serial_number: e.target.value }))} placeholder="Filter" /></th>
                  <th><input className="table-filter-input" value={columnFilters.status || ""} onChange={e => setColumnFilters(prev => ({ ...prev, status: e.target.value }))} placeholder="Filter" /></th>
                  <th><input className="table-filter-input" value={columnFilters.reviewer_name || ""} onChange={e => setColumnFilters(prev => ({ ...prev, reviewer_name: e.target.value }))} placeholder="Filter" /></th>
                  <th><input className="table-filter-input" value={columnFilters.approver_name || ""} onChange={e => setColumnFilters(prev => ({ ...prev, approver_name: e.target.value }))} placeholder="Filter" /></th>
                  <th><input className="table-filter-input" value={columnFilters.created_at || ""} onChange={e => setColumnFilters(prev => ({ ...prev, created_at: e.target.value }))} placeholder="Filter" /></th>
                  <th></th>
                </tr>}
              </thead>
              <tbody>
                {controlledData.map(wf => renderRow(wf, tab === "backlog"))}
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
              ⚠️ This will permanently remove <strong>{removeModal.model_name}</strong> from the workflow.
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
