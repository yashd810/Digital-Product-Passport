# Guides Documentation Index

This index provides quick navigation to comprehensive guides for getting started with the Claros DPP system, including local development setup, development workflows, and common tasks.

---

## Table of Contents

1. [Quick Navigation](#quick-navigation)
2. [Guides Overview](#guides-overview)
3. [Document Descriptions](#document-descriptions)
4. [Quick Reference](#quick-reference)
5. [Getting Started Scenarios](#getting-started-scenarios)
6. [Development Resources](#development-resources)
7. [Guides Statistics](#guides-statistics)
8. [Related Documentation](#related-documentation)

---

## Quick Navigation

| Guide | File | Focus | Duration |
|-------|------|-------|----------|
| [Getting Started](#getting-started---local-development) | GETTING_STARTED.md | Local development setup and workflow | 5 minutes (quick) or 30+ minutes (detailed) |

---

## Guides Overview

The Claros DPP guides provide step-by-step instructions and practical examples for working with the system, from initial setup through development workflows and deployment.

### Key Guide Content

1. **Quick Start Setup**
   - Prerequisites and requirements
   - 6-step setup procedure
   - Service access URLs
   - Account creation

2. **Detailed Environment Setup**
   - System requirements (minimum and recommended)
   - Docker installation for all platforms
   - Repository cloning
   - Environment configuration
   - Service startup and verification
   - Database initialization

3. **Development Workflows**
   - Frontend development procedures
   - Backend API development
   - Public viewer development
   - Hot reload and debugging
   - Running tests

4. **Common Development Tasks**
   - Creating test digital passports
   - Viewing public passports
   - Running test suites
   - Database inspection and management
   - Container log viewing

5. **Debugging & Troubleshooting**
   - Debug logging configuration
   - Container inspection
   - Resource monitoring
   - Common error solutions
   - Port conflict resolution
   - Memory issues
   - Service startup problems

6. **IDE Configuration**
   - Visual Studio Code setup
   - WebStorm/IntelliJ setup
   - Extension recommendations
   - Run configurations

---

## Document Descriptions

### GETTING_STARTED.md

**Purpose:** Comprehensive guide for getting started with local development on the Claros DPP system.

**Sections Covered:**
- Quick Start (5 minutes)
- Prerequisites and requirements
- Detailed Setup (6 main steps)
- Environment configuration
- Service startup and access
- Database initialization
- Development workflows (Frontend, Backend, Public Viewer)
- Common tasks (create passport, view public, run tests, database management)
- Debugging and troubleshooting
- IDE setup (VSCode, WebStorm)
- Next steps and getting help

**Topics Included:**
- System requirements (minimum and recommended)
- Docker installation for Mac, Ubuntu/Debian, Windows
- Repository cloning procedures
- Environment variables and configuration
- Service access URLs and ports
- Account creation and first steps
- Development workflow for each application
- Testing procedures
- Database operations
- Log viewing and inspection
- Common troubleshooting scenarios
- IDE configurations

**Code Examples:** 20+ command examples and configuration snippets

**Use Cases:**
- Setting up local development environment
- Getting started with the project
- Understanding the architecture from practitioner perspective
- Learning development workflow
- Troubleshooting setup issues
- IDE configuration and optimization

**Status:** Current comprehensive guide

---

## Quick Reference

### Services & Port Mapping

| Service | URL | Port | Purpose |
|---------|-----|------|---------|
| Frontend Dashboard | http://localhost:3000 | 3000 | Main UI for creating/managing passports |
| Backend API | http://localhost:3001 | 3001 | REST API endpoints |
| Public Viewer | http://localhost:3004 | 3004 | View public passports |
| Marketing Site | http://localhost:8080 | 8080 | Public marketing pages |
| PostgreSQL | localhost:5432 | 5432 | Database |

### Quick Commands

**Start All Services:**
```bash
docker-compose up -d
```

**View Logs:**
```bash
docker-compose logs -f backend-api
```

**Reset Database:**
```bash
docker-compose down -v && docker-compose up -d postgres
```

**Run Tests:**
```bash
npm run test
```

**Create Test Passport:**
1. Go to http://localhost:3000
2. Sign up or login
3. Click "Create Passport"
4. Fill in details and submit

---

## Getting Started Scenarios

### Scenario 1: Complete Beginner (No Docker Experience)

**Goal:** Get up and running from scratch

**Steps:**
1. Read [Quick Start section](GETTING_STARTED.md#quick-start-5-minutes)
2. Install Docker Desktop from docker.com
3. Clone repository
4. Run `docker-compose up -d`
5. Wait 30 seconds
6. Open http://localhost:3000

**Time:** ~15 minutes

**Related:** [System Requirements](GETTING_STARTED.md#1-system-requirements)

---

### Scenario 2: Experienced Developer (Docker Familiar)

**Goal:** Quick setup and understanding project structure

**Steps:**
1. Skim [Quick Start](GETTING_STARTED.md#quick-start-5-minutes) (2 minutes)
2. Clone and docker-compose up
3. Review [Development Workflow section](GETTING_STARTED.md#development-workflow)
4. Read [ARCHITECTURE.md](../architecture/ARCHITECTURE.md)
5. Start developing

**Time:** ~10 minutes

**Related:** [DEVELOPMENT.md](../development/DEVELOPMENT.md)

---

### Scenario 3: Debugging a Specific Issue

**Goal:** Troubleshoot a setup or development issue

**Steps:**
1. Check [Troubleshooting section](GETTING_STARTED.md#troubleshooting)
2. If port conflict: See [Port Already in Use](GETTING_STARTED.md#port-already-in-use)
3. If memory issue: See [Out of Memory](GETTING_STARTED.md#out-of-memory)
4. If services fail: See [Services Won't Start](GETTING_STARTED.md#services-wont-start)
5. Check logs with `docker-compose logs -f`

**Time:** ~5-10 minutes

**Related:** [COMMON_ISSUES.md](../troubleshooting/COMMON_ISSUES.md)

---

## Development Resources

### By Role

**Frontend Developer:**
- [Development Workflow - Frontend](GETTING_STARTED.md#working-on-frontend)
- [IDE Setup - VSCode](GETTING_STARTED.md#visual-studio-code)
- [frontend-app.md](../apps/frontend-app.md)
- [DEVELOPMENT.md](../development/DEVELOPMENT.md)

**Backend Developer:**
- [Development Workflow - Backend](GETTING_STARTED.md#working-on-backend-api)
- [API Endpoints](../api/ENDPOINTS.md)
- [DATABASE_SCHEMA.md](../database/DATABASE_SCHEMA.md)
- [backend-api.md](../apps/backend-api.md)

**DevOps/Infrastructure:**
- [Docker Configuration](../infrastructure/DOCKER.md)
- [docker-compose Files](../infrastructure/docker-compose-files.md)
- [LOCAL.md](../deployment/LOCAL.md)
- [OCI.md](../deployment/OCI.md)

**QA/Testing:**
- [Common Tasks - Run Tests](GETTING_STARTED.md#run-tests)
- [Testing](../development/DEVELOPMENT.md#testing)
- [Test Coverage](../development/DEVELOPMENT.md)

---

### By Technology

**Docker & Containers:**
- [Install Docker](GETTING_STARTED.md#2-install-docker)
- [DOCKER.md](../infrastructure/DOCKER.md)
- [docker-compose-files.md](../infrastructure/docker-compose-files.md)

**Database:**
- [Database Initialization](GETTING_STARTED.md#6-database-initialization)
- [Check Database](GETTING_STARTED.md#check-database)
- [Reset Database](GETTING_STARTED.md#reset-database)
- [DATABASE_SCHEMA.md](../database/DATABASE_SCHEMA.md)

**APIs & REST:**
- [Backend API development](GETTING_STARTED.md#working-on-backend-api)
- [ENDPOINTS.md](../api/ENDPOINTS.md)
- [API Authentication](../security/AUTHENTICATION.md)

**Frontend & React:**
- [Frontend development](GETTING_STARTED.md#working-on-frontend)
- [frontend-app.md](../apps/frontend-app.md)
- [accessibility-and-portability.md](../frontend/accessibility-and-portability.md)

---

## Guides Statistics

| Metric | Value |
|--------|-------|
| Total Guide Files | 1 |
| Files with Table of Contents | 1/1 (100%) |
| Files with Related Documentation | 1/1 (100%) |
| Quick Start Time | 5 minutes |
| Detailed Setup Time | 30+ minutes |
| Total Sections | 8 |
| Command Examples | 20+ |
| Setup Steps | 6 main steps |
| Services Configured | 4 (Frontend, Backend, Viewer, Marketing) |
| Databases | 1 (PostgreSQL) |
| Ports Used | 5 (3000, 3001, 3004, 8080, 5432) |
| Development Workflows | 3 (Frontend, Backend, Viewer) |
| Common Tasks | 6 documented |
| Troubleshooting Scenarios | 4+ |
| IDE Configurations | 2 (VSCode, WebStorm) |
| Total Documentation Lines | 500+ |
| Cross-References | 15+ |

---

## Related Documentation

### Getting Started Resources
- [ARCHITECTURE.md](../architecture/ARCHITECTURE.md) - Understand the system design
- [DEVELOPMENT.md](../development/DEVELOPMENT.md) - Development guidelines and best practices
- [WORKFLOWS.md](../development/WORKFLOWS.md) - Common development workflows

### Deployment & Infrastructure
- [LOCAL.md](../deployment/LOCAL.md) - Local deployment details
- [OCI.md](../deployment/OCI.md) - Production deployment
- [DOCKER.md](../infrastructure/DOCKER.md) - Docker containerization
- [docker-compose-files.md](../infrastructure/docker-compose-files.md) - Compose configuration
- [DATABASE.md](../infrastructure/DATABASE.md) - Database setup

### API & Data
- [ENDPOINTS.md](../api/ENDPOINTS.md) - API endpoint reference
- [din-spec-99100-import-guide.md](../reference/din-spec-99100-import-guide.md) - Data import guide
- [battery-dictionary.md](../api/battery-dictionary.md) - Field definitions

### Applications
- [frontend-app.md](../apps/frontend-app.md) - Frontend application
- [backend-api.md](../apps/backend-api.md) - Backend API
- [public-passport-viewer.md](../apps/public-passport-viewer.md) - Public viewer

### Troubleshooting & Help
- [COMMON_ISSUES.md](../troubleshooting/COMMON_ISSUES.md) - Troubleshooting guide
- [TROUBLESHOOTING_INDEX.md](../troubleshooting/TROUBLESHOOTING_INDEX.md) - Full troubleshooting index

---

**[← Back to Docs](../README.md)**
