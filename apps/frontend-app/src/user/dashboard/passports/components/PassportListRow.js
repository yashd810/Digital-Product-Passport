import React from "react";
import { useMotionPresence } from "../../../../shared/hooks/useMotionPresence";
import {
  formatPassportStatus,
  getPassportLinkType,
  normalizePassportStatus,
} from "../../../../passports/utils/passportStatus";
import { CompletenessBar } from "./PassportListComponents";
import { PassportListRowMenu } from "./PassportListRowMenu";
import { formatPassportDate, getPassportSerialNumberForType } from "../utils/passportListHelpers";
import { canManagePassports } from "../../../../shared/auth/passportAuthoringAccess";

export function PassportListRow({
  passport,
  parentGuid = passport.dppId,
  isHistorical = false,
  hasOlderVersions = false,
  user,
  activeType,
  allPassportTypes,
  pinnedGuids,
  expandedPassportGroups,
  openMenuId,
  menuAnchorRect,
  selectionMode,
  selectedPassports,
  openPassportViewer,
  toggleSelectPassport,
  togglePassportGroup,
  setOpenMenuId,
  setMenuAnchorRect,
  openMenu,
  filterByUser,
  navigate,
  setReleaseModal,
  handleRevise,
  handleClone,
  setDeviceModal,
  companyId,
  showError,
  showSuccess,
  getViewerPath,
  getViewerDestination,
  calcCompleteness,
  togglePin,
}) {
  const pType = passport.passportType || activeType;
  const menuId = `${passport.dppId}-${passport.versionNumber}`;
  const isOpen = openMenuId === menuId;
  const menuPresent = useMotionPresence(isOpen);
  const pct = calcCompleteness(passport, allPassportTypes);
  const isPinned = pinnedGuids.has(passport.dppId);
  const isExpanded = expandedPassportGroups.has(parentGuid);
  const normalizedStatus = normalizePassportStatus(passport.releaseStatus);
  const showOlderVersionsToggle = hasOlderVersions && !isHistorical;
  const serialNumber = getPassportSerialNumberForType(passport, allPassportTypes);
  const passportLinkType = getPassportLinkType(passport.releaseStatus);
  const viewerActionLabel = passportLinkType === "passport"
    ? "View passport"
    : passportLinkType === "inactive"
      ? "View historical passport"
      : "Preview passport";
  const viewerDestination = getViewerDestination(passport);

  return (
    <tr
      key={`${menuId}${isHistorical ? "-history" : ""}`}
      className={[
        isPinned ? "passport-row-pinned" : "",
        selectionMode ? "passport-row-clickable" : "",
        isHistorical ? "passport-row-history" : "",
      ].filter(Boolean).join(" ")}
      onClick={selectionMode ? () => {
        if (openMenuId) {
          setOpenMenuId(null);
          return;
        }
        toggleSelectPassport(passport.dppId, passport.versionNumber);
      } : undefined}
    >
      {user?.role !== "viewer" && selectionMode && (
        <td>
          <input
            type="checkbox"
            checked={selectedPassports.has(menuId)}
            onChange={() => toggleSelectPassport(passport.dppId, passport.versionNumber)}
            onClick={e => e.stopPropagation()}
          />
        </td>
      )}
      <td className="passport-pin-cell" title={isPinned ? "Pinned" : ""}>
        {!isHistorical && isPinned ? "📌" : ""}
      </td>
      <td className="passport-version-col">
        <div className={`passport-version-cell${isHistorical ? " historical" : ""}`}>
          {showOlderVersionsToggle && (
            <button
              type="button"
              className="passport-version-toggle"
              onClick={(e) => {
                e.stopPropagation();
                togglePassportGroup(parentGuid);
              }}
              aria-expanded={isExpanded}
              aria-label={isExpanded ? "Hide older versions" : "Show older versions"}
            >
              {isExpanded ? "▾" : "▸"}
            </button>
          )}
          <span className="version-badge">v{passport.versionNumber}</span>
        </div>
      </td>
      <td className="passport-serial-col">
        {serialNumber ? <span className="passport-serial-cell" title={serialNumber}>{serialNumber}</span> : <span className="no-product-id">—</span>}
      </td>
      <td className="passport-model-col"><span className="passport-model-cell" title={passport.modelName || undefined}>{passport.modelName}</span></td>
      {filterByUser && (
        <td><span className="type-badge passport-type-badge">{pType}</span></td>
      )}
      <td className="passport-date-col">{formatPassportDate(passport)}</td>
      <td className="passport-status-col">
        <div className="passport-status-cell">
          <span className={`status-badge ${normalizedStatus}`}>
            {formatPassportStatus(passport.releaseStatus)}
          </span>
        </div>
      </td>
      <td className="passport-view-cell" onClick={e => e.stopPropagation()}>
        {viewerDestination?.isPublicRoute ? (
          <a
            className="passport-view-btn"
            href={viewerDestination.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${viewerActionLabel}: ${passport.modelName || passport.dppId} (opens in a new tab)`}
          >
            View
          </a>
        ) : (
          <button
            type="button"
            className="passport-view-btn"
            onClick={() => openPassportViewer(passport)}
            disabled={!viewerDestination}
            aria-label={`${viewerActionLabel}: ${passport.modelName || passport.dppId}`}
          >
            View
          </button>
        )}
      </td>
      <td className="options-cell passport-options-col" onClick={e => e.stopPropagation()}>
        <div className="kebab-menu-container">
          <button
            type="button"
            className="kebab-menu-btn"
            onClick={e => openMenu(e, menuId)}
            aria-label={`Passport options for ${passport.modelName || serialNumber || passport.dppId}`}
          >
            ⋮
          </button>
        </div>
        {menuPresent && (
          <PassportListRowMenu
            anchorRect={menuAnchorRect}
            isOpen={isOpen}
            passport={passport}
            pType={pType}
            isPinned={isPinned}
            canManagePassport={canManagePassports(user)}
            companyName={user?.companyName}
            companyId={companyId}
            navigate={navigate}
            setOpenMenuId={setOpenMenuId}
            setMenuAnchorRect={setMenuAnchorRect}
            setReleaseModal={setReleaseModal}
            handleRevise={handleRevise}
            handleClone={handleClone}
            setDeviceModal={setDeviceModal}
            showError={showError}
            showSuccess={showSuccess}
            getViewerPath={getViewerPath}
            togglePin={togglePin}
          />
        )}
      </td>
      <td className="passport-completeness-col"><CompletenessBar pct={pct} /></td>
    </tr>
  );
}
