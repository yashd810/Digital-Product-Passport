"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  releasePassportAtomically,
} = require("../src/modules/passports/release-passport-transaction");

const releaseVariants = [
  {
    name: "normal release",
    source: "release",
    snapshotSource: "release",
    initialReleaseStatus: "draft",
  },
  {
    name: "bulk release",
    source: "bulkRelease",
    snapshotSource: "bulkRelease",
    initialReleaseStatus: "draft",
  },
  {
    name: "workflow release",
    source: "workflowApproval",
    snapshotSource: "workflowApprovalRelease",
    initialReleaseStatus: "inReview",
  },
];

const requiredFailurePoints = [
  "beforeArchive",
  "afterArchive",
  "signing",
  "releaseRecord",
  "signAudit",
  "obsolete",
  "attachmentVisibility",
  "releaseAudit",
];

function createReleaseHarness({ initialReleaseStatus, failAt = null, workflow = false }) {
  const state = {
    initialReleaseStatus,
    releaseStatus: initialReleaseStatus,
    workflowStatus: "inProgress",
    commits: 0,
    rollbacks: 0,
    releasedRow: null,
    calls: [],
    snapshotReasons: [],
  };
  let transactionState = null;

  const client = {
    async query(sql, values = []) {
      state.calls.push({ sql, values });
      if (sql === "BEGIN") {
        transactionState = {
          releaseStatus: state.releaseStatus,
          workflowStatus: state.workflowStatus,
        };
        return { rows: [] };
      }
      if (sql === "COMMIT") {
        state.releaseStatus = transactionState.releaseStatus;
        state.workflowStatus = transactionState.workflowStatus;
        transactionState = null;
        state.commits += 1;
        return { rows: [] };
      }
      if (sql === "ROLLBACK") {
        transactionState = null;
        state.rollbacks += 1;
        return { rows: [] };
      }
      if (sql.includes("FOR UPDATE") && sql.includes('FROM "batteryPassports"')) {
        if (!["draft", "inRevision", "inReview"].includes(transactionState.releaseStatus)) {
          return { rows: [] };
        }
        return {
          rows: [{
            id: 31,
            dppId: "dpp-release-test",
            lineageId: "lineage-release-test",
            companyId: 7,
            versionNumber: 2,
            releaseStatus: transactionState.releaseStatus,
            modelName: "Transactional battery",
          }],
        };
      }
      if (sql.includes('SET "releaseStatus" = \'released\'')) {
        transactionState.releaseStatus = "released";
        const released = {
          id: 31,
          dppId: "dpp-release-test",
          lineageId: "lineage-release-test",
          companyId: 7,
          versionNumber: 2,
          releaseStatus: "released",
          modelName: "Transactional battery",
        };
        state.releasedRow = released;
        return { rows: [released] };
      }
      if (sql.includes('UPDATE "passportAttachments"')) {
        if (failAt === "attachmentVisibility") throw new Error("attachment visibility unavailable");
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('UPDATE "passportWorkflow"')) {
        if (failAt === "workflowState") throw new Error("workflow state unavailable");
        transactionState.workflowStatus = "approved";
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() {},
  };

  const pool = {
    async connect() {
      return client;
    },
  };

  let auditCount = 0;
  const dependencies = {
    signPassport: async () => {
      if (failAt === "signing") throw new Error("signing unavailable");
      return {
        signature: "signature-value",
        dataHash: "hash-value",
        keyId: "key-id",
        signatureAlgorithm: "ES256",
        releasedAt: "2026-07-18T12:00:00.000Z",
      };
    },
    recordSignedDppRelease: async (queryable) => {
      assert.equal(queryable, client, "release records must use the release transaction client");
      if (failAt === "releaseRecord") throw new Error("release record unavailable");
      return { id: 41 };
    },
    logAudit: async (_companyId, _userId, action, _tableName, _dppId, _oldData, _newData, options) => {
      assert.equal(options.client, client, "audit events must use the release transaction client");
      auditCount += 1;
      if ((auditCount === 1 && failAt === "signAudit") || (action === "release" && failAt === "releaseAudit")) {
        throw new Error("audit unavailable");
      }
    },
    archivePassportSnapshot: async ({ passport, client: archiveClient, snapshotReason }) => {
      assert.equal(archiveClient, client, "archive snapshots must use the release transaction client");
      state.snapshotReasons.push(snapshotReason);
      if (snapshotReason.startsWith("before") && failAt === "beforeArchive") {
        throw new Error("pre-release archive unavailable");
      }
      if (snapshotReason.startsWith("after") && failAt === "afterArchive") {
        throw new Error("post-release archive unavailable");
      }
      return passport;
    },
    markOlderVersionsObsolete: async (_tableName, _dppId, _versionNumber, _passportType, options) => {
      assert.equal(options.client, client, "obsolete-version changes must use the release transaction client");
      assert.equal(options.failOnError, true, "release must require obsolete-version completion");
      if (failAt === "obsolete") throw new Error("obsolete transition unavailable");
    },
  };

  const afterReleaseInTransaction = workflow
    ? async ({ client: workflowClient }) => {
        await workflowClient.query('UPDATE "passportWorkflow" SET "overallStatus"=\'approved\'');
      }
    : null;

  return { state, pool, dependencies, afterReleaseInTransaction };
}

function buildReleaseOptions(variant, harness) {
  return {
    pool: harness.pool,
    tableName: '"batteryPassports"',
    dppId: "dpp-release-test",
    companyId: 7,
    passportType: "battery",
    userId: 19,
    releasedByEmail: "editor@example.test",
    editableReleaseStatusesSql: variant.initialReleaseStatus === "inReview"
      ? "('inReview')"
      : "('draft','inRevision')",
    typeDef: {
      fieldsJson: {
        sections: [{ fields: [{ key: "publicBatteryField", confidentiality: "public" }] }],
      },
    },
    releaseNote: "release test",
    source: variant.source,
    snapshotSource: variant.snapshotSource,
    ...harness.dependencies,
    afterReleaseInTransaction: harness.afterReleaseInTransaction,
  };
}

async function runRelease(variant, failAt = null) {
  const harness = createReleaseHarness({
    initialReleaseStatus: variant.initialReleaseStatus,
    failAt,
    workflow: variant.name === "workflow release",
  });
  const result = await releasePassportAtomically(buildReleaseOptions(variant, harness));
  return { ...harness, result };
}

for (const variant of releaseVariants) {
  for (const failurePoint of requiredFailurePoints) {
    test(`${variant.name} rolls back when ${failurePoint} fails`, async () => {
      const harness = createReleaseHarness({
        initialReleaseStatus: variant.initialReleaseStatus,
        failAt: failurePoint,
        workflow: variant.name === "workflow release",
      });
      await assert.rejects(releasePassportAtomically(buildReleaseOptions(variant, harness)));
      assert.equal(harness.state.releaseStatus, variant.initialReleaseStatus);
      assert.equal(harness.state.commits, 0);
      assert.equal(harness.state.rollbacks, 1);
      assert.equal(harness.state.workflowStatus, "inProgress");
    });
  }
}

for (const variant of releaseVariants) {
  test(`${variant.name} commits only after every required release artifact succeeds`, async () => {
    const { state, result } = await runRelease(variant);
    assert.equal(result.released.releaseStatus, "released");
    assert.equal(state.releaseStatus, "released");
    assert.equal(state.commits, 1);
    assert.equal(state.rollbacks, 0);
    const snapshotPrefix = `${variant.snapshotSource.slice(0, 1).toUpperCase()}${variant.snapshotSource.slice(1)}`;
    assert.deepEqual(state.snapshotReasons, [
      `before${snapshotPrefix}`,
      `after${snapshotPrefix}`,
    ]);
    assert.equal(
      state.calls.some(({ sql }) => sql.includes('UPDATE "passportAttachments"')),
      true,
      "attachment visibility is part of the committed release transaction"
    );
    if (variant.name === "workflow release") {
      assert.equal(state.workflowStatus, "approved");
    }
  });
}

test("workflow release also rolls back its workflow status when the final workflow transition fails", async () => {
  const variant = releaseVariants[2];
  const harness = createReleaseHarness({
    initialReleaseStatus: variant.initialReleaseStatus,
    failAt: "workflowState",
    workflow: true,
  });
  await assert.rejects(releasePassportAtomically(buildReleaseOptions(variant, harness)));
  assert.equal(harness.state.releaseStatus, "inReview");
  assert.equal(harness.state.workflowStatus, "inProgress");
  assert.equal(harness.state.commits, 0);
  assert.equal(harness.state.rollbacks, 1);
});
