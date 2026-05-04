# Claros Digital Product Passport - Complete Documentation

Welcome to the Claros DPP documentation! This guide covers everything you need to know about our platform.

---

## 📚 Documentation Guide

### Getting Started
- **[GETTING_STARTED.md](./guides/GETTING_STARTED.md)** - Quick 5-minute setup guide
- **[README.md](../README.md)** - Project overview and quick reference

### Understanding the System
- **[PROJECT_STRUCTURE.md](./PROJECT_STRUCTURE.md)** - Directory structure and organization
- **[ARCHITECTURE.md](./ARCHITECTURE.md)** - System design and component interactions
- **[DATA_FLOW.md](./DATA_FLOW.md)** - How data moves through the system
- **[DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md)** - Complete database structure

### Development
- **[development/DEVELOPMENT.md](./development/DEVELOPMENT.md)** - Coding standards and best practices
- **[api/ENDPOINTS.md](./api/ENDPOINTS.md)** - Complete REST API reference
- **[api/AUTHENTICATION.md](./api/AUTHENTICATION.md)** - Auth mechanisms and JWT

### Deployment
- **[deployment/LOCAL.md](./deployment/LOCAL.md)** - Local development with Docker
- **[deployment/OCI.md](./deployment/OCI.md)** - Production deployment on OCI

### Infrastructure
- **[infrastructure/DOCKER.md](./infrastructure/DOCKER.md)** - Docker configuration
- **[infrastructure/CADDY.md](./infrastructure/CADDY.md)** - Reverse proxy setup
- **[infrastructure/DATABASE.md](./infrastructure/DATABASE.md)** - Database management

### Security
- **[security/AUTHENTICATION.md](./security/AUTHENTICATION.md)** - Auth flows and JWT
- **[security/DATA_PROTECTION.md](./security/DATA_PROTECTION.md)** - Encryption and protection

---

## 🚀 Quick Start

### Local Development (5 minutes)

1. **Clone & Setup**
   ```bash
   git clone https://github.com/yashd810/Digital-Product-Passport.git
   cd Digital-Product-Passport
   cp .env.example .env
   ```

2. **Start Services**
   ```bash
   docker-compose up -d
   ```

3. **Access Apps**
   - Frontend: http://localhost:3000
   - API: http://localhost:3001
   - Viewer: http://localhost:3004

4. **Create Account**
   - Go to http://localhost:3000
   - Sign up and start creating DPPs!

**[Complete Local Setup Guide →](./guides/GETTING_STARTED.md)**

---

## 📋 What is Claros DPP?

Claros Digital Product Passport (DPP) is a comprehensive platform for:

- **Creating** structured digital passports for products
- **Managing** passport data with version control
- **Publishing** passports for public access
- **Sharing** passports with stakeholders
- **Tracking** who has accessed and modified passports

**Use Cases**:
- Battery recycling and circular economy
- Product authentication and traceability
- Supply chain transparency
- Regulatory compliance (DIN SPEC 99100)
- Environmental impact tracking

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────┐
│        Frontend Dashboard               │
│      (Vue.js, localhost:3000)          │
└────────┬────────────────────────────────┘
         │
┌────────▼────────────────────────────────┐
│       REST API Server                   │
│    (Express, localhost:3001)            │
└────────┬────────────────────────────────┘
         │
