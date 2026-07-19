"use strict";

(function exposeSectionCsvPaths(root, factory) {
  const schemaLimits = typeof module === "object" && module.exports
    ? require("./schema-limits")
    : root?.PassportModuleSchemaLimits;
  const api = factory(schemaLimits);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PassportModuleSectionCsvPaths = api;
})(typeof globalThis === "object" ? globalThis : null, ({ passportModuleSchemaLimits } = {}) => {
  if (!passportModuleSchemaLimits) throw new Error("Passport module schema limits are unavailable.");
  const sectionKeyPattern = /^[a-z][A-Za-z0-9]{0,199}$/;
  const maxSectionPathDepth = passportModuleSchemaLimits.maxDepth;

  function clean(value) {
    return String(value ?? "").trim();
  }

  function rowLabel(rowNumber, columnLabel) {
    if (rowNumber === "export") return columnLabel;
    return `CSV row ${rowNumber} ${columnLabel}`;
  }

  function assertPathDepth(path, rowNumber, columnLabel) {
    if (path.length > maxSectionPathDepth) {
      throw new Error(
        `${rowLabel(rowNumber, columnLabel)} supports at most ${maxSectionPathDepth} nested section levels.`
      );
    }
  }

  function parsePathCell(value, { rowNumber, columnLabel, validateSegment = () => {} }) {
    const text = clean(value);
    if (!text) return null;

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`${rowLabel(rowNumber, columnLabel)} must be a JSON array of non-empty strings.`);
    }
    if (!Array.isArray(parsed) || !parsed.length || parsed.some((segment) => typeof segment !== "string")) {
      throw new Error(`${rowLabel(rowNumber, columnLabel)} must be a non-empty JSON array of strings.`);
    }
    assertPathDepth(parsed, rowNumber, columnLabel);

    const path = parsed.map((segment) => segment.trim());
    if (path.some((segment) => !segment)) {
      throw new Error(`${rowLabel(rowNumber, columnLabel)} cannot contain empty path segments.`);
    }
    path.forEach((segment) => validateSegment(segment, rowNumber, columnLabel));
    return path;
  }

  function validateSectionKey(key, rowNumber, columnLabel) {
    if (!sectionKeyPattern.test(key)) {
      throw new Error(
        `${rowLabel(rowNumber, columnLabel)} contains invalid section key "${key}". `
        + "Section keys must be lower camelCase letters/numbers, start with a lowercase letter, and be at most 200 characters."
      );
    }
  }

  function buildSectionPathCells({ labels, keys, deriveSectionKey }) {
    if (!Array.isArray(labels) || !labels.length || labels.some((label) => !clean(label))) {
      throw new Error("Cannot export a section with an empty section label.");
    }
    if (!Array.isArray(keys) || keys.length !== labels.length) {
      throw new Error("Cannot export a section without a matching section key path.");
    }

    const normalizedLabels = labels.map(clean);
    const normalizedKeys = keys.map((key, index) => clean(key) || clean(deriveSectionKey?.(normalizedLabels[index])));
    assertPathDepth(normalizedLabels, "export", "Section path");
    normalizedKeys.forEach((key) => validateSectionKey(key, "export", "Section key path"));

    return {
      sectionPath: JSON.stringify(normalizedLabels),
      sectionKeyPath: JSON.stringify(normalizedKeys),
    };
  }

  function normalizeSectionPathRow({
    sectionLabel,
    sectionPath,
    sectionKeyPath,
    rowNumber,
    deriveSectionKey,
  }) {
    const label = clean(sectionLabel);
    const labels = parsePathCell(sectionPath, {
      rowNumber,
      columnLabel: "Section path",
    });
    const keys = parsePathCell(sectionKeyPath, {
      rowNumber,
      columnLabel: "Section key path",
      validateSegment: validateSectionKey,
    });

    if (!labels && !keys) {
      const key = clean(deriveSectionKey?.(label));
      validateSectionKey(key, rowNumber, "Section label");
      return {
        sectionLabel: label,
        sectionPath: [label],
        sectionKeyPath: [key],
        usesExplicitPath: false,
      };
    }
    if (!labels || !keys) {
      throw new Error(
        `${rowLabel(rowNumber, "Section path and Section key path")} must be provided together. `
        + "Use JSON arrays, for example [\"Product identity\", \"Materials\"] and [\"productIdentity\", \"materials\"]."
      );
    }
    if (labels.length !== keys.length) {
      throw new Error(`${rowLabel(rowNumber, "Section path")} and Section key path must have the same number of segments.`);
    }
    if (labels[labels.length - 1] !== label) {
      throw new Error(`${rowLabel(rowNumber, "Section label")} must match the final Section path label.`);
    }

    return {
      sectionLabel: label,
      sectionPath: labels,
      sectionKeyPath: keys,
      usesExplicitPath: true,
    };
  }

  function pathId(path) {
    return JSON.stringify(path);
  }

  function convertRowsToNestedSections(rows = []) {
    if (rows.length > passportModuleSchemaLimits.maxFields) {
      throw new Error(`CSV supports at most ${passportModuleSchemaLimits.maxFields} field rows.`);
    }
    const rootSections = [];
    const sectionsByKeyPath = new Map();
    const keyPathByLabelPath = new Map();
    const labelPathByKeyPath = new Map();
    const pathBySectionKey = new Map();

    rows.forEach((row, index) => {
      const rowNumber = row.rowNumber || index + 2;
      const labels = Array.isArray(row.sectionPath) ? row.sectionPath : [];
      const keys = Array.isArray(row.sectionKeyPath) ? row.sectionKeyPath : [];
      if (!labels.length || labels.length !== keys.length) {
        throw new Error(`${rowLabel(rowNumber, "Section path")} is missing or invalid.`);
      }
      assertPathDepth(labels, rowNumber, "Section path");

      const fullLabelPathId = pathId(labels);
      const fullKeyPathId = pathId(keys);
      const knownKeyPath = keyPathByLabelPath.get(fullLabelPathId);
      if (knownKeyPath && knownKeyPath !== fullKeyPathId) {
        throw new Error(
          `${rowLabel(rowNumber, "Section path")} is ambiguous: the same label path is paired with different section key paths.`
        );
      }
      keyPathByLabelPath.set(fullLabelPathId, fullKeyPathId);

      const knownLabelPath = labelPathByKeyPath.get(fullKeyPathId);
      if (knownLabelPath && knownLabelPath !== fullLabelPathId) {
        throw new Error(
          `${rowLabel(rowNumber, "Section key path")} is ambiguous: the same key path is paired with different section label paths.`
        );
      }
      labelPathByKeyPath.set(fullKeyPathId, fullLabelPathId);

      let parent = null;
      let current = null;
      for (let depth = 0; depth < keys.length; depth += 1) {
        const keyPath = keys.slice(0, depth + 1);
        const labelPath = labels.slice(0, depth + 1);
        const keyPathId = pathId(keyPath);
        const labelPathId = pathId(labelPath);
        const key = keys[depth];
        const label = labels[depth];
        const knownSectionPath = pathBySectionKey.get(key);
        if (knownSectionPath && knownSectionPath !== keyPathId) {
          throw new Error(
            `${rowLabel(rowNumber, "Section key path")} reuses section key "${key}" at more than one path. `
            + "Section keys must be globally unique."
          );
        }
        pathBySectionKey.set(key, keyPathId);

        const knownKeyPathAtDepth = keyPathByLabelPath.get(labelPathId);
        if (knownKeyPathAtDepth && knownKeyPathAtDepth !== keyPathId) {
          throw new Error(`${rowLabel(rowNumber, "Section path")} is ambiguous at "${labels.slice(0, depth + 1).join(" > ")}".`);
        }
        keyPathByLabelPath.set(labelPathId, keyPathId);

        const knownLabelPathAtDepth = labelPathByKeyPath.get(keyPathId);
        if (knownLabelPathAtDepth && knownLabelPathAtDepth !== labelPathId) {
          throw new Error(`${rowLabel(rowNumber, "Section key path")} is ambiguous at "${keys.slice(0, depth + 1).join(" > ")}".`);
        }
        labelPathByKeyPath.set(keyPathId, labelPathId);

        current = sectionsByKeyPath.get(keyPathId);
        if (!current) {
          if (sectionsByKeyPath.size >= passportModuleSchemaLimits.maxSections) {
            throw new Error(`CSV supports at most ${passportModuleSchemaLimits.maxSections} sections.`);
          }
          current = {
            key,
            label,
            fields: [],
            sections: [],
          };
          sectionsByKeyPath.set(keyPathId, current);
          if (parent) parent.sections.push(current);
          else rootSections.push(current);
        }
        parent = current;
      }
      current.fields.push(row.field);
    });

    const pending = [...rootSections];
    while (pending.length) {
      const section = pending.pop();
      if (!section.sections.length) {
        delete section.sections;
        continue;
      }
      section.sections.forEach((child) => pending.push(child));
    }
    return rootSections;
  }

  return {
    buildSectionPathCells,
    convertRowsToNestedSections,
    maxSectionPathDepth,
    normalizeSectionPathRow,
    passportModuleSchemaLimits,
  };
});
