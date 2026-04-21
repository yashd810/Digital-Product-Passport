import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { authHeaders } from "../../../shared/api/authHeaders";
import "../../../assets/styles/Dashboard.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

const NOTIF_ICONS = {
  passport_released:    "🚀",
  passport_revised:     "🔄",
  workflow_review:      "🔍",
  workflow_approval:    "📋",
  workflow_approved:    "✅",
  workflow_rejected:    "❌",
  workflow_submitted:   "📤",
  document_expiring:    "⏰",
  team_invite:          "✉️",
  comment_added:        "💬",
  default:              "🔔",
};

function timeAgo(dateStr) {
  const secs = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (secs < 60)   return "just now";
  if (secs < 3600) return `${Math.floor(secs/60)}m ago`;
  if (secs < 86400)return `${Math.floor(secs/3600)}h ago`;
  return `${Math.floor(secs/86400)}d ago`;
}

function NotificationsPanel({ user }) {
  const navigate   = useNavigate();
  const [open,     setOpen]     = useState(false);
  const [notifs,   setNotifs]   = useState([]);
  const [unread,   setUnread]   = useState(0);
  const [loading,  setLoading]  = useState(false);
  const panelRef   = useRef(null);
  const btnRef     = useRef(null);

  const fetchNotifs = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/users/me/notifications?limit=25`, {
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
      await fetch(`${API}/api/users/me/notifications/read-all`, {
        method: "PATCH",
        headers: { ...authHeaders() },
      });
      setNotifs(prev => prev.map(n => ({ ...n, read: true })));
      setUnread(0);
    } catch { }
  };

  const markRead = async (id) => {
    try {
      await fetch(`${API}/api/users/me/notifications/${id}/read`, {
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
    if (n.action_url) {
      navigate(n.action_url);
      return;
    }
    if (n.passport_guid) {
      window.open(`${window.location.origin}/passport/preview/${encodeURIComponent(n.passport_guid)}`, "_blank", "noopener,noreferrer");
      return;
    }
  };

  return (
    <div className="notif-container">
      <button
        ref={btnRef}
        className={`notif-bell${open ? " open" : ""}`}
        onClick={() => { setOpen(o => !o); if (!open) fetchNotifs(); }}
        title="Notifications"
      >
        🔔
        {unread > 0 && (
          <span className="notif-badge">{unread > 99 ? "99+" : unread}</span>
        )}
      </button>

      {open && (
        <div ref={panelRef} className="notif-panel">
          <div className="notif-panel-header">
            <span className="notif-panel-title">Notifications</span>
            {unread > 0 && (
              <button className="notif-mark-all" onClick={markAllRead}>
                Mark all read
              </button>
            )}
          </div>

          <div className="notif-panel-view-all">
            <button className="notif-view-all-btn" onClick={() => { setOpen(false); navigate("/dashboard/notifications"); }}>
              View all &amp; workflow history →
            </button>
          </div>
          <div className="notif-list">
            {loading && notifs.length === 0 ? (
              <div className="notif-empty">Loading…</div>
            ) : notifs.length === 0 ? (
              <div className="notif-empty">
                <div style={{ fontSize:32, marginBottom:8 }}>🔔</div>
                No new notifications
              </div>
            ) : (
              notifs.map(n => (
                <div key={n.id}
                  className={`notif-item${n.read ? "" : " unread"}`}
                  onClick={() => handleClick(n)}>
                  <div className="notif-icon">
                    {NOTIF_ICONS[n.type] || NOTIF_ICONS.default}
                  </div>
                  <div className="notif-content">
                    <div className="notif-title">{n.title}</div>
                    {n.message && <div className="notif-msg">{n.message}</div>}
                    <div className="notif-time">{timeAgo(n.created_at)}</div>
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
