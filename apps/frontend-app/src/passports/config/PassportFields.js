// ============================================================
// PASSPORT FIELD DEFINITIONS
// Sections are purely for display grouping in the form and viewer.
// All data for a passport type lives in ONE table on the server.
// The "key" matches the database column name exactly.
// ============================================================

// ──────────────────────────────────────────
//  BATTERY
// ──────────────────────────────────────────
export const BATTERY_SECTIONS = {
  general: {
    label: "General",
    fields: [
      { key: "category",          label: "Category",          type: "text" },
      { key: "manufactured_date", label: "Manufactured Date",  type: "text" },
      { key: "facility",          label: "Facility ID",        type: "text" },
      { key: "weight",            label: "Weight",             type: "text" },
      { key: "manufacturer",      label: "Manufactured By",    type: "text" },
    ],
  },
  material: {
    label: "Material Composition",
    fields: [
      { key: "chemistry",   label: "Battery Chemistry",                        type: "text" },
      { key: "cathode",     label: "Materials in Cathode",                     type: "textarea" },
      { key: "anode",       label: "Materials in Anode",                       type: "textarea" },
      { key: "electrolyte", label: "Materials in Electrolyte",                 type: "textarea" },
      { key: "hazardous",   label: "Hazardous Substances",                     type: "textarea" },
      { key: "critical",    label: "Critical Raw Materials",                   type: "textarea" },
      { key: "impact",      label: "Report of Impact of Hazardous Substances", type: "textarea" },
    ],
  },
  performance: {
    label: "Performance",
    fields: [
      { key: "capacity",    label: "Rated Capacity",                    type: "text" },
      { key: "power",       label: "Original Power Capability",         type: "text" },
      { key: "voltage",     label: "Rated Voltage",                     type: "text" },
      { key: "temperature", label: "Temperature Limits",                type: "text" },
      { key: "cycles",      label: "Number of Charge/Discharge Cycles", type: "text" },
      { key: "resistance",  label: "Internal Resistance",               type: "text" },
      { key: "report",      label: "Test Reports",                      type: "textarea" },
    ],
  },
  compliance: {
    label: "Compliance",
    fields: [
      { key: "conformity_url", label: "Conformity Assessment",     type: "file" },
      { key: "doc_url",        label: "Declaration of Conformity", type: "file" },
    ],
  },
  supplyChain: {
    label: "Supply Chain",
    fields: [
      { key: "sustainability", label: "Sustainability Report",     type: "textarea" },
      { key: "due_diligence",  label: "Due Diligence Report",      type: "textarea" },
      { key: "audit",          label: "Third Party Audit Reports", type: "textarea" },
      { key: "taxonomy",       label: "Taxonomy Report",           type: "textarea" },
    ],
  },
  circularity: {
    label: "Circularity",
    fields: [
      { key: "lithium", label: "Amount of Recycled Lithium", type: "text" },
      { key: "nickel",  label: "Amount of Recycled Nickel",  type: "text" },
      { key: "cobalt",  label: "Amount of Recycled Cobalt",  type: "text" },
      { key: "lead",    label: "Amount of Lead",             type: "text" },
    ],
  },
  carbonFootprint: {
    label: "Carbon Footprint",
    fields: [
      { key: "raw_material_cf", label: "Raw Material Carbon Footprint", type: "text" },
      { key: "lifetime_cf",     label: "Lifetime Carbon Footprint",     type: "text" },
      { key: "recycling_cf",    label: "Recycling Carbon Footprint",    type: "text" },
      { key: "total_cf",        label: "Total Carbon Footprint",        type: "text" },
      { key: "cf_class",        label: "Carbon Footprint Class",        type: "text" },
      { key: "reference_study", label: "Reference Study",               type: "textarea" },
    ],
  },
};

