import React, { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import IntroductionUpload from "./IntroductionUpload";
import { DEFAULT_COMPANY_BRANDING, normalizeCompanyBranding } from "../../../app/providers/ThemeContext";
import { authHeaders } from "../../../shared/api/authHeaders";
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
  const [introText, setIntroText] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [branding, setBranding] = useState(DEFAULT_COMPANY_BRANDING);

  useEffect(() => {
    fetchCompanyProfile();
  }, [resolvedCompanyId]);

  const fetchCompanyProfile = async () => {
    try {
      const r = await fetch(`${API}/api/companies/${resolvedCompanyId}/profile`, {
        headers: authHeaders(),
      });
      if (r.ok) {
        const d = await r.json();
        setLogoPreview(d.company_logo || null);
        setIntroText(d.introduction_text || "");
        setCompanyName(d.company_name || "");
        setBranding(normalizeCompanyBranding(d.branding_json));
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

      const r = await fetch(`${API}/api/companies/${resolvedCompanyId}/profile`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          company_logo: logoPreview,
          introduction_text: introText,
          branding_json: branding,
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

  const handleBrandingChange = (key, value) => {
    setBranding(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="company-profile-wrapper">
      <div className="profile-header">
        <h2>{isSuperAdminView ? "🎨 Company Branding" : "🏢 Company Profile"}</h2>
        <p>{isSuperAdminView ? `Manage public branding for ${companyName || "this company"}` : "Manage your company information and branding"}</p>
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
          <h3>Branding & Introduction</h3>
          <p style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 16 }}>
            Customize the logo and introduction text that will be displayed to consumers viewing your passports.
          </p>
          <IntroductionUpload
            logoPreview={logoPreview}
            introText={introText}
            onLogoChange={setLogoPreview}
            onTextChange={setIntroText}
          />
          <button className="profile-save-btn" onClick={handleSaveProfile} disabled={savingProfile}>
            {savingProfile ? "💾 Saving..." : "💾 Save Profile"}
          </button>
        </div>

        <div className="profile-card">
          <h3>Public Experience Branding</h3>
          <p style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 16 }}>
            These settings control the public passport viewer and consumer page without requiring frontend code changes for each onboarding.
          </p>

          <div className="profile-content company-branding-grid">
            <div className="info-group">
              <label>Viewer Variant</label>
              <select className="info-input" value={branding.viewer_variant} onChange={e => handleBrandingChange("viewer_variant", e.target.value)}>
                <option value="classic">Classic</option>
                <option value="minimal">Minimal</option>
                <option value="showcase">Showcase</option>
              </select>
            </div>

            <div className="info-group">
              <label>Consumer Variant</label>
              <select className="info-input" value={branding.consumer_variant} onChange={e => handleBrandingChange("consumer_variant", e.target.value)}>
                <option value="classic">Classic</option>
                <option value="minimal">Minimal</option>
                <option value="showcase">Showcase</option>
              </select>
            </div>

            <div className="info-group">
              <label>Public Page Title</label>
              <input className="info-input" type="text" value={branding.public_page_title} onChange={e => handleBrandingChange("public_page_title", e.target.value)} placeholder="Leave blank to use passport-type title" />
            </div>

            <div className="info-group">
              <label>Public Tagline</label>
              <input className="info-input" type="text" value={branding.public_tagline} onChange={e => handleBrandingChange("public_tagline", e.target.value)} placeholder="Optional marketing/supporting line" />
            </div>

            <div className="info-group">
              <label>Primary Color</label>
              <input className="info-input" type="color" value={branding.primary_color} onChange={e => handleBrandingChange("primary_color", e.target.value)} />
            </div>

            <div className="info-group">
              <label>Secondary Color</label>
              <input className="info-input" type="color" value={branding.secondary_color} onChange={e => handleBrandingChange("secondary_color", e.target.value)} />
            </div>

            <div className="info-group">
              <label>Accent Surface</label>
              <input className="info-input" type="color" value={branding.accent_color} onChange={e => handleBrandingChange("accent_color", e.target.value)} />
            </div>

            <div className="info-group">
              <label>Background Gradient</label>
              <input className="info-input" type="text" value={branding.background_gradient} onChange={e => handleBrandingChange("background_gradient", e.target.value)} placeholder="linear-gradient(...)" />
            </div>

            <div className="info-group">
              <label>Company Website</label>
              <input className="info-input" type="url" value={branding.company_website} onChange={e => handleBrandingChange("company_website", e.target.value)} placeholder="https://example.com" />
            </div>
          </div>

          <div className="company-branding-preview" style={{
            "--preview-primary": branding.primary_color,
            "--preview-secondary": branding.secondary_color,
            "--preview-accent": branding.accent_color,
            "--preview-gradient": branding.background_gradient,
          }}>
            <div className="company-branding-preview-hero">
              <strong>{branding.public_page_title || companyName || "Company Public Page"}</strong>
              <span>{branding.public_tagline || "Preview of company-controlled branding"}</span>
            </div>
            <div className="company-branding-preview-meta">
              <span>Viewer: {branding.viewer_variant}</span>
              <span>Consumer: {branding.consumer_variant}</span>
            </div>
          </div>

          <button className="profile-save-btn" onClick={handleSaveProfile} disabled={savingProfile}>
            {savingProfile ? "💾 Saving..." : "💾 Save Branding"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default CompanyProfile;
