import React from "react";
import {
  getPassportLinkType,
  isEditablePassportStatus,
  isReleasedPassportStatus,
} from "../../../../passports/utils/passportStatus";
import { buildPublicViewerUrl } from "../../../../passports/utils/publicViewerUrl";
import { KebabMenu } from "./PassportListComponents";

export function PassportListRowMenu({
  anchorRect,
  passport,
  pType,
  isPinned,
  navigate,
  openPassportViewer,
  setOpenMenuId,
  setMenuAnchorRect,
  setReleaseModal,
  handleRevise,
  handleClone,
  setCsvModal,
  setHistoryModal,
  setDeviceModal,
  showError,
  showSuccess,
  getViewerPath,
  handleArchive,
  handleDelete,
  togglePin,
}) {
  return (
    <KebabMenu anchorRect={anchorRect} onClose={() => { setOpenMenuId(null); setMenuAnchorRect(null); }}>
      <button className="menu-item" onClick={() => togglePin(passport.dppId)}>
        {isPinned ? "📌 Unpin" : "📌 Pin to top"}
      </button>
      <button className={`menu-item edit-item${!isEditablePassportStatus(passport.release_status) ? " disabled" : ""}`} disabled={!isEditablePassportStatus(passport.release_status)} onClick={() => { navigate(`/edit/${passport.dppId}?passportType=${pType}`); setOpenMenuId(null); }}>
        ✏️ Edit
      </button>
      <button className={`menu-item release-item${!isEditablePassportStatus(passport.release_status) ? " disabled" : ""}`} disabled={!isEditablePassportStatus(passport.release_status)} onClick={() => { setReleaseModal({ ...passport, passport_type: pType }); setOpenMenuId(null); }}>
        🎯 Release
      </button>
      <button className="menu-item" onClick={() => { openPassportViewer(passport, { forcePreview: true }); setOpenMenuId(null); }}>
        👁 Preview public view
      </button>
      <button className={`menu-item revise-item${!isReleasedPassportStatus(passport.release_status) ? " disabled" : ""}`} disabled={!isReleasedPassportStatus(passport.release_status)} onClick={() => { handleRevise(passport.dppId, passport.version_number, pType); setOpenMenuId(null); }}>
        🔄 Revise
      </button>
      <button className="menu-item" onClick={() => handleClone(passport, pType)}>
        🔁 Clone
      </button>
      <button className={`menu-item${!isEditablePassportStatus(passport.release_status) ? " disabled" : ""}`} disabled={!isEditablePassportStatus(passport.release_status)} onClick={() => { setCsvModal({ passport, pType }); setOpenMenuId(null); }}>
        📤 Update data via CSV
      </button>
      <button className="menu-item" onClick={() => { setHistoryModal({ dppId: passport.dppId, passportType: pType }); setOpenMenuId(null); }}>
        🕘 Update history
      </button>
      <button className="menu-item" onClick={() => { navigate(`/passport/${passport.dppId}/diff?passportType=${pType}`); setOpenMenuId(null); }}>
        🔀 Compare versions
      </button>
      <button className="menu-item" onClick={() => { setDeviceModal({ passport, pType }); setOpenMenuId(null); }}>
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
          const isPassportLink = getPassportLinkType(passport.release_status) === "passport";
          const url = isPassportLink ? buildPublicViewerUrl(path) : `${window.location.origin}${path}`;
          navigator.clipboard.writeText(url).then(() => {
            showSuccess(`${isPassportLink ? "Passport" : "Preview"} link copied to clipboard`);
          }).catch(() => {
            showError("Could not copy link");
          });
          setOpenMenuId(null);
        }}
      >
        🔗 {getPassportLinkType(passport.release_status) === "passport" ? "Copy passport link" : "Copy preview link"}
      </button>
      <button className="menu-item" onClick={() => { handleArchive(passport.dppId, pType); setOpenMenuId(null); }}>
        📦 Archive
      </button>
      <button className={`menu-item delete-item${!isEditablePassportStatus(passport.release_status) ? " disabled" : ""}`} disabled={!isEditablePassportStatus(passport.release_status)} onClick={() => { handleDelete(passport.dppId, pType); setOpenMenuId(null); }}>
        🗑️ Delete
      </button>
    </KebabMenu>
  );
}
