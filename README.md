# Claros Digital Product Passport - Complete Platform

A comprehensive, production-ready platform for creating, managing, and publishing Digital Product Passports (DPPs) for products like batteries, electronic devices, and more.

---

## 🚀 Quick Start

### Local Development (5 minutes)

```bash
# 1. Clone repository
git clone https://github.com/yashd810/Digital-Product-Passport.git
cd Digital-Product-Passport

# 2. Setup environment
cp config/.env.local config/.env.local.backup  # or copy from template

# 3. Start services
docker-compose -f docker/docker-compose.yml up -d

# 4. Access applications
# Frontend: http://localhost:3000
# API: http://localhost:3001
# Public Viewer: http://localhost:3004
```

**[Detailed Local Setup →](./docs/guides/GETTING_STARTED.md)**

---

## 📋 What is Claros DPP?

Claros Digital Product Passport is a platform for:

✅ **Creating** structured digital passports for products
✅ **Managing** passport data with version control
✅ **Publishing** passports for public access
✅ **Sharing** passports with stakeholders
✅ **Tracking** compliance and environmental data

**Use Cases**:
- Battery recycling and circular economy (DIN SPEC 99100)
- Product authentication and anti-counterfeiting
- Supply chain transparency
- Regulatory compliance documentation
- Environmental impact tracking
- Product lifecycle management

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────┐
│          Frontend Dashboard (Vue.js)             │
│          http://localhost:3000                   │
└──────────────┬──────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────┐
│         REST API Server (Express.js)            │
│          http://localhost:3001                  │
└──────────────┬──────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────┐
│         PostgreSQL Database                     │
│         (localhost:5432)                        │
└───────────────────────────────────────────────┘

