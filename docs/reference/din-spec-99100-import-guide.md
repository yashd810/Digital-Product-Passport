# DIN SPEC 99100 v1.3 Passport - Data Import Guide

## Table of Contents

1. [Overview](#overview)
2. [API Import Format](#️-important-api-import-format)
3. [Section 1: Identifiers and Product Data](#section-1-identifiers-and-product-data)
4. [Section 2: Symbols, Labels & Documentation of Conformity](#section-2-symbols-labels--documentation-of-conformity)
5. [Section 3: Battery Carbon Footprint](#section-3-battery-carbon-footprint)
6. [Section 4: Supply Chain Due Diligence](#section-4-supply-chain-due-diligence)
7. [Section 5: Battery Materials and Composition](#section-5-battery-materials-and-composition)
8. [Section 6: Circularity and Resource Efficiency](#section-6-circularity-and-resource-efficiency)
9. [Section 7: Performance and Durability](#section-7-performance-and-durability)
10. [Field Types Reference](#field-types-reference)
11. [Dynamic vs Static Fields](#dynamic-vs-static-fields)
12. [Access Restrictions](#access-restrictions)
13. [Handling Tables in CSV vs JSON](#handling-tables-in-csv-vs-json)
14. [Files Provided](#files-provided)
15. [Import Command](#import-command)
16. [Validation Notes](#validation-notes)

---

## Overview

**Passport Type:** `din_spec_v13`  
**Display Name:** DIN SPEC 99100 v1.3

This is the official EU Battery Regulation compliant passport type. It contains **7 sections** with comprehensive battery product information.

---

## ⚠️ IMPORTANT: API Import Format

When creating passports via the JSON API, **table fields (arrays) must be sent as JSON arrays**:

✅ **CORRECT:**
```json
{
  "passport_type": "din_spec_v13",
  "model_name": "Battery X-100",
  "materials_used_in_cathode": [
    ["Nickel", "35.2", "7440-02-0"],
    ["Manganese", "22.1", "7439-96-5"]
  ],
  "hazardous_substances": [
    ["Lead", "0.1", "7439-92-1", "Yes", "Toxic if inhaled"]
  ]
}
```

✅ **ALSO CORRECT** (single-column arrays):
```json
{
  "critical_raw_materials": ["Cobalt", "Nickel", "Lithium"]
}
```

The backend will automatically convert these arrays to JSON strings for storage and the app will display them as tables.

---

## Section 1: Identifiers and Product Data

Core product identification and metadata fields.

| Field Key | Type | Required | Example | Notes |
|-----------|------|----------|---------|-------|
| `dpp_schema_version` | textarea | Yes | "1.3.0" | Schema version |
| `dpp_status` | text | Yes | "approved" | Status of DPP |
| `dpp_granularity` | text | Yes | "single_cell" | Data granularity level |
| `datetime_of_latest_update` | text | Yes | "2026-04-03T10:30:00Z" | ISO datetime (dynamic) |
| `unique_passport_identifier` | url | Yes | "https://example.com/passport/550e8400..." | Public URL |
| `unique_battery_identifier` | url | Yes | "https://example.com/battery/X-100-2024-001" | Battery URL |
| `battery_model` | text | Yes | "Battery Model X-100" | Model name |
| `battery_serial_number` | text | Yes | "SN-2024-001-001" | Serial number |
| `unique_economic_operator_identifier` | text | No | "DE123456789" | Operator ID (restricted access) |
| `unique_manufacturer_identifier` | text | No | "ACME-DE-001" | Manufacturer ID (restricted) |
| `unique_facility_identifier` | text | No | "BERLIN-FACILITY-01" | Facility ID (restricted) |
| `economic_operator_information` | text | Yes | "Acme Battery Corp" | Operator name |
| `manufacturer_information` | text | Yes | "Acme Battery Corp, Berlin" | Manufacturer details |
| `manufacturing_place` | text | Yes | "Berlin, Germany" | Production location |
| `manufacturing_date` | date | Yes | "2026-03-15" | YYYY-MM-DD format |
| `date_of_into_service` | date | No | "2026-03-20" | When put into service |
| `warranty_period_the_battery` | text | Yes | "5 years" | Warranty duration |
| `battery_category` | text | Yes | "EV battery" | Category (e.g., EV, stationary) |
| `battery_mass` | text | Yes | "12.5 kg" | Total mass |
| `battery_status` | text | No | "new" | Current status (dynamic) |

---

## Section 2: Symbols, Labels & Documentation of Conformity

Regulatory symbols and compliance documentation.

| Field Key | Type | Required | Example | Notes |
|-----------|------|----------|---------|-------|
| `separate_collection_symbol` | symbol | Yes | "https://example.com/symbols/separate-collection.svg" | SVG symbol upload |
| `symbols_for_cadmium` | symbol | Yes | "https://example.com/symbols/cadmium.svg" | Cadmium hazard |
| `carbon_footprint_label` | symbol | Yes | "https://example.com/symbols/carbon-footprint.svg" | Carbon label |
| `symbols_for_lead` | symbol | Yes | "https://example.com/symbols/lead.svg" | Lead hazard |
| `extinguishing_agent` | text | Yes | "Use CO2 or dry powder" | Fire safety info |
| `meaning_of_and_symbols` | file | Yes | "https://example.com/docs/symbols.pdf" | Symbol explanation doc |
| `eu_declaration_of_conformity` | file | Yes | "https://example.com/docs/euloc.pdf" | EU DoC |
| `results_of_proving_compliance` | file | Yes | "https://example.com/docs/test-reports.pdf" | Test reports |

---

## Section 3: Battery Carbon Footprint

Environmental impact metrics.

| Field Key | Type | Required | Example | Notes |
|-----------|------|----------|---------|-------|
| `battery_carbon_functional_unit` | text | Yes | "45.5 kg CO2-eq per kWh" | Per unit basis |
| `contribution_of_and_preprocessing` | text | Yes | "25.3 kg CO2-eq" | Raw materials stage |
| `contribution_of_product_production` | text | Yes | "12.8 kg CO2-eq" | Manufacturing |
| `contribution_of_distribution` | text | Yes | "3.2 kg CO2-eq" | Transport/logistics |
| `contribution_of_and_recycling` | text | Yes | "4.2 kg CO2-eq" | End-of-life stage |
| `carbon_footprint_performance_class` | text | Yes | "A" | Class A-F rating |
| `web_link_footprint_study` | file | Yes | "https://example.com/cf-study.pdf" | Full study |
| `absolute_battery_carbon_footprint` | text | Yes | "455 kg CO2-eq" | Total for unit |

---

## Section 4: Supply Chain Due Diligence

Sourcing and compliance documentation.

| Field Key | Type | Required | Example | Notes |
|-----------|------|----------|---------|-------|
| `information_of_diligence_report` | file | Yes | "https://example.com/due-diligence.pdf" | CSDDD report |
| `third_party_recognised_schemes` | text | Yes | "ICMM member, Conflict-free cert" | Certifications |
| `supply_chain_indices` | text | Yes | "Cobalt conflict-free certified" | Sourcing claims |

---

## Section 5: Battery Materials and Composition

Detailed material breakdown including hazardous substances.

### Simple Fields
| Field Key | Type | Required | Example |
|-----------|------|----------|---------|
| `battery_chemistry` | text | Yes | "Li-ion NMC" |

### Table Fields (Complex - Array of Arrays)

**critical_raw_materials** (1 column, n rows)
```json
"critical_raw_materials": ["Cobalt", "Nickel", "Lithium"]
```

**materials_used_in_cathode** (3 columns: Material, Composition %, CAS Number)
```json
"materials_used_in_cathode": [
  ["Nickel", "35.2", "7440-02-0"],
  ["Manganese", "22.1", "7439-96-5"],
  ["Cobalt", "20.3", "7440-48-4"]
]
```

**materials_used_in_anode** (3 columns: Material, Composition %, CAS Number)
```json
"materials_used_in_anode": [
  ["Graphite", "15.3", "7782-42-5"],
  ["Silicon", "8.2", "7440-21-3"]
]
```

**materials_used_in_electrolyte** (3 columns: Material, Composition %, CAS Number)
```json
"materials_used_in_electrolyte": [
  ["Lithium hexafluorophosphate", "12.5", "21324-40-8"],
  ["Ethylene carbonate", "18.3", "96-49-1"]
]
```

**hazardous_substances** (5 columns: Material, Composition %, CAS Number, Presence, Impact)
```json
"hazardous_substances": [
  ["Lead", "0.1", "7439-92-1", "Yes", "Toxic if inhaled"],
  ["Cadmium", "0.01", "7440-43-9", "Yes", "Carcinogenic"]
]
```

---

## Section 6: Circularity and Resource Efficiency

Recycling, waste prevention, and end-of-life info.

| Field Key | Type | Required | Example | Notes |
|-----------|------|----------|---------|-------|
| `dismantling_information` | file | No | "https://example.com/docs/dismantle.pdf" | Disassembly guide |
| `part_numbers_for_components` | file | No | "https://example.com/docs/parts.pdf" | Component list |
| `information_on_spare_parts` | text | No | "Contact: parts@acme.com" | Spares availability |
| `safety_measures` | file | No | "https://example.com/docs/safety.pdf" | Safety protocols |
| `preconsumer_recycled_nickel` | text | Yes | "8.5%" | Pre-consumer recycled |
| `preconsumer_recycled_cobalt` | text | Yes | "5.2%" | Pre-consumer recycled |
| `preconsumer_recycled_lithium` | text | Yes | "3.1%" | Pre-consumer recycled |
| `postconsumer_recycled_nickel` | text | Yes | "12.3%" | Post-consumer recycled |
| `postconsumer_recycled_cobalt` | text | Yes | "9.8%" | Post-consumer recycled |
| `postconsumer_recycled_lithium` | text | Yes | "6.7%" | Post-consumer recycled |
| `recycled_lead_share` | text | Yes | "15.0%" | Lead recycled content |
| `renewable_content_share` | text | Yes | "2.5%" | Renewable materials |
| `information_on_waste_prevention` | file | Yes | "https://example.com/waste-prevent.pdf" | User guidance |
| `information_on_waste_batteries` | file | Yes | "https://example.com/waste-batt.pdf" | Collection info |
| `information_on_of_life` | file | Yes | "https://example.com/eol.pdf" | End-of-life guidance |

---

## Section 7: Performance and Durability

Extensive battery performance metrics and lifecycle data.

| Field Key | Type | Required | Example | Notes |
|-----------|------|----------|---------|-------|
| `rated_capacity` | text | Yes | "100 Ah" | Design capacity |
| `remaining_capacity` | text | No | "100 Ah" | Current capacity (dynamic) |
| `capacity_fade` | text | No | "0%" | Capacity loss (dynamic) |
| `certified_usable_battery_energy` | text | Yes | "370 Wh" | Usable energy certified |
| `remaining_usable_battery_energy` | text | No | "370 Wh" | Current usable (dynamic) |
| `state_of_energy_soce` | text | No | "100%" | Energy state (dynamic) |
| `state_of_charge_soc` | text | No | "80%" | Charge level (dynamic) |
| `minimum_voltage` | text | Yes | "2.5 V" | Minimum safe voltage |
| `maximum_voltage` | text | Yes | "4.2 V" | Maximum safe voltage |
| `nominal_voltage` | text | Yes | "3.7 V" | Nominal voltage |
| `original_power_capability` | text | Yes | "150 kW" | Original power |
| `remaining_power_capability` | text | No | "150 kW" | Current power (dynamic) |
| `power_fade` | text | No | "0%" | Power loss (dynamic) |
| `maximum_permitted_battery_power` | text | Yes | "160 kW" | Max safe power |
| `ratio_between_battery_energy` | text | Yes | "0.405" | Power to energy ratio |
| `initial_round_energy_efficiency` | text | Yes | "95%" | Initial efficiency |
| `round_trip_cycle_life` | text | Yes | "92%" | Efficiency at 50% life |
| `remaining_round_energy_efficiency` | text | No | "95%" | Current efficiency (dynamic) |
| `energy_round_efficiency_fade` | text | No | "0%" | Efficiency loss (dynamic) |
| `initial_selfdischarge_rate` | text | No | "0.5% per month" | Self-discharge |
| `current_selfdischarge_rate` | text | No | "0.5% per month" | Current rate (dynamic) |
| `evolution_of_selfdischarge_rates` | text | No | "Stable" | Trend (dynamic) |
| `initial_internal_module_recommended` | text | Yes | "15 mΩ" | Internal resistance |
| `internal_resistance_module_recommended` | text | No | "0 mΩ" | Resistance increase (dynamic) |
| `expected_lifetime_calendar_years` | text | No | "8" | Expected years |
| `expected_lifetime_chargedischarge_cycles` | text | Yes | "2000" | Expected cycles |
| `number_of_discharging_cycles` | text | No | "350" | Actual cycles so far (dynamic) |
| `cyclelife_reference_test` | textarea | Yes | "PNNL Test Protocol..." | Test methodology |
| `crate_of_cyclelife_test` | text | Yes | "1C" | Test C-rate |
| `energy_throughput` | text | No | "25500 kWh" | Total energy (dynamic) |
| `capacity_throughput` | text | No | "6875 Ah" | Total capacity (dynamic) |
| `capacity_threshold_for_exhaustion` | text | Yes | "80%" | EOL threshold |
| `temperature_information` | text | No | "20-25°C optimal" | Temp notes (dynamic) |
| `temperature_range_boundary_lower` | text | Yes | "-20°C" | Lower limit |
| `temperature_range_boundary_upper` | text | Yes | "60°C" | Upper limit |
| `time_spent_above_boundary` | text | No | "0 hours" | Extreme temp high (dynamic) |
| `time_spent_below_boundary` | text | No | "0 hours" | Extreme temp low (dynamic) |
| `time_spent_above_boundar` | text | No | "0 hours" | Charging at high temp (dynamic) |
| `time_spent_temperatures_below_boundary` | text | No | "0 hours" | Charging at low temp (dynamic) |
| `number_of_discharge_events` | text | No | "0" | Deep discharge count (dynamic) |
| `number_of_overcharge_events` | text | No | "0" | Overcharge events (dynamic) |
| `information_on_accidents` | text | No | "None reported" | Accident history (dynamic) |

---

## Field Types Reference

- **text**: Single-line text input
- **textarea**: Multi-line text (supports newlines)
- **date**: ISO 8601 format (YYYY-MM-DD)
- **url**: Full HTTP/HTTPS URL
- **file**: Upload or URL to document (PDF, etc.)
- **symbol**: SVG symbol upload or URL
- **table**: Array of arrays (JSON only)

---

## Dynamic vs Static Fields

Fields marked **dynamic: true** in the database are typically updated over time (e.g., state_of_charge, cycle_count, capacity_fade). Static fields are set once.

---

## Access Restrictions

Fields have different access levels:
- **public**: Available to all
- **legitimate_interest**: Company/authorized users only
- **notified_bodies**, **market_surveillance**, **eu_commission**: Government/authorities only

---

## Handling Tables in CSV vs JSON

### JSON Format (Recommended)
Best for tables - use array of arrays:
```json
"materials_used_in_cathode": [
  ["Nickel", "35.2", "7440-02-0"],
  ["Manganese", "22.1", "7439-96-5"]
]
```

### CSV Format
**Option A:** Multiple columns per item
```csv
cathode_material_1,cathode_comp_1,cathode_cas_1,cathode_material_2,cathode_comp_2,cathode_cas_2
Nickel,35.2,7440-02-0,Manganese,22.1,7439-96-5
```

**Option B:** JSON-encoded string in single cell
```csv
"[[""Nickel"",""35.2"",""7440-02-0""],[""Manganese"",""22.1"",""7439-96-5""]]"
```

**Option C:** Separate CSV file with passport_guid reference
```csv
passport_guid,material,composition,cas_number
550e8400-e29b-41d4-a716-446655440000,Nickel,35.2,7440-02-0
550e8400-e29b-41d4-a716-446655440000,Manganese,22.1,7439-96-5
```

---

## Files Provided

1. **din-spec-99100-passport.json** — Complete JSON with real DB field names
2. **din-spec-99100-passport.csv** — Single-row CSV with all fields populated
3. **This guide** — Complete field reference

---

## Import Command

```bash
# JSON import
curl -X POST http://localhost:3001/api/companies/:companyId/passports \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  --data @din-spec-99100-passport.json

# CSV import (if endpoint exists)
curl -F "file=@din-spec-99100-passport.csv" \
  -H "Authorization: Bearer <token>" \
  http://localhost:3001/api/passports/import-csv
```

---

## Validation Notes

1. **Passport Type**: Must be `din_spec_v13` (lowercase)
2. **Field Keys**: Must match EXACTLY (case-sensitive, underscores)
3. **Dates**: ISO 8601 (YYYY-MM-DD)
4. **Tables**: JSON format only, flat arrays
5. **URLs/Files**: Use full HTTP/HTTPS URLs
6. **Symbol Files**: SVG or PNG recommended
7. **Dynamic Fields**: Can be left empty on first import, updated later

---

## Related Documentation

- [data.md](./data.md) - Reference data files and BatteryPass attributes
- [DATABASE_SCHEMA.md](../database/DATABASE_SCHEMA.md) - Database schema for passport storage
- [API_INDEX.md](../api/API_INDEX.md) - Complete API endpoint reference
- [battery-dictionary.md](../api/battery-dictionary.md) - Battery field definitions
- [DEPLOYMENT.md](../deployment/LOCAL.md) - Local testing setup
- [REFERENCE_INDEX.md](./REFERENCE_INDEX.md) - Reference documentation index

---

**[← Back to Docs](../README.md)**
