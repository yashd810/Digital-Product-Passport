import React from "react";
import { useI18n } from "../../../../app/providers/i18n";

export function PassportListHeader({
  pageTitle,
  user,
  selectionMode,
  setSelectionMode,
  setSelectedPassports,
  setPrintQrModalOpen,
  setExportModalOpen,
}) {
  const { t } = useI18n();
  return (
    <div className="passport-list-header">
      <div>
        <h2 className="passport-list-title">📋 {pageTitle}</h2>
        <p className="passport-list-description">{t("passportListDescription")}</p>
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
            title={selectionMode ? t("hidePassportSelection") : t("selectPassports")}
          >
            {selectionMode ? t("doneSelecting") : t("selectPassports")}
          </button>
          <button className="csv-btn export-btn" onClick={() => setExportModalOpen(true)} title={t("exportPassports")}>
            📊 {t("export")}
          </button>
        </div>
      )}
    </div>
  );
}
