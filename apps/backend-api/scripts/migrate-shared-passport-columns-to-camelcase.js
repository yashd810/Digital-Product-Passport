"use strict";

const path = require("path");
require("dotenv").config({
  path: process.env.DOTENV_CONFIG_PATH || path.resolve(__dirname, "../../../docker/.env"),
});

const { Pool } = require("pg");

const SHARED_PASSPORT_TABLE_COLUMN_MAPPINGS = {
  dpp_subject_registry: [
    ["company_id", "companyId"],
    ["passport_dpp_id", "passportDppId"],
    ["internal_alias_id", "internalAliasId"],
    ["product_identifier_did", "productIdentifierDid"],
    ["product_did", "productDid"],
    ["dpp_did", "dppDid"],
    ["company_did", "companyDid"],
    ["created_at", "createdAt"],
    ["updated_at", "updatedAt"],
  ],
  dpp_registry_registrations: [
    ["passport_dpp_id", "passportDppId"],
    ["company_id", "companyId"],
    ["product_identifier", "productIdentifier"],
    ["dpp_id", "dppId"],
    ["registry_name", "registryName"],
    ["registration_payload", "registrationPayload"],
    ["registered_by", "registeredBy"],
    ["registered_at", "registeredAt"],
    ["updated_at", "updatedAt"],
  ],
  passport_registry: [
    ["dpp_id", "dppId"],
    ["lineage_id", "lineageId"],
    ["company_id", "companyId"],
    ["passport_type", "passportType"],
    ["access_key", "accessKey"],
    ["access_key_hash", "accessKeyHash"],
    ["access_key_prefix", "accessKeyPrefix"],
    ["access_key_last_rotated_at", "accessKeyLastRotatedAt"],
    ["device_api_key", "deviceApiKey"],
    ["device_api_key_hash", "deviceApiKeyHash"],
    ["device_api_key_prefix", "deviceApiKeyPrefix"],
    ["device_key_last_rotated_at", "deviceKeyLastRotatedAt"],
    ["created_at", "createdAt"],
  ],
  passport_backup_replications: [
    ["backup_provider_id", "backupProviderId"],
    ["backup_provider_key", "backupProviderKey"],
    ["passport_dpp_id", "passportDppId"],
    ["lineage_id", "lineageId"],
    ["company_id", "companyId"],
    ["passport_type", "passportType"],
    ["version_number", "versionNumber"],
    ["dpp_id", "dppId"],
    ["snapshot_scope", "snapshotScope"],
    ["replication_status", "replicationStatus"],
    ["storage_provider", "storageProvider"],
    ["storage_key", "storageKey"],
    ["public_url", "publicUrl"],
    ["payload_hash", "payloadHash"],
    ["payload_json", "payloadJson"],
    ["error_message", "errorMessage"],
    ["verification_status", "verificationStatus"],
    ["verification_error_message", "verificationErrorMessage"],
    ["verified_payload_hash", "verifiedPayloadHash"],
    ["last_verified_at", "lastVerifiedAt"],
    ["replicated_at", "replicatedAt"],
    ["created_at", "createdAt"],
    ["updated_at", "updatedAt"],
  ],
  backup_public_handovers: [
    ["company_id", "companyId"],
    ["passport_dpp_id", "passportDppId"],
    ["lineage_id", "lineageId"],
    ["passport_type", "passportType"],
    ["internal_alias_id", "internalAliasId"],
    ["version_number", "versionNumber"],
    ["backup_provider_id", "backupProviderId"],
    ["backup_provider_key", "backupProviderKey"],
    ["source_replication_id", "sourceReplicationId"],
    ["storage_key", "storageKey"],
    ["public_url", "publicUrl"],
    ["public_company_name", "publicCompanyName"],
    ["public_row_data", "publicRowData"],
    ["handover_status", "handoverStatus"],
    ["verification_status", "verificationStatus"],
    ["activated_by", "activatedBy"],
    ["deactivated_by", "deactivatedBy"],
    ["activated_at", "activatedAt"],
    ["deactivated_at", "deactivatedAt"],
    ["created_at", "createdAt"],
    ["updated_at", "updatedAt"],
  ],
  passport_access_grants: [
    ["passport_dpp_id", "passportDppId"],
    ["company_id", "companyId"],
    ["element_id_path", "elementIdPath"],
    ["grantee_user_id", "granteeUserId"],
    ["granted_by", "grantedBy"],
    ["expires_at", "expiresAt"],
    ["is_active", "isActive"],
    ["created_at", "createdAt"],
    ["updated_at", "updatedAt"],
  ],
  passport_scan_events: [
    ["passport_dpp_id", "passportDppId"],
    ["viewer_user_id", "viewerUserId"],
    ["user_agent", "userAgent"],
    ["scanned_at", "scannedAt"],
  ],
  passport_security_events: [
    ["passport_dpp_id", "passportDppId"],
    ["company_id", "companyId"],
    ["event_type", "eventType"],
    ["created_at", "createdAt"],
  ],
  passport_dynamic_values: [
    ["passport_dpp_id", "passportDppId"],
    ["field_key", "fieldKey"],
    ["updated_at", "updatedAt"],
  ],
  passport_signatures: [
    ["passport_dpp_id", "passportDppId"],
    ["version_number", "versionNumber"],
    ["data_hash", "dataHash"],
    ["signing_key_id", "signingKeyId"],
    ["released_at", "releasedAt"],
    ["signed_at", "signedAt"],
    ["vc_json", "vcJson"],
  ],
  dpp_release_records: [
    ["dpp_id", "dppId"],
    ["released_by_user_id", "releasedByUserId"],
    ["released_by_email", "releasedByEmail"],
    ["release_version", "releaseVersion"],
    ["dpp_hash", "dppHash"],
    ["signature_id", "signatureId"],
    ["release_note", "releaseNote"],
    ["released_at", "releasedAt"],
  ],
  passport_edit_sessions: [
    ["passport_dpp_id", "passportDppId"],
    ["company_id", "companyId"],
    ["passport_type", "passportType"],
    ["user_id", "userId"],
    ["last_activity_at", "lastActivityAt"],
    ["created_at", "createdAt"],
    ["updated_at", "updatedAt"],
  ],
  notifications: [
    ["user_id", "userId"],
    ["passport_dpp_id", "passportDppId"],
    ["action_url", "actionUrl"],
    ["created_at", "createdAt"],
  ],
  passport_workflow: [
    ["passport_dpp_id", "passportDppId"],
    ["passport_type", "passportType"],
    ["company_id", "companyId"],
    ["submitted_by", "submittedBy"],
    ["reviewer_id", "reviewerId"],
    ["approver_id", "approverId"],
    ["review_status", "reviewStatus"],
    ["approval_status", "approvalStatus"],
    ["overall_status", "overallStatus"],
    ["reviewer_comment", "reviewerComment"],
    ["approver_comment", "approverComment"],
    ["previous_release_status", "previousReleaseStatus"],
    ["reviewed_at", "reviewedAt"],
    ["approved_at", "approvedAt"],
    ["rejected_at", "rejectedAt"],
    ["created_at", "createdAt"],
    ["updated_at", "updatedAt"],
  ],
  passport_revision_batches: [
    ["company_id", "companyId"],
    ["passport_type", "passportType"],
    ["requested_by", "requestedBy"],
    ["scope_type", "scopeType"],
    ["scope_meta", "scopeMeta"],
    ["revision_note", "revisionNote"],
    ["changes_json", "changesJson"],
    ["submit_to_workflow", "submitToWorkflow"],
    ["reviewer_id", "reviewerId"],
    ["approver_id", "approverId"],
    ["total_targeted", "totalTargeted"],
    ["revised_count", "revisedCount"],
    ["skipped_count", "skippedCount"],
    ["failed_count", "failedCount"],
    ["created_at", "createdAt"],
    ["updated_at", "updatedAt"],
  ],
  passport_revision_batch_items: [
    ["batch_id", "batchId"],
    ["passport_dpp_id", "passportDppId"],
    ["passport_type", "passportType"],
    ["source_version_number", "sourceVersionNumber"],
    ["new_version_number", "newVersionNumber"],
    ["created_at", "createdAt"],
  ],
  passport_history_visibility: [
    ["passport_dpp_id", "passportDppId"],
    ["version_number", "versionNumber"],
    ["updated_by", "updatedBy"],
    ["created_at", "createdAt"],
    ["updated_at", "updatedAt"],
  ],
  passport_archives: [
    ["dpp_id", "dppId"],
    ["lineage_id", "lineageId"],
    ["company_id", "companyId"],
    ["passport_type", "passportType"],
    ["version_number", "versionNumber"],
    ["model_name", "modelName"],
    ["internal_alias_id", "internalAliasId"],
    ["product_identifier_did", "productIdentifierDid"],
    ["actor_identifier", "actorIdentifier"],
    ["snapshot_reason", "snapshotReason"],
    ["release_status", "releaseStatus"],
    ["row_data", "rowData"],
    ["archived_by", "archivedBy"],
    ["archived_at", "archivedAt"],
  ],
  passport_attachments: [
    ["public_id", "publicId"],
    ["company_id", "companyId"],
    ["passport_dpp_id", "passportDppId"],
    ["field_key", "fieldKey"],
    ["file_path", "filePath"],
    ["storage_key", "storageKey"],
    ["storage_provider", "storageProvider"],
    ["file_url", "fileUrl"],
    ["mime_type", "mimeType"],
    ["size_bytes", "sizeBytes"],
    ["is_public", "isPublic"],
    ["created_by", "createdBy"],
    ["created_at", "createdAt"],
    ["updated_at", "updatedAt"],
  ],
  product_identifier_lineage: [
    ["company_id", "companyId"],
    ["lineage_id", "lineageId"],
    ["previous_passport_dpp_id", "previousPassportDppId"],
    ["replacement_passport_dpp_id", "replacementPassportDppId"],
    ["previous_identifier", "previousIdentifier"],
    ["replacement_identifier", "replacementIdentifier"],
    ["previous_internal_alias_id", "previousInternalAliasId"],
    ["replacement_internal_alias_id", "replacementInternalAliasId"],
    ["previous_granularity", "previousGranularity"],
    ["replacement_granularity", "replacementGranularity"],
    ["transition_reason", "transitionReason"],
    ["created_by", "createdBy"],
    ["created_at", "createdAt"],
  ],
};

