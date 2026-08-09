import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { authHeaders, fetchWithAuth } from "../../../shared/api/authHeaders";
import { buildDashboardPath } from "../utils/dashboardRoutes";
import { safeWindowOpen, toSafeInternalPath } from "../../../shared/security/urlSafety";
import { useMotionPresence } from "../../../shared/hooks/useMotionPresence";
import { useI18n } from "../../../app/providers/i18n";
import "../../../shared/styles/Dashboard.css";

const api = import.meta.env.VITE_API_URL || "";

const notifIcons = {
  passportReleased:    "🚀",
  passportRevised:     "🔄",
  workflowReview:      "🔍",
  workflowApproval:    "📋",
  workflowApproved:    "✅",
  workflowRejected:    "❌",
  workflowSubmitted:   "📤",
  documentExpiring:    "⏰",
  teamInvite:          "✉️",
  commentAdded:        "💬",
  default:              "🔔",
};

function timeAgo(dateStr, t) {
  const secs = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (secs < 60)   return t("justNow");
  if (secs < 3600) return t("minutesAgo", { count: Math.floor(secs / 60) });
  if (secs < 86400)return t("hoursAgo", { count: Math.floor(secs / 3600) });
  return t("daysAgo", { count: Math.floor(secs / 86400) });
}

function NotificationsPanel({ user }) {
  const { t } = useI18n();
  const navigate   = useNavigate();
  const notificationsPath = buildDashboardPath({
    companyName: user?.companyName,
    subpath: "notifications",
  });
  const [open,     setOpen]     = useState(false);
  const [notifs,   setNotifs]   = useState([]);
  const [unread,   setUnread]   = useState(0);
  const [loading,  setLoading]  = useState(false);
  const panelRef   = useRef(null);
  const btnRef     = useRef(null);
  const panelPresent = useMotionPresence(open);

  const fetchNotifs = async () => {
    setLoading(true);
    try {
      const r = await fetchWithAuth(`${api}/api/users/me/notifications?limit=25`, {
        headers: { ...authHeaders() },
      });
      if (r.ok) {
        const data = await r.json();
        setNotifs(data);
        setUnread(data.filter(n => !n.read).length);
      }
    } catch { }
    finally { setLoading(false); }
  };

  useEffect(() => {
    fetchNotifs();
    const interval = setInterval(fetchNotifs, 30000); // poll every 30s
    return () => clearInterval(interval);
  }, []);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (open && panelRef.current && !panelRef.current.contains(e.target)
          && btnRef.current && !btnRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const markAllRead = async () => {
    try {
      await fetchWithAuth(`${api}/api/users/me/notifications/read-all`, {
        method: "PATCH",
        headers: { ...authHeaders() },
      });
      setNotifs(prev => prev.map(n => ({ ...n, read: true })));
      setUnread(0);
    } catch { }
  };

  const markRead = async (id) => {
    try {
      await fetchWithAuth(`${api}/api/users/me/notifications/${id}/read`, {
        method: "PATCH",
        headers: { ...authHeaders() },
      });
      setNotifs(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
      setUnread(prev => Math.max(0, prev - 1));
    } catch { }
  };

  const handleClick = (n) => {
    markRead(n.id);
    setOpen(false);
    const safeActionPath = toSafeInternalPath(n.actionUrl);
    if (safeActionPath) {
      navigate(safeActionPath);
      return;
    }
    if (n.passportDppId) {
      safeWindowOpen(`${window.location.origin}/dpp/preview/company/product/${encodeURIComponent(n.passportDppId)}`);
      return;
    }
  };

  return (
    <div className="notif-container">
      <button
        ref={btnRef}
        className={`notif-bell${open ? " open" : ""}`}
        onClick={() => { setOpen(o => !o); if (!open) fetchNotifs(); }}
        title={t("notifications")}
      >
        🔔
        {unread > 0 && (
          <span className="notif-badge">{unread > 99 ? "99+" : unread}</span>
        )}
      </button>

      {panelPresent && (
        <div
          ref={panelRef}
          className={`notif-panel${open ? " is-open" : ""}`}
          aria-hidden={!open}
          inert={open ? undefined : ""}
        >
          <div className="notif-panel-header">
            <span className="notif-panel-title">{t("notifications")}</span>
            {unread > 0 && (
              <button className="notif-mark-all" onClick={markAllRead}>
                {t("markAllRead")}
              </button>
            )}
          </div>

          <div className="notif-panel-view-all">
            <button className="notif-view-all-btn" onClick={() => { setOpen(false); navigate(notificationsPath); }}>
              {t("viewAllWorkflowHistory")} →
            </button>
          </div>
          <div className="notif-list">
            {loading && notifs.length === 0 ? (
              <div className="notif-empty">Loading…</div>
            ) : notifs.length === 0 ? (
              <div className="notif-empty">
                <div style={{ fontSize:32, marginBottom:8 }}>🔔</div>
                {t("noNotifications")}
              </div>
            ) : (
              notifs.map(n => (
                <div key={n.id}
                  className={`notif-item${n.read ? "" : " unread"}`}
                  onClick={() => handleClick(n)}>
                  <div className="notif-icon">
                    {notifIcons[n.type] || notifIcons.default}
                  </div>
                  <div className="notif-content">
                    <div className="notif-title">{n.title}</div>
                    {n.message && <div className="notif-msg">{n.message}</div>}
                    <div className="notif-time">{timeAgo(n.createdAt, t)}</div>
                  </div>
                  {!n.read && <div className="notif-dot" />}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default NotificationsPanel;
