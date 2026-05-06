# Getting Started - Local Development

## Table of Contents

1. [Quick Start (5 minutes)](#quick-start-5-minutes)
2. [Detailed Setup](#detailed-setup)
3. [Development Workflow](#development-workflow)
4. [Common Tasks](#common-tasks)
5. [Debugging & Troubleshooting](#debugging)
6. [IDE Setup](#ide-setup)
7. [Next Steps](#next-steps)
8. [Getting Help](#getting-help)

---

## Quick Start (5 minutes)

### Prerequisites

- Docker Desktop installed (Mac, Windows, Linux)
- Git installed
- Node.js 20+ (optional, for local development)
- 8GB+ RAM available
- Ports 3000, 3001, 3004, 5432, 8080 available

### Steps

1. **Clone Repository**
```bash
git clone https://github.com/yashd810/Digital-Product-Passport.git
cd Digital-Product-Passport
```

2. **Configure Environment**
```bash
cp .env.example .env
# Edit .env with your settings (optional for local dev)
```

3. **Start Services**
```bash
docker-compose up -d
```

4. **Wait for Services**
```bash
# Wait 30 seconds for database to initialize
sleep 30
docker-compose logs
```

5. **Access Applications**

| Service | URL | Purpose |
|---------|-----|---------|
| Frontend | http://localhost:3000 | Dashboard (login/sign up) |
| Backend API | http://localhost:3001 | REST API endpoints |
| Public Viewer | http://localhost:3004 | View public passports |
| Marketing Site | http://localhost:8080 | Marketing pages |

6. **Create Account**
- Go to http://localhost:3000
- Click "Sign Up"
- Fill in details and submit
- Start creating Digital Product Passports!

---

## Detailed Setup

### 1. System Requirements

**Minimum**:
- CPU: 4 cores
- RAM: 8GB (6GB available for Docker)
- Disk: 50GB free

**Recommended**:
- CPU: 8 cores
- RAM: 16GB+
- Disk: 100GB SSD

### 2. Install Docker

**macOS** (using Homebrew):
```bash
brew install docker
brew install docker-compose
```

Or download [Docker Desktop](https://www.docker.com/products/docker-desktop)

**Ubuntu/Debian**:
```bash
sudo apt update
sudo apt install docker.io docker-compose
sudo usermod -aG docker $USER
```

**Windows**:
Download and install [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop)

### 3. Clone Repository

```bash
git clone https://github.com/yashd810/Digital-Product-Passport.git
cd Digital-Product-Passport
```

### 4. Environment Configuration

**Copy example env file**:
```bash
cp .env.example .env
```

**Edit .env** (optional for local development):
```bash
# Database
DB_HOST=postgres
DB_PORT=5432
DB_NAME=dpp_db
DB_USER=dpp_user
DB_PASSWORD=dev_password

# API
API_PORT=3001
API_BASE_URL=http://localhost:3001

# Frontend
VITE_API_URL=http://localhost:3001
VITE_PUBLIC_VIEWER_URL=http://localhost:3004

# JWT
JWT_SECRET=your-secret-key-here
JWT_EXPIRY=24h

# Node Env
NODE_ENV=development
```

### 5. Start Services

**Start all services**:
```bash
docker-compose up -d
```

**Check service status**:
```bash
docker-compose ps
```

**View logs**:
```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f backend-api
docker-compose logs -f frontend-app
```

**Stop services**:
```bash
docker-compose down
```

**Restart services**:
```bash
docker-compose restart
```

### 6. Database Initialization

The database automatically initializes from `apps/backend-api/db/schema.sql` on first run.

**Manual initialization** (if needed):
```bash
docker-compose exec postgres psql -U dpp_user -d dpp_db < apps/backend-api/db/schema.sql
```

**Access database directly**:
```bash
docker-compose exec postgres psql -U dpp_user -d dpp_db
```

---

## Development Workflow

### Working on Frontend

**Change directory**:
```bash
cd apps/frontend-app
```

**Install dependencies** (first time only):
```bash
npm install
```

**Start dev server** (alternative to Docker):
```bash
npm run dev
```

**Build for production**:
```bash
npm run build
```

**Run tests**:
```bash
npm test
```

**The app will hot-reload** as you edit files.

### Working on Backend API

**Change directory**:
```bash
cd apps/backend-api
```

**Install dependencies** (first time only):
```bash
npm install
```

**Start dev server** (alternative to Docker):
```bash
npm run dev
```

**Run tests**:
```bash
npm test
```

**View logs**:
```bash
npm run logs
```

### Working on Public Viewer

**Change directory**:
```bash
cd apps/public-passport-viewer
```

**Install dependencies**:
```bash
npm install
```

**Start dev server**:
```bash
npm run dev
```

**Access at**: http://localhost:3004

---

## Common Tasks

### Create a Test DPP

1. Go to http://localhost:3000
2. Sign up for account
3. Click "Create Passport"
4. Fill in DPP information:
   - Product ID
   - Product Name
   - Data (JSON format)
5. Click "Create"
6. Click "Publish" to make public
7. Share public link

### View Public Passport

1. After publishing DPP, copy public link
2. Go to http://localhost:3004/viewer?dpp-id=<ID>
3. View passport details
4. Export to JSON-LD or verifiable credentials

### Run Tests

**Backend tests**:
```bash
cd apps/backend-api
npm test
```

**Frontend tests** (if configured):
```bash
cd apps/frontend-app
npm test
```

### Check Database

```bash
# Connect to database
docker-compose exec postgres psql -U dpp_user -d dpp_db

# List tables
\dt

# View users
SELECT id, email, created_at FROM users;

# View passports
SELECT id, product_name, is_published FROM digital_product_passports;

# Exit
\q
```

### Reset Database

**WARNING**: This deletes all data

```bash
docker-compose down
docker volume rm claros-dpp_postgres_data
docker-compose up -d
```

### View Docker Container Logs

```bash
# All containers
docker-compose logs

# Specific container
docker-compose logs backend-api
docker-compose logs frontend-app
docker-compose logs postgres

# Follow logs
docker-compose logs -f
```

### Debugging

**Enable debug logging** in .env:
```bash
DEBUG=dpp:*
LOG_LEVEL=debug
```

**Inspect running container**:
```bash
docker-compose exec backend-api bash
```

**View container stats**:
```bash
docker stats
```

---

## Troubleshooting

### Port Already in Use

If ports 3000, 3001, etc. are in use:

```bash
# Find process using port
lsof -i :3000

# Kill process
kill -9 <PID>

# Or change port in docker-compose.yml
```

### Database Connection Error

```bash
# Check database is running
docker-compose ps

# Check database logs
docker-compose logs postgres

# Restart database
docker-compose restart postgres
```

### Frontend Can't Connect to API

```bash
# Check backend is running
curl http://localhost:3001/api/health

# Check VITE_API_URL in .env is correct
# Default: http://localhost:3001

# Restart frontend
docker-compose restart frontend-app
```

### Out of Memory

Increase Docker memory allocation:
- **Mac/Windows**: Docker Desktop → Settings → Resources → Memory
- **Linux**: Edit `/etc/docker/daemon.json`

### Services Won't Start

```bash
# Check Docker is running
docker ps

# Pull latest images
docker-compose pull

# Rebuild images
docker-compose build --no-cache

# Start with verbose output
docker-compose up --verbose
```

---

## IDE Setup

### Visual Studio Code

**Install Extensions**:
- Docker
- Remote - Containers
- React - Official
- REST Client
- Postman

**Open in container** (optional):
- Command Palette → `Remote-Containers: Open Folder in Container`

**Debug configuration** (.vscode/launch.json):
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Launch Backend",
      "program": "${workspaceFolder}/apps/backend-api/Server/server.js",
      "restart": true,
      "console": "integratedTerminal"
    }
  ]
}
```

### WebStorm/IntelliJ

**Configurations**:
- Settings → Languages & Frameworks → Node.js and NPM
- Add Node.js interpreter from Docker

**Run Configurations**:
- Create "npm" run config for each app
- Set working directory to app folder

---

## Next Steps

1. **Read Architecture**: [docs/architecture/ARCHITECTURE.md](../architecture/ARCHITECTURE.md)
2. **API Reference**: [docs/api/ENDPOINTS.md](../api/ENDPOINTS.md)
3. **Development Guidelines**: [docs/development/DEVELOPMENT.md](../development/DEVELOPMENT.md)
4. **Deploy to Production**: [docs/deployment/OCI.md](../deployment/OCI.md)

---

## Getting Help

- **Issues**: GitHub Issues
- **Discussions**: GitHub Discussions
- **Documentation**: See `/docs` folder
- **API Docs**: OpenAPI spec at `/docs/openapi/dpp-api-v1.yaml`

---

## Related Documentation

- [ARCHITECTURE.md](../architecture/ARCHITECTURE.md) - System architecture and design
- [DEVELOPMENT.md](../development/DEVELOPMENT.md) - Development guidelines and practices
- [ENDPOINTS.md](../api/ENDPOINTS.md) - API endpoints reference
- [LOCAL.md](../deployment/LOCAL.md) - Local deployment setup
- [OCI.md](../deployment/OCI.md) - Production OCI deployment
- [DOCKER.md](../infrastructure/DOCKER.md) - Docker configuration details

---

**[← Back to Docs](../README.md)**