// ──────────────────────────────────────────
//  TEXTILE
// ──────────────────────────────────────────
export const TEXTILE_SECTIONS = {
  general: {
    label: "General",
    fields: [
      { key: "product_category",  label: "Product Category",  type: "text" },
      { key: "gender",            label: "Gender",            type: "text" },
      { key: "season",            label: "Season",            type: "text" },
      { key: "country_of_origin", label: "Country of Origin", type: "text" },
      { key: "manufacturer",      label: "Manufacturer",      type: "text" },
      { key: "brand",             label: "Brand",             type: "text" },
    ],
  },
  material: {
    label: "Material Composition",
    fields: [
      { key: "fiber_composition",    label: "Fibre Composition",    type: "textarea" },
      { key: "recycled_content_pct", label: "Recycled Content (%)", type: "text" },
      { key: "organic_certified",    label: "Organic Certified",    type: "boolean" },
      { key: "chemical_substances",  label: "Chemical Substances",  type: "textarea" },
      { key: "dyes_used",            label: "Dyes Used",            type: "textarea" },
    ],
  },
  careRepair: {
    label: "Care & Repair",
    fields: [
      { key: "washing_instructions",  label: "Washing Instructions",  type: "textarea" },
      { key: "drying_instructions",   label: "Drying Instructions",   type: "textarea" },
      { key: "ironing_instructions",  label: "Ironing Instructions",  type: "textarea" },
      { key: "repair_info",           label: "Repair Information",    type: "textarea" },
      { key: "spare_parts_available", label: "Spare Parts Available", type: "boolean" },
    ],
  },
  sustainability: {
    label: "Sustainability",
    fields: [
      { key: "certifications",      label: "Certifications",      type: "textarea" },
      { key: "carbon_footprint",    label: "Carbon Footprint",    type: "text" },
      { key: "water_usage",         label: "Water Usage",         type: "text" },
      { key: "recyclability_info",  label: "Recyclability Info",  type: "textarea" },
      { key: "end_of_life_options", label: "End of Life Options", type: "textarea" },
    ],
  },
  compliance: {
    label: "Compliance",
    fields: [
      { key: "reach_compliance", label: "REACH Compliance",     type: "boolean" },
      { key: "oeko_tex_cert",    label: "OEKO-TEX Certificate", type: "text" },
      { key: "doc_url",          label: "Compliance Document",  type: "file" },
    ],
  },
};

// ──────────────────────────────────────────
//  STEEL
// ──────────────────────────────────────────
export const STEEL_SECTIONS = {
  general: {
    label: "General",
    fields: [
      { key: "steel_grade",       label: "Steel Grade",       type: "text" },
      { key: "standard",          label: "Standard",          type: "text" },
      { key: "manufacturer",      label: "Manufacturer",      type: "text" },
      { key: "country_of_origin", label: "Country of Origin", type: "text" },
      { key: "production_date",   label: "Production Date",   type: "text" },
      { key: "heat_number",       label: "Heat Number",       type: "text" },
    ],
  },
  material: {
    label: "Material Composition",
    fields: [
      { key: "chemical_composition", label: "Chemical Composition",  type: "textarea" },
      { key: "carbon_content",       label: "Carbon Content (%)",    type: "text" },
      { key: "manganese_content",    label: "Manganese Content (%)", type: "text" },
      { key: "recycled_content_pct", label: "Recycled Content (%)",  type: "text" },
      { key: "alloying_elements",    label: "Alloying Elements",     type: "textarea" },
    ],
  },
  performance: {
    label: "Performance",
    fields: [
      { key: "tensile_strength", label: "Tensile Strength (MPa)", type: "text" },
      { key: "yield_strength",   label: "Yield Strength (MPa)",   type: "text" },
      { key: "elongation",       label: "Elongation (%)",         type: "text" },
      { key: "hardness",         label: "Hardness (HBW)",         type: "text" },
      { key: "impact_energy",    label: "Impact Energy (J)",      type: "text" },
    ],
  },
  compliance: {
    label: "Compliance",
    fields: [
      { key: "ce_marking",    label: "CE Marking",                type: "boolean" },
      { key: "mill_cert_url", label: "Mill Certificate",          type: "file" },
      { key: "doc_url",       label: "Declaration of Conformity", type: "file" },
    ],
  },
  carbonFootprint: {
    label: "Carbon Footprint",
    fields: [
      { key: "co2_per_tonne", label: "CO₂ per Tonne (kg)", type: "text" },
      { key: "scope1",        label: "Scope 1 Emissions",  type: "text" },
      { key: "scope2",        label: "Scope 2 Emissions",  type: "text" },
      { key: "scope3",        label: "Scope 3 Emissions",  type: "text" },
      { key: "methodology",   label: "Methodology",        type: "textarea" },
    ],
  },
};

