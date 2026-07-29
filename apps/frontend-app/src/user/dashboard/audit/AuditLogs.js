import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import AuditLogExplorer from "../../../shared/audit/AuditLogExplorer";
import { isCompanyDashboardAuditEvent } from "../../../shared/audit/auditDisplay";
import { authHeaders, fetchWithAuth } from "../../../shared/api/authHeaders";

function AuditLogs({ companyId }) {
  const navigate = useNavigate();
  const apiBaseUrl = import.meta.env.VITE_API_URL || "";
  const [logs, setLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!companyId) {
      navigate("/login");
      return undefined;
    }

    let isActive = true;
    const fetchAuditLogs = async () => {
      try {
        setIsLoading(true);
        setError("");
        const response = await fetchWithAuth(
          `${apiBaseUrl}/api/companies/${companyId}/audit-logs?limit=500`,
          { headers: authHeaders() },
        );
        if (!response.ok) throw new Error("Failed to fetch audit logs");
        const payload = await response.json();
        if (!isActive) return;
        const entries = Array.isArray(payload)
          ? payload
          : (Array.isArray(payload?.entries) ? payload.entries : []);
        // The API separates super-admin activity. Keep this explicit-role check as
        // a final UI boundary for older or cached responses.
        setLogs(entries.filter(isCompanyDashboardAuditEvent));
      } catch {
        if (isActive) setError("Failed to load audit logs. Please try again.");
      } finally {
        if (isActive) setIsLoading(false);
      }
    };

    fetchAuditLogs();
    return () => { isActive = false; };
  }, [apiBaseUrl, companyId, navigate]);

  return (
    <AuditLogExplorer
      title="Audit Logs"
      subtitle="Review passport changes made by members of your company. Super-admin activity is kept in the separate administration audit log."
      logs={logs}
      isLoading={isLoading}
      error={error}
      emptyMessage="No company passport activity has been recorded yet."
      exportFilenamePrefix="company-audit-logs"
      className="company-audit-explorer"
    />
  );
}

export default AuditLogs;
