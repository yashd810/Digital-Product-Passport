# Development Documentation Index

This index provides quick navigation and comprehensive reference for all Claros DPP development documentation, including coding guidelines, developer workflows, and automation scripts.

---

## Table of Contents

1. [Quick Navigation by Topic](#quick-navigation-by-topic)
2. [Development Areas Overview](#development-areas-overview)
3. [Document Descriptions](#document-descriptions)
4. [Getting Started Scenarios](#getting-started-scenarios)
5. [Task-Based Guides](#task-based-guides)
6. [Development Patterns](#development-patterns)
7. [Development Statistics](#development-statistics)
8. [Related Documentation](#related-documentation)

---

## Quick Navigation by Topic

| Topic | File | Purpose | Complexity |
|-------|------|---------|-----------|
| [Coding Conventions](#development-guidelines) | DEVELOPMENT.md | Guidelines and best practices | Low |
| [Workflow Examples](#developer-workflows) | WORKFLOWS.md | Feature-specific change paths | Medium |
| [Scripts Reference](#scripts-directory) | scripts.md | Deployment and utility scripts | Low |
| [Database Automation](#utility-scripts) | utility-scripts.md | Database operations | Low |

---

## Development Areas Overview

### Development Guidelines

**What is included?**
Comprehensive coding conventions, architectural principles, and best practices for the Claros DPP system.

**Key Topics:**
- Project structure and conventions
- Frontend development patterns (React, React Router, Vite)
- Backend development patterns (Express, services, middleware)
- Database schema management
- API contract enforcement
- Testing requirements and commands

**File:** [DEVELOPMENT.md](DEVELOPMENT.md)

---

### Developer Workflows

**What is included?**
Step-by-step guides for common development tasks, from adding dashboard pages to implementing authentication changes.

**Key Workflows:**
- Local development setup
- Adding dashboard pages
- Adding backend endpoints
- Modifying passport type fields
- Passport lifecycle changes
- Public viewer modifications
- Authentication and access control changes
- Storage and repository modifications
- DID, signing, and data carrier implementation
- Documentation updates

**File:** [WORKFLOWS.md](WORKFLOWS.md)

---

### Scripts Directory

**What is included?**
Reference for all deployment and utility automation scripts, organized by purpose with usage examples.

**Script Categories:**
- Deployment automation (OCI, manual steps, cookie fixes)
- Utility operations (bulk updates, admin role management)
- Quick reference commands for common tasks
- Health checks and service verification

**File:** [scripts.md](scripts.md)

---

### Utility Scripts

**What is included?**
Database and utility automation scripts for bulk operations and administrative tasks.

**Available Scripts:**
- bulk-update-fetch.js - Batch database operations
- fix-admin-role.js - Admin role management

**File:** [utility-scripts.md](utility-scripts.md)

---

## Document Descriptions

### DEVELOPMENT.md

**Purpose:** Comprehensive guide to development conventions and best practices for the Claros DPP system.

**Topics Covered:**
- Project principles and architecture
- Frontend conventions and patterns (React, routing, state management)
- Backend conventions and patterns (Express routes, services, middleware)
- Database schema changes and migrations
- API contract management
- Testing requirements and procedures
- Workflow detail references

**Use Cases:**
- Understanding project conventions before coding
- Reviewing best practices for specific areas
- Planning architectural changes
- Writing tests for new features
- Making database schema changes

**Cross-References:** 6 links to workflows, scripts, architecture, API, and database documentation

---

### WORKFLOWS.md

**Purpose:** Step-by-step guides for implementing common features and workflows in the Claros DPP system.

**Topics Covered:**
- Local development environment setup
- Dashboard page implementation
- Backend endpoint creation
- Passport type field modifications
- Complete passport lifecycle (create, edit, review, release, archive)
- Public viewer customization
- Authentication and access control changes
- Storage and repository modifications
- DID and digital signing implementation
- Documentation requirements

**Use Cases:**
- Adding new dashboard features
- Creating new API endpoints
- Modifying passport workflow behavior
- Implementing authentication changes
- Understanding data flow for specific features
- Planning significant architectural changes

**Cross-References:** 6 links to guidelines, scripts, security, architecture, and API documentation

---

### scripts.md

**Purpose:** Reference guide for all deployment, utility, and automation scripts used in the Claros DPP system.

**Topics Covered:**
- Script directory structure
- Deployment automation scripts (deploy-to-oci.sh, deploy-oci.sh, deploy-manual.sh, CRITICAL_COOKIE_FIX.sh)
- Utility scripts (bulk-update-fetch.js, fix-admin-role.js)
- Configuration and setup
- Quick reference commands
- Health check commands
- Service verification procedures

**Use Cases:**
- Deploying to OCI production
- Running bulk database operations
- Fixing admin role assignments
- Checking service health
- Troubleshooting deployment issues
- Understanding script automation

**Cross-References:** 6 links to guidelines, workflows, utilities, deployment, and infrastructure documentation

---

### utility-scripts.md

**Purpose:** Reference for database and automation scripts that support common administrative and operational tasks.

**Topics Covered:**
- Bulk update operations
- Admin role management
- Database access configuration
- Environment variable setup
- Error handling and rollback procedures
- Usage examples and best practices

**Use Cases:**
- Running bulk database updates
- Managing admin user roles
- Configuring database connections
- Automating repetitive tasks
- Troubleshooting operational issues
- Setting up development environments

**Cross-References:** 6 links to guidelines, workflows, scripts, database, and infrastructure documentation

---

## Getting Started Scenarios

### Scenario 1: Set Up Local Development

**Goal:** Get the complete development stack running locally

**Steps:**
1. Read [DEVELOPMENT.md - Frontend](DEVELOPMENT.md#frontend) and [Backend](DEVELOPMENT.md#backend) sections
2. Follow [WORKFLOWS.md - Local Development](WORKFLOWS.md#local-development) setup
3. Start containers: `docker compose -f docker/docker-compose.yml up -d`
4. Test frontend: `cd apps/frontend-app && npm run start`
5. Test backend: `cd apps/backend-api && npm run start`

**Related:** [LOCAL.md](../deployment/LOCAL.md), [DOCKER.md](../infrastructure/DOCKER.md)

---

### Scenario 2: Add a New Dashboard Page

**Goal:** Implement a new page in the admin or user dashboard

**Steps:**
1. Read [WORKFLOWS.md - Add Or Change A Dashboard Page](WORKFLOWS.md#add-or-change-a-dashboard-page)
2. Create page component under appropriate feature folder
3. Register route in App.js
4. Add protected layout wrapper
5. Implement API calls using shared helpers
6. Write tests with Jest/React Testing Library
7. Update documentation in docs/api/ if new endpoints needed

**Related:** [DEVELOPMENT.md - Frontend](DEVELOPMENT.md#frontend), [ENDPOINTS.md](../api/ENDPOINTS.md)

---

### Scenario 3: Add a New Backend Endpoint

**Goal:** Create a new API endpoint for a feature

**Steps:**
1. Read [WORKFLOWS.md - Add Or Change A Backend Endpoint](WORKFLOWS.md#add-or-change-a-backend-endpoint)
2. Pick appropriate route file in routes/ by feature
3. Reuse shared middleware and authentication
4. Implement business logic in services/ if complex
5. Add database schema changes to db/init.js (idempotent)
6. Write Jest/Supertest tests for auth, permissions, and behavior
7. Document endpoint in ENDPOINTS.md
8. Update frontend to call new endpoint

**Related:** [DEVELOPMENT.md - Backend](DEVELOPMENT.md#backend), [DEVELOPMENT.md - Testing](DEVELOPMENT.md#testing)

---

### Scenario 4: Modify Passport Type Fields

**Goal:** Add or change fields in the passport data model

**Steps:**
1. Read [WORKFLOWS.md - Add Or Change Passport Type Fields](WORKFLOWS.md#add-or-change-passport-type-fields)
2. Update admin UI in `src/admin/passport-types/`
3. Update user create/edit logic in `src/passports/`
4. Update server normalization in `helpers/passport-helpers.js`
5. Update storage model in `db/init.js` with idempotent ALTER TABLE
6. Update documentation in passport-type-storage-model.md
7. Test import/export if field is in CSV/JSON/dictionary

**Related:** [WORKFLOWS.md - Passport Lifecycle](WORKFLOWS.md#passport-lifecycle), [passport-type-storage-model.md](../api/passport-type-storage-model.md)

---

### Scenario 5: Deploy to Production

**Goal:** Deploy updated code to OCI production

**Steps:**
1. Read [scripts.md - Deployment Scripts](scripts.md#deployment-scripts-scriptsdeploy)
2. Test locally with full docker-compose stack
3. Commit and push changes to GitHub
4. Set environment: `export OCI_IP="79.72.16.68"`
5. Run: `bash scripts/deploy/deploy-to-oci.sh`
6. Verify: Run health check commands from [scripts.md](scripts.md#quick-reference)
7. Check logs if issues occur

**Related:** [OCI.md](../deployment/OCI.md), [DISTRIBUTED_DEPLOYMENT_GUIDE.md](../deployment/DISTRIBUTED_DEPLOYMENT_GUIDE.md)

---

### Scenario 6: Fix Database Issues

**Goal:** Run database utilities to fix data or role issues

**Steps:**
1. Read [utility-scripts.md - Scripts Available](utility-scripts.md#scripts-available)
2. Set environment variables or create .env file
3. Run fix-admin-role.js: `node scripts/utils/fix-admin-role.js`
4. Or run bulk update: `node scripts/utils/bulk-update-fetch.js`
5. Monitor output for errors
6. Verify changes took effect

**Related:** [DATABASE.md](../infrastructure/DATABASE.md), [DATABASE_SCHEMA.md](../database/DATABASE_SCHEMA.md)

---

## Task-Based Guides

### Task 1: Understand Project Architecture

**Files:** [DEVELOPMENT.md - Principles](DEVELOPMENT.md#principles), [DEVELOPMENT.md - Frontend](DEVELOPMENT.md#frontend)
**Time:** 15-30 minutes
**Goal:** Understand project structure and conventions

---

### Task 2: Set Up Local Development

**Files:** [WORKFLOWS.md - Local Development](WORKFLOWS.md#local-development), [DEVELOPMENT.md - Backend](DEVELOPMENT.md#backend)
**Time:** 20-40 minutes
**Goal:** Get development stack running

---

### Task 3: Write and Test Code

**Files:** [DEVELOPMENT.md - Testing](DEVELOPMENT.md#testing), [WORKFLOWS.md](WORKFLOWS.md)
**Time:** Varies by feature
**Goal:** Implement feature with proper test coverage

---

### Task 4: Update API Documentation

**Files:** [WORKFLOWS.md - Documentation Updates](WORKFLOWS.md#documentation-updates), [ENDPOINTS.md](../api/ENDPOINTS.md)
**Time:** 10-20 minutes
**Goal:** Document new or changed endpoints

---

### Task 5: Deploy Changes

**Files:** [scripts.md - Deployment Scripts](scripts.md#deployment-scripts-scriptsdeploy), [OCI.md](../deployment/OCI.md)
**Time:** 10-30 minutes
**Goal:** Get code to production

---

### Task 6: Fix Admin Roles

**Files:** [utility-scripts.md - fix-admin-role.js](utility-scripts.md#fix-admin-rolejs), [DATABASE.md](../infrastructure/DATABASE.md)
**Time:** 5-10 minutes
**Goal:** Assign or fix admin permissions

---

### Task 7: Perform Bulk Updates

**Files:** [utility-scripts.md - bulk-update-fetch.js](utility-scripts.md#bulk-update-fetchjs)
**Time:** 10-20 minutes
**Goal:** Run batch database operations

---

### Task 8: Check Deployment Health

**Files:** [scripts.md - Quick Reference](scripts.md#quick-reference), [OCI.md](../deployment/OCI.md)
**Time:** 5 minutes
**Goal:** Verify services are running

---

## Development Patterns

### Frontend Patterns

- **Route Protection:** Use RouteGuards.js for authentication-based routing
- **State Management:** useSessionAuth hook for user context
- **API Calls:** Shared helpers in src/shared/api/
- **Component Organization:** Feature-based folder structure
- **Feature Isolation:** Keep feature logic in own folder until reusable

### Backend Patterns

- **Route Organization:** Feature-based files in routes/ folder
- **Middleware Reuse:** Always use shared middleware from Server/server.js
- **Business Logic:** Move to services/ when complex or reused
- **Database Access:** Parameterized SQL with pg module
- **Schema Management:** Idempotent changes in db/init.js

### Passport Patterns

- **Data Model:** Type-flexible JSON structure with validation
- **Lifecycle States:** Create → Edit → Review → Release → Archive
- **Normalization:** Server-side normalization in passport-helpers.js
- **Representation:** Multiple forms (storage, public, API)

### Testing Patterns

- **Backend:** Jest with Supertest for HTTP testing
- **Frontend:** React Testing Library for component testing
- **a11y:** axe accessibility checks
- **Coverage:** Test auth, permissions, and main workflows

---

## Development Statistics

| Metric | Value |
|--------|-------|
| Total Development Files | 4 |
| Total Lines of Documentation | 700+ |
| Files with Table of Contents | 4/4 (100%) |
| Files with Related Documentation | 4/4 (100%) |
| Total Cross-References | 24 |
| Getting Started Scenarios | 6 |
| Task-Based Guides | 8 |
| Development Patterns Documented | 4 categories |

---

## Related Documentation

### Architecture
- [ARCHITECTURE.md](../architecture/ARCHITECTURE.md) - System runtime architecture
- [SERVICES.md](../architecture/SERVICES.md) - Service dependencies and port mapping
- [PROJECT_STRUCTURE.md](../architecture/PROJECT_STRUCTURE.md) - Repository organization

### API
- [ENDPOINTS.md](../api/ENDPOINTS.md) - Complete API endpoint reference
- [passport-type-storage-model.md](../api/passport-type-storage-model.md) - Data model specification

### Database
- [DATABASE.md](../infrastructure/DATABASE.md) - PostgreSQL setup and management
- [DATABASE_SCHEMA.md](../database/DATABASE_SCHEMA.md) - Full schema reference

### Deployment
- [LOCAL.md](../deployment/LOCAL.md) - Local development setup
- [OCI.md](../deployment/OCI.md) - Production deployment
- [DISTRIBUTED_DEPLOYMENT_GUIDE.md](../deployment/DISTRIBUTED_DEPLOYMENT_GUIDE.md) - Multi-server setup

### Infrastructure
- [DOCKER.md](../infrastructure/DOCKER.md) - Docker containerization
- [docker-compose-files.md](../infrastructure/docker-compose-files.md) - Docker Compose reference

### Security
- [AUTHENTICATION.md](../security/AUTHENTICATION.md) - JWT and RBAC authentication
- [signing-and-verification.md](../security/signing-and-verification.md) - Digital signatures

---

**[← Back to Docs](../README.md)**
