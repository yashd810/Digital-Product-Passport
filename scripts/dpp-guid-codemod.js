"use strict";

const fs = require("fs");
const path = require("path");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const generate = require("@babel/generator").default;
const t = require("@babel/types");

const files = process.argv.slice(2);

function replaceInString(value) {
  let next = String(value);
  const looksSql = /\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|JOIN|ALTER|CREATE|DROP|RETURNING|VALUES|ON CONFLICT|ORDER BY|LIMIT)\b/i.test(next);

  next = next.replace(/:guid\b/g, ":dppId");
  next = next.replace(/\bpassportGuid\b/g, "passportDppId");
  next = next.replace(/\bmatch_guid\b/g, "match_dpp_id");
  next = next.replace(/\bmatched_guid\b/g, "matched_dpp_id");
  next = next.replace(/\bpassport_guid\b/g, "passport_dpp_id");
  next = next.replace(/\bguids\b/g, "dppIds");

  if (looksSql) {
    next = next.replace(/\bguid\b/g, "dpp_id");
    next = next.replace(/\bGUID\b/g, "DPP_ID");
  } else {
    next = next.replace(/\bguid\b/g, "dppId");
    next = next.replace(/\bGuid\b/g, "DppId");
  }

  next = next.replace(/\bexisting_dppId\b/g, "existing_dpp_id");
  next = next.replace(/\bpassport_dppId\b/g, "passport_dpp_id");
  return next;
}

function updatePropertyName(identifierName) {
  if (identifierName === "guid") return "dppId";
  if (identifierName === "guids") return "dppIds";
  if (identifierName === "passportGuid") return "passportDppId";
  if (identifierName === "match_guid") return "match_dpp_id";
  if (identifierName === "matched_guid") return "matched_dpp_id";
  if (identifierName === "existing_guid") return "existing_dpp_id";
  return identifierName;
}

for (const relFile of files) {
  const file = path.resolve(relFile);
  const source = fs.readFileSync(file, "utf8");
  const ast = parser.parse(source, {
    sourceType: "script",
    plugins: [
      "jsx",
      "classProperties",
      "optionalChaining",
      "nullishCoalescingOperator",
      "objectRestSpread",
      "topLevelAwait",
    ],
  });

  traverse(ast, {
    Identifier(path) {
      path.node.name = updatePropertyName(path.node.name);
    },
    StringLiteral(path) {
      path.node.value = replaceInString(path.node.value);
    },
    TemplateElement(path) {
      path.node.value = {
        cooked: replaceInString(path.node.value.cooked),
        raw: replaceInString(path.node.value.raw),
      };
    },
    ObjectProperty(path) {
      if (!path.node.computed && t.isIdentifier(path.node.key)) {
        path.node.key.name = updatePropertyName(path.node.key.name);
      }
      if (t.isStringLiteral(path.node.key)) {
        path.node.key.value = replaceInString(path.node.key.value);
      }
      if (
        path.node.shorthand &&
        t.isIdentifier(path.node.key) &&
        t.isIdentifier(path.node.value) &&
        path.node.key.name !== path.node.value.name
      ) {
        path.node.shorthand = false;
      }
    },
    MemberExpression(path) {
      if (!path.node.computed && t.isIdentifier(path.node.property)) {
        path.node.property.name = updatePropertyName(path.node.property.name);
      }
      if (path.node.computed && t.isStringLiteral(path.node.property)) {
        path.node.property.value = replaceInString(path.node.property.value);
      }
    },
  });

  const output = generate(ast, { retainLines: true, comments: true }, source).code;
  fs.writeFileSync(file, output);
  process.stdout.write(`${relFile}\n`);
}
