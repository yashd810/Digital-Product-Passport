import React, { useState, useEffect, useRef } from "react";
import { useI18n } from "../../app/providers/i18n";
import { authHeaders, fetchWithAuth } from "../../shared/api/authHeaders";
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_REQUIREMENT_TEXT,
  validatePasswordPolicy,
} from "../../auth/utils/passwordPolicy";
import "../../shared/styles/Dashboard.css";

const API = import.meta.env.VITE_API_URL || "";

function UserProfile({
  user,
  companyId,
  onUserUpdate,
  showWorkflowDefaults = true,
  showLanguageSelector = true,
  profileTitle,
  profileSubtitle,
  showPersonalInfo = true,
  showHeader = true,
}) {
  const { t } = useI18n();
  const flashRef = useRef(null);

  const [profile,    setProfile]    = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [savingPw,   setSavingPw]   = useState(false);
  const [saving2FA,  setSaving2FA]  = useState(false);
  const [msg,        setMsg]        = useState({ type:"", text:"" });

  const [firstName,  setFirstName]  = useState("");
  const [lastName,   setLastName]   = useState("");
  const [phone,      setPhone]      = useState("");
  const [jobTitle,   setJobTitle]   = useState("");
  const [bio,        setBio]        = useState("");

  const [curPw,      setCurPw]      = useState("");
  const [newPw,      setNewPw]      = useState("");
  const [confPw,     setConfPw]     = useState("");
  const [twoFaEnabled, setTwoFaEnabled] = useState(false);
  const [twoFaPassword, setTwoFaPassword] = useState("");

  const [teamUsers,  setTeamUsers]  = useState([]);
  const [defReviewer,setDefReviewer]= useState("");
  const [defApprover,setDefApprover]= useState("");

  useEffect(() => {
    fetchProfile();
    if (showWorkflowDefaults && companyId) fetchTeam();
  }, []);

  const fetchProfile = async () => {
    try {
      const r = await fetchWithAuth(`${API}/api/users/me`, {
        headers: { ...authHeaders() },
      });
      if (!r.ok) throw new Error();
      const d = await r.json();
      setProfile(d);
      setFirstName(d.firstName || "");
      setLastName(d.lastName || "");
      setPhone(d.phone || "");
      setJobTitle(d.jobTitle || "");
      setBio(d.bio || "");
      setDefReviewer(d.defaultReviewerId ? String(d.defaultReviewerId) : "");
      setDefApprover(d.defaultApproverId ? String(d.defaultApproverId) : "");
      setTwoFaEnabled(!!d.twoFactorEnabled);
    } catch { }
    finally { setLoading(false); }
  };

  const fetchTeam = async () => {
    if (!companyId) return;
    try {
      const r = await fetchWithAuth(`${API}/api/companies/${companyId}/users`, {
        headers: { ...authHeaders() },
      });
      if (r.ok) {
        const d = await r.json();
        setTeamUsers(d.filter(u => u.role === "editor" || u.role === "company_admin"));
      }
    } catch { }
  };

  const flash = (type, text) => {
    setMsg({ type, text });
    setTimeout(() => setMsg({ type:"", text:"" }), 4000);
  };

  useEffect(() => {
    if (!msg.text || !flashRef.current) return;
    flashRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [msg]);

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const body = {
        firstName,
        lastName,
        phone,
        jobTitle,
        bio,
        defaultReviewerId: defReviewer ? parseInt(defReviewer) : null,
        defaultApproverId: defApprover ? parseInt(defApprover) : null,
      };
      const r = await fetchWithAuth(`${API}/api/users/me`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error("Failed to save");
      flash("success", "Profile updated!");
      if (onUserUpdate) onUserUpdate({ ...user, firstName, lastName });
    } catch (err) {
      flash("error", err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleChangePw = async (e) => {
    e.preventDefault();
    if (savingPw) return;
    if (!curPw || !newPw || !confPw) {
      flash("error", "Enter all password fields before updating your password.");
      return;
    }
    if (newPw !== confPw) { flash("error", "New passwords don't match"); return; }
    const passwordPolicyError = validatePasswordPolicy(newPw);
    if (passwordPolicyError) {
      flash("error", passwordPolicyError);
      return;
    }
    setSavingPw(true);
    try {
      const r = await fetchWithAuth(`${API}/api/users/me/password`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ currentPassword: curPw, newPassword: newPw }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      flash("success", "Password updated successfully.");
      setCurPw(""); setNewPw(""); setConfPw("");
    } catch (err) {
      flash("error", err.message);
    } finally {
      setSavingPw(false);
    }
  };

  const handleToggle2FA = async (e) => {
    e.preventDefault();
    if (saving2FA) return;
    if (!twoFaPassword) {
      flash("error", "Enter your current password before changing two-factor authentication.");
      return;
    }
    setSaving2FA(true);
    try {
      const response = await fetchWithAuth(`${API}/api/users/me/2fa`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ enable: !twoFaEnabled, currentPassword: twoFaPassword }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed");
      setTwoFaEnabled(data.twoFactorEnabled);
      setTwoFaPassword("");
      flash(
        "success",
        data.twoFactorEnabled
          ? "Two-factor authentication enabled successfully."
          : "Two-factor authentication disabled successfully."
      );
    } catch (err) {
      flash("error", err.message);
    } finally {
      setSaving2FA(false);
    }
  };

  if (loading) return <div className="loading dashboard-loading-screen">Loading profile…</div>;

  return (
    <div className="profile-page">
      {showHeader && (
        <div className="profile-header">
          <h2 className="profile-title">{profileTitle || t("myProfile")}</h2>
          <p className="profile-sub">{profileSubtitle || user?.email}</p>
        </div>
      )}

      {msg.text && (
        <div
          ref={flashRef}
          className={`alert alert-${msg.type === "success" ? "success" : "error"} dashboard-alert-spaced`}
        >
          {msg.text}
        </div>
      )}

      <div className="profile-right">
          {showPersonalInfo && (
            <div className="profile-card">
              <h4 className="card-section-title">Personal Information</h4>
              <form onSubmit={handleSaveProfile} className="profile-form">
                <div className="form-row-2">
                  <div className="form-group">
                    <label>{t("firstName")}</label>
                    <input type="text" value={firstName} disabled={saving}
                      onChange={e => setFirstName(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>{t("lastName")}</label>
                    <input type="text" value={lastName} disabled={saving}
                      onChange={e => setLastName(e.target.value)} />
                  </div>
                </div>
                <div className="form-row-2">
                  <div className="form-group">
                    <label>{t("phone")} <span className="opt">(optional)</span></label>
                    <input type="tel" value={phone} placeholder="+46 70 000 0000" disabled={saving}
                      onChange={e => setPhone(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>{t("jobTitle")} <span className="opt">(optional)</span></label>
                    <input type="text" value={jobTitle} placeholder="e.g. Product Manager" disabled={saving}
                      onChange={e => setJobTitle(e.target.value)} />
                  </div>
                </div>
                <div className="form-group">
                  <label>{t("bio")} <span className="opt">(optional)</span></label>
                  <textarea rows={3} value={bio} placeholder="Brief description…" disabled={saving}
                    onChange={e => setBio(e.target.value)} />
                </div>

                {showWorkflowDefaults && companyId && (
                  <>
                    <h4 className="card-section-title profile-section-spaced">
                      Workflow Defaults
                    </h4>
                    <p className="profile-helper-text">
                      Default reviewer and approver pre-filled when you release a passport.
                    </p>
                    <div className="form-row-2">
                      <div className="form-group">
                        <label>Default Reviewer</label>
                        <select value={defReviewer} disabled={saving}
                          onChange={e => setDefReviewer(e.target.value)}>
                          <option value="">— None —</option>
                          {teamUsers.filter(u => u.id !== user?.id).map(u => (
                            <option key={u.id} value={u.id}>
                              {u.firstName} {u.lastName} ({u.email})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="form-group">
                        <label>Default Approver</label>
                        <select value={defApprover} disabled={saving}
                          onChange={e => setDefApprover(e.target.value)}>
                          <option value="">— None —</option>
                          {teamUsers.filter(u => u.id !== user?.id).map(u => (
                            <option key={u.id} value={u.id}>
                              {u.firstName} {u.lastName} ({u.email})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </>
                )}

                <div className="form-actions">
                  <button type="submit" className="btn-primary dashboard-btn-primary">
                    {saving ? "Saving…" : t("saveChanges")}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Change Password */}
          <div className="profile-card">
            <h4 className="card-section-title">🔒 {t("changePassword")}</h4>
            <form onSubmit={handleChangePw} className="profile-form">
              <div className="form-group">
                <label>Current Password</label>
                <input type="password" value={curPw} placeholder="••••••••" disabled={savingPw}
                  onChange={e => setCurPw(e.target.value)} required />
              </div>
              <div className="form-row-2">
                <div className="form-group">
                  <label>{t("newPassword")}</label>
                  <input type="password" value={newPw} placeholder={`Min. ${PASSWORD_MIN_LENGTH} characters`} disabled={savingPw}
                    onChange={e => setNewPw(e.target.value)} required minLength={PASSWORD_MIN_LENGTH} />
                  <span style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4 }}>
                    {PASSWORD_REQUIREMENT_TEXT}
                  </span>
                </div>
                <div className="form-group">
                  <label>{t("confirmPassword")}</label>
                  <input type="password" value={confPw} placeholder="Repeat" disabled={savingPw}
                    className={confPw && confPw !== newPw ? "profile-input-error" : ""}
                    onChange={e => setConfPw(e.target.value)} required
                  />
                </div>
              </div>
              <div className="form-actions">
                <button type="submit" className="btn-primary dashboard-btn-primary">
                  {savingPw ? "Updating…" : "Update Password"}
                </button>
              </div>
            </form>
          </div>

          <div className="profile-card">
            <div className="sec-card-header">
              <div>
                <h4 className="card-section-title">Two-Factor Authentication</h4>
                <p className="profile-helper-text">
                  When enabled, a 6-digit verification code is sent to your email address each time you log in.
                </p>
              </div>
              <span className={`sec-badge ${twoFaEnabled ? "sec-badge-on" : "sec-badge-off"}`}>
                {twoFaEnabled ? "Enabled" : "Disabled"}
              </span>
            </div>
            <form onSubmit={handleToggle2FA} className="profile-form">
              <div className="form-group">
                <label>Current Password <span className="opt">(required to change this setting)</span></label>
                <input
                  type="password"
                  value={twoFaPassword}
                  placeholder="••••••••"
                  disabled={saving2FA}
                  onChange={e => setTwoFaPassword(e.target.value)}
                  required
                />
              </div>
              <div className="form-actions">
                <button
                  type="submit"
                  className="btn-primary dashboard-btn-primary"
                >
                  {saving2FA ? "Saving…" : twoFaEnabled ? "Disable 2FA" : "Enable 2FA"}
                </button>
              </div>
            </form>
          </div>

          {/* Account Info */}
          <div className="profile-card">
            <h4 className="card-section-title">ℹ️ Account Info</h4>
            <div className="info-grid">
              <div className="info-row"><span>Email</span><strong>{user?.email}</strong></div>
              <div className="info-row"><span>Role</span>
                <span className={`role-chip role-${profile?.role}`}>
                  {profile?.role?.replace("_", " ")}
                </span>
              </div>
              <div className="info-row"><span>Member since</span>
                <strong>{profile?.createdAt ? new Date(profile.createdAt).toLocaleDateString() : "—"}</strong>
              </div>
              {profile?.lastLoginAt && (
                <div className="info-row"><span>Last login</span>
                  <strong>{new Date(profile.lastLoginAt).toLocaleString()}</strong>
                </div>
              )}
            </div>
          </div>
      </div>
    </div>
  );
}

export default UserProfile;
