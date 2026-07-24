import React, { useCallback, useEffect, useState } from "react";
import AuditLogExplorer from "../../shared/audit/AuditLogExplorer";
import { authHeaders, fetchWithAuth } from "../../shared/api/authHeaders";
import "../styles/AdminDashboard.css";

const apiBaseUrl = import.meta.env.VITE_API_URL || "";
const pageSize = 500;

export function mergeAuditEntries(current, incoming) {
  const entriesByKey = new Map();
  [...current, ...incoming].forEach((entry, index) => {
    const key = entry?.id ?? `${entry?.createdAt || "entry"}-${entry?.action || "activity"}-${index}`;
    entriesByKey.set(String(key), entry);
  });
  return [...entriesByKey.values()];
}

export function getAdminAuditEntries(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.entries)) return payload.entries;
  if (Array.isArray(payload?.logs)) return payload.logs;
  return [];
}

function AdminAuditLogs() {
  const [logs, setLogs] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const fetchPage = useCallback(async ({ offset = 0, append = false } = {}) => {
    try {
      append ? setIsLoadingMore(true) : setIsLoading(true);
      setError("");
      const response = await fetchWithAuth(
        `${apiBaseUrl}/api/admin/audit-logs?limit=${pageSize}&offset=${offset}`,
        { headers: authHeaders() },
      );
      if (!response.ok) throw new Error("Failed to fetch super-admin audit logs");
      const payload = await response.json();
      const entries = getAdminAuditEntries(payload);
      setLogs((current) => append ? mergeAuditEntries(current, entries) : entries);
      setTotalCount(Number(payload?.pagination?.total) || (append ? offset + entries.length : entries.length));
    } catch {
      setError("Failed to load super-admin audit logs. Please try again.");
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    fetchPage();
  }, [fetchPage]);

  const hasMore = logs.length < totalCount;

  return (
    <AuditLogExplorer
      title="Super Admin Audit Logs"
      subtitle="Review administrative changes across the platform. These records are intentionally separate from company-user audit history."
      logs={logs}
      totalCount={totalCount}
      isLoading={isLoading}
      isLoadingMore={isLoadingMore}
      error={error}
      emptyMessage="No super-admin activity has been recorded yet."
      exportFilenamePrefix="super-admin-audit-logs-visible"
      className="admin-audit-explorer"
      hasMore={hasMore}
      onLoadMore={() => fetchPage({ offset: logs.length, append: true })}
      showChangeValues
      showCompany
    />
  );
}

export default AdminAuditLogs;
