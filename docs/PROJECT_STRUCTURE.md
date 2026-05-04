# Project Structure - Claros DPP

## Overview

Claros Digital Product Passport (DPP) is a comprehensive platform for creating, managing, verifying, and publishing Digital Product Passports. This document provides a complete overview of the project structure and organization.

---

## Directory Structure

```
claros-dpp/
├── apps/                           # Application services
│   ├── backend-api/               # REST API server (Node.js/Express)
│   ├── frontend-app/              # Web dashboard (Vue/Vite)
│   ├── public-passport-viewer/    # Public viewer app (Vite)
│   ├── marketing-site/            # Marketing website (Static)
│   └── asset-management/          # Asset management service
│
├── docs/                          # Comprehensive documentation
│   ├── guides/                    # User and developer guides
│   ├── api/                       # API documentation
│   ├── architecture/              # Architecture and design docs
│   ├── deployment/                # Deployment guides
│   ├── development/               # Development guidelines
│   ├── infrastructure/            # Infrastructure setup
│   ├── security/                  # Security policies
│   └── *.md files                 # Core documentation
│
├── infra/                         # Infrastructure & DevOps
│   ├── docker/                    # Docker configurations
│   │   ├── website/              # Marketing site Docker configs
│   │   ├── frontend/             # Frontend Docker configs
│   │   └── ...
│   ├── oracle/                   # OCI cloud setup
│   └── resources/                # Templates and resources
│
├── scripts/                       # Automation and utility scripts
│   └── *.js                      # Deployment and maintenance scripts
│
├── storage/                       # Local storage (dev only)
│
├── tests/                         # Integration tests (optional)
│
├── docker-compose.yml             # Local development stack
├── docker-compose.prod.yml        # Production deployment
├── package.json                   # Root dependencies
├── README.md                      # Quick start
└── .env.example                  # Environment variables template
```

---

## Applications (apps/)

### 1. backend-api
**Purpose**: Core REST API server for DPP platform

**Stack**: Node.js, Express, PostgreSQL

**Key Directories**:
- `Server/` - Express server entry point
- `routes/` - API endpoint definitions
- `services/` - Business logic and DPP operations
- `middleware/` - Authentication, validation, error handling
- `db/` - Database migrations and queries
- `helpers/` - Utility functions
- `tests/` - Jest test suites
- `scripts/` - Database seeding and maintenance

**Ports**: 3001 (development), 3001 (production)

**Environment Variables**: `.env` (see .env.example)

### 2. frontend-app
**Purpose**: Web dashboard for managing DPPs and accounts

**Stack**: Vue 3, Vite, Tailwind CSS

**Key Directories**:
- `src/` - Vue components and pages
- `src/components/` - Reusable UI components
- `src/pages/` - Page components
- `src/services/` - API communication
- `src/stores/` - State management

**Ports**: 3000 (development), 80/443 (production)

**Environment Variables**: `VITE_API_URL`, `VITE_PUBLIC_VIEWER_URL`

### 3. public-passport-viewer
**Purpose**: Public-facing viewer for Digital Product Passports

**Stack**: Vue 3, Vite

**Key Features**:
- View public DPPs without authentication
- QR code integration
- JSON-LD and verifiable credentials support

**Ports**: 3004 (development), 80/443 (production)

### 4. marketing-site
**Purpose**: Marketing and informational website

**Stack**: HTML5, CSS3, JavaScript

**Key Pages**:
- `index.html` - Home page
- `privacy-policy.html` - Privacy policy
- `terms-of-service.html` - Terms of service
- `shared.js` - Header/footer injection

**Ports**: 8080 (container), mapped via Docker

### 5. asset-management
**Purpose**: Manage static assets and resources

**Stack**: Node.js, Express

**Ports**: 3003 (development)

---

## Infrastructure (infra/)

### Docker Configurations
- **website/nginx.conf** - Marketing site Nginx config
- **frontend/nginx.conf.template** - Frontend Nginx template
- **asset-management/nginx.conf.template** - Asset service Nginx template

### Oracle Cloud Setup
- **Caddyfile** - Reverse proxy and SSL/TLS configuration
- **cloud-init.yaml** - OCI instance initialization
- **bootstrap.sh** - Setup script for production environment
- **deploy-prod.sh** - Production deployment automation

