import React from "react";
import {
  formatPassportStatus,
  normalizePassportStatus,
} from "../../../../passports/utils/passportStatus";
import { CompletenessBar } from "./PassportListComponents";
import { PassportListRowMenu } from "./PassportListRowMenu";

export function PassportListRow({
  passport,
  parentGuid = passport.guid,
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
  setCsvModal,
  setHistoryModal,
  setDeviceModal,
  companyId,
  showError,
  showSuccess,
  getViewerPath,
  handleArchive,
  handleDelete,
  calcCompleteness,
  togglePin,
}) {
  const pType = passport.passport_type || activeType;
  const menuId = `${passport.guid}-${passport.version_number}`;
  const isOpen = openMenuId === menuId;
  const pct = calcCompleteness(passport, allPassportTypes);
  const isPinned = pinnedGuids.has(passport.guid);
  const isExpanded = expandedPassportGroups.has(parentGuid);
  const normalizedStatus = normalizePassportStatus(passport.release_status);
  const showOlderVersionsToggle = hasOlderVersions && !isHistorical;

  return (
    <tr
      key={`${menuId}${isHistorical ? "-history" : ""}`}
      className={[
        isPinned ? "passport-row-pinned" : "",
        "passport-row-clickable",
        isHistorical ? "passport-row-history" : "",
      ].filter(Boolean).join(" ")}
      onClick={() => {
        if (openMenuId) {
          setOpenMenuId(null);
          return;
        }
        if (selectionMode) {
          toggleSelectPassport(passport.guid, passport.version_number);
        } else {
          openPassportViewer(passport);
        }
      }}
    >
      {user?.role !== "viewer" && selectionMode && (
        <td>
          <input
            type="checkbox"
            checked={selectedPassports.has(menuId)}
            onChange={() => toggleSelectPassport(passport.guid, passport.version_number)}
            onClick={e => e.stopPropagation()}
          />
        </td>
      )}
      <td className="passport-pin-cell" title={isPinned ? "Pinned" : ""}>
        {!isHistorical && isPinned ? "📌" : ""}
      </td>
      <td className="passport-version-col">
        <div className={`passport-version-cell${isHistorical ? " historical" : ""}`}>
          <span className="passport-version-toggle-slot" aria-hidden={!showOlderVersionsToggle}>
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
          </span>
          <span className="version-badge">v{passport.version_number}</span>
        </div>
      </td>
      <td>{passport.product_id ? <span className="product-id-badge">{passport.product_id}</span> : <span className="no-product-id">—</span>}</td>
      <td>
        <button className="model-link-btn" onClick={e => { e.stopPropagation(); openPassportViewer(passport); }}>
          {passport.model_name}
        </button>
      </td>
      {filterByUser && (
        <td><span className="type-badge passport-type-badge">{pType}</span></td>
      )}
      <td>{new Date(passport.created_at).toLocaleDateString()}</td>
      <td>
        <div className="passport-status-cell">
          <span className={`status-badge ${normalizedStatus}`}>
            {formatPassportStatus(passport.release_status)}
          </span>
        </div>
      </td>
      <td><CompletenessBar pct={pct} /></td>
      {!filterByUser && (
        <td className="small-text">
          {passport.first_name && passport.last_name
            ? `${passport.first_name} ${passport.last_name}`
            : passport.created_by_email || "—"}
        </td>
      )}
      <td className="options-cell" onClick={e => e.stopPropagation()}>
        {user?.role !== "viewer" && (
          <div className="kebab-menu-container">
            <button className="kebab-menu-btn" onClick={e => openMenu(e, menuId)}>⋮</button>
          </div>
        )}
        {isOpen && (
          <PassportListRowMenu
            anchorRect={menuAnchorRect}
            passport={passport}
            pType={pType}
            isPinned={isPinned}
            companyId={companyId}
            navigate={navigate}
            openPassportViewer={openPassportViewer}
            setOpenMenuId={setOpenMenuId}
            setMenuAnchorRect={setMenuAnchorRect}
            setReleaseModal={setReleaseModal}
            handleRevise={handleRevise}
            handleClone={handleClone}
            setCsvModal={setCsvModal}
            setHistoryModal={setHistoryModal}
            setDeviceModal={setDeviceModal}
            showError={showError}
            showSuccess={showSuccess}
            getViewerPath={getViewerPath}
            handleArchive={handleArchive}
            handleDelete={handleDelete}
            togglePin={togglePin}
          />
        )}
      </td>
    </tr>
  );
}