Additional Services:
├── Public Viewer (localhost:3004) - View public DPPs
├── Marketing Site (localhost:8080) - Static pages
└── Caddy (Production) - Reverse proxy + SSL/TLS
```

---

## 📁 Project Structure

```
Digital-Product-Passport/
├── apps/                      # Microservices (5 services)
│   ├── backend-api/          # REST API (Node.js/Express)
│   ├── frontend-app/         # Dashboard (Vue.js)
│   ├── public-passport-viewer/ # Public viewer (Vue.js)
│   ├── marketing-site/       # Static pages (HTML/CSS)
│   └── asset-management/     # Asset service
│
├── docs/                      # Complete documentation (26+ files)
│   ├── guides/               # Setup and usage guides
│   ├── api/                 # API documentation
│   ├── deployment/          # Deployment guides
│   ├── development/         # Development guidelines
│   ├── infrastructure/      # Infrastructure setup
│   ├── security/           # Security documentation
│   ├── troubleshooting/     # Troubleshooting guides
│   ├── archive/            # Historical documentation
│   ├── ARCHITECTURE.md      # System overview
│   ├── DATABASE_SCHEMA.md   # Database design
│   └── DATA_FLOW.md        # Data movement
│
├── docker/                   # Docker configuration files
│   ├── docker-compose.yml        # Local development
│   ├── docker-compose.prod.yml   # Production main
│   ├── docker-compose.prod.backend.yml
│   ├── docker-compose.prod.frontend.yml
│   └── .dockerignore            # Docker ignore rules
│
├── config/                   # Configuration files
│   ├── .env.local           # Local development config
│   └── .env.production      # Production config (template)
│
├── data/                     # Data files & datasets
│   └── 2026_BatteryPass-Ready_DataAttributeLongList_v1.3.xlsx
│
├── scripts/                  # Deployment & utility scripts
│   ├── deploy/             # Deployment scripts
│   └── utils/              # Utility scripts
│
├── infra/                    # Infrastructure & DevOps
│   ├── docker/              # Docker configurations
│   └── oracle/             # OCI cloud setup
│
├── LICENSE                  # MIT License
├── README.md               # This file (main entry point)
└── renovate.json           # Dependency management
```

---

## 🛠️ Technology Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Vue 3, Vite, Tailwind CSS |
| **Backend** | Node.js, Express.js |
| **Database** | PostgreSQL |
| **Authentication** | JWT tokens |
| **Containerization** | Docker, Docker Compose |
| **Reverse Proxy** | Caddy, Nginx |
| **Cloud** | Oracle Cloud Infrastructure (OCI) |
| **Testing** | Jest, Vue Test Utils |
| **API Docs** | OpenAPI 3.0 |

---

## 📊 Features

### 🔐 Authentication & Authorization
- JWT-based authentication
- Role-based access control (RBAC)
- Three roles: admin, editor, viewer
- Workspace-level permissions
- Session management

### 📄 DPP Management
- Create digital product passports
- Flexible JSONB data schema
- Version control and history
- Audit logging of all changes
- Soft delete support

### 🌐 Publishing & Sharing
- Publish passports for public access
- Generate shareable links
- No authentication required for public viewers
- Export to JSON-LD and verifiable credentials
- QR code support

### 👥 Collaboration
- Create workspaces
- Invite team members
- Manage workspace members
- Activity tracking
- Workspace-level permissions

### 🔒 Security
- Password hashing (bcrypt)
- HTTPS/TLS encryption
- Parameterized database queries
- Input validation and sanitization
- Audit logging
- Secure session management

---

## 📚 Documentation

### Getting Started
- **[5-Minute Quick Start](./docs/guides/GETTING_STARTED.md)** - Quick setup guide
- **[Local Development Setup](./docs/deployment/LOCAL.md)** - Detailed local setup
- **[Production OCI Deployment](./docs/deployment/OCI.md)** - Deploy to cloud

### System Understanding
- **[Architecture Overview](./docs/ARCHITECTURE.md)** - System design
- **[Database Schema](./docs/DATABASE_SCHEMA.md)** - Database structure
- **[Data Flow](./docs/DATA_FLOW.md)** - How data moves
- **[Project Structure](./docs/PROJECT_STRUCTURE.md)** - Directory guide

### API & Development
- **[REST API Endpoints](./docs/api/ENDPOINTS.md)** - Complete API reference
- **[Development Guidelines](./docs/development/DEVELOPMENT.md)** - Coding standards
- **[Authentication](./docs/api/AUTHENTICATION.md)** - Auth mechanisms

### Infrastructure
- **[Docker Setup](./docs/infrastructure/DOCKER.md)** - Container configuration
- **[Caddy Configuration](./docs/infrastructure/CADDY.md)** - Reverse proxy setup

### Security
- **[Authentication & Authorization](./docs/security/AUTHENTICATION.md)** - Auth details
- **[Data Protection](./docs/security/DATA_PROTECTION.md)** - Encryption & protection

**[👉 Complete Documentation Index →](./docs/README.md)**

---

## 🚀 Getting Started

### Prerequisites

**Minimum Requirements**:
- Docker Desktop (includes Docker & Docker Compose)
- Git
- 8GB RAM available
- 50GB disk space
- macOS, Linux, or Windows with WSL2

**Installation**:
- [Docker Desktop](https://www.docker.com/products/docker-desktop)
- [Git](https://git-scm.com/downloads)

### Setup Steps

**1. Clone Repository**
```bash
git clone https://github.com/yashd810/Digital-Product-Passport.git
cd Digital-Product-Passport
```

**2. Configure Environment**
```bash
cp .env.example .env
# Edit if needed (defaults work for local dev)
```

**3. Start All Services**
```bash
docker-compose up -d
```

**4. Wait for Startup**
```bash
sleep 30  # Wait for database initialization
docker-compose ps  # Check status
```

**5. Access Applications**

| Service | URL | Purpose |
|---------|-----|---------|
| Frontend | http://localhost:3000 | Dashboard |
| API | http://localhost:3001 | REST API |
| Public Viewer | http://localhost:3004 | View public DPPs |
| Marketing | http://localhost:8080 | Static pages |

**6. Create Account**
- Go to http://localhost:3000
- Click "Sign Up"
- Fill in details and create account
- Start using the platform!

---

## 🎯 Common Tasks

### Create a Test DPP

1. Sign up at http://localhost:3000
2. Create a workspace
3. Click "Create Passport"
4. Fill in DPP data:
   - Product ID
   - Product Name
   - Additional data (capacity, manufacturer, etc.)
5. Click "Create"
6. Click "Publish" to make public
7. Share public link with others

### View Public DPP

1. After publishing, copy the public link
2. Share link or access directly
3. No login required
4. View, export, or share further

### Run Tests

```bash
# Backend tests
cd apps/backend-api
npm test

