# Utility Scripts

Database and utility automation scripts.

## Table of Contents

1. [Scripts Available](#scripts-available)
2. [Usage Examples](#usage-examples)
3. [Environment Setup](#environment-setup)

## Scripts Available

### bulk-update-fetch.js
**Purpose**: Batch update operations  
**Usage**: `node bulk-update-fetch.js`  
**Operations**:
- Bulk data imports
- Batch updates
- Data validation
- Error handling

### fix-admin-role.js
**Purpose**: Admin role management  
**Usage**: `node fix-admin-role.js`  
**Operations**:
- Assign admin role
- Verify permissions
- Fix role inconsistencies
- Reset assignments

## Usage Examples

```bash
# Run bulk update
node bulk-update-fetch.js

# Fix admin roles
node fix-admin-role.js
```

## Environment Setup

These scripts need database access. Ensure:

```bash
# Environment variables set
export DB_HOST="localhost"
export DB_PORT="5432"
export DB_USER="claros_user"
export DB_PASSWORD="claros_password_dev"
export DB_NAME="claros_dpp"

# Or use .env file in project root
```

---

## Related Documentation

- [DEVELOPMENT.md](./DEVELOPMENT.md) - Development guidelines
- [WORKFLOWS.md](./WORKFLOWS.md) - Developer workflows
- [scripts.md](./scripts.md) - Deployment scripts
- [DATABASE.md](../infrastructure/DATABASE.md) - Database setup and management
- [DATABASE_SCHEMA.md](../database/DATABASE_SCHEMA.md) - Database schema reference
- [OCI.md](../deployment/OCI.md) - OCI deployment

---

**[← Back to Scripts](../README.md)**
