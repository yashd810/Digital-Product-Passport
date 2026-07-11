"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const createStorageService = require("../src/services/storage-service");

const pdfBuffer = Buffer.from("%PDF-1.7\nvalidated document\n", "utf8");
const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function withLocalStorage(run) {
  const previousProvider = process.env.STORAGE_PROVIDER;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dpp-storage-service-"));
  process.env.STORAGE_PROVIDER = "local";
  const service = createStorageService({
    localStorageDir: root,
    filesBaseDir: path.join(root, "passport-files"),
    repoBaseDir: path.join(root, "repository-files"),
    uploadsBaseDir: path.join(root, "uploads"),
    serverBaseUrl: "http://localhost:3001",
  });
  try {
    await run(service);
  } finally {
    if (previousProvider === undefined) delete process.env.STORAGE_PROVIDER;
    else process.env.STORAGE_PROVIDER = previousProvider;
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("storage derives downloadable content types and extensions from validated bytes", async () => {
  await withLocalStorage(async (storageService) => {
    const passportFile = await storageService.savePassportFile({
      dppId: "dpp-1",
      fieldKey: "complianceDocument",
      buffer: pdfBuffer,
    });
    assert.equal(passportFile.contentType, "application/pdf");
    assert.match(passportFile.storageKey, /^passport-files\/dpp-1\/complianceDocument-\d+\.pdf$/);

    const symbol = await storageService.saveGlobalSymbol({ buffer: pngBuffer });
    assert.equal(symbol.contentType, "image/png");
    assert.match(symbol.storageKey, /^uploads\/symbols\/symbol\d+[a-f0-9-]+\.png$/);
    await assert.doesNotReject(fs.access(symbol.path));
  });
});

test("storage rejects files whose bytes do not match the declared upload class", async () => {
  await withLocalStorage(async (storageService) => {
    await assert.rejects(
      storageService.saveRepositoryFile({
        companyId: 7,
        buffer: Buffer.from("<html>not a PDF</html>", "utf8"),
      }),
      (error) => error?.code === "invalidFileSignature"
    );
    await assert.rejects(
      storageService.saveRepositorySymbol({
        companyId: 7,
        buffer: Buffer.from("not an image", "utf8"),
      }),
      (error) => error?.code === "invalidFileSignature"
    );
  });
});