# Frontend tests
cd apps/frontend-app
npm test
```

### Reset Database

```bash
# WARNING: Deletes all data
docker-compose down -v
docker-compose up -d
```

### View Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f backend-api
docker-compose logs -f frontend-app
docker-compose logs -f postgres
```

---

## 🏗️ API Overview

### Authentication
```
POST   /api/auth/register      # Create account
POST   /api/auth/login         # Login
POST   /api/auth/logout        # Logout
POST   /api/auth/refresh       # Refresh token
```

### DPPs
```
GET    /api/passports                  # List DPPs
POST   /api/passports                  # Create DPP
GET    /api/passports/:id              # Get DPP
PUT    /api/passports/:id              # Update DPP
DELETE /api/passports/:id              # Delete DPP
POST   /api/passports/:id/publish      # Publish DPP
GET    /api/passports/:id/public       # Get public DPP (no auth)
```

### Workspaces
```
GET    /api/workspaces                 # List workspaces
POST   /api/workspaces                 # Create workspace
GET    /api/workspaces/:id             # Get workspace
PUT    /api/workspaces/:id             # Update workspace
DELETE /api/workspaces/:id             # Delete workspace
```

### Members
```
GET    /api/workspaces/:id/members                # List members
POST   /api/workspaces/:id/invite                 # Invite user
PUT    /api/workspaces/:id/members/:userId        # Update role
DELETE /api/workspaces/:id/members/:userId        # Remove member
```

**[Complete API Reference →](./docs/api/ENDPOINTS.md)**

---

## 🔍 Database

**Core Tables**:
- `users` - User accounts
- `workspaces` - Organizational units
- `workspace_members` - User-workspace mappings
- `digital_product_passports` - DPP data
- `passport_versions` - Version history
- `audit_logs` - Change tracking
- `sessions` - Active sessions
- `invitations` - Pending invitations

**[Complete Schema →](./docs/DATABASE_SCHEMA.md)**

---

## 🐛 Troubleshooting

### Port Already in Use
```bash
lsof -i :3000  # Find process
kill -9 <PID>  # Kill process
```

### Database Connection Error
```bash
docker-compose restart postgres
sleep 30
```

### Frontend Can't Connect to API
```bash
# Check API is running
curl http://localhost:3001/api/health

# Update VITE_API_URL in .env if needed
docker-compose restart frontend-app
```

### Out of Memory
Increase Docker memory in Docker Desktop settings (Preferences → Resources)

