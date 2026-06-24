function createBackupEventHelpers({
  backupProviderService,
  complianceService,
  getCompanyNameMap,
  normalizePassportRow,
}) {
  function assertBackupReplicationResult(result, contextLabel) {
    if (!result || result.success !== false) return result;
    const message = result.error || result.reason || `${contextLabel} backup replication failed`;
    const error = new Error(message);
    error.code = result.reason || "backupProviderRequired";
    error.backupResult = result;
    throw error;
  }

  function getActorIdentifier(user) {
    return user?.actorIdentifier ||
      user?.globallyUniqueOperatorId ||
      user?.operatorIdentifier ||
      user?.economicOperatorId ||
      user?.email ||
      (user?.userId ? `user:${user.userId}` : null);
  }

  async function replicatePassportToBackup({
    passport,
    passportType = null,
    companyName = "",
    reason = "manual",
    snapshotScope = "releasedCurrent",
  }) {
    if (!backupProviderService || !passport?.dppId || !passport?.companyId) {
      return { success: true, skipped: true, reason: "backupServiceUnavailable" };
    }

    const resolvedPassportType = passportType || passport.passportType;
    if (!resolvedPassportType) {
      return { success: true, skipped: true, reason: "passportTypeRequired" };
    }

    const typeDef = await complianceService.loadPassportTypeDefinition(resolvedPassportType);
    const resolvedCompanyName = companyName
      || (await getCompanyNameMap([passport.companyId])).get(String(passport.companyId))
      || "";

    return assertBackupReplicationResult(await backupProviderService.replicatePassportSnapshot({
      passport: { ...normalizePassportRow(passport), passportType: resolvedPassportType },
      typeDef,
      companyName: resolvedCompanyName,
      reason,
      snapshotScope,
    }), "Passport");
  }

  async function replicateAccessControlEventToBackup({
    companyId,
    eventType,
    severity = "normal",
    actorUserId = null,
    actorIdentifier = null,
    affectedUserId = null,
    affectedApiKeyId = null,
    affectedGrantId = null,
    passportDppId = null,
    audience = null,
    elementIdPath = null,
    revocationMode = "standard",
    reason = null,
    metadata = {},
  }) {
    if (!backupProviderService || !companyId || !backupProviderService.replicateAccessControlEvent) {
      return { success: true, skipped: true, reason: "backupServiceUnavailable" };
    }

    return assertBackupReplicationResult(await backupProviderService.replicateAccessControlEvent({
      companyId,
      eventType,
      severity,
      actorUserId,
      actorIdentifier,
      affectedUserId,
      affectedApiKeyId,
      affectedGrantId,
      passportDppId,
      audience,
      elementIdPath,
      revocationMode,
      reason,
      metadata,
    }), "Access-control");
  }

  async function replicateAuditAnchorToBackup({
    companyId,
    anchoredBy = null,
    actorIdentifier = null,
    anchor,
    summary,
  }) {
    if (!backupProviderService || !companyId || !backupProviderService.replicateAuditAnchorEvent) {
      return { success: true, skipped: true, reason: "backupServiceUnavailable" };
    }
    return assertBackupReplicationResult(await backupProviderService.replicateAuditAnchorEvent({
      companyId,
      actorUserId: anchoredBy,
      actorIdentifier,
      anchor,
      summary,
    }), "Audit-anchor");
  }

  function withAuditActorAliases(row) {
    if (!row || typeof row !== "object") return row;
    return {
      ...row,
      globallyUniqueOperatorId: row.actorIdentifier || null,
      globallyUniqueOperatorIdentifier: row.actorIdentifier || null,
    };
  }

  return {
    getActorIdentifier,
    replicateAccessControlEventToBackup,
    replicateAuditAnchorToBackup,
    replicatePassportToBackup,
    withAuditActorAliases,
  };
}

module.exports = {
  createBackupEventHelpers,
};
