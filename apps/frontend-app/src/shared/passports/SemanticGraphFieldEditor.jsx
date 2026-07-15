import React from "react";
import {
  createEmptySemanticClassValue,
  getSemanticGraphClass,
  getSemanticGraphEnum,
  isManySemanticProperty,
  isPlainObject,
  parseSemanticGraphValue,
  semanticPropertyCardinality,
} from "./semanticGraphUtils";
import { toSafeExternalHref } from "../security/urlSafety";

function ScalarInput({ property, value, disabled, onChange }) {
  if (property.dataType === "boolean") {
    return (
      <label className="semantic-boolean-input">
        <input type="checkbox" checked={value === true} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
        <span>{value === true ? "Yes" : "No"}</span>
      </label>
    );
  }
  const inputType = {
    date: "date",
    datetime: "datetime-local",
    decimal: "number",
    integer: "number",
    uri: "url",
  }[property.dataType] || "text";
  const inputValue = property.dataType === "datetime" && value
    ? (() => {
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return String(value);
        const pad = (part) => String(part).padStart(2, "0");
        return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}:${pad(parsed.getSeconds())}`;
      })()
    : (value ?? "");
  return (
    <input
      type={inputType}
      step={property.dataType === "datetime" ? "1" : (property.dataType === "integer" ? "1" : (property.dataType === "decimal" ? "any" : undefined))}
      value={inputValue}
      disabled={disabled}
      onChange={(event) => {
        if (property.dataType !== "datetime" || !event.target.value) {
          onChange(event.target.value);
          return;
        }
        const parsed = new Date(event.target.value);
        onChange(Number.isNaN(parsed.getTime()) ? event.target.value : parsed.toISOString());
      }}
    />
  );
}

function PropertyHeader({ property }) {
  return (
    <div className="semantic-property-heading">
      <div>
        <strong>{property.label || property.key}</strong>
        {property.minCount > 0 && <span className="semantic-required">Required</span>}
      </div>
      <span className="semantic-cardinality">{semanticPropertyCardinality(property)}</span>
    </div>
  );
}

function ClassEditor({ graph, classKey, value, disabled, onChange, depth }) {
  const classDef = getSemanticGraphClass(graph, classKey);
  const objectValue = isPlainObject(value) ? value : {};
  if (!classDef) return <p className="semantic-editor-error">Unknown semantic class: {classKey}</p>;
  return (
    <div className="semantic-class-editor" data-depth={depth}>
      <div className="semantic-class-heading">
        <div>
          <strong>{classDef.label}</strong>
          <code>{classDef.key}</code>
        </div>
        {toSafeExternalHref(classDef.semanticId)
          ? <a href={toSafeExternalHref(classDef.semanticId)} target="_blank" rel="noopener noreferrer">Class IRI</a>
          : <span>Class IRI unavailable</span>}
      </div>
      {classDef.definition && <p className="semantic-class-definition">{classDef.definition}</p>}
      <div className="semantic-class-properties">
        {(classDef.properties || []).map((childProperty) => (
          <SemanticPropertyEditor
            key={childProperty.key}
            graph={graph}
            property={childProperty}
            value={objectValue[childProperty.key]}
            disabled={disabled}
            depth={depth + 1}
            onChange={(nextValue) => onChange({ ...objectValue, [childProperty.key]: nextValue })}
          />
        ))}
      </div>
    </div>
  );
}

function OneValueEditor({ graph, property, value, disabled, onChange, depth }) {
  if (property.rangeKind === "scalar") {
    return <ScalarInput property={property} value={value} disabled={disabled} onChange={onChange} />;
  }
  if (property.rangeKind === "enum") {
    const enumDef = getSemanticGraphEnum(graph, property.rangeEnumKey);
    return (
      <select value={value ?? ""} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        <option value="">Select {property.label || property.key}</option>
        {(enumDef?.values || []).map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
      </select>
    );
  }
  if (property.relationshipType === "reference") {
    const iri = isPlainObject(value) ? value["@id"] : value;
    return (
      <input
        type="url"
        value={iri ?? ""}
        disabled={disabled}
        placeholder="https://example.com/id/resource"
        onChange={(event) => onChange({ "@id": event.target.value })}
      />
    );
  }
  return (
    <ClassEditor
      graph={graph}
      classKey={property.rangeClassKey}
      value={value}
      disabled={disabled}
      onChange={onChange}
      depth={depth}
    />
  );
}

function SemanticPropertyEditor({ graph, property, value, disabled, onChange, depth = 0, root = false }) {
  const many = isManySemanticProperty(property);
  const parsedValue = parseSemanticGraphValue(value, many ? [] : value);
  const canRemoveSingleClass = property.rangeKind === "class"
    && property.relationshipType === "composition"
    && property.minCount === 0;

  if (!many) {
    const hasClassValue = property.rangeKind !== "class"
      || property.relationshipType === "reference"
      || isPlainObject(parsedValue);
    return (
      <div className={`semantic-property-editor${root ? " semantic-root-property" : ""}`}>
        <PropertyHeader property={property} />
        {property.definition && <p className="semantic-property-definition">{property.definition}</p>}
        {!hasClassValue ? (
          <button
            type="button"
            className="semantic-add-button"
            disabled={disabled}
            onClick={() => onChange(createEmptySemanticClassValue(graph, property.rangeClassKey))}
          >
            + Add {property.label || "details"}
          </button>
        ) : (
          <>
            <OneValueEditor graph={graph} property={property} value={parsedValue} disabled={disabled} onChange={onChange} depth={depth} />
            {canRemoveSingleClass && (
              <button type="button" className="semantic-remove-button" disabled={disabled} onClick={() => onChange(null)}>
                Remove {property.label || "details"}
              </button>
            )}
          </>
        )}
      </div>
    );
  }

  const values = Array.isArray(parsedValue) ? parsedValue : [];
  const canAdd = property.maxCount === null || values.length < property.maxCount;
  return (
    <div className={`semantic-property-editor semantic-property-many${root ? " semantic-root-property" : ""}`}>
      <PropertyHeader property={property} />
      {property.definition && <p className="semantic-property-definition">{property.definition}</p>}
      <div className="semantic-many-list">
        {values.map((entry, index) => (
          <div className="semantic-many-entry" key={`${property.key}-${index}`}>
            <div className="semantic-many-entry-heading">
              <span>{property.label || property.key} {index + 1}</span>
              <button
                type="button"
                className="semantic-remove-button"
                disabled={disabled || values.length <= property.minCount}
                onClick={() => onChange(values.filter((_, entryIndex) => entryIndex !== index))}
              >
                Remove
              </button>
            </div>
            <OneValueEditor
              graph={graph}
              property={property}
              value={entry}
              disabled={disabled}
              depth={depth}
              onChange={(nextEntry) => onChange(values.map((current, entryIndex) => entryIndex === index ? nextEntry : current))}
            />
          </div>
        ))}
      </div>
      <button
        type="button"
        className="semantic-add-button"
        disabled={disabled || !canAdd}
        onClick={() => onChange([
          ...values,
          property.rangeKind === "class" && property.relationshipType === "composition"
            ? createEmptySemanticClassValue(graph, property.rangeClassKey)
            : (property.rangeKind === "class" ? { "@id": "" } : ""),
        ])}
      >
        + Add {property.label || "value"}
      </button>
    </div>
  );
}

export default function SemanticGraphFieldEditor(props) {
  return <SemanticPropertyEditor {...props} root />;
}
