"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { resolveExistingContainedPath } = require("../src/shared/storage/path-containment");

test("canonical path containment rejects external files and symlink escapes", async () => {
  const root = await fsPromises.mkdtemp(path.join(os.tmpdir(), "dpp-path-containment-"));
  const baseDir = path.join(root, "base");
  const outsideFile = path.join(root, "outside.txt");
  const containedFile = path.join(baseDir, "contained.txt");
  const symlinkPath = path.join(baseDir, "outside-link.txt");
  await fsPromises.mkdir(baseDir);
  await fsPromises.writeFile(containedFile, "contained");
  await fsPromises.writeFile(outsideFile, "outside");
  await fsPromises.symlink(outsideFile, symlinkPath);

  try {
    assert.equal(
      resolveExistingContainedPath({ fs, path, targetPath: containedFile, basePath: baseDir }),
      fs.realpathSync(containedFile)
    );
    assert.equal(
      resolveExistingContainedPath({ fs, path, targetPath: outsideFile, basePath: baseDir }),
      null
    );
    assert.equal(
      resolveExistingContainedPath({ fs, path, targetPath: symlinkPath, basePath: baseDir }),
      null
    );
  } finally {
    await fsPromises.rm(root, { recursive: true, force: true });
  }
});
