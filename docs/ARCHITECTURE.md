# System Architecture - Claros DPP

## Overview

Claros DPP is a distributed microservices architecture designed for creating, managing, and publishing Digital Product Passports. The system consists of multiple containerized services communicating through RESTful APIs.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        External Users                            │
└────────┬────────────────────────────────────────────────────────┘
         │
         │ HTTPS
         │
┌────────▼─────────────────────────────────────────────────────────┐
│                    Caddy Reverse Proxy (80/443)                   │
│              (Handles SSL/TLS, routing, load balancing)          │
└────────┬────────────────────────────────────────────────────────┘
         │
    ┌────┴──────────────┬──────────────┬──────────────┐
    │                   │              │              │
    ▼                   ▼              ▼              ▼
┌─────────────┐   ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  Marketing  │   │  Frontend    │ │   Public     │ │    API       │
│    Site     │   │    App       │ │   Viewer     │ │   Server     │
│ (Static)    │   │  (Vue.js)    │ │  (Vue.js)    │ │ (Express)    │
│             │   │ Port 3000    │ │ Port 3004    │ │ Port 3001    │
│ (Nginx)     │   │  (Nginx)     │ │  (Nginx)     │ │              │
└─────────────┘   └──────┬───────┘ └──────┬───────┘ └──────┬──────┘
                         │                │               │
                         │                │               │
                    ┌────▼────────────────▼───────────────▼────┐
                    │                                          │
                    │        PostgreSQL Database               │
                    │    (Persistent Data Storage)             │
                    │                                          │
                    └──────────────────────────────────────────┘
```

---

## Service Architecture

### 1. Reverse Proxy Layer (Caddy)

**Responsibilities**:
- SSL/TLS encryption (HTTPS)
- Domain routing (claros-dpp.online)
- Request forwarding to backend services
- Load balancing
- Health checks

**Configuration**: `/infra/oracle/Caddyfile`

**Features**:
- Automatic certificate management
- HTTP/2 support
- Response compression
- Request logging

---

### 2. Marketing Site

**Type**: Static HTML/CSS/JavaScript

**Deployment**: Nginx in Docker container

**Architecture**:
```
Client Browser
    ↓
Caddy (reverse proxy)
    ↓
Nginx Container (serves static files)
    ↓
index.html, privacy-policy.html, terms-of-service.html, etc.
```

**Key Components**:
- `index.html` - Main page with hero section, features, CTA
- `shared.js` - Dynamically injects navbar and footer
- `styles.css` - Responsive styling
- `privacy-policy.html` - Privacy policy (23 sections + Cookie Policy)
- `terms-of-service.html` - Terms of Service (41 sections)

**Data Flow**: 
- User → HTTP GET request → Nginx → Returns HTML/CSS/JS
- Minimal backend dependency (pure static)

---

### 3. Frontend Application (Vue.js Dashboard)

**Type**: Single Page Application (SPA)

**Technology**: Vue 3 + Vite + Tailwind CSS

**Deployment**: Nginx in Docker container (production), Vite dev server (development)

**Architecture**:
```
Browser
    ↓
Caddy (reverse proxy)
    ↓
Nginx Container (serves SPA bundle)
    ↓
Vue.js Application
    ├── Authenticated user check
    ├── Route to pages (dashboard, settings, etc.)
    └── API calls to backend
```

**Directory Structure**:
```
apps/frontend-app/
├── src/
│   ├── components/     # Reusable Vue components
│   ├── pages/          # Page-level components
│   ├── services/       # API service layer
│   ├── stores/         # State management (Pinia)
│   ├── App.vue         # Root component
│   └── main.js         # Entry point
├── vite.config.js      # Build configuration
├── package.json        # Dependencies
└── Dockerfile          # Container configuration
```

**Key Features**:
- User authentication (JWT tokens)
- DPP management dashboard
- Workspace management
- Admin controls
- Settings and preferences
- Real-time data updates

**API Communication**:
- Uses Axios or Fetch API to call backend REST endpoints
- Includes JWT token in Authorization header
- Handles errors and loading states
- Caches responses when appropriate

---

### 4. Public Passport Viewer

**Type**: Single Page Application (SPA)

**Technology**: Vue 3 + Vite

**Deployment**: Nginx in Docker container (production), Vite dev server (development)

**Architecture**:
```
Public User (no login required)
    ↓
Caddy (reverse proxy)
    ↓
Nginx Container (serves SPA)
    ↓
Vue.js Application
    └── Fetch public DPP data via API
        ├── Display passport information
        ├── Show QR codes
        └── Export to JSON-LD, verifiable credentials
```

**Key Features**:
- View public Digital Product Passports
- QR code generation and scanning
- JSON-LD export
- Verifiable credentials support
- No authentication required
- Shareable links for public passports

**Data Flow**:
1. User accesses public link (e.g., `/viewer?dpp-id=123`)
2. Vue loads public DPP data from API (`/api/passports/:id/public`)
3. Display formatted passport information
4. User can share, export, or scan

---

### 5. Backend API Server (Express.js)

**Type**: RESTful API Server

**Technology**: Node.js, Express, PostgreSQL

**Deployment**: Docker container

**Architecture**:
```
Request
    ↓
