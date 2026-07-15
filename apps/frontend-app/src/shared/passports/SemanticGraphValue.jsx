import React from "react";
import {
  getSemanticGraphClass,
  getSemanticGraphEnum,
  isManySemanticProperty,
  isPlainObject,
  parseSemanticGraphValue,
} from "./semanticGraphUtils";
import { toSafeExternalHref } from "../security/urlSafety";

function ScalarValue({ property, value }) {
  if (property.dataType === "boolean") return <span>{value ? "Yes" : "No"}</span>;
  if (property.dataType === "uri" && typeof value === "string") {
    const href = toSafeExternalHref(value);
    return href
      ? <a href={href} target="_blank" rel="noopener noreferrer">{value}</a>
      : <span>{value}</span>;
  }
  return <span>{String(value ?? "—")}</span>;
}

function OneSemanticValue({ graph, property, value, labelFormatter, depth }) {
  if (property.rangeKind === "scalar") return <ScalarValue property={property} value={value} />;
  if (property.rangeKind === "enum") {
    const enumValue = getSemanticGraphEnum(graph, property.rangeEnumKey)
      ?.values?.find((candidate) => candidate.key === value);
    return (
      <span className="semantic-enum-value" title={enumValue?.semanticId || value}>
        {enumValue?.label || String(value ?? "—")}
      </span>
    );
  }
  if (property.relationshipType === "reference") {
    const iri = isPlainObject(value) ? value["@id"] : value;
    const href = toSafeExternalHref(iri);
    return href
      ? <a href={href} target="_blank" rel="noopener noreferrer">{iri}</a>
      : <span>{iri || "—"}</span>;
  }

  const classDef = getSemanticGraphClass(graph, property.rangeClassKey);
  if (!classDef || !isPlainObject(value)) return <span>—</span>;
  return (
    <div className="semantic-class-value" data-depth={depth}>
      <div className="semantic-class-value-heading">
        <strong>{classDef.label}</strong>
        {value["@id"] && (
          toSafeExternalHref(value["@id"])
            ? <a href={toSafeExternalHref(value["@id"])} target="_blank" rel="noopener noreferrer">{value["@id"]}</a>
            : <span>{value["@id"]}</span>
        )}
      </div>
      <dl>
        {(classDef.properties || [])
          .filter((childProperty) => Object.prototype.hasOwnProperty.call(value, childProperty.key))
          .map((childProperty) => (
            <div className="semantic-class-value-row" key={childProperty.key}>
              <dt>{labelFormatter(childProperty)}</dt>
              <dd>
                <SemanticGraphValue
                  graph={graph}
                  property={childProperty}
                  value={value[childProperty.key]}
                  labelFormatter={labelFormatter}
                  depth={depth + 1}
                />
              </dd>
            </div>
          ))}
      </dl>
    </div>
  );
}

export default function SemanticGraphValue({
  graph,
  property,
  value,
  labelFormatter = (entry) => entry?.label || entry?.key || "",
  depth = 0,
}) {
  const many = isManySemanticProperty(property);
  const parsed = parseSemanticGraphValue(value, many ? [] : value);
  if (parsed === null || parsed === undefined || parsed === "" || (Array.isArray(parsed) && parsed.length === 0)) {
    return <span className="field-value-empty">—</span>;
  }
  const entries = many ? (Array.isArray(parsed) ? parsed : []) : [parsed];
  if (!entries.length) return <span className="field-value-empty">—</span>;
  if (!many) {
    return <OneSemanticValue graph={graph} property={property} value={entries[0]} labelFormatter={labelFormatter} depth={depth} />;
  }
  return (
    <div className="semantic-value-list">
      {entries.map((entry, index) => (
        <div className="semantic-value-list-entry" key={`${property.key}-${index}`}>
          <OneSemanticValue graph={graph} property={property} value={entry} labelFormatter={labelFormatter} depth={depth} />
        </div>
      ))}
    </div>
  );
}
