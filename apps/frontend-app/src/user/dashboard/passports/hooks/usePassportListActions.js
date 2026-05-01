import { useCallback } from "react";
import { authHeaders, fetchWithAuth } from "../../../../shared/api/authHeaders";
import { buildPassportJsonLdExport } from "../../../../shared/utils/batterySemanticExport";
import {
  isEditablePassportStatus,
  isReleasedPassportStatus,
} from "../../../../passports/utils/passportStatus";
import { buildPublicPassportPath } from "../../../../passports/utils/passportRoutes";
import { buildPublicViewerUrl } from "../../../../passports/utils/publicViewerUrl";
import { renderPassportQrToCanvas } from "../../../../passport-viewer/utils/QRcode";

const API = import.meta.env.VITE_API_URL || "";

export function usePassportListActions({
  activeType,
  allPassportTypes,
  archiveConfirm,
  companyId,
  fetchPassports,
  selectedPassportList,
  setArchiveConfirm,
  setBulkActionLoading,
  setPrintQrModalOpen,
  setQrExporting,
  setSelectedPassports,
  showError,
  showSuccess,
  user,
  navigate,
}) {
  const handleRevise = useCallback(async (dppId, versionNumber, passportType) => {
    const response = await fetchWithAuth(`${API}/api/companies/${companyId}/passports/${dppId}/revise`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ passportType }),
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok) {
      showSuccess(`v${versionNumber} → v${data.newVersion} moved into In Revision.`);
      fetchPassports();
      return;
    }
    showError(data.error || "Revise failed");
  }, [companyId, fetchPassports, showError, showSuccess]);

  const handleClone = useCallback(async (passport, passportType) => {
    try {
      const response = await fetchWithAuth(
        `${API}/api/companies/${companyId}/passports/${passport.dppId}?passportType=${passportType}`,
        { headers: authHeaders() }
      );
      if (!response.ok) throw new Error("Failed to fetch passport data");
      const data = await response.json();
      navigate(`/create/${passportType}`, { state: { cloneData: data } });
    } catch {
      showError("Failed to clone passport — could not fetch data");
    }
  }, [companyId, navigate, showError]);

  const handleDelete = useCallback(async (dppId, passportType) => {
    if (!window.confirm("Delete this passport?")) return;

    const response = await fetchWithAuth(`${API}/api/companies/${companyId}/passports/${dppId}`, {
      method: "DELETE",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ passportType }),
    });

    if (response.ok) {
      showSuccess("Deleted");
      fetchPassports();
      return;
    }

    const data = await response.json().catch(() => ({}));
    showError(data.error || "Delete failed");
  }, [companyId, fetchPassports, showError, showSuccess]);

  const handleArchive = useCallback((dppId, passportType) => {
    setArchiveConfirm({ mode: "single", dppId, pType: passportType });
  }, [setArchiveConfirm]);

  const downloadQrCodes = useCallback(async ({ widthMm, heightMm, format }) => {
    if (!selectedPassportList.length) {
      showError("Select at least one passport first.");
      return;
    }

    const dpi = 300;
    const mmToPx = (mm) => Math.max(1, Math.round((mm / 25.4) * dpi));
    const widthPx = mmToPx(widthMm);
    const heightPx = mmToPx(heightMm);
    const mimeType = format === "jpeg" ? "image/jpeg" : "image/png";
    const isBlackAndWhite = true;
    const background = isBlackAndWhite || format === "jpeg" ? "#ffffff" : "#0f2134";

    setQrExporting(true);
    try {
      for (const passport of selectedPassportList) {
        const canvas = document.createElement("canvas");
        canvas.width = widthPx;
        canvas.height = heightPx;

        const context = canvas.getContext("2d");
        if (!context) throw new Error("Could not create export canvas");

        context.fillStyle = background;
        context.fillRect(0, 0, widthPx, heightPx);

        const topPadding = Math.round(heightPx * 0.09);
        const bottomPadding = Math.round(heightPx * 0.08);
        const sidePadding = Math.round(widthPx * 0.08);
        const categoryFontSize = Math.max(22, Math.round(heightPx * 0.065));
        const guidFontSize = Math.max(18, Math.round(heightPx * 0.045));
        const qrTop = topPadding + categoryFontSize + Math.round(heightPx * 0.06);
        const qrBottomLimit = heightPx - bottomPadding - guidFontSize - Math.round(heightPx * 0.05);
        const qrSize = Math.max(120, Math.min(widthPx - sidePadding * 2, qrBottomLimit - qrTop));
        const qrX = Math.round((widthPx - qrSize) / 2);
        const qrY = qrTop;

        const qrCanvas = document.createElement("canvas");
        const passportPath = buildPublicPassportPath({
          companyName: user?.company_name,
          modelName: passport.model_name,
          productId: passport.product_id,
        });
        if (!passportPath) throw new Error("Passport link is unavailable for this QR code");

        const passportUrl = buildPublicViewerUrl(passportPath);
        if (!passportUrl) throw new Error("Passport link is unavailable for this QR code");
        await renderPassportQrToCanvas(qrCanvas, {
          url: passportUrl,
          granularity: passport.granularity || "item",
          width: qrSize,
          margin: 1,
          color: {
            dark: isBlackAndWhite ? "#000000" : (format === "jpeg" ? "#0b1826" : "#f0f6fa"),
            light: background,
          },
        });

        context.textAlign = "center";
        context.fillStyle = isBlackAndWhite ? "#000000" : (format === "jpeg" ? "#0b1826" : "#f0f6fa");
        context.font = `700 ${categoryFontSize}px ${getComputedStyle(document.documentElement).getPropertyValue("--font").trim() || "sans-serif"}`;
        context.fillText((passport.passport_type || activeType || "Passport").replace(/_/g, " "), widthPx / 2, topPadding + categoryFontSize);

        context.drawImage(qrCanvas, qrX, qrY, qrSize, qrSize);

        context.font = `600 ${guidFontSize}px monospace`;
        context.fillStyle = isBlackAndWhite ? "#000000" : (format === "jpeg" ? "#35586a" : "#b8ccd9");
        context.fillText(passport.product_id || passport.dppId, widthPx / 2, heightPx - bottomPadding);

        const dataUrl = canvas.toDataURL(mimeType, format === "jpeg" ? 0.95 : undefined);
        const link = document.createElement("a");
        const safeType = (passport.passport_type || activeType || "passport").replace(/[^a-z0-9-_]+/gi, "_").toLowerCase();
        link.href = dataUrl;
        link.download = `${safeType}_${passport.product_id || passport.dppId}.${format}`;
        link.click();
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      setPrintQrModalOpen(false);
      showSuccess(`Downloaded ${selectedPassportList.length} QR code file${selectedPassportList.length !== 1 ? "s" : ""}.`);
    } catch (error) {
      showError(error.message || "Failed to generate QR codes");
    } finally {
      setQrExporting(false);
    }
  }, [activeType, selectedPassportList, setPrintQrModalOpen, setQrExporting, showError, showSuccess, user?.company_name]);

  const bulkRelease = useCallback(async () => {
    if (!selectedPassportList.length) return;

    const editable = selectedPassportList.filter((passport) => isEditablePassportStatus(passport.release_status));
    if (!editable.length) {
      showError("No draft or in-revision passports selected.");
      return;
    }
    if (!window.confirm(`Release ${editable.length} passport${editable.length !== 1 ? "s" : ""}? This cannot be undone.`)) return;

    setBulkActionLoading(true);
    try {
      const items = editable.map((passport) => ({ dppId: passport.dppId, passportType: passport.passport_type || activeType }));
      const response = await fetchWithAuth(`${API}/api/companies/${companyId}/passports/bulk-release`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ items }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Bulk release failed");
      showSuccess(`Released ${data.summary?.released || 0}, skipped ${data.summary?.skipped || 0}, failed ${data.summary?.failed || 0}`);
      setSelectedPassports(new Set());
      fetchPassports();
    } catch (error) {
      showError(error.message);
    } finally {
      setBulkActionLoading(false);
    }
  }, [activeType, companyId, fetchPassports, selectedPassportList, setBulkActionLoading, setSelectedPassports, showError, showSuccess]);

  const bulkDelete = useCallback(async () => {
    if (!selectedPassportList.length) return;

    const editable = selectedPassportList.filter((passport) => isEditablePassportStatus(passport.release_status));
    if (!editable.length) {
      showError("No deletable passports selected. Released passports cannot be deleted.");
      return;
    }
    if (!window.confirm(`Permanently delete ${editable.length} passport${editable.length !== 1 ? "s" : ""}? This cannot be undone.`)) return;

    setBulkActionLoading(true);
    let deleted = 0;
    let failed = 0;

    try {
      for (const passport of editable) {
        const passportType = passport.passport_type || activeType;
        const response = await fetchWithAuth(`${API}/api/companies/${companyId}/passports/${passport.dppId}`, {
          method: "DELETE",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ passportType }),
        });
        if (response.ok) deleted += 1;
        else failed += 1;
      }
      showSuccess(`Deleted ${deleted}${failed ? `, ${failed} failed` : ""}`);
      setSelectedPassports(new Set());
      fetchPassports();
    } catch (error) {
      showError(error.message);
    } finally {
      setBulkActionLoading(false);
    }
  }, [activeType, companyId, fetchPassports, selectedPassportList, setBulkActionLoading, setSelectedPassports, showError, showSuccess]);

  const bulkExportJson = useCallback(async () => {
    if (!selectedPassportList.length) {
      showError("Select at least one passport.");
      return;
    }

    setBulkActionLoading(true);
    try {
      const grouped = selectedPassportList.reduce((acc, passport) => {
        const passportType = passport.passport_type || activeType;
        if (!acc[passportType]) acc[passportType] = [];
        acc[passportType].push(passport);
        return acc;
      }, {});

      let exportedCount = 0;
      const fileCount = Object.keys(grouped).length;
      for (const [passportType, passportsForType] of Object.entries(grouped)) {
        const typeResponse = await fetchWithAuth(`${API}/api/passport-types/${passportType}`);
        if (!typeResponse.ok) throw new Error(`Failed to fetch field definitions for ${passportType}`);
        const typeData = await typeResponse.json();
        const semanticModelKey = typeData.semantic_model_key || "";
        const umbrellaCategory = typeData.umbrella_category || "";

        const exported = [];
        for (const passport of passportsForType) {
          const query = new URLSearchParams({
            passportType,
            representation: "full",
          });
          if (passport.version_number !== null && passport.version_number !== undefined && passport.version_number !== "") {
            query.set("versionNumber", String(passport.version_number));
          }
          const response = await fetchWithAuth(`${API}/api/companies/${companyId}/passports/${passport.dppId}?${query.toString()}`, {
            headers: authHeaders(),
          });
          if (!response.ok) continue;
          const data = await response.json();
          exported.push(data);
        }

        if (!exported.length) {
          continue;
        }

        const exportPayload = buildPassportJsonLdExport(exported, passportType, { semanticModelKey, umbrellaCategory });
        const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/ld+json" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        const filenamePrefix = fileCount > 1 ? `${passportType}-` : "";
        link.download = `${filenamePrefix}passports-export-${new Date().toISOString().slice(0, 10)}.jsonld`;
        link.click();
        URL.revokeObjectURL(link.href);
        exportedCount += exported.length;
      }

      if (!exportedCount) {
        showError("Could not fetch any passport data.");
        return;
      }

      showSuccess(`Exported ${exportedCount} passport${exportedCount !== 1 ? "s" : ""} as JSON-LD`);
    } catch (error) {
      showError(error.message);
    } finally {
      setBulkActionLoading(false);
    }
  }, [activeType, companyId, selectedPassportList, setBulkActionLoading, showError, showSuccess]);

  const bulkArchive = useCallback(() => {
    if (!selectedPassportList.length) return;
    setArchiveConfirm({ mode: "bulk", count: selectedPassportList.length });
  }, [selectedPassportList.length, setArchiveConfirm]);

  const confirmArchive = useCallback(async () => {
    if (!archiveConfirm) return;

    if (archiveConfirm.mode === "single") {
      try {
        setBulkActionLoading(true);
        const response = await fetchWithAuth(`${API}/api/companies/${companyId}/passports/${archiveConfirm.dppId}/archive`, {
          method: "POST",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ passportType: archiveConfirm.pType }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Archive failed");
        showSuccess("Passport archived");
        setArchiveConfirm(null);
        fetchPassports();
      } catch (error) {
        showError(error.message);
      } finally {
        setBulkActionLoading(false);
      }
      return;
    }

    try {
      setBulkActionLoading(true);
      const items = selectedPassportList.map((passport) => ({ dppId: passport.dppId, passportType: passport.passport_type || activeType }));
      const response = await fetchWithAuth(`${API}/api/companies/${companyId}/passports/bulk-archive`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ items }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Bulk archive failed");
      showSuccess(`Archived ${data.summary?.archived || 0}, skipped ${data.summary?.skipped || 0}`);
      setSelectedPassports(new Set());
      setArchiveConfirm(null);
      fetchPassports();
    } catch (error) {
      showError(error.message);
    } finally {
      setBulkActionLoading(false);
    }
  }, [activeType, archiveConfirm, companyId, fetchPassports, selectedPassportList, setArchiveConfirm, setBulkActionLoading, setSelectedPassports, showError, showSuccess]);

  return {
    bulkArchive,
    bulkDelete,
    bulkExportJson,
    bulkRelease,
    confirmArchive,
    downloadQrCodes,
    handleArchive,
    handleClone,
    handleDelete,
    handleRevise,
  };
}
