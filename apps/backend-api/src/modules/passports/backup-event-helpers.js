function createBackupEventHelpers({
  backupProviderService,
  complianceService,
  getCompanyNameMap,
  normalizePassportRow,
}) {
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
    snapshotScope = "released_current",
  }) {
    if (!backupProviderService || !passport?.dppId || !passport?.company_id) {
      return { success: true, skipped: true, reason: "BACKUP_SERVICE_UNAVAILABLE" };
    }

    const resolvedPassportType = passportType || passport.passport_type;
    if (!resolvedPassportType) {
      return { success: true, skipped: true, reason: "PASSPORT_TYPE_REQUIRED" };
    }

    const typeDef = await complianceService.loadPassportTypeDefinition(resolvedPassportType);
    const resolvedCompanyName = companyName
      || (await getCompanyNameMap([passport.company_id])).get(String(passport.company_id))
      || "";

    return backupProviderService.replicatePassportSnapshot({
      passport: { ...normalizePassportRow(passport), passport_type: resolvedPassportType },
      typeDef,
      companyName: resolvedCompanyName,
      reason,
      snapshotScope,
    });
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
      return { success: true, skipped: true, reason: "BACKUP_SERVICE_UNAVAILABLE" };
    }

    return backupProviderService.replicateAccessControlEvent({
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
    });
  }

  async function replicateAuditAnchorToBackup({
    companyId,
    anchoredBy = null,
    actorIdentifier = null,
    anchor,
    summary,
  }) {
    if (!backupProviderService || !companyId || !backupProviderService.replicateAuditAnchorEvent) {
      return { success: true, skipped: true, reason: "BACKUP_SERVICE_UNAVAILABLE" };
    }
    return backupProviderService.replicateAuditAnchorEvent({
      companyId,
      actorUserId: anchoredBy,
      actorIdentifier,
      anchor,
      summary,
    });
  }

  function withAuditActorAliases(row) {
    if (!row || typeof row !== "object") return row;
    return {
      ...row,
      globallyUniqueOperatorId: row.actor_identifier || null,
      globallyUniqueOperatorIdentifier: row.actor_identifier || null,
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
