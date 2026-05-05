# Architecture Documentation Index

Complete reference guide to system architecture, design patterns, and technical organization.

**Last updated:** 2026-05-05

---

## Quick Navigation

### Getting Started

- **New to the project?** Start with [ARCHITECTURE.md](#architecturemd)
- **Setting up locally?** See [PROJECT_STRUCTURE.md](#project_structuremd)
- **Understanding services?** Check [SERVICES.md](#servicesmd)
- **Building a feature?** Review [DATA_FLOW.md](#data_flowmd)
- **Deploying to production?** See [deployment/](../deployment/)

---

## Core Architecture Documents

### ARCHITECTURE.md

**Purpose:** High-level system runtime architecture and service overview

**What you'll find:**
- System architecture diagram
- Runtime services and their roles
- Frontend bootstrap and authentication flow
- Data ownership model
- Component interaction overview

**Best for:**
- Understanding system layout at a glance
- Onboarding new developers
- Architecture decision-making
- System design discussions

**Related:**
- [DATA_FLOW.md](#data_flowmd) - How data moves through system
- [SERVICES.md](#servicesmd) - Service-to-port mapping
- [PROJECT_STRUCTURE.md](#project_structuremd) - File organization

---

### DATA_FLOW.md

**Purpose:** Request/response data movement through the system

**What you'll find:**
- Core request path (browser → API → database)
- Authentication flow (login → JWT → headers)
- Passport creation workflow
- Component communication patterns
- Data serialization and transformation

**Best for:**
- Debugging request issues
- Understanding authentication
- Tracing data through system
- Learning workflow patterns
- Implementing new features

**Related:**
- [ARCHITECTURE.md](#architecturemd) - System overview
- [DID and Passport Model](#did-and-passport-model) - Passport structure
- [../api/ENDPOINTS.md](../api/ENDPOINTS.md) - Available endpoints

---

### PROJECT_STRUCTURE.md

**Purpose:** Repository folder organization and application structure

**What you'll find:**
- Root directory layout
- Application folder purposes (backend-api, frontend-app, etc.)
- Documentation layout
- Runtime containers and ports
- Change location guide (where to make specific changes)

**Best for:**
- Finding where to make code changes
- Understanding repository structure
- Navigating codebase
- Onboarding developers
- Setting up local environment

**Related:**
- [SERVICES.md](#servicesmd) - Service mapping
- [ARCHITECTURE.md](#architecturemd) - System overview
- [../deployment/](../deployment/) - Deployment structure

---

### SERVICES.md

**Purpose:** Service-to-port mapping and inter-service dependencies

**What you'll find:**
- Local container definitions
- Backend route module responsibilities
- Backend service purposes
- Frontend route ownership
- Public URL families
- Service dependencies (visual diagrams)
- Inter-service communication patterns

**Best for:**
- Understanding service responsibilities
- Finding which service handles a feature
- Debugging service integration issues
- Planning new services
- Understanding API structure

**Related:**
- [PROJECT_STRUCTURE.md](#project_structuremd) - File locations
- [ARCHITECTURE.md](#architecturemd) - System overview
- [../api/ENDPOINTS.md](../api/ENDPOINTS.md) - Endpoint reference

---

## Specialized Architecture

### DID and Passport Model

**Purpose:** Decentralized identifier structure and passport data model

**What you'll find:**
- DID structure explanation (company, product, passport DIDs)
- DID resolution flow and endpoints
- Passport structure and versioning
- Signature and cryptography model (RS256, ES256, JCS)
- Public URL mapping and QR codes
- Implementation details and code locations
- Complete resolution flow example

**Best for:**
- Understanding identifier system
- Implementing DID-related features
- Passport signature verification
- Public URL handling
- Blockchain/distributed systems knowledge needed

**Related:**
- [../api/did-resolution.md](../api/did-resolution.md) - API endpoint reference
- [../api/data-carrier-authenticity.md](../api/data-carrier-authenticity.md) - Signature details
- [current-state-audit.md](#current-state-audit) - Configuration details

---

### Battery Dictionary Design

**Purpose:** Battery semantic model and dictionary data management

**What you'll find:**
- Dictionary generation process
- JSON artifacts (manifest, terms, categories, units, field-map)
- Governance and authority model
- Versioning and traceability
- API endpoints for dictionary data
- Configuration and generation commands

**Best for:**
- Understanding battery product domain
- Building dictionary management features
- Semantic validation implementation
- Product category modeling
- Data standardization

**Related:**
- [../api/battery-dictionary.md](../api/battery-dictionary.md) - API endpoints
- [OAIS Archive Mapping](#oais-archive-mapping) - Archive model
- [current-state-audit.md](#current-state-audit) - Configuration

---

### OAIS Archive Mapping

**Purpose:** OAIS (Open Archival Information System) standard mapping and compliance

**What you'll find:**
- OAIS standard overview
- Information object mapping
- Producer/repository/consumer roles
- Archival functions (ingest, preservation, access)
- Passport content archival model
- Metadata and preservation planning
- Digital preservation strategy
- Compliance checklist

**Best for:**
- Understanding archive requirements
- Long-term data preservation planning
- Compliance with digital preservation standards
- Backup and recovery strategies
- Regulatory compliance
- Supply chain data retention

**Related:**
- [../security/backup-continuity-policy.md](../security/backup-continuity-policy.md) - Backup strategy
- [current-state-audit.md](#current-state-audit) - System state
- [../api/passport-type-storage-model.md](../api/passport-type-storage-model.md) - Database schema

---

### Current State Audit

**Purpose:** System state, deployment status, configuration checklist

**What you'll find:**
- System overview with statistics
- Core architecture and technology stack
- Local and production deployment status
- Required environment variables
- Database schema status (47 tables)
- API coverage summary (183+ endpoints)
- Frontend application status
- Security status assessment
- Performance baseline metrics
- Known limitations
- Migration and upgrade notes

**Best for:**
- Understanding current system state
- Deployment configuration
- Security assessment
- Performance expectations
- Upgrade planning
- Configuration checklist

**Related:**
- [PROJECT_STRUCTURE.md](#project_structuremd) - File structure
- [SERVICES.md](#servicesmd) - Service mapping
- [../deployment/](../deployment/) - Deployment guides
- [../security/](../security/) - Security documentation

---

## API and Data Reference

These documents live in [../api/](../api/) but are closely related to architecture:

### Key API Documents

- **[../api/ENDPOINTS.md](../api/ENDPOINTS.md)** - Complete endpoint reference (183+ endpoints, 6,199 lines)
- **[../api/passport-type-storage-model.md](../api/passport-type-storage-model.md)** - Database schema (47 tables)
- **[../api/did-resolution.md](../api/did-resolution.md)** - DID endpoint specification
- **[../api/data-carrier-authenticity.md](../api/data-carrier-authenticity.md)** - Signature models
- **[../api/access-grants.md](../api/access-grants.md)** - Permission system

### Frontend Architecture

For frontend-specific documentation, see:
- `apps/frontend-app/src/README.md` (if exists)
- Component structure in `apps/frontend-app/src/`

---

## Deployment and Infrastructure

These documents live in [../deployment/](../deployment/):

- **[../deployment/production-domain-and-did-setup.md](../deployment/production-domain-and-did-setup.md)** - Domain and DID configuration
- **[../deployment/oci-free-tier-edge.md](../deployment/oci-free-tier-edge.md)** - OCI deployment

See [deployment](../deployment/) folder for complete deployment documentation.

---

## Security and Compliance

These documents live in [../security/](../security/):

- **[../security/access-revocation-process.md](../security/access-revocation-process.md)** - Access control model
- **[../security/backup-continuity-policy.md](../security/backup-continuity-policy.md)** - Backup strategy
- **[../security/audit-logging-and-anchoring.md](../security/audit-logging-and-anchoring.md)** - Audit trail

See [security](../security/) folder for complete security documentation.

---

## How to Use This Index

### By Task

#### "I want to understand the system"
1. Start: [ARCHITECTURE.md](#architecturemd)
2. Then: [DATA_FLOW.md](#data_flowmd)
3. Deep dive: [DID and Passport Model](#did-and-passport-model)

#### "I need to add a new API endpoint"
1. Start: [SERVICES.md](#servicesmd) (find related route)
2. Then: [../api/ENDPOINTS.md](../api/ENDPOINTS.md) (see similar endpoints)
3. Reference: [DATA_FLOW.md](#data_flowmd) (understand data flow)
4. Code: [PROJECT_STRUCTURE.md](#project_structuremd) (locate files)

#### "I'm setting up the project"
1. Start: [PROJECT_STRUCTURE.md](#project_structuremd)
2. Services: [SERVICES.md](#servicesmd)
3. Deploy: [../deployment/](../deployment/) (if production)
4. Config: [current-state-audit.md](#current-state-audit) (environment variables)

#### "I need to debug something"
1. Start: [DATA_FLOW.md](#data_flowmd)
2. Find service: [SERVICES.md](#servicesmd)
3. Check endpoint: [../api/ENDPOINTS.md](../api/ENDPOINTS.md)
4. Verify config: [current-state-audit.md](#current-state-audit)

#### "I'm implementing passport signing"
1. Model: [DID and Passport Model](#did-and-passport-model)
2. Signatures: [../api/data-carrier-authenticity.md](../api/data-carrier-authenticity.md)
3. Storage: [../api/passport-type-storage-model.md](../api/passport-type-storage-model.md)

#### "I'm deploying to production"
1. Setup: [../deployment/production-domain-and-did-setup.md](../deployment/production-domain-and-did-setup.md)
2. Config: [current-state-audit.md](#current-state-audit)
3. DIDs: [DID and Passport Model](#did-and-passport-model)
4. Backup: [../security/backup-continuity-policy.md](../security/backup-continuity-policy.md)

---

## Document Statistics

| Document | Lines | Purpose |
| --- | --- | --- |
| ARCHITECTURE.md | 96 | System overview |
| DATA_FLOW.md | 113 | Request/response flows |
| PROJECT_STRUCTURE.md | 158 | Repository organization |
| SERVICES.md | 180+ | Service mapping |
| battery-dictionary-design.md | 48 | Dictionary model |
| current-state-audit.md | 380+ | System state audit |
| did-and-passport-model.md | 400+ | DID/passport model |
| oais-archive-mapping.md | 204 | Archive standard mapping |
| **Total** | **1,579+** | **Complete architecture** |

---

## Related Documentation

- [Root Documentation Index](../README.md) - All documentation
- [API Endpoints](../api/ENDPOINTS.md) - All endpoints (183+)
- [Deployment](../deployment/) - Deployment guides
- [Security](../security/) - Security and compliance
- [Administration](../admin/) - Admin configuration

---

## Key Statistics

### System Size

- **183+ API Endpoints** across 14 route files
- **47 Database Tables** in PostgreSQL
- **3 React Applications** (dashboard, viewer, marketing)
- **14 Backend Services** with specialized responsibilities

### Documentation Coverage

- **Architecture**: 1,579+ lines across 8 files
- **API**: 6,199+ lines across 14 files
- **Total**: 7,778+ lines of comprehensive documentation

### Code Organization

- **Backend API**: 14 route modules, 12+ services
- **Frontend**: 8+ major sections, 50+ pages
- **Configuration**: 20+ environment variables
- **Database**: 47 tables with full schema documentation

---

## Quick Links to Code

| Component | Location |
| --- | --- |
| Backend API | `apps/backend-api/` |
| Frontend Dashboard | `apps/frontend-app/` |
| Public Viewer | `apps/public-passport-viewer/` |
| Route Modules | `apps/backend-api/routes/` |
| Services | `apps/backend-api/services/` |
| Database | `apps/backend-api/db/init.js` |
| Tests | `apps/backend-api/tests/`, `apps/frontend-app/src/test/` |
| Docker | `docker/docker-compose.yml` |
| Infrastructure | `infra/` |

---

**For more information, see the individual documents listed above or the [root documentation index](../README.md).**
