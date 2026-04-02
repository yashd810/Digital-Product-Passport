import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";

function AuditLogs({ companyId }) {
  const navigate = useNavigate();
  const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

  const [logs,        setLogs]        = useState([]);
  const [isLoading,   setIsLoading]   = useState(true);
  const [error,       setError]       = useState("");
  const [expandedLog, setExpandedLog] = useState(null);
  const [flashMsg,    setFlashMsg]    = useState(""); // {type: "success"|"error", text: string}

  // ── Filters ────────────────────────────────────────────────
  const [filterUser,      setFilterUser]      = useState("");
  const [filterAction,    setFilterAction]    = useState("");
  const [filterDateFrom,  setFilterDateFrom]  = useState("");
  const [filterDateTo,    setFilterDateTo]    = useState("");

  useEffect(() => {
    if (!companyId) { navigate("/login"); return; }
    fetchAuditLogs();
  }, [companyId]);

  const fetchAuditLogs = async () => {
    try {
      setIsLoading(true);
      setError("");
      const r = await fetch(
        `${API_BASE_URL}/api/companies/${companyId}/audit-logs?limit=1000`,
        { headers: { Authorization: "Bearer cookie-session" } }
      );
      if (!r.ok) throw new Error("Failed to fetch audit logs");
      setLogs(await r.json());
    } catch (err) {
      setError("Failed to load audit logs");
    } finally {
      setIsLoading(false);
    }
  };

  // ── Derived: unique action values for dropdown ─────────────
  const actionOptions = useMemo(() =>
    [...new Set(logs.map(l => l.action).filter(Boolean))].sort()
  , [logs]);

  // ── Derived: filtered logs ─────────────────────────────────
  const filteredLogs = useMemo(() => {
    const userQ  = filterUser.trim().toLowerCase();
    const fromTs = filterDateFrom ? new Date(filterDateFrom).getTime() : null;
    const toTs   = filterDateTo   ? new Date(filterDateTo + "T23:59:59").getTime() : null;

    return logs.filter(log => {
      if (userQ   && !(log.user_email || "").toLowerCase().includes(userQ)) return false;
      if (filterAction && log.action !== filterAction) return false;
      const ts = new Date(log.created_at).getTime();
      if (fromTs && ts < fromTs) return false;
      if (toTs   && ts > toTs)   return false;
      return true;
    });
  }, [logs, filterUser, filterAction, filterDateFrom, filterDateTo]);

  const hasFilters = filterUser || filterAction || filterDateFrom || filterDateTo;
  const clearFilters = () => {
    setFilterUser(""); setFilterAction("");
    setFilterDateFrom(""); setFilterDateTo("");
  };

  // ── CSV export (exports filtered logs) ────────────────────
  const exportCSV = () => {
    try {
      const escape = (val) => {
        const s = String(val ?? "");
        return s.includes(",") || s.includes('"') || s.includes("\n")
          ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const headers = ["Timestamp", "User", "Action", "Table", "Passport GUID", "Record ID"];
      const rows = filteredLogs.map(l => [
        new Date(l.created_at).toLocaleString(),
        l.user_email || "System",
        l.action,
        l.table_name || "",
        l.passport_guid || "",
        l.record_id || "",
      ]);
      const csv = [headers, ...rows].map(r => r.map(escape).join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `audit_logs_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      setFlashMsg({ type: "success", text: "✓ Audit logs exported successfully" });
      setTimeout(() => setFlashMsg(""), 4000);
    } catch (err) {
      setFlashMsg({ type: "error", text: `✗ Export failed: ${err.message}` });
      setTimeout(() => setFlashMsg(""), 4000);
    }
  };

  const getActionColor = (action) => {
    if (!action) return "";
    const a = action.toLowerCase();
    if (a.includes("create")) return "action-create";
    if (a.includes("update") || a.includes("edit") || a.includes("patch")) return "action-update";
    if (a.includes("delete") || a.includes("remove") || a.includes("revoke")) return "action-delete";
    if (a.includes("release")) return "action-release";
    if (a.includes("revis")) return "action-revise";
    return "";
  };

  const getActionIcon = (action) => {
    if (!action) return "📋";
    const a = action.toLowerCase();
    if (a.includes("create")) return "✨";
    if (a.includes("update") || a.includes("edit") || a.includes("patch")) return "📝";
    if (a.includes("delete") || a.includes("remove") || a.includes("revoke")) return "🗑️";
    if (a.includes("release")) return "🚀";
    if (a.includes("revis")) return "🔄";
    return "📋";
  };

  const toggleExpanded = (id) => setExpandedLog(expandedLog === id ? null : id);

  return (
    <div className="audit-logs-page">
      <header className="audit-header">
        <h1>📋 Audit Logs</h1>
        <p className="header-subtitle">Track all changes in your passports</p>
      </header>

      <main className="audit-main">
        {error && <div className="alert alert-error">{error}</div>}
        {flashMsg && <div className={`alert alert-${flashMsg.type}`}>{flashMsg.text}</div>}

        {/* ── Filter bar ── */}
        <div className="audit-filter-bar">
          <div className="audit-filter-row">
            <div className="audit-filter-group">
              <label className="audit-filter-label">User</label>
              <input
                type="text"
                className="audit-filter-input"
                placeholder="Search by email…"
                value={filterUser}
                onChange={e => setFilterUser(e.target.value)}
              />
            </div>

            <div className="audit-filter-group">
              <label className="audit-filter-label">Action</label>
              <select
                className="audit-filter-select"
                value={filterAction}
                onChange={e => setFilterAction(e.target.value)}
              >
                <option value="">All actions</option>
                {actionOptions.map(a => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>

            <div className="audit-filter-group">
              <label className="audit-filter-label">From</label>
              <input
                type="date"
                className="audit-filter-input"
                value={filterDateFrom}
                onChange={e => setFilterDateFrom(e.target.value)}
              />
            </div>

            <div className="audit-filter-group">
              <label className="audit-filter-label">To</label>
              <input
                type="date"
                className="audit-filter-input"
                value={filterDateTo}
                onChange={e => setFilterDateTo(e.target.value)}
              />
            </div>

            <div className="audit-filter-actions">
              {hasFilters && (
                <button className="audit-clear-btn" onClick={clearFilters}>✕ Clear</button>
              )}
              <button className="audit-export-btn" onClick={exportCSV}
                disabled={filteredLogs.length === 0} title="Export filtered logs as CSV">
                ⬇ Export CSV
              </button>
            </div>
          </div>

          {hasFilters && (
            <div className="audit-filter-summary">
              Showing <strong>{filteredLogs.length}</strong> of <strong>{logs.length}</strong> entries
            </div>
          )}
        </div>

        {isLoading && <div className="loading">Loading audit logs...</div>}

        {!isLoading && filteredLogs.length === 0 && !error && (
          <div className="empty-state">
            <p>{logs.length === 0
              ? "No audit logs yet. Create and modify passports to see activity here."
              : "No entries match your filters."}</p>
            {hasFilters && logs.length > 0 && (
              <button className="audit-clear-btn audit-clear-btn-spaced" onClick={clearFilters}>
                Clear filters
              </button>
            )}
          </div>
        )}

        {!isLoading && filteredLogs.length > 0 && (
          <div className="logs-container">
            <div className="logs-header">
              <span className="logs-count">
                {hasFilters
                  ? `${filteredLogs.length} of ${logs.length} entries`
                  : `${logs.length} entries`}
              </span>
            </div>

            <div className="logs-list">
              {filteredLogs.map(log => (
                <div key={log.id} className="log-entry">
                  <div className="log-header" onClick={() => toggleExpanded(log.id)}>
                    <span className={`log-icon ${getActionColor(log.action)}`}>
                      {getActionIcon(log.action)}
                    </span>

                    <div className="log-main-info">
                      <span className="log-action">
                        <strong>{(log.action || "").toUpperCase()}</strong>
                      </span>
                      <span className="log-table">{log.table_name}</span>
                      {log.passport_guid && (
                        <span className="log-guid">{log.passport_guid.substring(0, 8)}…</span>
                      )}
                    </div>

                    <div className="log-meta">
                      <span className="log-user">{log.user_email || "System"}</span>
                      <span className="log-time">{new Date(log.created_at).toLocaleString()}</span>
                    </div>

                    <span className={`toggle-icon ${expandedLog === log.id ? "expanded" : ""}`}>▼</span>
                  </div>

                  {expandedLog === log.id && (
                    <div className="log-details">
                      <div className="detail-section">
                        <h4>Action Details</h4>
                        <div className="detail-grid">
                          <div className="detail-item">
                            <span className="detail-label">User</span>
                            <span className="detail-value">{log.user_email || "System"}</span>
                          </div>
                          <div className="detail-item">
                            <span className="detail-label">Action</span>
                            <span className="detail-value">{log.action}</span>
                          </div>
                          <div className="detail-item">
                            <span className="detail-label">Table</span>
                            <span className="detail-value">{log.table_name}</span>
                          </div>
                          <div className="detail-item">
                            <span className="detail-label">Record ID</span>
                            <span className="detail-value">{log.record_id || "—"}</span>
                          </div>
                          <div className="detail-item">
                            <span className="detail-label">Passport GUID</span>
                            <span className="detail-value">{log.passport_guid || "—"}</span>
                          </div>
                          <div className="detail-item">
                            <span className="detail-label">Timestamp</span>
                            <span className="detail-value">{new Date(log.created_at).toLocaleString()}</span>
                          </div>
                        </div>
                      </div>

                      {log.new_values && (
                        <div className="detail-section">
                          <h4>New Values</h4>
                          <pre className="json-display">{JSON.stringify(log.new_values, null, 2)}</pre>
                        </div>
                      )}

                      {log.old_values && (
                        <div className="detail-section">
                          <h4>Old Values</h4>
                          <pre className="json-display">{JSON.stringify(log.old_values, null, 2)}</pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      <footer className="audit-footer">
        <p>&copy; {new Date().getFullYear()} Digital Product Passport System.</p>
      </footer>
    </div>
  );
}

export default AuditLogs;