Caddy (reverse proxy)
    ↓
Express Server (Port 3001)
    ├── Middleware Layer
    │   ├── Authentication (JWT verification)
    │   ├── Validation (request schema)
    │   ├── Error handling
    │   └── Logging
    ├── Routes Layer
    │   ├── /api/auth/* - Authentication endpoints
    │   ├── /api/passports/* - DPP endpoints
    │   ├── /api/workspaces/* - Workspace management
    │   ├── /api/users/* - User management
    │   └── /api/admin/* - Admin operations
    ├── Services Layer
    │   ├── Passport Service - DPP creation, validation, publishing
    │   ├── Auth Service - JWT token generation, validation
    │   ├── User Service - User operations
    │   ├── Database Service - Query abstraction
    │   └── File Service - Asset uploads
    └── Database Layer
        └── PostgreSQL queries
```

**Directory Structure**:
```
apps/backend-api/
├── Server/
│   └── server.js         # Express app initialization
├── routes/              # API route definitions
├── services/            # Business logic
│   ├── PassportService.js
│   ├── AuthService.js
│   ├── UserService.js
│   └── ...
├── middleware/          # Express middleware
│   ├── auth.js
│   ├── validation.js
│   ├── errorHandler.js
│   └── ...
├── db/                  # Database operations
│   ├── migrations/
│   ├── queries.js
│   └── schema.sql
├── helpers/             # Utility functions
├── tests/              # Jest test suites
└── package.json
```

**Key Features**:
- JWT-based authentication
- Request validation and error handling
- Database transactions
- Audit logging
- Rate limiting (optional)
- CORS configuration

**API Endpoints** (partial):
```
POST   /api/auth/register      - Create account
POST   /api/auth/login         - Login and get JWT
POST   /api/passports          - Create DPP
GET    /api/passports/:id      - Fetch DPP
PUT    /api/passports/:id      - Update DPP
DELETE /api/passports/:id      - Delete DPP
POST   /api/passports/:id/publish - Publish DPP
GET    /api/passports/:id/public - Get public DPP (no auth)
GET    /api/workspaces         - List user workspaces
POST   /api/users/:id/invite   - Invite user to workspace
```

---

## Database Architecture

### PostgreSQL Schema

**Core Tables**:

```
users
├── id (PK)
├── email (UNIQUE)
├── password_hash
├── first_name
├── last_name
├── created_at
└── updated_at

workspaces
├── id (PK)
├── owner_id (FK → users)
├── name
├── description
├── created_at
└── updated_at

workspace_members
├── workspace_id (FK)
├── user_id (FK)
├── role (admin, editor, viewer)
└── joined_at

digital_product_passports (DPPs)
├── id (PK)
├── workspace_id (FK)
├── product_id
├── product_name
├── data (JSONB) - Flexible schema
├── version
├── is_published
├── published_at
├── created_by (FK → users)
├── created_at
└── updated_at

audit_logs
├── id (PK)
├── user_id (FK)
├── action (created, updated, published, deleted)
├── entity_type (passport, user, workspace)
├── entity_id
├── changes (JSONB)
├── created_at

sessions
├── id (PK)
├── user_id (FK)
├── token_hash
├── expires_at
└── created_at
```

**Relationships**:
```
users ←──1:N──→ workspaces
users ←──N:N──→ workspaces (via workspace_members)
workspaces ←──1:N──→ digital_product_passports
users ←──1:N──→ digital_product_passports (created_by)
users ←──1:N──→ audit_logs
```

---

## Data Flow

### 1. User Registration & Authentication

```
User Registration Flow:
1. User fills form in Frontend
2. Frontend POST /api/auth/register { email, password, name }
3. Backend validates input
4. Backend hashes password
5. Backend creates user record in DB
6. Backend returns success

User Login Flow:
1. User submits credentials in Frontend
2. Frontend POST /api/auth/login { email, password }
3. Backend validates credentials
4. Backend generates JWT token
5. Backend returns { token, user }
6. Frontend stores JWT in localStorage
7. Frontend includes JWT in future requests (Authorization header)
```

### 2. DPP Creation & Publishing

```
DPP Creation Flow:
1. User submits passport data in Dashboard
2. Frontend POST /api/passports { data, workspace_id }
3. Backend validates DPP schema
4. Backend creates record in DB
5. Backend returns DPP object with ID
6. Frontend displays success and updates UI

DPP Publishing Flow:
1. User clicks "Publish" button
2. Frontend POST /api/passports/:id/publish
3. Backend marks DPP as published
4. Backend generates public link
5. Backend logs action in audit_logs
6. Public link available at /viewer?dpp-id=:id
```

### 3. Public Passport Viewing

```
1. Public user accesses /viewer?dpp-id=123
2. Public Viewer SPA loads
3. Vue app requests GET /api/passports/123/public
4. Backend verifies DPP is published
5. Backend returns passport data
6. Vue renders formatted passport
7. User can view, share, or export
```

### 4. Request Lifecycle (with Auth)

```
Frontend Request:
1. Component makes API call: fetch('/api/passports', {
     headers: { 'Authorization': 'Bearer <JWT>' }
   })
2. Request goes through Caddy (reverse proxy)
3. Caddy forwards to backend port 3001
4. Express middleware chain:
   a. Parse JSON body
   b. Extract JWT from Authorization header
   c. Verify JWT signature and expiry
   d. Attach user to request object
   e. Validate request schema
5. Route handler processes request
6. Service layer executes business logic
7. Database queries execute
8. Response constructed
9. Response sent through middleware
10. Caddy sends to Frontend
11. Frontend processes response
12. Vue component updates UI
```

---

## Error Handling

```
Error Flow:
1. Database error or validation failure
2. Service layer throws error
3. Error handler middleware catches
4. Error logged to console/file
5. Sanitized error response sent to client
6. Frontend handles error
7. User sees friendly error message
```

**HTTP Status Codes**:
- 200 OK - Successful request
- 201 Created - Resource created
- 400 Bad Request - Validation error
- 401 Unauthorized - Invalid/missing JWT
- 403 Forbidden - Insufficient permissions
- 404 Not Found - Resource not found
- 500 Internal Server Error - Server error

---

## Deployment Architecture

### Local Development (docker-compose.yml)

```
Host Machine
    ├── Port 3000 → Frontend dev server
    ├── Port 3001 → Backend API
    ├── Port 3004 → Public Viewer dev server
    ├── Port 8080 → Marketing site (Nginx)
    └── Port 5432 → PostgreSQL
```

All services in one Compose file, easy to start/stop.

### Production (OCI + Caddy)

```
Internet (0.0.0.0:80,443)
    ↓
Caddy Reverse Proxy (instance IP)
    ├── Route: claros-dpp.online → Frontend (port 3000)
    ├── Route: api.claros-dpp.online → Backend (port 3001)
    ├── Route: viewer.claros-dpp.online → Viewer (port 3004)
    └── Route: www.claros-dpp.online → Marketing (port 8080)

Each service in separate Docker container:
- Container 1: Frontend (Nginx + Vue bundle)
- Container 2: Backend API (Express)
- Container 3: Public Viewer (Nginx + Vue bundle)
- Container 4: Marketing Site (Nginx)
- Container 5: PostgreSQL (Database)
```

---

## Security Architecture

### Authentication
- JWT tokens (signed with HS256 or RS256)
- Tokens stored in browser localStorage
- Token expires after 24 hours (configurable)
- Refresh token mechanism (optional)

### Authorization
- Role-based access control (RBAC)
- Workspace-level permissions (admin, editor, viewer)
- API endpoints check user roles
- Public endpoints have explicit authentication bypass

### Data Protection
- Passwords hashed with bcrypt
- HTTPS/TLS for all traffic
- Sensitive data not logged
- Environment variables for secrets
- SQL prepared statements (prevent injection)

### Audit Logging
- All DPP operations logged
- User actions tracked in audit_logs table
- Includes who, what, when, where
- Enables security incident investigation

---

## Scalability Considerations

### Current Architecture
- Single PostgreSQL instance
- Services in separate containers
- Can run multiple backend replicas with load balancing

### Future Scaling
- Database read replicas for read-heavy workloads
- Cache layer (Redis) for frequently accessed data
- Message queue (RabbitMQ) for async operations
- Microservices split (separate services per domain)
- Horizontal scaling of containers via Kubernetes

---

## Monitoring & Observability

### Logs
- Application logs: stdout/stderr
- Caddy logs: Access and error logs
- Database logs: Query logs (slow query log)
- Collected via Docker logging driver

### Health Checks
- Caddy health endpoint: `/health`
- Backend API health: `/api/health`
- Database connectivity checks

### Metrics (optional)
- Response times
- Error rates
- Database query performance
- Container resource usage

---

## Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Reverse Proxy | Caddy | SSL/TLS, routing, load balancing |
| Frontend | Vue 3, Vite | Web dashboard UI |
| API Server | Node.js, Express | RESTful API |
| Database | PostgreSQL | Persistent data storage |
| Containerization | Docker | Container runtime |
| Container Orchestration | Docker Compose | Multi-container management |
| Testing | Jest | Unit and integration tests |
| API Documentation | OpenAPI 3.0 | API specification |

---

## Next Steps

For detailed information:
- [API Endpoints](../api/ENDPOINTS.md) - Full API reference
- [Database Schema](../DATABASE_SCHEMA.md) - Database design
- [Data Flow](../DATA_FLOW.md) - Detailed data movement
- [Deployment Guide](../deployment/OCI.md) - Production deployment

