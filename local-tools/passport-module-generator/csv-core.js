"use strict";

(function exposePassportModuleCsvCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PassportModuleCsvCore = api;
})(typeof globalThis === "object" ? globalThis : null, () => {
  const supportedDelimiters = Object.freeze([",", ";", "\t"]);
  const formulaPrefixPattern = /^[\u0000-\u0020]*[=+\-@]/;

  function assertDelimiter(delimiter) {
    if (!supportedDelimiters.includes(delimiter)) {
      throw new Error("CSV delimiter must be a comma, semicolon, or tab.");
    }
  }

  function stripBom(value) {
    const text = String(value ?? "");
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  }

  function extractSeparatorDirective(value) {
    const text = stripBom(value);
    const lineEndIndex = text.search(/[\r\n]/);
    const firstLine = lineEndIndex === -1 ? text : text.slice(0, lineEndIndex);
    const match = /^sep=(,|;|\t)$/i.exec(firstLine);
    if (!match) {
      return { text, delimiter: "", physicalLineOffset: 0, hadSeparatorDirective: false };
    }

    let contentStart = firstLine.length;
    if (text[contentStart] === "\r" && text[contentStart + 1] === "\n") contentStart += 2;
    else if (text[contentStart] === "\r" || text[contentStart] === "\n") contentStart += 1;
    return {
      text: text.slice(contentStart),
      delimiter: match[1],
      physicalLineOffset: 1,
      hadSeparatorDirective: true,
    };
  }

  function parseWithDelimiter(text, delimiter, physicalLineOffset = 0) {
    assertDelimiter(delimiter);
    const rows = [];
    const rowNumbers = [];
    let row = [];
    let field = "";
    let index = 0;
    let inQuotes = false;
    let afterQuote = false;
    let fieldStarted = false;
    let physicalLine = 1 + physicalLineOffset;
    let rowStartLine = physicalLine;
    let recordEndedAtNewline = false;

    const pushField = () => {
      row.push(field);
      field = "";
      fieldStarted = false;
      afterQuote = false;
    };
    const pushRow = () => {
      pushField();
      rows.push(row);
      rowNumbers.push(rowStartLine);
      row = [];
      rowStartLine = physicalLine;
    };

    while (index < text.length) {
      const char = text[index];
      const next = text[index + 1];

      if (inQuotes) {
        if (char === '"' && next === '"') {
          field += '"';
          index += 2;
          continue;
        }
        if (char === '"') {
          inQuotes = false;
          afterQuote = true;
          index += 1;
          continue;
        }
        if (char === "\r") {
          if (next === "\n") {
            field += "\r\n";
            index += 2;
          } else {
            field += "\r";
            index += 1;
          }
          physicalLine += 1;
          continue;
        }
        if (char === "\n") physicalLine += 1;
        field += char;
        index += 1;
        continue;
      }

      if (afterQuote) {
        if (char === delimiter) {
          pushField();
          recordEndedAtNewline = false;
          index += 1;
          continue;
        }
        if (char === "\r" || char === "\n") {
          if (char === "\r" && next === "\n") index += 2;
          else index += 1;
          physicalLine += 1;
          pushRow();
          rowStartLine = physicalLine;
          recordEndedAtNewline = true;
          continue;
        }
        throw new Error(`CSV contains characters after a closing quote on physical line ${physicalLine}.`);
      }

      if (char === delimiter) {
        pushField();
        recordEndedAtNewline = false;
        index += 1;
        continue;
      }
      if (char === "\r" || char === "\n") {
        if (char === "\r" && next === "\n") index += 2;
        else index += 1;
        physicalLine += 1;
        pushRow();
        rowStartLine = physicalLine;
        recordEndedAtNewline = true;
        continue;
      }
      if (char === '"') {
        if (fieldStarted || field) {
          throw new Error(`CSV contains a quote in an unquoted value on physical line ${physicalLine}.`);
        }
        inQuotes = true;
        fieldStarted = true;
        recordEndedAtNewline = false;
        index += 1;
        continue;
      }

      field += char;
      fieldStarted = true;
      recordEndedAtNewline = false;
      index += 1;
    }

    if (inQuotes) throw new Error(`CSV contains an unterminated quoted value starting on physical line ${rowStartLine}.`);
    if (!recordEndedAtNewline || row.length || field || fieldStarted || afterQuote) pushRow();
    return { rows, rowNumbers };
  }

  function scoreDelimiter(text, delimiter) {
    let parsed;
    try {
      parsed = parseWithDelimiter(text, delimiter);
    } catch {
      return Number.NEGATIVE_INFINITY;
    }
    const widths = parsed.rows
      .filter((row) => row.some((cell) => String(cell).trim()))
      .slice(0, 25)
      .map((row) => row.length);
    if (!widths.length) return 0;
    const counts = new Map();
    widths.forEach((width) => counts.set(width, (counts.get(width) || 0) + 1));
    const [modeWidth, modeCount] = [...counts.entries()]
      .sort((left, right) => right[1] - left[1] || right[0] - left[0])[0];
    const inconsistentCount = widths.length - modeCount;
    return (modeWidth > 1 ? 10000 : 0) + (modeCount * 100) + modeWidth - (inconsistentCount * 200);
  }

  function detectCsvDialect(value) {
    const prepared = extractSeparatorDirective(value);
    if (prepared.delimiter) return prepared;

    const ranked = supportedDelimiters
      .map((delimiter, priority) => ({ delimiter, priority, score: scoreDelimiter(prepared.text, delimiter) }))
      .sort((left, right) => right.score - left.score || left.priority - right.priority);
    return {
      ...prepared,
      delimiter: ranked[0]?.score > 0 ? ranked[0].delimiter : ",",
    };
  }

  function parseCsv(value, { delimiter = "" } = {}) {
    const prepared = extractSeparatorDirective(value);
    const selectedDelimiter = delimiter || prepared.delimiter || detectCsvDialect(prepared.text).delimiter;
    assertDelimiter(selectedDelimiter);
    const parsed = parseWithDelimiter(prepared.text, selectedDelimiter, prepared.physicalLineOffset);
    return {
      ...parsed,
      delimiter: selectedDelimiter,
      hadSeparatorDirective: prepared.hadSeparatorDirective,
    };
  }

  function protectFormulaCell(value) {
    const text = String(value ?? "");
    if (text.startsWith("'")) return `'${text}`;
    return formulaPrefixPattern.test(text) ? `'${text}` : text;
  }

  function restoreFormulaSafeCell(value) {
    const text = String(value ?? "");
    if (text.startsWith("''")) return text.slice(1);
    return /^'[\u0000-\u0020]*[=+\-@]/.test(text) ? text.slice(1) : text;
  }

  function csvEscape(value, { delimiter = ",", formulaSafe = true } = {}) {
    assertDelimiter(delimiter);
    const raw = formulaSafe ? protectFormulaCell(value) : String(value ?? "");
    if (raw.includes('"') || raw.includes("\r") || raw.includes("\n") || raw.includes(delimiter)) {
      return `"${raw.replace(/"/g, '""')}"`;
    }
    return raw;
  }

  function buildCsv(rows = [], {
    delimiter = ",",
    bom = true,
    lineEnding = "\r\n",
    formulaSafe = true,
  } = {}) {
    assertDelimiter(delimiter);
    if (!Array.isArray(rows) || rows.some((row) => !Array.isArray(row))) {
      throw new Error("CSV rows must be arrays.");
    }
    if (!["\r\n", "\n", "\r"].includes(lineEnding)) {
      throw new Error("CSV line ending must be CRLF, LF, or CR.");
    }
    const body = rows
      .map((row) => row.map((cell) => csvEscape(cell, { delimiter, formulaSafe })).join(delimiter))
      .join(lineEnding);
    return `${bom ? "\ufeff" : ""}${body}${rows.length ? lineEnding : ""}`;
  }

  return {
    buildCsv,
    csvEscape,
    detectCsvDialect,
    parseCsv,
    protectFormulaCell,
    restoreFormulaSafeCell,
    supportedDelimiters,
  };
});
