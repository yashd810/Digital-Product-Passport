import React from "react";
import {
  getPassportLinkType,
  isEditablePassportStatus,
  isReleasedPassportStatus,
} from "../../../../passports/utils/passportStatus";
import { buildPublicViewerUrl } from "../../../../passports/utils/publicViewerUrl";
import { buildDashboardPath } from "../../utils/dashboardRoutes";
import { KebabMenu } from "./PassportListComponents";
import { passportAuthoringAccessMessage } from "../../../../shared/auth/passportAuthoringAccess";
import { useI18n } from "../../../../app/providers/i18n";

export function PassportListRowMenu({
  anchorRect,
  isOpen,
  passport,
  pType,
  isPinned,
  canManagePassport,
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
  const { t } = useI18n();
  const effectivePassportType = passport.passportType || pType;
  const compareVersionsPath = buildDashboardPath({
    companyName,
    companyId,
    subpath: `passports/${passport.dppId}/history?passportType=${encodeURIComponent(effectivePassportType)}`,
  });
  const closeMenu = () => {
    setOpenMenuId(null);
    setMenuAnchorRect(null);
  };
  const runManagedAction = (action) => {
    if (!canManagePassport) {
      showError(passportAuthoringAccessMessage);
      closeMenu();
      return;
    }
    action();
  };

  return (
    <KebabMenu anchorRect={anchorRect} open={isOpen} onClose={closeMenu}>
      <button className="menu-item" onClick={() => togglePin(passport.dppId)}>
        📌 {isPinned ? t("unpin") : t("pinToTop")}
      </button>
      <button
        className={`menu-item edit-item${!isEditablePassportStatus(passport.releaseStatus) ? " disabled" : ""}`}
        disabled={!isEditablePassportStatus(passport.releaseStatus)}
        title={canManagePassport ? undefined : passportAuthoringAccessMessage}
        onClick={() => runManagedAction(() => { navigate(`/edit/${passport.dppId}?passportType=${effectivePassportType}`); closeMenu(); })}
      >
        ✏️ Edit
      </button>
      <button
        className={`menu-item release-item${!isEditablePassportStatus(passport.releaseStatus) ? " disabled" : ""}`}
        disabled={!isEditablePassportStatus(passport.releaseStatus)}
        title={canManagePassport ? undefined : passportAuthoringAccessMessage}
        onClick={() => runManagedAction(() => { setReleaseModal({ ...passport, passportType: effectivePassportType }); closeMenu(); })}
      >
        🎯 Release
      </button>
      <button className="menu-item" onClick={() => { setReleaseModal({ ...passport, passportType: effectivePassportType, checkerOnly: true }); setOpenMenuId(null); }}>
        🧪 {t("verificationCheck")}
      </button>
      <button
        className={`menu-item revise-item${!isReleasedPassportStatus(passport.releaseStatus) ? " disabled" : ""}`}
        disabled={!isReleasedPassportStatus(passport.releaseStatus)}
        title={canManagePassport ? undefined : passportAuthoringAccessMessage}
        onClick={() => runManagedAction(() => { handleRevise(passport.dppId, passport.versionNumber, effectivePassportType); closeMenu(); })}
      >
        🔄 Revise
      </button>
      <button
        className="menu-item"
        title={canManagePassport ? undefined : passportAuthoringAccessMessage}
        onClick={() => runManagedAction(() => handleClone(passport, effectivePassportType))}
      >
        🔁 {t("clone")}
      </button>
      <button className="menu-item" onClick={() => { navigate(compareVersionsPath); setOpenMenuId(null); }}>
        🕘 {t("updateHistory")}
      </button>
      <button
        className="menu-item"
        title={canManagePassport ? undefined : passportAuthoringAccessMessage}
        onClick={() => runManagedAction(() => { setDeviceModal({ passport, pType: effectivePassportType }); closeMenu(); })}
      >
        📡 {t("deviceIntegration")}
      </button>
      <button
        className="menu-item"
        onClick={() => {
          const path = getViewerPath(passport);
          if (!path) {
            showError(t("noViewerLink"));
            setOpenMenuId(null);
            return;
          }
          const isPassportLink = getPassportLinkType(passport.releaseStatus) === "passport";
          const url = isPassportLink ? buildPublicViewerUrl(path) : `${window.location.origin}${path}`;
          if (!url) {
            showError(t("noViewerLink"));
            setOpenMenuId(null);
            return;
          }
          navigator.clipboard.writeText(url).then(() => {
            showSuccess(t(isPassportLink ? "passportLinkCopied" : "previewLinkCopied"));
          }).catch(() => {
            showError(t("linkCopyFailed"));
          });
          setOpenMenuId(null);
        }}
      >
        🔗 {t(getPassportLinkType(passport.releaseStatus) === "passport" ? "copyPassportLink" : "copyPreviewLink")}
      </button>
    </KebabMenu>
  );
}
