import React from "react";

export function PassportListHeader({
  pageTitle,
  user,
  selectionMode,
  setSelectionMode,
  setSelectedPassports,
  setPrintQrModalOpen,
  setExportModalOpen,
}) {
  return (
    <div className="passport-list-header">
      <div>
        <h2 className="passport-list-title">📋 {pageTitle}</h2>
        <p className="passport-list-description">Manage and track all your digital product passports</p>
      </div>
      {user?.role !== "viewer" && (
        <div className="passport-list-actions">
          <button
            className={`csv-btn template-btn passport-select-toggle${selectionMode ? " active" : ""}`}
            onClick={() => {
              if (selectionMode) {
                setSelectionMode(false);
                setSelectedPassports(new Set());
                setPrintQrModalOpen(false);
                return;
              }
              setSelectionMode(true);
            }}
            title={selectionMode ? "Hide passport selection" : "Select passports"}
          >
            {selectionMode ? "Done Selecting" : "Select Passports"}
          </button>
          <button className="csv-btn export-btn" onClick={() => setExportModalOpen(true)} title="Export passports">
            📊 Export
          </button>
        </div>
      )}
    </div>
  );
}
