# Reference Documentation Index

This index provides quick navigation to reference materials for the Claros DPP system, including data specifications, passport schemas, field definitions, and import guides.

---

## Table of Contents

1. [Quick Navigation](#quick-navigation)
2. [Reference Documentation Overview](#reference-documentation-overview)
3. [Document Descriptions](#document-descriptions)
4. [Data Reference Guide](#data-reference-guide)
5. [Passport Schema Reference](#passport-schema-reference)
6. [Getting Started](#getting-started)
7. [Reference Categories](#reference-categories)
8. [Reference Statistics](#reference-statistics)
9. [Related Documentation](#related-documentation)

---

## Quick Navigation

| Topic | File | Focus | Type |
|-------|------|-------|------|
| [Data Files](#data-directory) | data.md | BatteryPass data attributes and datasets | Reference |
| [DIN SPEC Import](#din-spec-99100-v13) | din-spec-99100-import-guide.md | Complete DIN SPEC 99100 passport schema and import format | Guide |

---

## Reference Documentation Overview

The Claros DPP reference documentation provides comprehensive specifications and guides for data structures, passport schemas, and data import procedures.

### Key Reference Areas

1. **Data Reference**
   - BatteryPass data attributes
   - Data file organization
   - Dataset management
   - Versioning and archival

2. **Passport Schemas**
   - DIN SPEC 99100 v1.3 complete specification
   - Field definitions and types
   - Data validation rules
   - Access restrictions

3. **Import Procedures**
   - JSON import format
   - CSV import options
   - API endpoints
   - Validation procedures

4. **Field Reference**
   - 7 main sections of DIN SPEC
   - 50+ field definitions
   - Field types and constraints
   - Dynamic vs static fields

---

## Document Descriptions

### data.md

**Purpose:** Central reference for data files and datasets used in Claros DPP.

**Topics Covered:**
- Files overview (BatteryPass data attributes)
- BatteryPass data attributes documentation
- File information and versioning
- Contents and structure
- Usage guidelines (developers and data teams)
- Integration with schema and APIs
- Working with data files
- Adding new datasets
- Versioning procedures
- Security considerations

**Key Content:**
- BatteryPass Excel file reference (v1.3)
- Integration links to database, API, and services
- Data file management procedures
- Security best practices

**Use Cases:**
- Finding available data files
- Understanding data structure
- Integrating new datasets
- Data validation procedures
- Version management

**Status:** Current reference

---

### din-spec-99100-import-guide.md

**Purpose:** Complete technical reference for DIN SPEC 99100 v1.3 passport schema and data import procedures.

**Topics Covered:**
- DIN SPEC 99100 v1.3 passport type overview
- API import format requirements
- Section 1: Identifiers and Product Data (19+ fields)
- Section 2: Symbols, Labels & Documentation (8+ fields)
- Section 3: Battery Carbon Footprint (7+ fields)
- Section 4: Supply Chain Due Diligence (referenced)
- Section 5: Battery Materials and Composition (simple and table fields)
- Section 6: Circularity and Resource Efficiency (referenced)
- Section 7: Performance and Durability (referenced)
- Field types reference (text, textarea, date, symbol, file, url)
- Dynamic vs static fields classification
- Access restrictions and controlled fields
- Table data handling in CSV vs JSON formats
- Import command examples
- Validation notes and rules

**Field Coverage:** 50+ individual field definitions with:
- Field key (database identifier)
- Field type (text, date, symbol, file, url, etc.)
- Required/optional status
- Example values
- Notes and constraints

**Code Examples:** 10+ JSON and CSV format examples

**Use Cases:**
- Importing passport data programmatically
- Validating passport data
- Understanding DIN SPEC structure
- Field mapping and data integration
- CSV vs JSON decision making
- API integration procedures

**Status:** Current specification

---

## Data Reference Guide

### Available Datasets

| Dataset | File | Format | Version | Purpose |
|---------|------|--------|---------|---------|
| BatteryPass Attributes | 2026_BatteryPass-Ready_DataAttributeLongList_v1.3.xlsx | Excel | 1.3 | Battery passport field definitions |

### Data Integration Points

**Referenced In:**
- [DATABASE_SCHEMA.md](../database/DATABASE_SCHEMA.md) - Field mapping to database tables
- [API_INDEX.md](../api/API_INDEX.md) - Endpoint parameters
- [battery-dictionary.md](../api/battery-dictionary.md) - Field descriptions
- [PassportService.js](../apps/backend-api/services/PassportService.js) - Service implementation

---

## Passport Schema Reference

### DIN SPEC 99100 v1.3

**Passport Type:** `din_spec_v13`  
**Status:** EU Battery Regulation compliant  
**Sections:** 7 main sections  
**Total Fields:** 50+ documented fields

### Schema Sections

| Section | Fields | Type | Required |
|---------|--------|------|----------|
| Identifiers & Product Data | 19 | Product info | Yes |
| Symbols, Labels & Documentation | 8 | Compliance docs | Yes |
| Battery Carbon Footprint | 7 | Environmental | Yes |
| Supply Chain Due Diligence | Multiple | Supply chain | Conditional |
| Battery Materials & Composition | Simple + Table | Materials | Yes |
| Circularity & Resource Efficiency | Multiple | End-of-life | Conditional |
| Performance & Durability | Multiple | Performance | Conditional |

### Field Type Classifications

**Simple Fields:** text, textarea, date, number, url  
**Complex Fields:** symbol (SVG/PNG), file (PDF/DOC), table (array of arrays)  
**Dynamic Fields:** Updated post-creation  
**Static Fields:** Set at creation only  
**Restricted Fields:** Controlled access (economic operator, manufacturer, facility IDs)

---

## Getting Started

### For Data Integration

**Goal:** Understand available data and how to use it

**Steps:**
1. Read [data.md](./data.md) overview section
2. Review BatteryPass data attributes structure
3. Check integration points (Database, API, Services)
4. Plan data import strategy
5. Reference [din-spec-99100-import-guide.md](./din-spec-99100-import-guide.md) for format

**Related:** [DATABASE_SCHEMA.md](../database/DATABASE_SCHEMA.md)

---

### For Passport Data Import

**Goal:** Import DIN SPEC 99100 v1.3 passport data

**Steps:**
1. Read [din-spec-99100-import-guide.md - Overview](./din-spec-99100-import-guide.md#overview)
2. Review API import format requirements
3. Prepare data in JSON format (recommended)
4. Check field validation rules
5. Use import command to submit data
6. Verify with GET endpoint

**Related:** [API_INDEX.md](../api/API_INDEX.md), [LOCAL.md](../deployment/LOCAL.md)

---

### For CSV Data Handling

**Goal:** Handle table/array data in CSV imports

**Steps:**
1. Read [Handling Tables in CSV vs JSON](./din-spec-99100-import-guide.md#handling-tables-in-csv-vs-json)
2. Review 3 CSV format options
3. Choose Option A (multiple columns) or Option C (separate file)
4. Prepare CSV accordingly
5. Use import endpoint with CSV file
6. Validate imported data

**Related:** [din-spec-99100-import-guide.md](./din-spec-99100-import-guide.md)

---

## Reference Categories

### By Use Case

**Data Import:**
- din-spec-99100-import-guide.md (complete guide)
- Import command examples
- CSV vs JSON handling
- Validation procedures

**Data Management:**
- data.md (data files and organization)
- Versioning procedures
- Security considerations
- Integration mapping

**Schema Reference:**
- din-spec-99100-import-guide.md (7 sections, 50+ fields)
- Field types and constraints
- Access restrictions
- Dynamic field definitions

**Validation:**
- Validation notes (must-match rules)
- Date formats
- Field requirements
- Symbol/file types

---

### By Audience

**Developers:**
- API import format requirements
- Field mapping to database
- JSON/CSV format options
- Integration procedures

**Data Teams:**
- Data file organization
- BatteryPass attributes
- Versioning procedures
- Import procedures

**System Administrators:**
- Data file management
- Security controls
- Backup procedures
- Integration mapping

---

## Reference Statistics

| Metric | Value |
|--------|-------|
| Total Reference Files | 2 |
| Files with Table of Contents | 2/2 (100%) |
| Files with Related Documentation | 2/2 (100%) |
| Total Sections | 16+ |
| Total Field Definitions | 50+ |
| Code Examples | 10+ |
| Data Integration Points | 4+ |
| Schema Sections | 7 |
| Field Types | 8+ |
| Access-Restricted Fields | 5+ |
| Dynamic Fields | 8+ |
| Total Documentation Lines | 800+ |
| Cross-References | 20+ |

---

## Related Documentation

### Database & API
- [DATABASE_SCHEMA.md](../database/DATABASE_SCHEMA.md) - Database schema and field mappings
- [API_INDEX.md](../api/API_INDEX.md) - Complete API endpoint reference
- [battery-dictionary.md](../api/battery-dictionary.md) - Battery field definitions

### Backend Services
- [PassportService.js](../apps/backend-api/services/PassportService.js) - Passport data service
- [backend-api.md](../apps/backend-api.md) - Backend API documentation

### Deployment & Development
- [LOCAL.md](../deployment/LOCAL.md) - Local development setup
- [DEVELOPMENT.md](../development/DEVELOPMENT.md) - Development practices
- [WORKFLOWS.md](../development/WORKFLOWS.md) - Development workflows

### Security & Architecture
- [AUTHENTICATION.md](../security/AUTHENTICATION.md) - API authentication
- [ARCHITECTURE.md](../architecture/ARCHITECTURE.md) - System architecture
- [passport-representations.md](../api/passport-representations.md) - Passport data models

---

**[← Back to Docs](../README.md)**
