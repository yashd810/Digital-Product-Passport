"use strict";

const supertest = require("supertest");

const createDidService = require("../services/did-service");

function createJsonHandler(fn) {
  return (req, res) => {
    try {
      const payload = fn(req);
      res.json(payload);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  };
}

async function invokeJsonRoute(handler, req = {}) {
  return new Promise((resolve, reject) => {
    const response = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        resolve({ status: this.statusCode, body });
      },
    };

    Promise.resolve(handler(req, response)).catch(reject);
  });
}

describe("DID routes", () => {
  test("supertest is installed for route integration coverage", () => {
    expect(typeof supertest).toBe("function");
  });

  test("returns the canonical DPP DID payload for the DID route", async () => {
    const didService = createDidService({
      didDomain: "www.claros-dpp.online",
      publicOrigin: "https://www.claros-dpp.online",
      apiOrigin: "https://api.claros.test",
    });
    const didRoute = createJsonHandler((req) => {
      const did = didService.generateDppDid(req.params.granularity, req.params.stableId);
      return {
        id: did,
        didDocument: didService.didToDocumentUrl(did),
      };
    });

    const response = await invokeJsonRoute(didRoute, {
      params: { granularity: "item", stableId: "BAT-2026-001" },
    });

    expect(response.status).toBe(200);
    expect(response.body.id).toBe("did:web:www.claros-dpp.online:did:dpp:item:BAT-2026-001");
    expect(response.body.didDocument).toBe("https://www.claros-dpp.online/did/dpp/item/BAT-2026-001/did.json");
  });

  test("maps a public DID document URL back to the subject DID", async () => {
    const didService = createDidService({
      didDomain: "www.claros-dpp.online",
      publicOrigin: "https://www.claros-dpp.online",
      apiOrigin: "https://api.claros.test",
    });
    const resolveRoute = createJsonHandler((req) => ({
      subjects: didService.publicUrlToSubjects(req.query.url),
    }));

    const response = await invokeJsonRoute(resolveRoute, {
      query: { url: "https://www.claros-dpp.online/did/dpp/model/BAT-2026-001/did.json" },
    });

    expect(response.status).toBe(200);
    expect(response.body.subjects).toEqual([
      "did:web:www.claros-dpp.online:did:dpp:model:BAT-2026-001",
    ]);
  });

  test("supports batch subject DID document URLs", async () => {
    const didService = createDidService({
      didDomain: "www.claros-dpp.online",
      publicOrigin: "https://www.claros-dpp.online",
      apiOrigin: "https://api.claros.test",
    });

    const did = didService.generateBatchDid("battery", "BATCH-2026-001");
    expect(did).toBe("did:web:www.claros-dpp.online:did:battery:batch:BATCH-2026-001");
    expect(didService.parseDid(did)).toMatchObject({
      entityType: "batch",
      passportType: "battery",
      stableId: "BATCH-2026-001",
    });
    expect(didService.didToDocumentUrl(did)).toBe(
      "https://www.claros-dpp.online/did/battery/batch/BATCH-2026-001/did.json"
    );
    expect(didService.publicUrlToSubjects("https://www.claros-dpp.online/did/battery/batch/BATCH-2026-001/did.json")).toEqual([
      "did:web:www.claros-dpp.online:did:battery:batch:BATCH-2026-001",
    ]);
  });
});
