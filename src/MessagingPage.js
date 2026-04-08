import React, { useState, useEffect, useRef, useCallback } from "react";
import { authHeaders } from "./authHeaders";
import "./Dashboard.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

function initials(u) {
  if (!u) return "?";
  return `${(u.first_name || "").charAt(0)}${(u.last_name || "").charAt(0)}`.toUpperCase() || u.email?.charAt(0)?.toUpperCase() || "?";
}

function displayName(u) {
  if (!u) return "";
  return `${u.first_name || ""} ${u.last_name || ""}`.trim() || u.email;
}

function timeLabel(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now - d) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7)  return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function msgTime(dateStr) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function groupByDate(messages) {
  const groups = [];
  let lastDate = null;
  messages.forEach(m => {
    const d = new Date(m.created_at);
    const label = d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
    if (label !== lastDate) {
      groups.push({ type: "date", label });
      lastDate = label;
    }
    groups.push({ type: "msg", msg: m });
  });
  return groups;
}

export default function MessagingPage({ user }) {
  const [conversations, setConversations] = useState([]);
  const [activeConvId, setActiveConvId]   = useState(null);
  const [messages, setMessages]           = useState([]);
  const [draft, setDraft]                 = useState("");
  const [companyUsers, setCompanyUsers]   = useState([]);
  const [showNewModal, setShowNewModal]   = useState(false);
  const [search, setSearch]               = useState("");
  const [userSearch, setUserSearch]       = useState("");
  const [loadingConvs, setLoadingConvs]   = useState(true);
  const [loadingMsgs, setLoadingMsgs]     = useState(false);
  const [sending, setSending]             = useState(false);

  const bottomRef  = useRef(null);
  const inputRef   = useRef(null);
  const pollRef    = useRef(null);
  const activeRef  = useRef(activeConvId);
  activeRef.current = activeConvId;

  // ── Load conversations ──
  const fetchConversations = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/messaging/conversations`, { headers: authHeaders() });
      if (r.ok) setConversations(await r.json());
    } catch {}
    finally { setLoadingConvs(false); }
  }, []);

  useEffect(() => { fetchConversations(); }, [fetchConversations]);

  // ── Load company users for new-chat modal ──
  useEffect(() => {
    fetch(`${API}/api/messaging/users`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : [])
      .then(setCompanyUsers)
      .catch(() => {});
  }, []);

  // ── Load messages when conversation selected ──
  const fetchMessages = useCallback(async (convId) => {
    if (!convId) return;
    setLoadingMsgs(true);
    try {
      const r = await fetch(`${API}/api/messaging/conversations/${convId}/messages?limit=50`, {
        headers: authHeaders(),
      });
      if (r.ok) setMessages(await r.json());
    } catch {}
    finally { setLoadingMsgs(false); }
  }, []);

  useEffect(() => {
    if (activeConvId) {
      fetchMessages(activeConvId);
      // Update unread in list immediately
      setConversations(prev => prev.map(c => c.id === activeConvId ? { ...c, unread: 0 } : c));
    }
  }, [activeConvId, fetchMessages]);

  // ── Poll for new messages every 5s ──
  useEffect(() => {
    pollRef.current = setInterval(async () => {
      if (!activeRef.current) return;
      try {
        const r = await fetch(`${API}/api/messaging/conversations/${activeRef.current}/messages?limit=50`, {
          headers: authHeaders(),
        });
        if (r.ok) setMessages(await r.json());
      } catch {}
      fetchConversations();
    }, 5000);
    return () => clearInterval(pollRef.current);
  }, [fetchConversations]);


  // ── Send message ──
  const sendMessage = async () => {
    const body = draft.trim();
    if (!body || !activeConvId || sending) return;
    setSending(true);
    setDraft("");
    try {
      const r = await fetch(`${API}/api/messaging/conversations/${activeConvId}/messages`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (r.ok) {
        const msg = await r.json();
        setMessages(prev => [...prev, msg]);
        fetchConversations();
      }
    } catch {}
    finally { setSending(false); inputRef.current?.focus(); }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  // ── Start new conversation ──
  const startConversation = async (otherUserId) => {
    setShowNewModal(false);
    setUserSearch("");
    try {
      const r = await fetch(`${API}/api/messaging/conversations`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ otherUserId }),
      });
      if (r.ok) {
        const { id } = await r.json();
        await fetchConversations();
        setActiveConvId(id);
      }
    } catch {}
  };

  const activeConv = conversations.find(c => c.id === activeConvId);
  const filteredConvs = conversations.filter(c => {
    const name = `${c.first_name || ""} ${c.last_name || ""} ${c.email || ""}`.toLowerCase();
    return name.includes(search.toLowerCase());
  });
  const filteredUsers = companyUsers.filter(u => {
    const name = `${u.first_name || ""} ${u.last_name || ""} ${u.email || ""}`.toLowerCase();
    return name.includes(userSearch.toLowerCase());
  });

  const totalUnread = conversations.reduce((sum, c) => sum + (parseInt(c.unread) || 0), 0);

  return (
    <div className="msg-page">
      {/* ── Left: Conversation List ── */}
      <aside className="msg-sidebar">
        <div className="msg-sidebar-header">
          <h2 className="msg-sidebar-title">
            Messages
            {totalUnread > 0 && <span className="msg-total-badge">{totalUnread}</span>}
          </h2>
          <button className="msg-new-btn" onClick={() => setShowNewModal(true)} title="New conversation">
            ✏️
          </button>
        </div>

        <div className="msg-search-wrap">
          <input
            className="msg-search"
            type="text"
            placeholder="Search conversations…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div className="msg-conv-list">
          {loadingConvs ? (
            <div className="msg-conv-empty">Loading…</div>
          ) : filteredConvs.length === 0 ? (
            <div className="msg-conv-empty">
              <div style={{ fontSize: 32, marginBottom: 8 }}>💬</div>
              {search ? "No results" : "No conversations yet.\nClick ✏️ to start one."}
            </div>
          ) : (
            filteredConvs.map(c => {
              const unread = parseInt(c.unread) || 0;
              const isActive = c.id === activeConvId;
              return (
                <div
                  key={c.id}
                  className={`msg-conv-item${isActive ? " active" : ""}${unread > 0 ? " unread" : ""}`}
                  onClick={() => setActiveConvId(c.id)}
                >
                  <div className="msg-conv-avatar">{initials(c)}</div>
                  <div className="msg-conv-info">
                    <div className="msg-conv-name-row">
                      <span className="msg-conv-name">{displayName(c)}</span>
                      <span className="msg-conv-time">{timeLabel(c.last_message_at)}</span>
                    </div>
                    <div className="msg-conv-preview-row">
                      <span className="msg-conv-preview">
                        {c.last_sender_id === user?.id ? "You: " : ""}
                        {c.last_message || "Start the conversation"}
                      </span>
                      {unread > 0 && <span className="msg-unread-badge">{unread}</span>}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* ── Right: Chat window ── */}
      <main className="msg-chat">
        {!activeConvId ? (
          <div className="msg-empty-state">
            <div className="msg-empty-icon">💬</div>
            <h3>Your Messages</h3>
            <p>Select a conversation or start a new one to chat with your team.</p>
            <button className="msg-start-btn" onClick={() => setShowNewModal(true)}>
              Start a conversation
            </button>
          </div>
        ) : (
          <>
            {/* Chat header */}
            <div className="msg-chat-header">
              <div className="msg-chat-avatar">{initials(activeConv)}</div>
              <div className="msg-chat-person">
                <span className="msg-chat-name">{displayName(activeConv)}</span>
                <span className="msg-chat-role">{activeConv?.email}</span>
              </div>
            </div>

            {/* Messages */}
            <div className="msg-messages">
              {loadingMsgs ? (
                <div className="msg-loading">Loading…</div>
              ) : messages.length === 0 ? (
                <div className="msg-no-msgs">
                  No messages yet. Say hello! 👋
                </div>
              ) : (
                groupByDate(messages).map((item, idx) => {
                  if (item.type === "date") {
                    return <div key={`date-${idx}`} className="msg-date-divider"><span>{item.label}</span></div>;
                  }
                  const m = item.msg;
                  const isMe = m.sender_id === user?.id;
                  return (
                    <div key={m.id} className={`msg-bubble-row${isMe ? " me" : ""}`}>
                      {!isMe && (
                        <div className="msg-bubble-avatar">
                          {`${(m.first_name||"").charAt(0)}${(m.last_name||"").charAt(0)}`.toUpperCase() || "?"}
                        </div>
                      )}
                      <div className="msg-bubble-wrap">
                        <div className={`msg-bubble${isMe ? " msg-bubble-me" : " msg-bubble-them"}`}>
                          {m.body}
                        </div>
                        <span className="msg-bubble-time">{msgTime(m.created_at)}</span>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className="msg-input-bar">
              <textarea
                ref={inputRef}
                className="msg-input"
                placeholder="Type a message… (Enter to send)"
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
              />
              <button
                className="msg-send-btn"
                onClick={sendMessage}
                disabled={!draft.trim() || sending}
              >
                ➤
              </button>
            </div>
          </>
        )}
      </main>

      {/* ── New conversation modal ── */}
      {showNewModal && (
        <div className="msg-modal-overlay" onClick={() => { setShowNewModal(false); setUserSearch(""); }}>
          <div className="msg-modal" onClick={e => e.stopPropagation()}>
            <div className="msg-modal-header">
              <h3>New Conversation</h3>
              <button className="msg-modal-close" onClick={() => { setShowNewModal(false); setUserSearch(""); }}>✕</button>
            </div>
            <input
              className="msg-search msg-modal-search"
              type="text"
              placeholder="Search teammates…"
              value={userSearch}
              onChange={e => setUserSearch(e.target.value)}
              autoFocus
            />
            <div className="msg-modal-list">
              {filteredUsers.length === 0 ? (
                <div className="msg-conv-empty">No teammates found</div>
              ) : (
                filteredUsers.map(u => (
                  <div key={u.id} className="msg-modal-user" onClick={() => startConversation(u.id)}>
                    <div className="msg-conv-avatar">{initials(u)}</div>
                    <div>
                      <div className="msg-conv-name">{displayName(u)}</div>
                      <div className="msg-conv-preview" style={{ marginTop: 2 }}>{u.email}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
