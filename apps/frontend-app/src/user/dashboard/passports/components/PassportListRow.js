import React, { useEffect, useRef } from "react";
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
import { useI18n } from "../../../../app/providers/i18n";

function PassportIdentifierText({ value, className, cellId, onIdentifierColumnWidthChange }) {
  const measurementRef = useRef(null);
  const naturalMeasurementRef = useRef(null);
  const wideColumnLockedRef = useRef(false);

  useEffect(() => {
    const measurementNode = measurementRef.current;
    const naturalMeasurementNode = naturalMeasurementRef.current;
    if (!measurementNode || !naturalMeasurementNode) return undefined;
    wideColumnLockedRef.current = false;
    onIdentifierColumnWidthChange?.(cellId, 0);

    const updateColumnWidth = () => {
      if (wideColumnLockedRef.current) return;
      const lineHeight = Number.parseFloat(window.getComputedStyle(measurementNode).lineHeight);
      const maximumTwoLineHeight = Number.isFinite(lineHeight) ? lineHeight * 2 : 40;
      if (measurementNode.getBoundingClientRect().height <= maximumTwoLineHeight + 1) return;

      const naturalWidth = naturalMeasurementNode.getBoundingClientRect().width;
      const requiredColumnWidth = Math.max(measurementNode.clientWidth, Math.ceil(naturalWidth / 2) + 24);
      wideColumnLockedRef.current = true;
      onIdentifierColumnWidthChange?.(cellId, requiredColumnWidth);
    };

    updateColumnWidth();
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updateColumnWidth);
    resizeObserver?.observe(measurementNode);
    return () => {
      resizeObserver?.disconnect();
      onIdentifierColumnWidthChange?.(cellId, 0);
    };
  }, [cellId, onIdentifierColumnWidthChange, value]);

  return (
    <span className="passport-text-cell-container">
      <span ref={measurementRef} className={`${className} passport-text-cell-measure`} aria-hidden="true">
        {value}
      </span>
      <span ref={naturalMeasurementRef} className={`${className} passport-text-cell-natural-measure`} aria-hidden="true">
        {value}
      </span>
      <span className={className} title={value}>{value}</span>
    </span>
  );
}

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
  onIdentifierColumnWidthChange,
}) {
  const { t } = useI18n();
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
    ? t("viewPassport")
    : passportLinkType === "inactive"
      ? t("viewHistoricalPassport")
      : t("previewPassport");
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
      <td className="passport-pin-cell" title={isPinned ? t("pinned") : ""}>
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
              aria-label={isExpanded ? t("hideOlderVersions") : t("showOlderVersions")}
            >
              {isExpanded ? "▾" : "▸"}
            </button>
          )}
          <span className="version-badge">v{passport.versionNumber}</span>
        </div>
      </td>
      <td className="passport-serial-col">
        {serialNumber ? <PassportIdentifierText value={serialNumber} className="passport-serial-cell" cellId={`${menuId}-serial`} onIdentifierColumnWidthChange={onIdentifierColumnWidthChange} /> : <span className="no-product-id">—</span>}
      </td>
      <td className="passport-model-col">
        {passport.modelName ? <PassportIdentifierText value={passport.modelName} className="passport-model-cell" cellId={`${menuId}-model`} onIdentifierColumnWidthChange={onIdentifierColumnWidthChange} /> : <span className="no-product-id">—</span>}
      </td>
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
            aria-label={`${viewerActionLabel}: ${passport.modelName || passport.dppId} (${t("opensInNewTab")})`}
          >
            {t("view")}
          </a>
        ) : (
          <button
            type="button"
            className="passport-view-btn"
            onClick={() => openPassportViewer(passport)}
            disabled={!viewerDestination}
            aria-label={`${viewerActionLabel}: ${passport.modelName || passport.dppId}`}
          >
            {t("view")}
          </button>
        )}
      </td>
      <td className="options-cell passport-options-col" onClick={e => e.stopPropagation()}>
        <div className="kebab-menu-container">
          <button
            type="button"
            className="kebab-menu-btn"
            onClick={e => openMenu(e, menuId)}
            aria-label={t("passportOptionsFor", { passport: passport.modelName || serialNumber || passport.dppId })}
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
