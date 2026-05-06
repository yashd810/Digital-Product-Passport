# Deployment Documentation Index

Master navigation guide for the complete Claros DPP deployment documentation system.

---

## Table of Contents

1. [Quick Navigation](#quick-navigation)
2. [Deployment Overview](#deployment-overview)
3. [Document Descriptions](#document-descriptions)
4. [Getting Started Scenarios](#getting-started-scenarios)
5. [Deployment Decision Tree](#deployment-decision-tree)
6. [Task-Based Usage Guide](#task-based-usage-guide)
7. [Deployment Statistics](#deployment-statistics)
8. [Related Documentation](#related-documentation)

---

## Quick Navigation

### By Deployment Target

| Target | Primary Document | Setup Time | Complexity | Use Case |
|--------|-----------------|-----------|-----------|----------|
| **Local Development** | [LOCAL.md](LOCAL.md) | 15 min | Low | Development, testing, debugging |
| **OCI Single Server** | [OCI.md](OCI.md) | 30-45 min | Medium | Production, single-instance setup |
| **OCI Distributed (2 servers)** | [DISTRIBUTED_DEPLOYMENT_GUIDE.md](DISTRIBUTED_DEPLOYMENT_GUIDE.md) | 45-60 min | High | Production, high availability |
| **Free Tier Setup** | [oracle-cloud-free-tier.md](oracle-cloud-free-tier.md) | 20-30 min | Low | Cost-effective production |
| **Free Tier Edge** | [oci-free-tier-edge.md](oci-free-tier-edge.md) | 25-35 min | Medium | Free tier with load balancing |
| **Domain & DID Config** | [production-domain-and-did-setup.md](production-domain-and-did-setup.md) | 20 min | Medium | Domain setup for any production |
| **Scripts & Automation** | [deploy-scripts.md](deploy-scripts.md) | Varies | Low | Automated deployments |
| **Authentication Fixes** | [DEPLOYMENT_INSTRUCTIONS.md](DEPLOYMENT_INSTRUCTIONS.md) | 10 min | Low | Fixing auth issues post-deploy |

### By Task

| Task | Primary Document | Secondary References |
|------|-----------------|----------------------|
| **Set up local environment** | [LOCAL.md](LOCAL.md) | - |
| **Deploy to production** | [OCI.md](OCI.md) | [production-domain-and-did-setup.md](production-domain-and-did-setup.md) |
| **Configure distributed setup** | [DISTRIBUTED_DEPLOYMENT_GUIDE.md](DISTRIBUTED_DEPLOYMENT_GUIDE.md) | [OCI.md](OCI.md), [DEPLOYMENT_INSTRUCTIONS.md](DEPLOYMENT_INSTRUCTIONS.md) |
| **Use free tier** | [oracle-cloud-free-tier.md](oracle-cloud-free-tier.md) | [oci-free-tier-edge.md](oci-free-tier-edge.md) |
| **Configure domain and DID** | [production-domain-and-did-setup.md](production-domain-and-did-setup.md) | [OCI.md](OCI.md), [oci-free-tier-edge.md](oci-free-tier-edge.md) |
| **Use automated deployment scripts** | [deploy-scripts.md](deploy-scripts.md) | [OCI.md](OCI.md), [DISTRIBUTED_DEPLOYMENT_GUIDE.md](DISTRIBUTED_DEPLOYMENT_GUIDE.md) |
| **Fix authentication errors** | [DEPLOYMENT_INSTRUCTIONS.md](DEPLOYMENT_INSTRUCTIONS.md) | [DISTRIBUTED_DEPLOYMENT_GUIDE.md](DISTRIBUTED_DEPLOYMENT_GUIDE.md) |
| **Troubleshoot deployment** | [OCI.md](OCI.md) - Troubleshooting | [LOCAL.md](LOCAL.md) - Troubleshooting |

---

## Deployment Overview

The Claros DPP deployment documentation system comprises **8 comprehensive guides** covering local development, OCI production deployment, distributed infrastructure, and automated scripts. These documents are organized by deployment target and complexity level.

### Deployment Targets

**1. Local Development**
- Target: Developer machine (macOS, Linux, Windows+WSL2)
- Document: [LOCAL.md](LOCAL.md)
- Time: 15 minutes
- Purpose: Development, testing, debugging locally

**2. OCI Production (Single Server)**
- Target: Single Ubuntu VM on Oracle Cloud
- Document: [OCI.md](OCI.md)
- Time: 30-45 minutes
- Purpose: Production deployment with consolidated services

**3. OCI Production (Distributed - 2 Servers)**
- Target: Frontend server + Backend/Database server
- Document: [DISTRIBUTED_DEPLOYMENT_GUIDE.md](DISTRIBUTED_DEPLOYMENT_GUIDE.md)
- Time: 45-60 minutes
- Purpose: Production with separation of concerns, high availability

**4. OCI Free Tier (Minimal)**
- Target: Always-Free OCI instance
- Document: [oracle-cloud-free-tier.md](oracle-cloud-free-tier.md)
- Time: 20-30 minutes
- Purpose: Cost-effective production setup

**5. OCI Free Tier (with Edge)**
- Target: Always-Free + OCI Load Balancer
- Document: [oci-free-tier-edge.md](oci-free-tier-edge.md)
- Time: 25-35 minutes
- Purpose: Free tier with managed load balancing and TLS termination

### Infrastructure Patterns

**Pattern 1: Local Docker Compose**
- All services in single docker-compose.yml
- Single network
- PostgreSQL in container
- No external reverse proxy
- Used in: LOCAL.md

**Pattern 2: Centralized Production**
- All services on single OCI instance
- Docker Compose with docker-compose.prod.yml
- Caddy reverse proxy on same instance
- Used in: OCI.md

**Pattern 3: Distributed Production**
- Frontend server: frontend-app, public-viewer, asset-management, marketing-site
- Backend server: backend-api, PostgreSQL, object storage
- Separate Caddy reverse proxies on each
- Used in: DISTRIBUTED_DEPLOYMENT_GUIDE.md

**Pattern 4: Edge Pattern (Free Tier)**
- OCI Network Load Balancer terminates TLS
- Caddy handles domain routing
- Single or dual server backends
- Used in: oci-free-tier-edge.md

---

## Document Descriptions

### [LOCAL.md](LOCAL.md)

**Purpose**: Complete guide for local development deployment using Docker Compose.

**Key Sections**:
- Prerequisites (Docker, Git, Node.js)
- Quick start in 5 minutes
- Services configuration (backend, frontend, database, storage)
- Docker Compose commands (up, down, logs, exec)
- Development workflow
- Common tasks (database reset, running tests, debugging)
- Environment variables
- Troubleshooting
- Performance optimization tips
- IDE setup (VS Code)
- Best practices
- Next steps to production

**Use When**:
- Setting up local development environment
- Testing features before production deployment
- Debugging application issues
- Learning system architecture

**Time to Deploy**: 15 minutes  
**Difficulty**: Low  
**Infrastructure**: Local machine with Docker

---

### [OCI.md](OCI.md)

**Purpose**: Complete guide for deploying Claros DPP to Oracle Cloud Infrastructure (single server).

**Key Sections**:
- Overview and architecture
- OCI instance prerequisites
- Installation steps (bootstrap, Docker setup, deployment)
- Post-deployment configuration
- Deployment commands (deploy, redeploy, logs)
- Troubleshooting (common issues, debug procedures)
- Maintenance (backups, upgrades, monitoring)
- Security checklist
- Disaster recovery procedures
- Performance optimization
- Cost optimization
- Support and next steps

**Use When**:
- Deploying to production on OCI
- Running all services on single instance
- Need comprehensive deployment guide
- Require troubleshooting help

**Time to Deploy**: 30-45 minutes  
**Difficulty**: Medium  
**Infrastructure**: OCI Ubuntu 24.04 LTS VM

---

### [DISTRIBUTED_DEPLOYMENT_GUIDE.md](DISTRIBUTED_DEPLOYMENT_GUIDE.md)

**Purpose**: Guide for deploying across two OCI servers (frontend + backend separation).

**Key Sections**:
- Architecture diagram (two-server layout)
- Deployment configuration (compose files per server)
- The 502 error problem (what went wrong)
- Solution implemented (fixes applied)
- Verification procedures
- Current status (verified and operational)
- Troubleshooting (debugging distributed issues)
- Deployment checklist
- Key learnings from troubleshooting
- File structure and naming conventions

**Use When**:
- Deploying to production with two separate servers
- Need frontend/backend separation
- Troubleshooting 502 Bad Gateway errors
- Understanding distributed deployment architecture
- Looking for deployment lessons learned

**Time to Deploy**: 45-60 minutes  
**Difficulty**: High  
**Infrastructure**: OCI (2 servers: 79.72.16.68 frontend, 82.70.54.173 backend)

---

### [oracle-cloud-free-tier.md](oracle-cloud-free-tier.md)

**Purpose**: Minimal guide for deploying to Oracle Cloud Always-Free tier.

**Key Topics**:
- What's included (bootstrap scripts, deployment helpers)
- Recommended OCI setup (Ampere A1 instance)
- Object Storage configuration
- Minimal deployment flow (5 steps)
- Two-host OCI split (frontend/backend)
- Secret handling best practices
- HTTP/2 and TLS requirements
- Post-deploy verification
- Implementation notes

**Use When**:
- Deploying on free OCI tier
- Want cost-effective production setup
- Using Always-Free Ampere instances
- Need Object Storage integration

**Time to Deploy**: 20-30 minutes  
**Difficulty**: Low  
**Infrastructure**: OCI Always-Free Ampere A1 instance

---

### [oci-free-tier-edge.md](oci-free-tier-edge.md)

**Purpose**: Guide for using OCI free-tier networking resources (Load Balancer) for TLS termination.

**Key Topics**:
- Free-tier availability (resources available in free tier)
- Recommended mode (Network Load Balancer passthrough)
- Alternative modes (Flexible Load Balancer, custom TLS)
- Health-check targets
- Suggested OCI layouts
- Repo changes already in place
- Practical recommendations
- Evidence and limits documentation

**Use When**:
- Using OCI free-tier load balancing
- Need managed TLS termination
- Want edge configuration on free tier
- Exploring alternative networking patterns

**Time to Deploy**: 25-35 minutes  
**Difficulty**: Medium  
**Infrastructure**: OCI (VM + Network Load Balancer)

---

### [production-domain-and-did-setup.md](production-domain-and-did-setup.md)

**Purpose**: Configuration guide for production domains and Decentralized Identifier (DID) setup.

**Key Topics**:
- DID Web domain configuration
- Application URLs (frontend, backend, public)
- Allowed origins for CORS
- Signing keys (certificate PEMs)
- Storage configuration (S3, OCI Object Storage)
- Backup provider setup
- Caddy configuration for domain routing
- Environment variables
- SSL/TLS verification
- Testing and validation

**Use When**:
- Setting up production domain
- Configuring DID Web identifiers
- Setting up object storage (S3 or OCI)
- Configuring backup provider
- Need TLS/SSL verification

**Time to Deploy**: 20 minutes  
**Difficulty**: Medium  
**Infrastructure**: For any production setup

---

### [deploy-scripts.md](deploy-scripts.md)

**Purpose**: Reference for automated deployment scripts and their usage.

**Key Topics**:
- Quick start with scripts
- Scripts overview (deploy-to-oci.sh, deploy-oci.sh, deploy-manual.sh)
- Each script's purpose and use cases
- Environment configuration requirements
- Troubleshooting deployment failures
- Script parameters and options

**Use When**:
- Running automated deployments
- Using deployment scripts
- Understanding script behavior
- Troubleshooting script failures

**Time to Deploy**: Varies (scripts automate much of it)  
**Difficulty**: Low  
**Infrastructure**: Any production target

---

### [DEPLOYMENT_INSTRUCTIONS.md](DEPLOYMENT_INSTRUCTIONS.md)

**Purpose**: Critical guide for JWT and cross-domain authentication fixes required for production.

**Key Topics**:
- Issue summary (403 Forbidden errors)
- Root causes (missing COOKIE_DOMAIN, DB_HOST, MFA policy)
- Infrastructure setup (two-server layout)
- Deployment options (SSH manual or automated script)
- Configuration details (environment variables)
- Verification checklist
- Rollback plan
- Technical details (cookie domain behavior, JWT flow)
- Support information

**Use When**:
- Fixing authentication errors after deployment
- API requests returning 403 Forbidden
- Setting up JWT authentication
- Configuring session cookies for subdomains
- Understanding cross-domain authentication

**Time to Deploy**: 10 minutes  
**Difficulty**: Low  
**Infrastructure**: Post-deployment fix

---

## Getting Started Scenarios

### Scenario 1: I want to develop locally

**Goal**: Set up Claros DPP on your machine for development.

**Recommended Reading Order**:
1. Start: [LOCAL.md](LOCAL.md) - Prerequisites and Quick Start
2. Reference: [LOCAL.md](LOCAL.md) - Services Configuration
3. Reference: [LOCAL.md](LOCAL.md) - Development Workflow
4. Final: [LOCAL.md](LOCAL.md) - Troubleshooting

**Time**: 15 minutes  
**Result**: Fully functional local development environment

---

### Scenario 2: I need to deploy to OCI production (single server)

**Goal**: Deploy Claros DPP to production on a single OCI instance.

**Recommended Reading Order**:
1. Start: [OCI.md](OCI.md) - Overview and Prerequisites
2. Reference: [OCI.md](OCI.md) - Installation Steps
3. Reference: [production-domain-and-did-setup.md](production-domain-and-did-setup.md) - Domain configuration
4. Then: [OCI.md](OCI.md) - Post-Deployment Configuration
5. Final: [OCI.md](OCI.md) - Security Checklist

**Time**: 30-45 minutes  
**Result**: Production deployment on single OCI instance

---

### Scenario 3: I need distributed deployment (frontend + backend servers)

**Goal**: Deploy to production with frontend and backend on separate OCI instances.

**Recommended Reading Order**:
1. Start: [DISTRIBUTED_DEPLOYMENT_GUIDE.md](DISTRIBUTED_DEPLOYMENT_GUIDE.md) - Architecture
2. Reference: [DISTRIBUTED_DEPLOYMENT_GUIDE.md](DISTRIBUTED_DEPLOYMENT_GUIDE.md) - Deployment Configuration
3. Reference: [OCI.md](OCI.md) - Installation Steps (for individual server setup)
4. Then: [production-domain-and-did-setup.md](production-domain-and-did-setup.md) - Domain setup
5. Final: [DEPLOYMENT_INSTRUCTIONS.md](DEPLOYMENT_INSTRUCTIONS.md) - Authentication fix

**Time**: 45-60 minutes  
**Result**: Production deployment across two separate servers

---

### Scenario 4: I want to use free tier (cost-effective)

**Goal**: Deploy Claros DPP on OCI Always-Free tier.

**Recommended Reading Order**:
1. Start: [oracle-cloud-free-tier.md](oracle-cloud-free-tier.md) - Overview and setup
2. Reference: [oracle-cloud-free-tier.md](oracle-cloud-free-tier.md) - Recommended setup
3. Optional: [oci-free-tier-edge.md](oci-free-tier-edge.md) - Add edge load balancing
4. Then: [production-domain-and-did-setup.md](production-domain-and-did-setup.md) - Domain configuration
5. Final: [OCI.md](OCI.md) - Troubleshooting if needed

**Time**: 20-35 minutes  
**Result**: Cost-effective production deployment on free tier

---

### Scenario 5: I need to fix authentication errors

**Goal**: Resolve 403 Forbidden or authentication failures in production.

**Recommended Reading Order**:
1. Start: [DEPLOYMENT_INSTRUCTIONS.md](DEPLOYMENT_INSTRUCTIONS.md) - Issue Summary
2. Reference: [DEPLOYMENT_INSTRUCTIONS.md](DEPLOYMENT_INSTRUCTIONS.md) - Verification Checklist
3. Then: [DEPLOYMENT_INSTRUCTIONS.md](DEPLOYMENT_INSTRUCTIONS.md) - Configuration Details
4. Reference: [DEPLOYMENT_INSTRUCTIONS.md](DEPLOYMENT_INSTRUCTIONS.md) - Technical Details

**Time**: 10 minutes  
**Result**: Fixed authentication and working API calls

---

### Scenario 6: I need to use automated scripts

**Goal**: Use deployment scripts for faster/easier deployment.

**Recommended Reading Order**:
1. Start: [deploy-scripts.md](deploy-scripts.md) - Quick Start
2. Reference: [deploy-scripts.md](deploy-scripts.md) - Scripts Overview
3. Reference: [deploy-scripts.md](deploy-scripts.md) - Environment Configuration
4. Final: [deploy-scripts.md](deploy-scripts.md) - Troubleshooting

**Time**: Varies based on script execution time  
**Result**: Automated deployment to OCI

---

## Deployment Decision Tree

```
START: Want to deploy Claros DPP?
│
├─→ Local/Development?
│   └─→ YES → [LOCAL.md](LOCAL.md) ✅
│
├─→ Production on OCI?
│   │
│   ├─→ Single Server?
│   │   └─→ YES → [OCI.md](OCI.md) ✅
│   │
│   ├─→ Two Servers (Frontend + Backend)?
│   │   └─→ YES → [DISTRIBUTED_DEPLOYMENT_GUIDE.md](DISTRIBUTED_DEPLOYMENT_GUIDE.md) ✅
│   │
│   ├─→ Always-Free Tier?
│   │   ├─→ YES + Want edge LB? → [oci-free-tier-edge.md](oci-free-tier-edge.md) ✅
│   │   └─→ YES + Minimal? → [oracle-cloud-free-tier.md](oracle-cloud-free-tier.md) ✅
│   │
│   └─→ All production → Then add [production-domain-and-did-setup.md](production-domain-and-did-setup.md) 📋
│
├─→ Using automated scripts?
│   └─→ YES → [deploy-scripts.md](deploy-scripts.md) 🔧
│
├─→ Authentication errors?
│   └─→ YES → [DEPLOYMENT_INSTRUCTIONS.md](DEPLOYMENT_INSTRUCTIONS.md) 🔨
│
└─→ Need help/troubleshooting?
    └─→ See relevant document's Troubleshooting section
```

---

## Task-Based Usage Guide

### Task: Set Up Local Development Environment

**Primary Document**: [LOCAL.md](LOCAL.md) - Prerequisites and Quick Start  
**Secondary References**: [LOCAL.md](LOCAL.md) - Services Configuration  
**Output**: Running local development environment

---

### Task: Deploy to Single OCI Server

**Primary Document**: [OCI.md](OCI.md)  
**Secondary References**: [production-domain-and-did-setup.md](production-domain-and-did-setup.md)  
**Output**: Production deployment on OCI

---

### Task: Deploy to Distributed Servers

**Primary Document**: [DISTRIBUTED_DEPLOYMENT_GUIDE.md](DISTRIBUTED_DEPLOYMENT_GUIDE.md)  
**Secondary References**: [OCI.md](OCI.md), [DEPLOYMENT_INSTRUCTIONS.md](DEPLOYMENT_INSTRUCTIONS.md)  
**Output**: Two-server production deployment

---

### Task: Configure Production Domain

**Primary Document**: [production-domain-and-did-setup.md](production-domain-and-did-setup.md)  
**Secondary References**: [OCI.md](OCI.md), [oci-free-tier-edge.md](oci-free-tier-edge.md)  
**Output**: Domain configuration, DID setup, TLS verification

---

### Task: Deploy on Free Tier

**Primary Document**: [oracle-cloud-free-tier.md](oracle-cloud-free-tier.md)  
**Secondary References**: [oci-free-tier-edge.md](oci-free-tier-edge.md)  
**Output**: Cost-effective production deployment

---

### Task: Use Load Balancer on Free Tier

**Primary Document**: [oci-free-tier-edge.md](oci-free-tier-edge.md)  
**Secondary References**: [oracle-cloud-free-tier.md](oracle-cloud-free-tier.md)  
**Output**: Edge load balancing configuration

---

### Task: Run Automated Deployment

**Primary Document**: [deploy-scripts.md](deploy-scripts.md)  
**Secondary References**: [OCI.md](OCI.md)  
**Output**: Automated deployment execution

---

### Task: Fix Authentication Errors

**Primary Document**: [DEPLOYMENT_INSTRUCTIONS.md](DEPLOYMENT_INSTRUCTIONS.md)  
**Secondary References**: [DISTRIBUTED_DEPLOYMENT_GUIDE.md](DISTRIBUTED_DEPLOYMENT_GUIDE.md)  
**Output**: Fixed authentication, verified API calls

---

### Task: Troubleshoot Deployment Issues

**Primary Document**: [OCI.md](OCI.md) - Troubleshooting  
**Secondary References**: [LOCAL.md](LOCAL.md) - Troubleshooting, [DISTRIBUTED_DEPLOYMENT_GUIDE.md](DISTRIBUTED_DEPLOYMENT_GUIDE.md) - Troubleshooting  
**Output**: Resolved deployment issue

---

## Deployment Statistics

### Documentation Coverage

| Metric | Value |
|--------|-------|
| **Total Deployment Guides** | 8 |
| **Total Lines** | 2,500+ |
| **Files with Table of Contents** | 8/8 (100%) ✅ |
| **Files with Related Documentation** | 8/8 (100%) ✅ |
| **Deployment Targets** | 5 (local, OCI single, OCI distributed, free tier, free tier edge) |
| **Getting Started Scenarios** | 6 complete scenarios |
| **Task-Based Guides** | 8 specific deployment tasks |

### Deployment Targets

| Target | Document | Complexity | Time |
|--------|----------|-----------|------|
| **Local Development** | LOCAL.md | Low | 15 min |
| **OCI Single Server** | OCI.md | Medium | 30-45 min |
| **OCI Distributed (2 servers)** | DISTRIBUTED_DEPLOYMENT_GUIDE.md | High | 45-60 min |
| **OCI Free Tier (Minimal)** | oracle-cloud-free-tier.md | Low | 20-30 min |
| **OCI Free Tier (with Edge)** | oci-free-tier-edge.md | Medium | 25-35 min |

### Infrastructure Patterns

| Pattern | Use Case | Services Location | Database |
|---------|----------|-------------------|----------|
| **Local Docker Compose** | Development | Single machine | Container |
| **Centralized Production** | Production (single) | Single OCI instance | Container |
| **Distributed Production** | Production (HA) | 2 OCI instances (separated) | Backend server |
| **Free Tier** | Cost-effective | Always-Free OCI | Container |
| **Edge Pattern** | HA + managed TLS | 2 servers + Load Balancer | Backend server |

### Cross-Reference Coverage

All 8 deployment files include:
- ✅ Table of Contents with all sections
- ✅ Related Documentation with 6 cross-reference links per file
- ✅ Links to security documentation (authentication, data protection)
- ✅ Links to architecture documentation (ARCHITECTURE, SERVICES)
- ✅ Links to other deployment guides

---

## Related Documentation

### Security Documentation
- [AUTHENTICATION.md](../security/AUTHENTICATION.md) - User authentication mechanisms
- [Data Protection](../security/DATA_PROTECTION.md) - Encryption and key management
- [AUDIT_LOGGING.md](../security/AUDIT_LOGGING.md) - Deployment and authentication logging

### Architecture Documentation
- [ARCHITECTURE.md](../architecture/ARCHITECTURE.md) - System runtime architecture
- [SERVICES.md](../architecture/SERVICES.md) - Service-to-port mapping and dependencies
- [PROJECT_STRUCTURE.md](../architecture/PROJECT_STRUCTURE.md) - Repository organization
- [did-and-passport-model.md](../architecture/did-and-passport-model.md) - DID structure

### API Documentation
- [ENDPOINTS.md](../api/ENDPOINTS.md) - Complete API reference
- [AUTHENTICATION.md](../security/AUTHENTICATION.md) - API authentication

---

**[← Back to Documentation](../README.md)**
