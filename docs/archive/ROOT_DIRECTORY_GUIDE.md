# Project Root Directory - File Organization Guide

This document explains the purpose of files and directories in the project root and where they belong.

## Root Directory Contents

### Essential Files (Keep in Root)

```
README.md                          # Main project documentation
LICENSE                           # Project license (MIT)
.gitignore                        # Git ignore rules
.env                              # Local environment configuration (GITIGNORED)
.env.prod                         # Production environment config (GITIGNORED)
renovate.json                     # Dependency management config
```

### Docker Compose Files (Keep in Root)

```
docker-compose.yml                # Local development (all services, no prod optimizations)
docker-compose.prod.yml           # Production deployment configuration
docker-compose.prod.backend.yml   # Backend service specific config
docker-compose.prod.frontend.yml  # Frontend service specific config
```

### Directories Structure (Clean & Organized)

```
📁 apps/                          # All application services
   ├── backend-api/               # Node.js Express backend
   ├── frontend-app/              # Vue.js SPA frontend
   ├── public-passport-viewer/    # Public viewer (Vue.js)
   └── marketing-site/            # Static marketing website

📁 docs/                          # Complete documentation
   ├── README.md                  # Documentation index
   ├── ARCHITECTURE.md            # System design
   ├── DATA_FLOW.md               # Data movement documentation
   ├── DATABASE_SCHEMA.md         # Database structure
   ├── PROJECT_STRUCTURE.md       # Directory organization
   ├── guides/                    # Setup & getting started
   │   └── GETTING_STARTED.md
   ├── deployment/                # Deployment procedures
   │   ├── LOCAL.md               # Local Docker Compose setup
   │   └── OCI.md                 # Production OCI deployment
   ├── api/                       # API documentation
   │   └── ENDPOINTS.md           # Complete API reference
   ├── development/               # Development guidelines
   │   └── DEVELOPMENT.md         # Coding standards & patterns
   ├── infrastructure/            # Infrastructure guides
   │   ├── DOCKER.md              # Docker & containerization
   │   ├── CADDY.md               # Reverse proxy & SSL/TLS
   │   └── DATABASE.md            # Database management
   ├── security/                  # Security documentation
   │   ├── AUTHENTICATION.md      # JWT & authorization
   │   ├── DATA_PROTECTION.md     # Encryption & data security
   │   └── AUDIT_LOGGING.md       # Compliance & audit trails
   ├── troubleshooting/           # Common issues & fixes
   │   ├── README.md
   │   └── COMMON_ISSUES.md       # Comprehensive troubleshooting
   └── archive/                   # Historical documentation
       └── README.md              # Previous fixes & solutions

📁 scripts/                       # Deployment & utility scripts
   ├── deploy-oci.sh              # OCI deployment script
   ├── deploy-to-oci.sh           # Alternative OCI deployment
   ├── deploy-manual.sh           # Manual deployment steps
   ├── bulk-update-fetch.js       # Database utilities
   └── fix-admin-role.js          # Admin utility scripts

📁 infra/                         # Infrastructure as Code
   ├── docker/                    # Docker configurations
   └── oracle/                    # OCI specific setup

📁 codex_bundle/                  # Data/configuration bundles

📁 storage/                       # Storage & persistence
   └── local-storage/             # Local file storage

📁 memory/                        # Project memory & notes
   ├── MEMORY.md
   └── project_domain.md

📁 node_modules/                  # Dependencies (GITIGNORED)

📁 .git/                          # Version control

📁 .vscode/                       # VS Code settings

📁 .github/                       # GitHub configuration
```

## File Organization Explained

### Why This Structure?

