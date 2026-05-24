import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { authHeaders, fetchWithAuth } from "../../../shared/api/authHeaders";
import "../../../assets/styles/Dashboard.css";

const API = import.meta.env.VITE_API_URL || "";

const NOTIF_ICONS = {
  passport_released:  "🚀",
  passport_revised:   "🔄",
  workflow_review:    "🔍",
  workflow_approval:  "📋",
  workflow_approved:  "✅",
  workflow_rejected:  "❌",
  workflow_submitted: "📤",
  document_expiring:  "⏰",
  team_invite:        "✉️",
  comment_added:      "💬",
  default:            "🔔",
};

const TYPE_LABELS = {
  passport_released:  "Released",
  passport_revised:   "Revised",
  workflow_review:    "Review Requested",
  workflow_approval:  "Approval Requested",
  workflow_approved:  "Approved",
  workflow_rejected:  "Rejected",
  workflow_submitted: "Submitted",
  team_invite:        "Team Invite",
  default:            "Notification",
};

function fmt(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function timeAgo(dateStr) {
  const secs = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (secs < 60)    return "just now";
  if (secs < 3600)  return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function StatusPill({ status }) {
  const map = {
    pending:   { label: "Pending",   cls: "nwf-pill-pending"  },
    approved:  { label: "Approved",  cls: "nwf-pill-approved" },
    rejected:  { label: "Rejected",  cls: "nwf-pill-rejected" },
    skipped:   { label: "Skipped",   cls: "nwf-pill-skipped"  },
    in_progress: { label: "In Progress", cls: "nwf-pill-pending" },
  };
  const s = map[status] || { label: status, cls: "nwf-pill-skipped" };
  return <span className={`nwf-pill ${s.cls}`}>{s.label}</span>;
}

export default function NotificationsPage({ user }) {
  const navigate = useNavigate();
  const [notifs,   setNotifs]   = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [filter,   setFilter]   = useState("all");

  useEffect(() => {
    (async () => {
      try {
        const r = await fetchWithAuth(`${API}/api/users/me/notifications/full?limit=100`, {
          headers: authHeaders(),
        });
        if (r.ok) setNotifs(await r.json());
      } catch {}
      finally { setLoading(false); }
    })();
  }, []);

  const markAllRead = async () => {
    await fetchWithAuth(`${API}/api/users/me/notifications/read-all`, {
      method: "PATCH", headers: authHeaders(),
    });
    setNotifs(prev => prev.map(n => ({ ...n, read: true })));
  };

  const markRead = async (id) => {
    await fetchWithAuth(`${API}/api/users/me/notifications/${id}/read`, {
      method: "PATCH", headers: authHeaders(),
    });
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  const hasWorkflow = (n) => n.workflowSubmittedAt || n.reviewerName || n.approverName;

  const filtered = notifs.filter(n => {
    if (filter === "unread")   return !n.read;
    if (filter === "workflow") return hasWorkflow(n);
    return true;
  });

  const unreadCount = notifs.filter(n => !n.read).length;

  return (
    <div className="nwf-page">
      <div className="nwf-header-row">
        <button className="csv-back-btn" onClick={() => navigate(-1)}>← Back</button>
        <div className="nwf-header-right">
          {unreadCount > 0 && (
            <button className="nwf-mark-all-btn" onClick={markAllRead}>
              Mark all as read
            </button>
          )}
        </div>
      </div>

      <h2 className="nwf-title">🔔 Notifications &amp; Workflow History</h2>
      <p className="nwf-subtitle">All notifications with full reviewer, approver and comment details.</p>

      <div className="nwf-filters">
        {["all", "unread", "workflow"].map(f => (
          <button key={f}
            className={`nwf-filter-btn${filter === f ? " active" : ""}`}
            onClick={() => setFilter(f)}>
            {f === "all" ? "All" : f === "unread" ? `Unread${unreadCount ? ` (${unreadCount})` : ""}` : "Workflow"}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="nwf-loading">Loading notifications…</div>
      ) : filtered.length === 0 ? (
        <div className="nwf-empty">
          <div style={{ fontSize: 40, marginBottom: 10 }}>🔔</div>
          No notifications yet.
        </div>
      ) : (
        <div className="nwf-list">
          {filtered.map(n => {
            const isOpen = expanded === n.id;
            const wf = hasWorkflow(n);
            return (
              <div key={n.id} className={`nwf-card${n.read ? "" : " nwf-card-unread"}`}>
                <div className="nwf-card-main" onClick={() => {
                  if (!n.read) markRead(n.id);
                  setExpanded(isOpen ? null : n.id);
                }}>
                  <div className="nwf-card-icon">
                    {NOTIF_ICONS[n.type] || NOTIF_ICONS.default}
                  </div>
                  <div className="nwf-card-body">
                    <div className="nwf-card-top">
                      <span className="nwf-card-title">{n.title}</span>
                      <span className={`nwf-type-badge nwf-type-${n.type}`}>
                        {TYPE_LABELS[n.type] || n.type}
                      </span>
                    </div>
                    {n.message && <div className="nwf-card-msg">{n.message}</div>}
                    <div className="nwf-card-meta">
                      <span className="nwf-card-time">{fmt(n.createdAt)}</span>
                      <span className="nwf-card-ago">· {timeAgo(n.createdAt)}</span>
                      {wf && <span className="nwf-has-detail">📋 Workflow details</span>}
                    </div>
                  </div>
                  <div className="nwf-card-actions">
                    {!n.read && <span className="nwf-unread-dot" />}
                    {wf && <span className="nwf-expand-chevron">{isOpen ? "▲" : "▼"}</span>}
                  </div>
                </div>

                {isOpen && wf && (
                  <div className="nwf-detail">
                    <div className="nwf-detail-title">Workflow Details</div>
                    <div className="nwf-detail-grid">

                      {n.workflowSubmittedAt && (
                        <div className="nwf-detail-row">
                          <span className="nwf-detail-label">Submitted</span>
                          <span className="nwf-detail-value">{fmt(n.workflowSubmittedAt)}</span>
                        </div>
                      )}

                      {n.submitterName?.trim() && (
                        <div className="nwf-detail-row">
                          <span className="nwf-detail-label">Submitted by</span>
                          <span className="nwf-detail-value">{n.submitterName} <span className="nwf-detail-email">({n.submitterEmail})</span></span>
                        </div>
                      )}

                      {n.overallStatus && (
                        <div className="nwf-detail-row">
                          <span className="nwf-detail-label">Overall status</span>
                          <span className="nwf-detail-value"><StatusPill status={n.overallStatus} /></span>
                        </div>
                      )}

                      {n.reviewerName?.trim() && (
                        <>
                          <div className="nwf-detail-section-label">Review</div>
                          <div className="nwf-detail-row">
                            <span className="nwf-detail-label">Reviewer</span>
                            <span className="nwf-detail-value">{n.reviewerName} <span className="nwf-detail-email">({n.reviewerEmail})</span></span>
                          </div>
                          <div className="nwf-detail-row">
                            <span className="nwf-detail-label">Status</span>
                            <span className="nwf-detail-value"><StatusPill status={n.reviewStatus} /></span>
                          </div>
                          {n.reviewedAt && (
                            <div className="nwf-detail-row">
                              <span className="nwf-detail-label">Reviewed at</span>
                              <span className="nwf-detail-value">{fmt(n.reviewedAt)}</span>
                            </div>
                          )}
                          {n.reviewerComment && (
                            <div className="nwf-detail-row nwf-detail-row-full">
                              <span className="nwf-detail-label">Reviewer comment</span>
                              <div className="nwf-comment-box">{n.reviewerComment}</div>
                            </div>
                          )}
                        </>
                      )}

                      {n.approverName?.trim() && (
                        <>
                          <div className="nwf-detail-section-label">Approval</div>
                          <div className="nwf-detail-row">
                            <span className="nwf-detail-label">Approver</span>
                            <span className="nwf-detail-value">{n.approverName} <span className="nwf-detail-email">({n.approverEmail})</span></span>
                          </div>
                          <div className="nwf-detail-row">
                            <span className="nwf-detail-label">Status</span>
                            <span className="nwf-detail-value"><StatusPill status={n.approvalStatus} /></span>
                          </div>
                          {n.approvedAt && (
                            <div className="nwf-detail-row">
                              <span className="nwf-detail-label">Approved at</span>
                              <span className="nwf-detail-value">{fmt(n.approvedAt)}</span>
                            </div>
                          )}
                          {n.rejectedAt && (
                            <div className="nwf-detail-row">
                              <span className="nwf-detail-label">Rejected at</span>
                              <span className="nwf-detail-value">{fmt(n.rejectedAt)}</span>
                            </div>
                          )}
                          {n.approverComment && (
                            <div className="nwf-detail-row nwf-detail-row-full">
                              <span className="nwf-detail-label">Approver comment</span>
                              <div className="nwf-comment-box">{n.approverComment}</div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
