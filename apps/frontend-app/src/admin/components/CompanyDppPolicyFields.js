import React from "react";
import {
  companyDppPolicyBooleanFields,
  defaultCompanyDppPolicy,
} from "../utils/companyDppPolicy";

function CompanyDppPolicyFields({
  policy,
  onChange,
  disabled = false,
  idPrefix = "companyPolicy",
}) {
  const currentPolicy = policy || defaultCompanyDppPolicy;
  return (
    <div className="company-policy-fields">
      <div className="form-group">
        <label htmlFor={`${idPrefix}-defaultGranularity`}>Default Granularity</label>
        <select
          id={`${idPrefix}-defaultGranularity`}
          value={currentPolicy.defaultGranularity}
          onChange={(event) => onChange("defaultGranularity", event.target.value)}
          disabled={disabled}
        >
          <option value="item">Item</option>
          <option value="batch">Batch</option>
          <option value="model">Model</option>
        </select>
      </div>

      {companyDppPolicyBooleanFields.map(([field, label]) => (
        <label key={field} className="checkbox-label admin-checkbox-spaced">
          <input
            type="checkbox"
            checked={currentPolicy[field] === true}
            onChange={(event) => onChange(field, event.target.checked)}
            disabled={disabled}
          />
          <span>{label}</span>
        </label>
      ))}
    </div>
  );
}

export default CompanyDppPolicyFields;
