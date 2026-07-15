import React from "react";
import {
  getPassportLinkType,
  isEditablePassportStatus,
  isReleasedPassportStatus,
} from "../../../../passports/utils/passportStatus";
import { buildPublicViewerUrl } from "../../../../passports/utils/publicViewerUrl";
import { buildDashboardPath } from "../../utils/dashboardRoutes";
import { KebabMenu } from "./PassportListComponents";

export function PassportListRowMenu({
  anchorRect,
  passport,
  pType,
  isPinned,
  navigate,
  setOpenMenuId,
  setMenuAnchorRect,
  setReleaseModal,
  handleRevise,
  handleClone,
  setDeviceModal,
  showError,
  showSuccess,
  getViewerPath,
  togglePin,
  companyName,
  companyId,
}) {
  const effectivePassportType = passport.passportType || pType;
  const compareVersionsPath = buildDashboardPath({
    companyName,
    companyId,
    subpath: `passports/${passport.dppId}/history?passportType=${encodeURIComponent(effectivePassportType)}`,
  });

  return (
    <KebabMenu anchorRect={anchorRect} onClose={() => { setOpenMenuId(null); setMenuAnchorRect(null); }}>
      <button className="menu-item" onClick={() => togglePin(passport.dppId)}>
        {isPinned ? "📌 Unpin" : "📌 Pin to top"}
      </button>
      <button className={`menu-item edit-item${!isEditablePassportStatus(passport.releaseStatus) ? " disabled" : ""}`} disabled={!isEditablePassportStatus(passport.releaseStatus)} onClick={() => { navigate(`/edit/${passport.dppId}?passportType=${effectivePassportType}`); setOpenMenuId(null); }}>
        ✏️ Edit
      </button>
      <button className={`menu-item release-item${!isEditablePassportStatus(passport.releaseStatus) ? " disabled" : ""}`} disabled={!isEditablePassportStatus(passport.releaseStatus)} onClick={() => { setReleaseModal({ ...passport, passportType: effectivePassportType }); setOpenMenuId(null); }}>
        🎯 Release
      </button>
      <button className="menu-item" onClick={() => { setReleaseModal({ ...passport, passportType: effectivePassportType, checkerOnly: true }); setOpenMenuId(null); }}>
        🧪 Verification check
      </button>
      <button className={`menu-item revise-item${!isReleasedPassportStatus(passport.releaseStatus) ? " disabled" : ""}`} disabled={!isReleasedPassportStatus(passport.releaseStatus)} onClick={() => { handleRevise(passport.dppId, passport.versionNumber, effectivePassportType); setOpenMenuId(null); }}>
        🔄 Revise
      </button>
      <button className="menu-item" onClick={() => handleClone(passport, effectivePassportType)}>
        🔁 Clone
      </button>
      <button className="menu-item" onClick={() => { navigate(compareVersionsPath); setOpenMenuId(null); }}>
        🕘 Update history
      </button>
      <button className="menu-item" onClick={() => { setDeviceModal({ passport, pType: effectivePassportType }); setOpenMenuId(null); }}>
        📡 Device Integration
      </button>
      <button
        className="menu-item"
        onClick={() => {
          const path = getViewerPath(passport);
          if (!path) {
            showError("No viewer link is available for this passport");
            setOpenMenuId(null);
            return;
          }
          const isPassportLink = getPassportLinkType(passport.releaseStatus) === "passport";
          const url = isPassportLink ? buildPublicViewerUrl(path) : `${window.location.origin}${path}`;
          if (!url) {
            showError("No viewer link is available for this passport");
            setOpenMenuId(null);
            return;
          }
          navigator.clipboard.writeText(url).then(() => {
            showSuccess(`${isPassportLink ? "Passport" : "Preview"} link copied to clipboard`);
          }).catch(() => {
            showError("Could not copy link");
          });
          setOpenMenuId(null);
        }}
      >
        🔗 {getPassportLinkType(passport.releaseStatus) === "passport" ? "Copy passport link" : "Copy preview link"}
      </button>
    </KebabMenu>
  );
}
