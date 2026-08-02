// Shared audit-log view: route callers supply access scope; this owns display and export.
import React, { useId, useMemo, useState } from "react";

/**
 * Reusable audit-log feature view.
 *
 * User and super-admin routes supply their access scope while this component
 * owns filtering, readable formatting, and CSV export presentation.
 */
import {
  buildAuditCsv,
  formatAuditAction,
  formatAuditActor,
  formatAuditEntity,
  filterAuditLogs,
  getAuditChangedFieldLabels,
  getAuditActionKind,
  getAuditActionOptions,
} from "./auditDisplay";
import AppSelect from "../shared/components/AppSelect";
import "./AuditLogExplorer.css";

const actionIcons = {
  create: "＋",
  update: "✎",
  delete: "−",
  release: "✓",
  revise: "↻",
  neutral: "•",
};

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function shortRecordId(recordId) {
  const value = String(recordId || "");
  return value.length > 12 ? `${value.slice(0, 12)}…` : value;
}

function AuditLogExplorer({
  title,
  subtitle,
  logs = [],
  isLoading = false,
  error = "",
  emptyMessage = "No audit activity has been recorded yet.",
  exportFilenamePrefix = "audit-logs",
  className = "",
  totalCount,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
  showChangeValues = false,
  showCompany = false,
}) {
  const idPrefix = useId();
  const [filterUser, setFilterUser] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterCompany, setFilterCompany] = useState("");
  const [expandedLog, setExpandedLog] = useState(null);
  const [flashMessage, setFlashMessage] = useState(null);

  const safeLogs = Array.isArray(logs) ? logs : [];
  const resolvedTotalCount = Number.isFinite(Number(totalCount))
    ? Math.max(Number(totalCount), safeLogs.length)
    : safeLogs.length;
  const actionOptions = useMemo(() => getAuditActionOptions(safeLogs), [safeLogs]);
  const filteredLogs = useMemo(() => filterAuditLogs(safeLogs, {
    user: filterUser,
    action: filterAction,
    dateFrom: filterDateFrom,
    dateTo: filterDateTo,
    company: filterCompany,
  }), [safeLogs, filterUser, filterAction, filterDateFrom, filterDateTo, filterCompany]);

  const hasFilters = Boolean(filterUser || filterAction || filterDateFrom || filterDateTo || filterCompany);
  const clearFilters = () => {
    setFilterUser("");
    setFilterAction("");
    setFilterDateFrom("");
    setFilterDateTo("");
    setFilterCompany("");
  };

  const exportCsv = () => {
    try {
      const blob = new Blob(["\uFEFF", buildAuditCsv(filteredLogs, formatTimestamp, {
        includeCompany: showCompany,
      })], {
        type: "text/csv;charset=utf-8",
      });
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `${exportFilenamePrefix}-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
      setFlashMessage({ type: "success", text: "Audit log CSV downloaded." });
    } catch (exportError) {
      setFlashMessage({ type: "error", text: `CSV export failed: ${exportError.message}` });
    }
    window.setTimeout(() => setFlashMessage(null), 4000);
  };

  return (
    <section className={`audit-explorer ${className}`.trim()}>
      <header className="audit-explorer-heading">
        <span className="audit-explorer-heading-icon" aria-hidden="true">📋</span>
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
      </header>

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {flashMessage && (
        <div className={`alert alert-${flashMessage.type}`} role="status" aria-live="polite">
          {flashMessage.text}
        </div>
      )}

      <section className="audit-explorer-filters" aria-label="Audit log filters">
        <div className="audit-explorer-filter-grid">
          <div className="audit-explorer-filter-group">
            <label htmlFor={`${idPrefix}-user`}>User</label>
            <input
              id={`${idPrefix}-user`}
              type="search"
              placeholder="Search name or email"
              value={filterUser}
              onChange={(event) => setFilterUser(event.target.value)}
            />
          </div>

          {showCompany && (
            <div className="audit-explorer-filter-group">
              <label htmlFor={`${idPrefix}-company`}>Company</label>
              <input
                id={`${idPrefix}-company`}
                type="search"
                placeholder="Search company"
                value={filterCompany}
                onChange={(event) => setFilterCompany(event.target.value)}
              />
            </div>
          )}

          <div className="audit-explorer-filter-group">
            <label htmlFor={`${idPrefix}-action`}>Action</label>
            <AppSelect
              id={`${idPrefix}-action`}
              value={filterAction}
              onChange={(event) => setFilterAction(event.target.value)}
            >
              <option value="">All actions</option>
              {actionOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </AppSelect>
          </div>

          <div className="audit-explorer-filter-group">
            <label htmlFor={`${idPrefix}-from`}>From</label>
            <input
              id={`${idPrefix}-from`}
              type="date"
              value={filterDateFrom}
              onChange={(event) => setFilterDateFrom(event.target.value)}
            />
          </div>

          <div className="audit-explorer-filter-group">
            <label htmlFor={`${idPrefix}-to`}>To</label>
            <input
              id={`${idPrefix}-to`}
              type="date"
              value={filterDateTo}
              onChange={(event) => setFilterDateTo(event.target.value)}
            />
          </div>

          <div className="audit-explorer-filter-actions">
            {hasFilters && (
              <button type="button" className="audit-explorer-secondary-btn" onClick={clearFilters}>
                Clear
              </button>
            )}
            <button
              type="button"
              className="audit-explorer-export-btn"
              onClick={exportCsv}
              disabled={filteredLogs.length === 0}
            >
              <span aria-hidden="true">↓</span>
              Export visible CSV
            </button>
          </div>
        </div>

        {hasFilters && (
          <p className="audit-explorer-filter-summary" aria-live="polite">
            Showing <strong>{filteredLogs.length}</strong> of <strong>{safeLogs.length}</strong> loaded entries
            {hasMore ? <> ({resolvedTotalCount} total)</> : null}
          </p>
        )}
      </section>

      {isLoading && <div className="audit-explorer-state">Loading audit logs…</div>}

      {!isLoading && !error && filteredLogs.length === 0 && (
        <div className="audit-explorer-state audit-explorer-empty">
          <span aria-hidden="true">📭</span>
          <p>{safeLogs.length === 0 ? emptyMessage : "No entries match the selected filters."}</p>
          {hasFilters && safeLogs.length > 0 && (
            <button type="button" className="audit-explorer-secondary-btn" onClick={clearFilters}>
              Clear filters
            </button>
          )}
          {hasMore && onLoadMore && (
            <button
              type="button"
              className="audit-explorer-secondary-btn"
              onClick={onLoadMore}
              disabled={isLoadingMore}
            >
              {isLoadingMore ? "Loading…" : "Load more entries"}
            </button>
          )}
        </div>
      )}

      {!isLoading && filteredLogs.length > 0 && (
        <section className="audit-explorer-results" aria-label="Audit log entries">
          <div className="audit-explorer-results-header">
            <h3>Activity history</h3>
            <span>
              {hasMore
                ? `${safeLogs.length} loaded of ${resolvedTotalCount}`
                : `${filteredLogs.length} ${filteredLogs.length === 1 ? "entry" : "entries"}`}
            </span>
          </div>

          <div className="audit-explorer-list">
            {filteredLogs.map((log, index) => {
              const logKey = log.id ?? `${log.createdAt || "entry"}-${index}`;
              const detailId = `${idPrefix}-details-${index}`;
              const isExpanded = expandedLog === logKey;
              const actionKind = getAuditActionKind(log.action);
              const changedFieldLabels = getAuditChangedFieldLabels(log);

              return (
                <article key={logKey} className={`audit-explorer-entry action-${actionKind}`}>
                  <button
                    type="button"
                    className="audit-explorer-entry-summary"
                    onClick={() => setExpandedLog(isExpanded ? null : logKey)}
                    aria-expanded={isExpanded}
                    aria-controls={detailId}
                  >
                    <span className="audit-explorer-action-icon" aria-hidden="true">
                      {actionIcons[actionKind]}
                    </span>

                    <span className="audit-explorer-entry-main">
                      <strong>{formatAuditAction(log.action)}</strong>
                      <span className="audit-explorer-entry-context">
                        <span className="audit-explorer-entity">{formatAuditEntity(log.tableName)}</span>
                        {showCompany && log.companyName && (
                          <span className="audit-explorer-company">{log.companyName}</span>
                        )}
                        {log.recordId && (
                          <span className="audit-explorer-record" title={String(log.recordId)}>
                            Record {shortRecordId(log.recordId)}
                          </span>
                        )}
                      </span>
                    </span>

                    <span className="audit-explorer-entry-meta">
                      <strong>{formatAuditActor(log)}</strong>
                      <time dateTime={log.createdAt || undefined}>{formatTimestamp(log.createdAt)}</time>
                    </span>

                    <span className={`audit-explorer-chevron${isExpanded ? " is-expanded" : ""}`} aria-hidden="true">⌄</span>
                  </button>

                  <div
                    className={`audit-explorer-details-motion${isExpanded ? " is-expanded" : ""}`}
                    aria-hidden={!isExpanded}
                    inert={isExpanded ? undefined : ""}
                  >
                    <div id={detailId} className="audit-explorer-details">
                      <h4>Action details</h4>
                      <dl className="audit-explorer-detail-grid">
                        <div><dt>User</dt><dd>{formatAuditActor(log)}</dd></div>
                        {(log.userEmail || log.actorEmail) && (
                          <div><dt>Email</dt><dd>{log.userEmail || log.actorEmail}</dd></div>
                        )}
                        {showCompany && (
                          <div><dt>Company</dt><dd>{log.companyName || "Platform-wide"}</dd></div>
                        )}
                        <div><dt>Action</dt><dd>{formatAuditAction(log.action)}</dd></div>
                        <div><dt>Entity</dt><dd>{formatAuditEntity(log.tableName)}</dd></div>
                        <div><dt>Record ID</dt><dd>{log.recordId || "—"}</dd></div>
                        <div><dt>Timestamp</dt><dd>{formatTimestamp(log.createdAt)}</dd></div>
                      </dl>

                      {!showChangeValues && changedFieldLabels.length > 0 && (
                        <section className="audit-explorer-changed-fields">
                          <h4>Changed fields</h4>
                          <div>
                            {changedFieldLabels.map((fieldLabel) => (
                              <span key={fieldLabel}>{fieldLabel}</span>
                            ))}
                          </div>
                        </section>
                      )}

                      {showChangeValues && (log.newValues || log.oldValues) && (
                        <div className="audit-explorer-change-grid">
                          {log.newValues && (
                            <section>
                              <h4>New values</h4>
                              <pre>{JSON.stringify(log.newValues, null, 2)}</pre>
                            </section>
                          )}
                          {log.oldValues && (
                            <section>
                              <h4>Previous values</h4>
                              <pre>{JSON.stringify(log.oldValues, null, 2)}</pre>
                            </section>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          {hasMore && onLoadMore && (
            <div className="audit-explorer-pagination">
              <p>Showing {safeLogs.length} of {resolvedTotalCount} entries</p>
              <button
                type="button"
                className="audit-explorer-secondary-btn"
                onClick={onLoadMore}
                disabled={isLoadingMore}
              >
                {isLoadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </section>
      )}
    </section>
  );
}

export default AuditLogExplorer;
