import React from "react";
import { authHeaders } from "../../../../shared/api/authHeaders";
import {
  getPassportLinkType,
  isEditablePassportStatus,
  isReleasedPassportStatus,
} from "../../../../passports/utils/passportStatus";
import { KebabMenu } from "./PassportListComponents";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

export function PassportListRowMenu({
  anchorRect,
  passport,
  pType,
  isPinned,
  companyId,
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
      <button className="menu-item" onClick={() => togglePin(passport.guid)}>
        {isPinned ? "📌 Unpin" : "📌 Pin to top"}
      </button>
      <button className={`menu-item edit-item${!isEditablePassportStatus(passport.release_status) ? " disabled" : ""}`} disabled={!isEditablePassportStatus(passport.release_status)} onClick={() => { navigate(`/edit/${passport.guid}?passportType=${pType}`); setOpenMenuId(null); }}>
        ✏️ Edit
      </button>
      <button className={`menu-item release-item${!isEditablePassportStatus(passport.release_status) ? " disabled" : ""}`} disabled={!isEditablePassportStatus(passport.release_status)} onClick={() => { setReleaseModal({ ...passport, passport_type: pType }); setOpenMenuId(null); }}>
        🎯 Release
      </button>
      <button className="menu-item" onClick={() => { openPassportViewer(passport, { forcePreview: true }); setOpenMenuId(null); }}>
        👁 Preview public view
      </button>
      <button className={`menu-item revise-item${!isReleasedPassportStatus(passport.release_status) ? " disabled" : ""}`} disabled={!isReleasedPassportStatus(passport.release_status)} onClick={() => { handleRevise(passport.guid, passport.version_number, pType); setOpenMenuId(null); }}>
        🔄 Revise
      </button>
      <button className="menu-item" onClick={() => handleClone(passport, pType)}>
        🔁 Clone
      </button>
      <button className={`menu-item${!isEditablePassportStatus(passport.release_status) ? " disabled" : ""}`} disabled={!isEditablePassportStatus(passport.release_status)} onClick={() => { setCsvModal({ passport, pType }); setOpenMenuId(null); }}>
        📤 Update data via CSV
      </button>
      <button className="menu-item" onClick={() => { setHistoryModal({ guid: passport.guid, passportType: pType }); setOpenMenuId(null); }}>
        🕘 Update history
      </button>
      <button className="menu-item" onClick={() => { navigate(`/passport/${passport.guid}/diff?passportType=${pType}`); setOpenMenuId(null); }}>
        🔀 Compare versions
      </button>
      <button className="menu-item" onClick={() => { setDeviceModal({ passport, pType }); setOpenMenuId(null); }}>
        📡 Device Integration
      </button>
      <button
        className="menu-item"
        onClick={async () => {
          setOpenMenuId(null);
          try {
            const response = await fetch(`${API}/api/companies/${companyId}/passports/${passport.guid}/export/aas`, { headers: authHeaders() });
            if (!response.ok) throw new Error();
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `passport-${passport.guid}.aas.json`;
            link.click();
            URL.revokeObjectURL(url);
          } catch {
            showError("Failed to export AAS");
          }
        }}
      >
        📦 Export AAS (JSON)
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
          const url = `${window.location.origin}${path}`;
          navigator.clipboard.writeText(url).then(() => {
            showSuccess(`${getPassportLinkType(passport.release_status) === "passport" ? "Passport" : "Preview"} link copied to clipboard`);
          }).catch(() => {
            showError("Could not copy link");
          });
          setOpenMenuId(null);
        }}
      >
        🔗 {getPassportLinkType(passport.release_status) === "passport" ? "Copy passport link" : "Copy preview link"}
      </button>
      <button className="menu-item" onClick={() => { handleArchive(passport.guid, pType); setOpenMenuId(null); }}>
        📦 Archive
      </button>
      <button className={`menu-item delete-item${!isEditablePassportStatus(passport.release_status) ? " disabled" : ""}`} disabled={!isEditablePassportStatus(passport.release_status)} onClick={() => { handleDelete(passport.guid, pType); setOpenMenuId(null); }}>
        🗑️ Delete
      </button>
    </KebabMenu>
  );
}