function isSafeSqlIdentifier(value) {
  return /^[a-z][a-z0-9_]*$/i.test(String(value || ""));
}

function quoteDbIdentifier(value) {
  const identifier = String(value || "").trim();
  if (!isSafeSqlIdentifier(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }
  return `"${identifier.replace(/"/g, "\"\"")}"`;
}

async function renameTableColumnsToCamelCase(client, tableName, columnMappings = []) {
  const columns = await client.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [tableName]
  );
  const existingColumns = new Set(columns.rows.map((row) => row.column_name));
  if (!existingColumns.size) {
    return { tableName, status: "missing", renamedColumns: [] };
  }

  const renamedColumns = [];
  for (const [legacyName, camelName] of columnMappings) {
    if (!existingColumns.has(legacyName) || existingColumns.has(camelName)) continue;
    await client.query(
      `ALTER TABLE ${quoteDbIdentifier(tableName)}
       RENAME COLUMN ${quoteDbIdentifier(legacyName)}
       TO ${quoteDbIdentifier(camelName)}`
    );
    existingColumns.delete(legacyName);
    existingColumns.add(camelName);
    renamedColumns.push(`${legacyName}->${camelName}`);
  }

  return {
    tableName,
    status: renamedColumns.length ? "applied" : "ok",
    renamedColumns,
  };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || undefined,
    host: process.env.DB_HOST || undefined,
    port: process.env.DB_PORT ? Number.parseInt(process.env.DB_PORT, 10) : undefined,
    user: process.env.DB_USER || undefined,
    password: process.env.DB_PASSWORD || undefined,
    database: process.env.DB_NAME || undefined,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const results = [];
    for (const [tableName, mappings] of Object.entries(SHARED_PASSPORT_TABLE_COLUMN_MAPPINGS)) {
      results.push(await renameTableColumnsToCamelCase(client, tableName, mappings));
    }
    if (apply) {
      await client.query("COMMIT");
    } else {
      await client.query("ROLLBACK");
    }
    process.stdout.write(JSON.stringify({ apply, results }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