// ──────────────────────────────────────────
//  TOYS
// ──────────────────────────────────────────
export const TOYS_SECTIONS = {
  general: {
    label: "General",
    fields: [
      { key: "toy_category",      label: "Toy Category",      type: "text" },
      { key: "age_range",         label: "Age Range",         type: "text" },
      { key: "manufacturer",      label: "Manufacturer",      type: "text" },
      { key: "country_of_origin", label: "Country of Origin", type: "text" },
      { key: "production_date",   label: "Production Date",   type: "text" },
    ],
  },
  material: {
    label: "Material Composition",
    fields: [
      { key: "primary_material",    label: "Primary Material",    type: "text" },
      { key: "secondary_materials", label: "Secondary Materials", type: "textarea" },
      { key: "chemical_substances", label: "Chemical Substances", type: "textarea" },
      { key: "phthalates_free",     label: "Phthalates Free",     type: "boolean" },
      { key: "bpa_free",            label: "BPA Free",            type: "boolean" },
    ],
  },
  safety: {
    label: "Safety",
    fields: [
      { key: "en71_compliant",      label: "EN71 Compliant",         type: "boolean" },
      { key: "choking_hazard_info", label: "Choking Hazard Info",    type: "textarea" },
      { key: "electrical_safety",   label: "Electrical Safety Info", type: "textarea" },
      { key: "flammability_rating", label: "Flammability Rating",    type: "text" },
      { key: "safety_warnings",     label: "Safety Warnings",        type: "textarea" },
    ],
  },
  compliance: {
    label: "Compliance",
    fields: [
      { key: "ce_marking",      label: "CE Marking",      type: "boolean" },
      { key: "reach_compliant", label: "REACH Compliant", type: "boolean" },
      { key: "doc_url",         label: "Compliance Doc",  type: "file" },
      { key: "test_report_url", label: "Test Report",     type: "file" },
    ],
  },
};

// ──────────────────────────────────────────
//  CONSTRUCTION
// ──────────────────────────────────────────
export const CONSTRUCTION_SECTIONS = {
  general: {
    label: "General",
    fields: [
      { key: "product_category",    label: "Product Category",    type: "text" },
      { key: "intended_use",        label: "Intended Use",        type: "textarea" },
      { key: "manufacturer",        label: "Manufacturer",        type: "text" },
      { key: "country_of_origin",   label: "Country of Origin",   type: "text" },
      { key: "production_date",     label: "Production Date",     type: "text" },
      { key: "design_working_life", label: "Design Working Life", type: "text" },
    ],
  },
  material: {
    label: "Material Composition",
    fields: [
      { key: "material_type",        label: "Material Type",        type: "text" },
      { key: "composition",          label: "Composition",          type: "textarea" },
      { key: "recycled_content_pct", label: "Recycled Content (%)", type: "text" },
      { key: "hazardous_substances", label: "Hazardous Substances", type: "textarea" },
    ],
  },
  performance: {
    label: "Performance",
    fields: [
      { key: "mechanical_strength",  label: "Mechanical Strength",  type: "text" },
      { key: "fire_resistance",      label: "Fire Resistance",      type: "text" },
      { key: "thermal_performance",  label: "Thermal Performance",  type: "text" },
      { key: "acoustic_performance", label: "Acoustic Performance", type: "text" },
      { key: "durability_class",     label: "Durability Class",     type: "text" },
    ],
  },
  compliance: {
    label: "Compliance",
    fields: [
      { key: "ce_marking",     label: "CE Marking",                       type: "boolean" },
      { key: "dop_url",        label: "Declaration of Performance",       type: "file" },
      { key: "test_report_url",label: "Test Report",                      type: "file" },
    ],
  },
  sustainability: {
    label: "Sustainability",
    fields: [
      { key: "carbon_footprint", label: "Carbon Footprint",                        type: "text" },
      { key: "epd_url",          label: "Environmental Product Declaration",        type: "file" },
      { key: "recyclability",    label: "Recyclability Info",                       type: "textarea" },
      { key: "end_of_life",      label: "End of Life Options",                      type: "textarea" },
    ],
  },
};

// ──────────────────────────────────────────
//  MASTER MAP
// ──────────────────────────────────────────
export const PASSPORT_SECTIONS_MAP = {
  battery:      BATTERY_SECTIONS,
  textile:      TEXTILE_SECTIONS,
  steel:        STEEL_SECTIONS,
  toys:         TOYS_SECTIONS,
  construction: CONSTRUCTION_SECTIONS,
};