┌────────▼────────────────────────────────┐
│      PostgreSQL Database                │
│     (localhost:5432)                    │
└─────────────────────────────────────────┘
```

**Additional Services**:
- **Public Viewer** (localhost:3004) - View published passports
- **Marketing Site** (localhost:8080) - Static landing pages
- **Caddy Reverse Proxy** (Production) - SSL/TLS and routing

**[Detailed Architecture →](./ARCHITECTURE.md)**

---

## 📂 Project Structure

```
Digital-Product-Passport/
├── apps/                      # Application services
│   ├── backend-api/          # REST API (Node.js, Express)
│   ├── frontend-app/         # Dashboard (Vue.js)
│   ├── public-passport-viewer/ # Public viewer
│   ├── marketing-site/       # Static pages
│   └── asset-management/     # Asset service
├── docs/                      # Documentation (you are here)
├── infra/                    # Infrastructure configs
│   ├── docker/              # Docker and Nginx configs
│   └── oracle/              # OCI cloud setup
├── scripts/                  # Deployment scripts
└── docker-compose.yml        # Local development
```

**[Complete Structure →](./PROJECT_STRUCTURE.md)**

---

## 🔧 Technology Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Frontend** | Vue 3, Vite, Tailwind CSS | Web dashboard UI |
| **Backend** | Node.js, Express, PostgreSQL | REST API server |
| **Public Viewer** | Vue 3, Vite | Public passport viewer |
| **Marketing Site** | HTML5, CSS3 | Static pages |
| **Containerization** | Docker, Docker Compose | Container runtime |
| **Reverse Proxy** | Caddy, Nginx | SSL/TLS and routing |
| **Cloud** | Oracle Cloud (OCI) | Production hosting |
| **Database** | PostgreSQL | Data persistence |

---

## 🔐 Key Features

### Authentication & Authorization
- JWT-based authentication
- Role-based access control (RBAC)
- Workspace-level permissions
- Session management

### DPP Management
- Create and edit digital passports
- Flexible JSONB data schema
- Version control and history
- Audit logging of all changes

### Publishing & Sharing
- Publish passports for public viewing
- Generate shareable public links
- No authentication required for public viewers
- Export to JSON-LD and verifiable credentials

### Data Security
- Password hashing (bcrypt)
- HTTPS/TLS encryption
- Parameterized database queries
- Input validation and sanitization

**[Security Details →](./security/AUTHENTICATION.md)**

---

## 📊 Database Schema

**Core Tables**:
- `users` - User accounts
- `workspaces` - Organizational units
- `workspace_members` - User-workspace mappings
- `digital_product_passports` - DPP data
- `passport_versions` - Version history
- `audit_logs` - Change tracking
- `sessions` - Active sessions
- `invitations` - Pending invites

**[Complete Schema →](./DATABASE_SCHEMA.md)**

---

## 🔄 Data Flow

### User Creates a DPP

```
1. User fills form → Frontend
2. Frontend validates → POST /api/passports
3. Backend validates schema → Database
4. Database stores → Returns ID
5. Frontend receives → Updates UI
```

### DPP Publishing

```
1. Click "Publish" → Frontend
2. PUT /api/passports/:id/publish → Backend
3. Backend marks published → Database
4. Generates public link → Returns to Frontend
5. Public accessible at /viewer?dpp-id=...
```

**[Detailed Data Flow →](./DATA_FLOW.md)**

---

## 🌐 API Reference

All REST endpoints with full documentation:

```
POST   /api/auth/register          - Create account
POST   /api/auth/login             - Login
POST   /api/passports              - Create DPP
GET    /api/passports              - List DPPs
GET    /api/passports/:id          - Get DPP
PUT    /api/passports/:id          - Update DPP
POST   /api/passports/:id/publish  - Publish DPP
GET    /api/passports/:id/public   - Get public DPP (no auth)
GET    /api/workspaces             - List workspaces
POST   /api/workspaces             - Create workspace
```

**[Complete API Reference →](./api/ENDPOINTS.md)**

---

## 👨‍💻 Development

### Code Standards
- ESLint & Prettier for formatting
- Jest for testing
- Meaningful commit messages
- Code review process

### Frontend Guidelines
- Vue 3 Composition API
- TypeScript (recommended)
- Component-based architecture
- State management with Pinia

### Backend Guidelines
- Express middleware pattern
- Services layer abstraction
- Error handling best practices
- Database transaction support

**[Development Guidelines →](./development/DEVELOPMENT.md)**

---

## 🚀 Deployment

### Local Development
```bash
docker-compose up -d
# Access at http://localhost:3000
```

### OCI Production
```bash
# Complete production setup with:
# - Ubuntu 24.04 LTS VM
# - Caddy reverse proxy
# - SSL/TLS certificates
# - PostgreSQL database
# - Automatic backups
```

**[Local Setup Guide →](./deployment/LOCAL.md)**

**[OCI Production Guide →](./deployment/OCI.md)**

---

## 🔍 API Responses

### Success
```json
{
  "success": true,
  "data": { ... },
  "message": "Operation successful"
}
```

### Error
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable error",
    "details": [ ... ]
  }
}
```

---

## 🧪 Testing

**Backend Tests**:
```bash
cd apps/backend-api
npm test              # Run all tests
npm test -- --watch  # Watch mode
npm test -- --coverage
```

**Frontend Tests**:
```bash
cd apps/frontend-app
npm test
```

---

## 📝 Common Tasks

### Create a Test DPP
1. Sign up at http://localhost:3000
2. Create workspace
3. Click "Create Passport"
4. Fill in details and submit
5. Publish to make public

### Reset Database
```bash
docker-compose down -v
docker-compose up -d
```

### View Logs
```bash
docker-compose logs -f backend-api
docker-compose logs -f frontend-app
```

### Access Database
```bash
docker-compose exec postgres psql -U dpp_user -d dpp_db
```

---

## 🐛 Troubleshooting & Support

### Common Issues

