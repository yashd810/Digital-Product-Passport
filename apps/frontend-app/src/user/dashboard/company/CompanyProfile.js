import React, { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import CompanyLogoUpload from "./CompanyLogoUpload";
import { authHeaders, fetchWithAuth } from "../../../shared/api/authHeaders";
import "../../../assets/styles/Dashboard.css";

const API = import.meta.env.VITE_API_URL || "";

function CompanyProfile({ companyId, user }) {
  const { companyId: routeCompanyId } = useParams();
  const resolvedCompanyId = companyId || routeCompanyId;
  const isSuperAdminView = user?.role === "super_admin" && routeCompanyId;

  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [message, setMessage] = useState({ type: "", text: "" });
  const [logoPreview, setLogoPreview] = useState(null);
  const [companyName, setCompanyName] = useState("");
  const [backupPolicy, setBackupPolicy] = useState(null);
  const [continuityEvidence, setContinuityEvidence] = useState(null);

  useEffect(() => {
    fetchCompanyProfile();
  }, [resolvedCompanyId, isSuperAdminView]);

  const fetchCompanyProfile = async () => {
    try {
      setBackupPolicy(null);
      setContinuityEvidence(null);
      const r = await fetchWithAuth(`${API}/api/companies/${resolvedCompanyId}/profile`, {
        headers: authHeaders(),
      });
      if (r.ok) {
        const d = await r.json();
        setLogoPreview(d.company_logo || null);
        setCompanyName(d.company_name || "");
      }

      if (isSuperAdminView) {
        const adminBase = `${API}/api/admin/companies/${resolvedCompanyId}`;
        const [policyRes, evidenceRes] = await Promise.all([
          fetchWithAuth(`${adminBase}/backup-policy`, {
            headers: authHeaders(),
          }).catch(() => null),
          fetchWithAuth(`${adminBase}/backup-continuity-evidence`, {
            headers: authHeaders(),
          }).catch(() => null),
        ]);

        if (policyRes?.ok) {
          setBackupPolicy(await policyRes.json());
        }
        if (evidenceRes?.ok) {
          setContinuityEvidence(await evidenceRes.json());
        }
      }
    } catch (error) {
    } finally {
      setLoading(false);
    }
  };

  const handleSaveProfile = async () => {
    try {
      setSavingProfile(true);
      setMessage({ type: "", text: "" });

      const r = await fetchWithAuth(`${API}/api/companies/${resolvedCompanyId}/profile`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          company_logo: logoPreview,
        }),
      });

      if (!r.ok) throw new Error("Failed");
      setMessage({ type: "success", text: "Company profile updated!" });
      setTimeout(() => setMessage({ type: "", text: "" }), 3000);
    } catch (error) {
      setMessage({ type: "error", text: "Failed to save profile." });
      setTimeout(() => setMessage({ type: "", text: "" }), 3000);
    } finally {
      setSavingProfile(false);
    }
  };

  if (loading) {
    return <div className="loading" style={{ padding: 40 }}>Loading company profile...</div>;
  }

  return (
    <div className="company-profile-wrapper">
      <div className="profile-header">
        <h2>🏢 Company Profile</h2>
        <p>{isSuperAdminView ? `Manage the public company logo for ${companyName || "this company"}` : "Manage your company logo for passport viewing"}</p>
      </div>

      {message.text && <div className={`profile-message ${message.type}`}>{message.text}</div>}

      <div className="profile-content">
        <div className="profile-card">
          <h3>Company Information</h3>
          <div className="info-group">
            <label>Company Name</label>
            <input
              type="text"
              value={companyName}
              disabled
              className="info-input disabled"
            />
            <small style={{ color: "var(--text-secondary)", marginTop: 4 }}>Company name is managed by administrators</small>
          </div>
        </div>

        <div className="profile-card">
          <h3>Company Logo</h3>
          <p style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 16 }}>
            Upload the company logo that will be displayed in the public and preview passport viewer.
          </p>
          <CompanyLogoUpload
            logoPreview={logoPreview}
            onLogoChange={setLogoPreview}
          />
          <button className="profile-save-btn" onClick={handleSaveProfile} disabled={savingProfile}>
            {savingProfile ? "💾 Saving..." : "💾 Save Profile"}
          </button>
        </div>

        {isSuperAdminView ? (
          <div className="profile-card">
            <h3>Backup Continuity</h3>
            <p style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 16 }}>
              This shows whether backup continuity evidence is production-ready, what is already proven, and what still needs manual OCI or restore-drill work.
            </p>

            {continuityEvidence ? (
              <div className="continuity-grid">
                <div className="continuity-stat">
                  <span>Readiness</span>
                  <strong className={continuityEvidence?.readiness?.status === "ready" ? "status-good" : "status-warn"}>
                    {continuityEvidence?.readiness?.status === "ready" ? "Ready" : "Not ready"}
                  </strong>
                </div>
                <div className="continuity-stat">
                  <span>Backup provider</span>
                  <strong>{continuityEvidence?.readiness?.backupProviderConfigured ? "Configured" : "Missing"}</strong>
                </div>
                <div className="continuity-stat">
                  <span>Replication proof</span>
                  <strong>{continuityEvidence?.replicationEvidence?.status === "proven" ? "Proven" : "Not proven"}</strong>
                </div>
                <div className="continuity-stat">
                  <span>Restore drill</span>
                  <strong>{continuityEvidence?.restoreDrillEvidence?.status === "proven" ? "Proven" : "Not proven"}</strong>
                </div>
                <div className="continuity-stat">
                  <span>Immutability</span>
                  <strong>{continuityEvidence?.immutableArchivalEvidence?.status === "proven" ? "Proven" : "Not proven"}</strong>
                </div>
              </div>
            ) : (
              <p style={{ color: "var(--text-secondary)" }}>Continuity evidence is unavailable right now.</p>
            )}

            {backupPolicy && (
              <div className="continuity-notes">
                <h4>Policy targets</h4>
                <ul>
                  <li>RPO target: {backupPolicy.rpoMinutes} minutes</li>
                  <li>RTO target: {backupPolicy.rtoHours} hours</li>
                  <li>Backup provider required: {backupPolicy.backupProviderRequired ? "Yes" : "No"}</li>
                  <li>Automatic public handover: {backupPolicy.automaticPublicHandoverEnabled ? "Enabled" : "Disabled"}</li>
                </ul>
              </div>
            )}

            {continuityEvidence?.readiness?.missingEvidence?.length ? (
              <div className="continuity-notes">
                <h4>Still missing</h4>
                <ul>
                  {continuityEvidence.readiness.missingEvidence.map((item) => (
                    <li key={item}>{item.replace(/_/g, " ")}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="continuity-notes">
              <h4>What you need to do next</h4>
              <ul>
                <li>Run the restore-drill command on the OCI backend host and record the evidence URI.</li>
                <li>Configure OCI bucket retention or immutability on the dedicated DB backup bucket.</li>
                <li>Add the resulting evidence URIs into the production env so readiness becomes fully proven.</li>
              </ul>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default CompanyProfile;
