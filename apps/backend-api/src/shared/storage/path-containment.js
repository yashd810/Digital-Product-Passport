"use strict";

function isPathInsideBase(path, targetPath, basePath) {
  const resolvedBase = path.resolve(basePath);
  const resolvedTarget = path.resolve(targetPath);
  return resolvedTarget === resolvedBase || resolvedTarget.startsWith(`${resolvedBase}${path.sep}`);
}

function resolveExistingContainedPath({ fs, path, targetPath, basePath }) {
  const resolvedTarget = path.resolve(targetPath);
  if (!isPathInsideBase(path, resolvedTarget, basePath)) return null;

  try {
    const resolvedBase = fs.realpathSync(basePath);
    const resolvedExistingTarget = fs.realpathSync(resolvedTarget);
    return isPathInsideBase(path, resolvedExistingTarget, resolvedBase) ? resolvedExistingTarget : null;
  } catch {
    return null;
  }
}

module.exports = {
  isPathInsideBase,
  resolveExistingContainedPath,
};