**Authentication Issues** - "Invalid or expired token"
- Missing COOKIE_DOMAIN configuration
- JWT token expired or invalid
- Cross-subdomain cookie issues
- **[Authentication Guide →](./troubleshooting/COMMON_ISSUES.md#authentication-issues)**

**CORS & Domain Issues** - "CORS policy blocked"
- CORS middleware not configured
- Credentials not enabled in frontend/backend
- Preflight requests not handled
- **[CORS Solutions →](./troubleshooting/COMMON_ISSUES.md#cors--domain-issues)**

**Database Connection** - "connect ECONNREFUSED"
- Database container not running
- Incorrect connection credentials
- Host name resolution issues
- **[Database Troubleshooting →](./troubleshooting/COMMON_ISSUES.md#database-issues)**

**Port Already in Use** - "EADDRINUSE"
```bash
lsof -i :3000  # Find process using port
kill -9 <PID>  # Kill the process
```

**Complete Troubleshooting Guide**:
- **[Common Issues & Solutions](./troubleshooting/COMMON_ISSUES.md)** - Comprehensive troubleshooting reference
- **[Archived Fixes](./archive/README.md)** - Historical issues and solutions
- **[Local Development Issues](./deployment/LOCAL.md#troubleshooting)** - Development-specific problems

---

## 📚 More Documentation

### Getting Started Quickly
- [5-Minute Quick Start](./guides/GETTING_STARTED.md)
- [Local Development Setup](./deployment/LOCAL.md)
- [Production Deployment](./deployment/OCI.md)

### Understanding the System
- [Architecture Overview](./ARCHITECTURE.md)
- [Database Schema](./DATABASE_SCHEMA.md)
- [Data Flow Diagrams](./DATA_FLOW.md)
- [Project Structure](./PROJECT_STRUCTURE.md)

### API Documentation
- [REST Endpoints](./api/ENDPOINTS.md)
- [Authentication](./api/AUTHENTICATION.md)

### Development
- [Coding Standards](./development/DEVELOPMENT.md)
- [Testing Guidelines](./development/TESTING.md)
- [Git Workflow](./development/CONTRIBUTING.md)

### Infrastructure
- [Docker Setup](./infrastructure/DOCKER.md)
- [Caddy Configuration](./infrastructure/CADDY.md)
- [Database Management](./infrastructure/DATABASE.md)

### Security
- [Authentication & Authorization](./security/AUTHENTICATION.md)
- [Data Protection](./security/DATA_PROTECTION.md)
- [Audit Logging](./security/AUDIT_LOGGING.md)

---

## 🤝 Contributing

1. Create feature branch: `git checkout -b feature/your-feature`
2. Make changes following [Development Guidelines](./development/DEVELOPMENT.md)
3. Write tests for new features
4. Commit with meaningful messages: `git commit -m "feat: add feature"`
5. Push and create pull request

**[Contribution Guidelines →](./development/CONTRIBUTING.md)**

---

## 📞 Support

- **Documentation**: Everything is in `/docs` folder
- **Issues**: GitHub Issues page
- **API Docs**: [api/ENDPOINTS.md](./api/ENDPOINTS.md)
- **Architecture**: [ARCHITECTURE.md](./ARCHITECTURE.md)
- **Deployment**: [deployment/OCI.md](./deployment/OCI.md)

---

## 📄 License

MIT License - See [LICENSE](../LICENSE) file

---

## 🎯 Quick Links

| Need Help With | Link |
|---|---|
| Getting Started | [guides/GETTING_STARTED.md](./guides/GETTING_STARTED.md) |
| Understanding System | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| REST API | [api/ENDPOINTS.md](./api/ENDPOINTS.md) |
| Database | [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) |
| Local Setup | [deployment/LOCAL.md](./deployment/LOCAL.md) |
| Production Deployment | [deployment/OCI.md](./deployment/OCI.md) |
| Coding Standards | [development/DEVELOPMENT.md](./development/DEVELOPMENT.md) |
| Troubleshooting Issues | [troubleshooting/COMMON_ISSUES.md](./troubleshooting/COMMON_ISSUES.md) |
| Docker Guide | [infrastructure/DOCKER.md](./infrastructure/DOCKER.md) |
| Database Management | [infrastructure/DATABASE.md](./infrastructure/DATABASE.md) |
| Authentication & Security | [security/AUTHENTICATION.md](./security/AUTHENTICATION.md) |
| Data Protection | [security/DATA_PROTECTION.md](./security/DATA_PROTECTION.md) |
| Audit Logging | [security/AUDIT_LOGGING.md](./security/AUDIT_LOGGING.md) |
| Historical Issues | [archive/README.md](./archive/README.md) |

---

## 📊 Statistics

- **Services**: 5 microservices
- **Database Tables**: 10 core tables
- **API Endpoints**: 30+ endpoints
- **Technology Stack**: 8+ technologies
- **Documentation Pages**: 15+ guides
- **Code Quality**: ESLint + Prettier + Jest

---

**Last Updated**: May 4, 2026

**Version**: 1.0.0

**Status**: ✅ Production Ready

