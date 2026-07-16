function registerBackupRoutes(app, deps) {
  const {
    backupProviderService,
    authenticateToken,
    checkCompanyAdmin,
    logAudit,
    loadLatestLivePassport,
    normalizePassportRow,
    stripRestrictedFieldsForPublicView,
    getCompanyNameMap,
    replicatePassportToBackup,
  } = deps;
  const backupAdminGuard = checkCompanyAdmin;
  const backupReadGuard = checkCompanyAdmin;

  function toBackupProviderResponse(provider) {
    if (!provider) return null;
    const { configJson, ...safeProvider } = provider;
    const hasConfiguration = configJson && typeof configJson === "object" && !Array.isArray(configJson)
      ? Object.keys(configJson).length > 0
      : Boolean(configJson);
    return { ...safeProvider, hasConfiguration };
  }

  app.get("/api/companies/:companyId/backup-providers", authenticateToken, backupAdminGuard, async (req, res) => {
    try {
      if (!backupProviderService) return res.json([]);
      const providers = await backupProviderService.listProviders({ companyId: req.params.companyId });
      res.json(providers.map(toBackupProviderResponse));
    } catch {
      res.status(500).json({ error: "Failed to fetch backup providers" });
    }
  });

  app.post("/api/companies/:companyId/backup-providers", authenticateToken, backupAdminGuard, async (req, res) => {
    try {
      if (!backupProviderService) return res.status(503).json({ error: "Backup provider service is unavailable" });
      const provider = await backupProviderService.upsertProvider({
        companyId: req.params.companyId,
        providerKey: req.body?.providerKey,
        providerType: req.body?.providerType || "ociObjectStorage",
        displayName: req.body?.displayName || "OCI Object Storage Backup",
        objectPrefix: req.body?.objectPrefix || "backup-provider",
        publicBaseUrl: req.body?.publicBaseUrl || null,
        supportsPublicHandover: req.body?.supportsPublicHandover !== false,
        config: req.body?.config || {},
        createdBy: req.user.userId,
        isActive: req.body?.isActive !== false,
      });
      await logAudit(
        req.params.companyId,
        req.user.userId,
        "upsertBackupProvider",
        "backupServiceProviders",
        null,
        null,
        { providerKey: provider.providerKey, providerType: provider.providerType }
      );
      res.status(201).json(toBackupProviderResponse(provider));
    } catch (error) {
      res.status(error.statusCode || 400).json({ error: error.message || "Failed to upsert backup provider" });
    }
  });

  app.delete("/api/companies/:companyId/backup-providers/:providerKey", authenticateToken, backupAdminGuard, async (req, res) => {
    try {
      if (!backupProviderService) return res.status(503).json({ error: "Backup provider service is unavailable" });
      const provider = await backupProviderService.revokeProvider({
        companyId: req.params.companyId,
        providerKey: req.params.providerKey,
      });
      if (!provider) return res.status(404).json({ error: "Backup provider not found" });
      await logAudit(
        req.params.companyId,
        req.user.userId,
        "revokeBackupProvider",
        "backupServiceProviders",
        null,
        { providerKey: req.params.providerKey },
        { revoked: true }
      );
      res.json({ success: true, provider: toBackupProviderResponse(provider) });
    } catch {
      res.status(500).json({ error: "Failed to revoke backup provider" });
    }
  });

  app.get("/api/companies/:companyId/passports/:dppId/backup-replications", authenticateToken, backupReadGuard, async (req, res) => {
    try {
      if (!backupProviderService) return res.json([]);
      const replications = await backupProviderService.listReplications({
        companyId: req.params.companyId,
        passportDppId: req.params.dppId,
      });
      res.json(replications);
    } catch {
      res.status(500).json({ error: "Failed to fetch backup replications" });
    }
  });

  app.get("/api/companies/:companyId/passports/:dppId/backup-handover", authenticateToken, backupReadGuard, async (req, res) => {
    try {
      if (!backupProviderService) {
        return res.status(503).json({ error: "Backup provider service is unavailable" });
      }
      const handovers = await backupProviderService.listPublicHandovers({
        companyId: req.params.companyId,
        passportDppId: req.params.dppId,
      });
      const active = handovers.find((row) => row.handoverStatus === "active") || null;
      return res.json({
        active,
        history: handovers,
      });
    } catch {
      return res.status(500).json({ error: "Failed to fetch backup public handover status" });
    }
  });

  app.post("/api/companies/:companyId/passports/:dppId/backup-handover/activate", authenticateToken, backupAdminGuard, async (req, res) => {
    try {
      if (!backupProviderService) {
        return res.status(503).json({ error: "Backup provider service is unavailable" });
      }
      const passportType = req.body?.passportType;
      if (!passportType) return res.status(400).json({ error: "passportType required in body" });

      const currentPassport = await loadLatestLivePassport({
        companyId: req.params.companyId,
        dppId: req.params.dppId,
        passportType,
        releaseStatusSql: "('released','obsolete')",
      });
      if (!currentPassport) return res.status(404).json({ error: "Released passport not found" });

      const normalizedPassport = { ...normalizePassportRow(currentPassport), passportType };
      const publicRowData = await stripRestrictedFieldsForPublicView(normalizedPassport, passportType);
      const companyName = (await getCompanyNameMap([req.params.companyId])).get(String(req.params.companyId)) || "";

      const handover = await backupProviderService.activatePublicHandover({
        companyId: req.params.companyId,
        passportDppId: req.params.dppId,
        lineageId: normalizedPassport.lineageId || normalizedPassport.dppId,
        passportType,
        internalAliasId: normalizedPassport.internalAliasId,
        versionNumber: normalizedPassport.versionNumber,
        publicRowData,
        publicCompanyName: companyName,
        activatedBy: req.user.userId,
        actorIdentifier: req.user.actorIdentifier || req.user.globallyUniqueOperatorId || null,
        notes: req.body?.notes || null,
      });

      await logAudit(
        req.params.companyId,
        req.user.userId,
        "activateBackupPublicHandover",
        "backupPublicHandovers",
        req.params.dppId,
        null,
        {
          passportType,
          sourceReplicationId: handover?.sourceReplicationId || null,
          backupProviderKey: handover?.backupProviderKey || null,
          publicUrl: handover?.publicUrl || null,
        },
        {
          actorIdentifier: req.user.actorIdentifier || req.user.globallyUniqueOperatorId || null,
        }
      );

      return res.status(201).json({
        success: true,
        handover,
      });
    } catch (error) {
      const message = error.message || "Failed to activate backup public handover";
      if (
        message.includes("inactive")
        || message.includes("verified backup replication")
        || message.includes("required")
        || message.includes("Company not found")
      ) {
        return res.status(409).json({ error: message });
      }
      return res.status(500).json({ error: message });
    }
  });

  app.post("/api/companies/:companyId/passports/:dppId/backup-handover/deactivate", authenticateToken, backupAdminGuard, async (req, res) => {
    try {
      if (!backupProviderService) {
        return res.status(503).json({ error: "Backup provider service is unavailable" });
      }

      const handover = await backupProviderService.deactivatePublicHandover({
        companyId: req.params.companyId,
        passportDppId: req.params.dppId,
        deactivatedBy: req.user.userId,
        notes: req.body?.notes || null,
      });

      if (!handover) {
        return res.status(404).json({ error: "Active backup public handover not found" });
      }

      await logAudit(
        req.params.companyId,
        req.user.userId,
        "deactivateBackupPublicHandover",
        "backupPublicHandovers",
        req.params.dppId,
        null,
        {
          backupProviderKey: handover.backupProviderKey || null,
          publicUrl: handover.publicUrl || null,
        },
        {
          actorIdentifier: req.user.actorIdentifier || req.user.globallyUniqueOperatorId || null,
        }
      );

      return res.json({
        success: true,
        handover,
      });
    } catch {
      return res.status(500).json({ error: "Failed to deactivate backup public handover" });
    }
  });

  app.post("/api/companies/:companyId/passports/:dppId/backup-replications", authenticateToken, backupAdminGuard, async (req, res) => {
    try {
      if (!backupProviderService) return res.status(503).json({ error: "Backup provider service is unavailable" });
      const passportType = req.body?.passportType;
      if (!passportType) return res.status(400).json({ error: "passportType required in body" });

      const currentPassport = await loadLatestLivePassport({
        companyId: req.params.companyId,
        dppId: req.params.dppId,
        passportType,
        releaseStatusSql: "('released','obsolete')",
      });
      if (!currentPassport) return res.status(404).json({ error: "Released passport not found" });

      const result = await replicatePassportToBackup({
        passport: { ...currentPassport, passportType },
        passportType,
        reason: "manualReplication",
        snapshotScope: req.body?.snapshotScope || "releasedCurrent",
      });

      await logAudit(
        req.params.companyId,
        req.user.userId,
        "replicatePassportBackup",
        "passportBackupReplications",
        req.params.dppId,
        null,
        { passportType, resultCount: result.results?.length || 0 }
      );

      res.status(202).json(result);
    } catch {
      res.status(500).json({ error: "Failed to replicate passport backup" });
    }
  });

  app.post("/api/companies/:companyId/passports/:dppId/backup-replications/verify", authenticateToken, backupAdminGuard, async (req, res) => {
    try {
      if (!backupProviderService) return res.status(503).json({ error: "Backup provider service is unavailable" });
      const replicationId = req.body?.replicationId ?? null;
      if (replicationId !== null && replicationId !== undefined && !Number.isFinite(Number(replicationId))) {
        return res.status(400).json({ error: "replicationId must be a valid integer" });
      }
      const result = await backupProviderService.verifyReplications({
        companyId: req.params.companyId,
        passportDppId: req.params.dppId,
        replicationId,
      });

      await logAudit(
        req.params.companyId,
        req.user.userId,
        "verifyPassportBackup",
        "passportBackupReplications",
        req.params.dppId,
        null,
        {
          replicationId: replicationId || null,
          verified: result.verified || 0,
          failed: result.failed || 0,
        }
      );

      if (result.error) {
        return res.status(404).json({ error: result.error, results: result.results || [] });
      }
      return res.status(result.success ? 200 : 207).json(result);
    } catch {
      res.status(500).json({ error: "Failed to verify backup replications" });
    }
  });
}

module.exports = registerBackupRoutes;