1. **apps/** - All microservices in one place, easy to understand project services
2. **docs/** - All documentation organized by topic (deployment, security, infrastructure, etc.)
3. **scripts/** - All automation scripts grouped together, not scattered in root
4. **infra/** - Infrastructure-specific code and configurations
5. **Root** - Only essential files that are immediately relevant

### Before (Messy) vs After (Clean)

**❌ BEFORE (Messy Root)**
```
/
├── README.md
├── CORS_FIX_GUIDE.md             ← Should be in docs/
├── CRITICAL_COOKIE_DOMAIN_FIX.md ← Should be in docs/
├── CRITICAL_COOKIE_FIX.sh        ← Should be in scripts/
├── DEPLOYMENT_FIX_GUIDE.md       ← Should be in docs/
├── DEPLOYMENT_INSTRUCTIONS.md    ← Should be in docs/
├── DISTRIBUTED_DEPLOYMENT_GUIDE.md ← Should be in docs/
├── FIX_SUMMARY.md                ← Should be in docs/
├── PRODUCTION_READINESS_REPORT.md ← Should be in docs/
├── SOLUTION_SUMMARY.md           ← Should be in docs/
├── STALE_COOKIE_FIX.md           ← Should be in docs/
├── bulk-update-fetch.js          ← Should be in scripts/
├── deploy-manual.sh              ← Should be in scripts/
├── deploy-oci.sh                 ← Should be in scripts/
├── deploy-to-oci.sh              ← Should be in scripts/
├── fix-admin-role.js             ← Should be in scripts/
└── ... (Too many root files!)
```

**✅ AFTER (Clean Root)**
```
/
├── README.md                      ✓ Essential
├── LICENSE                        ✓ Essential
├── .gitignore                     ✓ Essential
├── .env                           ✓ Essential (local config)
├── .env.prod                      ✓ Essential (prod config)
├── renovate.json                  ✓ Essential (dependency mgmt)
├── docker-compose.yml             ✓ Essential (dev setup)
├── docker-compose.prod.yml        ✓ Essential (prod setup)
├── docker-compose.prod.backend.yml ✓ Essential (backend prod)
├── docker-compose.prod.frontend.yml ✓ Essential (frontend prod)
├── apps/                          ✓ All services organized
├── docs/                          ✓ All docs organized
├── scripts/                       ✓ All scripts organized
├── infra/                         ✓ Infrastructure organized
├── codex_bundle/                  ✓ Data organized
├── storage/                       ✓ Storage organized
├── memory/                        ✓ Notes organized
└── .git/                          ✓ Version control
```

## Migration Checklist

When organizing a messy root directory:

- [ ] Move all `.md` files to `docs/` subdirectories:
  - Fix guides → `docs/troubleshooting/` or `docs/archive/`
  - Deployment guides → `docs/deployment/`
  - Technical docs → `docs/` root or appropriate subfolder
  
- [ ] Move all shell scripts to `scripts/`:
  - Deploy scripts → `scripts/deploy/`
  - Fix scripts → `scripts/fixes/`
  - Utility scripts → `scripts/utils/`

- [ ] Move all utility files to `scripts/`:
  - JavaScript utilities → `scripts/utils/`
  - Node.js scripts → `scripts/`

- [ ] Update documentation with new paths
- [ ] Update deployment scripts with new paths
- [ ] Test all links and references

## Root Files Reference

### docker-compose.yml
**Purpose**: Local development environment with all services  
**Used for**: `docker-compose up -d` in development  
**Includes**: All 5 services, development volumes, no prod optimizations  

### docker-compose.prod.yml
**Purpose**: Production deployment on OCI  
**Used for**: `docker-compose -f docker-compose.prod.yml up` on production server  
**Includes**: Optimized images, prod environment vars, port mappings  

### .env
**Purpose**: Local development environment variables  
**Ignored by Git**: YES (security)  
**Contains**: Dev API URL, debug mode, local database config  

### .env.prod
**Purpose**: Production environment variables (template)  
**Ignored by Git**: YES (security - actual prod values separate)  
**Contains**: Production API URL, JWT secret, DB credentials  

### renovate.json
**Purpose**: Automated dependency updates  
**Manages**: npm package updates, Docker image updates  
**Keep in Root**: YES (required by Renovate bot)  

## Best Practices Going Forward

1. **Never add .md files to root** - Always create in `docs/` subdirectory
2. **Keep scripts organized** - All scripts go in `scripts/` with subdirectories
3. **Document your structure** - Maintain this file as reference
4. **Use meaningful names** - File names should clearly indicate purpose
5. **Update references** - When moving files, update all references to them
6. **Create READMEs** - Each folder should have a README explaining contents

---

**[← Back to Main README](./README.md)**
