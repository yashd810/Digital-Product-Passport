# Data Directory

Data files and datasets for the Claros Digital Product Passport project.

## Table of Contents

1. [Files Overview](#files-overview)
2. [BatteryPass Data Attributes](#batterypass-data-attributes)
3. [Working with Data Files](#working-with-data-files)

---

## Files Overview

| File | Description | Purpose |
|------|-------------|---------|
| `2026_BatteryPass-Ready_DataAttributeLongList_v1.3.xlsx` | BatteryPass data attributes | Reference data for battery passport creation |

## BatteryPass Data Attributes

Excel file containing the comprehensive list of data attributes for battery passport creation according to EU DIN SPEC 99100 standard.

### File Information
- **Version**: 1.3
- **Last Updated**: 2026
- **Status**: Ready for implementation

### Contents
Detailed list of:
- Required data fields
- Optional data fields
- Data types and formats
- Validation rules
- Mapping to database schema

### Usage

**For Developers**:
- Reference when implementing battery passport data schema
- Validate passport data against this specification
- Ensure all required fields are captured

**For Data Teams**:
- Use as basis for data import procedures
- Validate external data sources against this schema
- Document data transformations

### Integration

The data attributes from this file are mapped to:
- Database schema in `/docs/database/DATABASE_SCHEMA.md`
- API endpoints in `/docs/api/ENDPOINTS.md`
- Passport data model in `/apps/backend-api/services/PassportService.js`

## Working with Data Files

### Adding New Datasets
1. Save file in this directory
2. Add entry to this README
3. Document purpose and usage
4. Link from relevant documentation

### Versioning
- Keep all versions for historical reference
- Use version numbers in filenames (e.g., `name_v1.2.xlsx`)
- Document changes between versions

### Security
- Sensitive data should NOT be stored here
- Use `.gitignore` to prevent committing data with secrets
- For production data, use secure backup procedures

---

## Related Documentation

- [din-spec-99100-import-guide.md](./din-spec-99100-import-guide.md) - DIN SPEC 99100 passport data format
- [DATABASE_SCHEMA.md](../database/DATABASE_SCHEMA.md) - Database schema and field mappings
- [API_INDEX.md](../api/API_INDEX.md) - API endpoints for passport creation
- [battery-dictionary.md](../api/battery-dictionary.md) - Battery data attributes
- [DEVELOPMENT.md](../development/DEVELOPMENT.md) - Development practices
- [REFERENCE_INDEX.md](./REFERENCE_INDEX.md) - Reference documentation index

---

**[← Back to Project](../README.md)**
