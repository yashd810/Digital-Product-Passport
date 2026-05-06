# Configuration Documentation Index

This index provides quick navigation and comprehensive reference for system configuration, including environment variables, configuration files, and setup procedures for local development and production deployment.

---

## Table of Contents

1. [Quick Navigation](#quick-navigation)
2. [Configuration Overview](#configuration-overview)
3. [Document Descriptions](#document-descriptions)
4. [Environment Variables Reference](#environment-variables-reference)
5. [Configuration Scenarios](#configuration-scenarios)
6. [Common Configuration Tasks](#common-configuration-tasks)
7. [Configuration Statistics](#configuration-statistics)
8. [Related Documentation](#related-documentation)

---

## Quick Navigation

| Configuration | File | Focus | Environment |
|---------------|------|-------|-------------|
| [Local Development](#local-development) | configuration-files.md | .env.local setup | Development |
| [Production Deployment](#production) | configuration-files.md | .env.production setup | OCI |

---

## Configuration Overview

The Claros DPP configuration documentation provides comprehensive guidance for setting up environment variables and configuration files for both local development and production deployment.

### Key Configuration Areas

1. **Local Development Configuration**
   - Development environment setup
   - Local database connections
   - Frontend/backend communication
   - Debug logging

2. **Production Configuration**
   - OCI deployment settings
   - Secure password configuration
   - Domain and URL setup
   - Feature enablement

3. **Environment Variables**
   - Core settings (NODE_ENV, DEBUG)
   - API configuration
   - Frontend URLs
   - Database connection strings
   - Authentication secrets
   - Security features

4. **Security Configuration**
   - JWT secret management
   - Password security
   - MFA enforcement
   - CORS configuration

---

## Document Descriptions

### configuration-files.md

**Purpose:** Complete reference for environment configuration files and variables for local and production deployment.

**Topics Covered:**
- Files overview (.env.local, .env.production)
- Local development environment setup
- Production environment configuration
- Using configuration files (Docker, OCI deployment)
- Environment variable reference
- Core settings (NODE_ENV, DEBUG)
- API configuration variables
- Frontend configuration variables
- Database configuration variables
- Authentication variables
- Security feature configuration
- Security best practices
- Troubleshooting common issues

**Configuration Files Documented:**
- `.env.local` - Local development (Docker Compose)
- `.env.production` - Production (OCI deployment)

**Environment Variables:** 20+ documented with explanations

**Key Sections:**
- Local Development (.env.local) with 10+ variables
- Production (.env.production) with security templates
- Using Configuration Files (deployment procedures)
- Environment Variable Reference (5 categories)
- Security Best Practices (5 key practices)
- Troubleshooting (3 common scenarios)

**Code Examples:** 5+ configuration examples and troubleshooting commands

**Use Cases:**
- Setting up local development environment
- Configuring production deployment
- Understanding environment variables
- Security configuration
- Troubleshooting configuration issues
- Database connection setup
- API endpoint configuration

**Status:** Current complete reference

---

## Environment Variables Reference

### Core Settings

| Variable | Values | Purpose | Default |
|----------|--------|---------|---------|
| NODE_ENV | development, production | Environment mode | development |
| DEBUG | true, false | Verbose logging | false |

### API Configuration

| Variable | Type | Purpose | Example |
|----------|------|---------|---------|
| API_PORT | number | Backend API port | 3001 |
| API_HOST | string | API hostname | localhost |
| VITE_API_URL | URL | Frontend API URL | http://localhost:3001 |

### Frontend Configuration

| Variable | Type | Purpose | Example |
|----------|------|---------|---------|
| VITE_PUBLIC_VIEWER_URL | URL | Public viewer URL | http://localhost:3004 |

### Database Configuration

| Variable | Type | Purpose | Example |
|----------|------|---------|---------|
| DB_HOST | string | Database hostname | postgres |
| DB_PORT | number | Database port | 5432 |
| DB_USER | string | Database user | claros_user |
| DB_PASSWORD | string | Database password | *** |
| DB_NAME | string | Database name | claros_dpp |

### Authentication & Security

| Variable | Type | Purpose | Requirements |
|----------|------|---------|---------------|
| JWT_SECRET | string | JWT signing key | Min 32 characters |
| JWT_EXPIRATION | string | Token expiry | Format: "24h" |
| COOKIE_DOMAIN | string | Session cookie domain | .claros-dpp.online |
| REQUIRE_MFA_FOR_CONTROLLED_DATA | boolean | MFA enforcement | true/false |
| CORS_ORIGINS | string | Allowed origins | Comma-separated URLs |

---

## Configuration Scenarios

### Scenario 1: Local Development Setup

**Goal:** Configure local environment for development

**Steps:**
1. Copy .env.example to .env.local
2. Set NODE_ENV=development
3. Set DEBUG=true for detailed logs
4. Configure DB_HOST=postgres (Docker service)
5. Set JWT_SECRET to test value
6. Set VITE_API_URL=http://localhost:3001

**Time:** 5 minutes

**File:** [configuration-files.md#local-development-envlocal](configuration-files.md#local-development-envlocal)

---

### Scenario 2: Production OCI Deployment

**Goal:** Secure production configuration for OCI

**Steps:**
1. Create .env.production file
2. Set NODE_ENV=production
3. Set DEBUG=false
4. Set DB_HOST=localhost (after SSH)
5. Generate strong JWT_SECRET (32+ chars)
6. Set COOKIE_DOMAIN=.claros-dpp.online
7. Enable REQUIRE_MFA_FOR_CONTROLLED_DATA=true
8. Store securely, never commit to git

**Time:** 10 minutes

**File:** [configuration-files.md#production-envproduction](configuration-files.md#production-envproduction)

---

### Scenario 3: Troubleshooting Configuration Issues

**Goal:** Debug configuration-related problems

**Steps:**
1. Check if services can connect to database
   - Verify DB_HOST and DB_PORT
   - Confirm DB_USER and DB_PASSWORD
2. Check if frontend can reach API
   - Verify VITE_API_URL
   - Check CORS configuration
3. Check JWT authentication issues
   - Verify JWT_SECRET is set
   - Check JWT_EXPIRATION format

**File:** [configuration-files.md#troubleshooting](configuration-files.md#troubleshooting)

---

## Common Configuration Tasks

### Task 1: Set Up Local Development

**Goal:** Get local environment running

**Steps:**
1. Read [Local Development section](configuration-files.md#local-development-envlocal)
2. Create .env.local with provided variables
3. Run `docker-compose up -d`
4. Verify services at http://localhost:3000

**Related:** [LOCAL.md](../deployment/LOCAL.md)

---

### Task 2: Configure Production Environment

**Goal:** Prepare secure production configuration

**Steps:**
1. Read [Production section](configuration-files.md#production-envproduction)
2. Create .env.production template
3. Generate strong secrets (32+ chars)
4. Set domain to production URL
5. Enable security features
6. Store securely (not in git)

**Related:** [OCI.md](../deployment/OCI.md)

---

### Task 3: Configure Database Connection

**Goal:** Set up correct database connection

**Steps:**
1. For local: Set DB_HOST=postgres (Docker service name)
2. For production: Set DB_HOST=localhost (after SSH)
3. Set DB_PORT=5432
4. Set DB_USER and DB_PASSWORD
5. Verify with `docker-compose logs`

**Related:** [DATABASE.md](../infrastructure/DATABASE.md)

---

### Task 4: Enable Security Features

**Goal:** Activate security configuration

**Steps:**
1. Generate JWT_SECRET (32+ random characters)
2. Set JWT_EXPIRATION=24h
3. Set COOKIE_DOMAIN=.claros-dpp.online (production)
4. Enable REQUIRE_MFA_FOR_CONTROLLED_DATA=true
5. Configure CORS_ORIGINS for allowed domains

**Related:** [AUTHENTICATION.md](../security/AUTHENTICATION.md)

---

## Configuration Statistics

| Metric | Value |
|--------|-------|
| Total Configuration Files | 1 |
| Files with Table of Contents | 1/1 (100%) |
| Files with Related Documentation | 1/1 (100%) |
| Configuration File Types | 2 (.env.local, .env.production) |
| Environment Variables | 20+ |
| Variable Categories | 5 |
| Core Settings | 2 |
| API Configuration Variables | 3 |
| Frontend Variables | 1 |
| Database Variables | 5 |
| Security Variables | 5+ |
| Code Examples | 5+ |
| Troubleshooting Scenarios | 3 |
| Configuration Tasks | 4+ |
| Total Documentation Lines | 200+ |
| Cross-References | 15+ |

---

## Related Documentation

### Deployment & Infrastructure
- [LOCAL.md](../deployment/LOCAL.md) - Local development deployment
- [OCI.md](../deployment/OCI.md) - Production OCI deployment
- [DOCKER.md](../infrastructure/DOCKER.md) - Docker configuration
- [docker-compose-files.md](../infrastructure/docker-compose-files.md) - Compose setup
- [DEPLOYMENT_INDEX.md](../deployment/DEPLOYMENT_INDEX.md) - Deployment guide

### Security & Authentication
- [AUTHENTICATION.md](../security/AUTHENTICATION.md) - JWT and authentication
- [SECURITY_INDEX.md](../security/SECURITY_INDEX.md) - Security documentation

### Database & Services
- [DATABASE.md](../infrastructure/DATABASE.md) - Database setup
- [backend-api.md](../apps/backend-api.md) - Backend API documentation

### Getting Started
- [GETTING_STARTED.md](../guides/GETTING_STARTED.md) - Local setup guide
- [DEVELOPMENT.md](../development/DEVELOPMENT.md) - Development practices

---

**[← Back to Docs](../README.md)**