### Resources
- **templates/** - DIN SPEC 99100 battery passport templates
- **semantics/** - Data structure definitions

---

## Documentation Structure (docs/)

### Core Documentation
- **PROJECT_STRUCTURE.md** - This file
- **ARCHITECTURE.md** - System design and data flow
- **GETTING_STARTED.md** - Development environment setup
- **DATA_FLOW.md** - How data moves through the system
- **DATABASE_SCHEMA.md** - Database structure and relationships

### Guides
- **guides/DEVELOPMENT.md** - Development guidelines and best practices
- **guides/DEPLOYMENT.md** - How to deploy to production
- **guides/LOCAL_SETUP.md** - Local development environment

### API Documentation
- **api/ENDPOINTS.md** - REST API endpoints
- **api/AUTHENTICATION.md** - Auth mechanisms
- **api/PASSPORT_OPERATIONS.md** - DPP-specific operations

### Architecture
- **architecture/SYSTEM_DESIGN.md** - Overall system architecture
- **architecture/SERVICE_INTERACTION.md** - How services communicate

### Development
- **development/CODE_STYLE.md** - Coding standards
- **development/TESTING.md** - Testing guidelines
- **development/CONTRIBUTING.md** - Contribution guidelines

### Deployment
- **deployment/LOCAL.md** - Local setup with Docker
- **deployment/OCI.md** - OCI cloud deployment
- **deployment/MONITORING.md** - Monitoring and logs

### Infrastructure
- **infrastructure/DOCKER.md** - Docker setup and configs
- **infrastructure/DATABASE.md** - Database setup
- **infrastructure/CADDY.md** - Reverse proxy configuration

### Security
- **security/AUTHENTICATION.md** - Auth flow and JWT
- **security/DATA_PROTECTION.md** - Data encryption and protection
- **security/AUDIT_LOGGING.md** - Audit trails

---

## Scripts (scripts/)

### Deployment Scripts
- `deploy-to-oci.sh` - Deploy to OCI server
- `deploy-manual.sh` - Manual deployment steps
- `deploy-oci.sh` - OCI deployment automation

### Maintenance Scripts
- `dpp-guid-codemod.js` - Codebase refactoring
- `generate-battery-dictionary.js` - Battery data generation
- `bulk-update-fetch.js` - Batch updates
- `fix-admin-role.js` - Admin role fixes

---

## Configuration Files

### Root Level
- **docker-compose.yml** - Local development stack
- **docker-compose.prod.yml** - Production deployment config
- **docker-compose.prod.backend.yml** - Backend-only prod config
- **docker-compose.prod.frontend.yml** - Frontend-only prod config
- **.env.example** - Environment variables template
- **renovate.json** - Dependency update automation

### Application Level
Each app has:
- `package.json` - Dependencies
- `Dockerfile` - Container image
- `.env.example` - App-specific environment variables
- Configuration files (vite.config.js, jest.config.js, etc.)

---

## Key Technologies

| Component | Technology |
|-----------|-----------|
| Backend | Node.js, Express, PostgreSQL |
| Frontend | Vue 3, Vite, Tailwind CSS |
| Public Viewer | Vue 3, Vite |
| Marketing Site | HTML5, CSS3, JavaScript |
| Containerization | Docker, Docker Compose |
| Reverse Proxy | Caddy, Nginx |
| Cloud Platform | Oracle Cloud (OCI) |
| Testing | Jest, Vue Test Utils |
| API Spec | OpenAPI 3.0 |

---

## Development Workflow

1. **Local Development**: Use `docker-compose.yml` to run all services
2. **Testing**: Run tests with `npm test` in each app
3. **Code Changes**: Commit to git and push to GitHub
4. **CI/CD**: Automated builds and tests (if configured)
5. **Staging**: Deploy to staging OCI instance
6. **Production**: Deploy to production OCI instance with Caddy

---

## Data Flow

1. **User Access** → Marketing site (static) → Sign up/Login
2. **Dashboard** → Frontend app (Vue) → REST API calls
3. **API Processing** → Backend API (Express) → Database queries
4. **DPP Creation** → Backend validates → Stores in PostgreSQL
5. **Public Access** → Public viewer (Vue) → Fetches public DPPs
6. **Data Export** → JSON-LD, Verifiable Credentials format

---

## Deployment Environments

### Local Development
- All services in Docker Compose
- Hot reload enabled
- Database in container
- No SSL/TLS

### OCI Production
- Each service in separate Docker container
- Caddy reverse proxy (SSL/TLS)
- PostgreSQL database
- Persistent storage
- Health checks and monitoring

---

## Getting Started

1. **Clone repository** and navigate to project root
2. **Install dependencies**: `npm install` (root and each app)
3. **Configure environment**: Copy `.env.example` to `.env`
4. **Start services**: `docker-compose up -d`
5. **Access applications**:
   - Frontend: http://localhost:3000
   - API: http://localhost:3001
   - Viewer: http://localhost:3004
   - Marketing: http://localhost:8080 (via container)

For detailed setup, see [GETTING_STARTED.md](./guides/LOCAL_SETUP.md)

---

## Support & Documentation

- **API Reference**: See [docs/api/ENDPOINTS.md](./api/ENDPOINTS.md)
- **Architecture**: See [docs/architecture/SYSTEM_DESIGN.md](./architecture/SYSTEM_DESIGN.md)
- **Deployment**: See [docs/deployment/](./deployment/)
- **Security**: See [docs/security/](./security/)