**[More Troubleshooting →](./docs/deployment/LOCAL.md#troubleshooting)**

---

## 📦 Docker Commands

```bash
# Start services
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f

# Stop services
docker-compose stop

# Restart services
docker-compose restart

# Remove everything
docker-compose down

# Clean up (WARNING: deletes data)
docker-compose down -v
```

---

## 👨‍💻 Development

### Code Structure

**Frontend** (`apps/frontend-app/`):
- Vue 3 with Composition API
- Vite for bundling
- Pinia for state management
- Tailwind CSS for styling

**Backend** (`apps/backend-api/`):
- Express.js server
- PostgreSQL with migrations
- JWT authentication
- Jest for testing
- Service layer architecture

**Public Viewer** (`apps/public-passport-viewer/`):
- Vue 3 SPA for public access
- No authentication required
- Display and export DPP data

### Development Guidelines

- **[Coding Standards](./docs/development/DEVELOPMENT.md)** - Code style and patterns
- **[Testing Guidelines](./docs/development/DEVELOPMENT.md#testing)** - How to write tests
- **[Git Workflow](./docs/development/DEVELOPMENT.md#git-workflow)** - Commit and branch naming

### Running Tests

```bash
# Backend
cd apps/backend-api
npm test              # Run all tests
npm test -- --watch  # Watch mode
npm test -- --coverage

# Frontend
cd apps/frontend-app
npm test
```

---

## 🚀 Production Deployment

### OCI Cloud Deployment

Complete setup for production deployment:

```bash
# 1. Setup OCI instance (Ubuntu 24.04 LTS)
# 2. Configure environment variables
# 3. Setup Caddy reverse proxy
# 4. Deploy with Docker Compose
# 5. Enable automated backups
# 6. Monitor health and logs
```

**[Complete OCI Deployment Guide →](./docs/deployment/OCI.md)**

---

## 📊 Project Statistics

- **Microservices**: 5 services
- **Database Tables**: 10 core tables
- **API Endpoints**: 30+ endpoints
- **Documentation Pages**: 15+ guides
- **Code Quality**: ESLint, Prettier, Jest
- **Type Safety**: TypeScript ready

---

## 🤝 Contributing

We welcome contributions! Please:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Follow [Development Guidelines](./docs/development/DEVELOPMENT.md)
4. Write tests for new features
5. Submit a pull request

---

## 📄 License

MIT License - See [LICENSE](./LICENSE) file

---

## 📞 Support

- **Documentation**: [docs/](./docs/) folder with complete guides
- **Issues**: GitHub Issues page
- **API Reference**: [docs/api/ENDPOINTS.md](./docs/api/ENDPOINTS.md)
- **Architecture**: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)

---

## 🔗 Quick Links

| Topic | Link |
|-------|------|
| Quick Start | [guides/GETTING_STARTED.md](./docs/guides/GETTING_STARTED.md) |
| API Reference | [api/ENDPOINTS.md](./docs/api/ENDPOINTS.md) |
| Architecture | [ARCHITECTURE.md](./docs/ARCHITECTURE.md) |
| Database | [DATABASE_SCHEMA.md](./docs/DATABASE_SCHEMA.md) |
| Local Setup | [deployment/LOCAL.md](./docs/deployment/LOCAL.md) |
| Production | [deployment/OCI.md](./docs/deployment/OCI.md) |
| Development | [development/DEVELOPMENT.md](./docs/development/DEVELOPMENT.md) |
| All Docs | [docs/README.md](./docs/README.md) |

---

## 🎯 Roadmap

- ✅ Core DPP management
- ✅ User authentication and authorization
- ✅ Workspace collaboration
- ✅ Public sharing
- 🔄 Advanced analytics
- 🔄 Mobile app
- 🔄 Blockchain integration
- 🔄 Advanced search

---

## 📈 Status

- **Platform**: ✅ Production Ready
- **Version**: 1.0.0
- **Last Updated**: May 4, 2026
- **License**: MIT

---

## 💡 Key Concepts

### Digital Product Passport (DPP)
A structured document containing complete information about a product's lifecycle, materials, environmental impact, and recycling instructions.

### Workspace
An organizational unit where team members collaborate on related DPPs.

### Role-Based Access Control (RBAC)
Permission system with three roles:
- **Admin**: Full access, manage members
- **Editor**: Can create and edit DPPs
- **Viewer**: Read-only access

### Public Access
DPPs can be published to allow public viewing without authentication.

---

**Questions? See the [complete documentation](./docs/README.md)!**

Recommended:
- `DID_WEB_DOMAIN`
- `PUBLIC_APP_URL`
- `ALLOWED_ORIGINS`
- `STORAGE_PROVIDER`

## How to regenerate the battery dictionary

Code/files:
- `scripts/generate-battery-dictionary.js`
- `apps/backend-api/resources/semantics/battery/v1/`
- `apps/frontend-app/src/shared/semantics/battery-dictionary-terms.generated.json`

Run:
```bash
node scripts/generate-battery-dictionary.js
```

That script rewrites the backend dictionary artifacts and the generated frontend term list.

## How to rotate signing keys

Code/files:
- `apps/backend-api/services/signing-service.js`
- `apps/backend-api/db/init.js`

Use an EC P-256 keypair for new issuance:
```js
const crypto = require("crypto");
const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
  namedCurve: "P-256",
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" }
});
```

Steps:
1. Replace `SIGNING_PRIVATE_KEY` and `SIGNING_PUBLIC_KEY` with the new P-256 PEM values.
2. Restart `backend-api`.
3. Confirm a new row appears in `passport_signing_keys` with `algorithm_version = 'ES256'`.
4. Verify `GET /api/passports/:guid/signature` returns `algorithm: "ES256"` for newly released passports.

Migration notes:
- Existing RSA-backed rows remain verifiable because verification accepts both `RS256` and `ES256`.
- New VC proofs stay on `JsonWebSignature2020`, but the JWS header now uses `ES256` when the active key is P-256.
