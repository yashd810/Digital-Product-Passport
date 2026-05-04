# Local Development Deployment - Claros DPP

Complete guide for setting up and running Claros DPP locally for development.

---

## Prerequisites

### System Requirements
- **CPU**: 4+ cores
- **RAM**: 8GB+ (6GB available for Docker)
- **Disk**: 50GB+ free space
- **OS**: macOS, Linux, or Windows with WSL2

### Software Requirements
- Docker Desktop 4.0+
- Git 2.0+
- Node.js 20+ (optional, for running services without Docker)
- npm 10+ (optional)

### Installation

**Docker**:
- macOS/Windows: [Download Docker Desktop](https://www.docker.com/products/docker-desktop)
- Linux: 
  ```bash
  sudo apt-get install docker.io docker-compose
  sudo usermod -aG docker $USER
  ```

**Git**:
- [Download Git](https://git-scm.com/downloads)

---

## Quick Start (5 minutes)

### 1. Clone Repository

```bash
git clone https://github.com/yashd810/Digital-Product-Passport.git
cd Digital-Product-Passport
```

### 2. Environment Configuration

```bash
cp .env.example .env
```

Edit `.env` if needed (defaults work for local development):

```bash
# Database
DB_HOST=postgres
DB_PORT=5432
DB_NAME=dpp_db
DB_USER=dpp_user
DB_PASSWORD=dev_password

# API
API_PORT=3001
NODE_ENV=development

# Frontend
VITE_API_URL=http://localhost:3001
VITE_PUBLIC_VIEWER_URL=http://localhost:3004

# JWT
JWT_SECRET=dev-secret-key-change-in-production
JWT_EXPIRY=24h
```

### 3. Start Services

```bash
# Start all services in background
docker-compose up -d

# Wait for services to be ready
sleep 30

# Check status
docker-compose ps
```

### 4. Access Applications

| Service | URL | Purpose |
|---------|-----|---------|
| Frontend | http://localhost:3000 | Dashboard |
| Backend API | http://localhost:3001 | REST API |
| Public Viewer | http://localhost:3004 | Public passport viewer |
| Marketing Site | http://localhost:8080 | Static pages |

### 5. Create Account

1. Go to http://localhost:3000
2. Click "Sign Up"
3. Enter credentials and create account
4. Start using the platform!

---

## Services Configuration

### Frontend App

**Port**: 3000 (Vite dev server)

**Services**:
- Vue.js development server
- Hot module replacement (HMR)
- Source maps for debugging

**Start alone** (without Docker):
```bash
cd apps/frontend-app
npm install
npm run dev
```

**Build for production**:
```bash
npm run build
# Output: dist/ folder
```

### Backend API

**Port**: 3001 (Express server)

**Services**:
- REST API server
- PostgreSQL connection
- JWT authentication
- Request validation

**Start alone**:
```bash
cd apps/backend-api
npm install
npm run dev
```

**Environment variables** (backend/.env):
```
DB_HOST=localhost
DB_PORT=5432
DB_NAME=dpp_db
DB_USER=dpp_user
DB_PASSWORD=dev_password
API_PORT=3001
JWT_SECRET=dev-secret
NODE_ENV=development
LOG_LEVEL=debug
```

**Health check**:
```bash
curl http://localhost:3001/api/health
```

### Public Passport Viewer

**Port**: 3004 (Vite dev server)

**Services**:
- Public DPP viewer
- No authentication required
- Vue.js SPA

**Start alone**:
```bash
cd apps/public-passport-viewer
npm install
npm run dev
```

### Marketing Site

**Port**: 8080 (Nginx in Docker)

**Services**:
- Static HTML pages
- Privacy policy, terms of service
- Marketing content

**Files**:
- `apps/marketing-site/index.html` - Home page
- `apps/marketing-site/privacy-policy.html` - Privacy policy
- `apps/marketing-site/terms-of-service.html` - Terms

**Rebuild**:
```bash
docker-compose up -d --build marketing-site
```

### Database

**Port**: 5432 (PostgreSQL)

**Connection Details**:
- Host: localhost
- Port: 5432
- Database: dpp_db
- User: dpp_user
- Password: dev_password

**Access database**:
```bash
# Via Docker
docker-compose exec postgres psql -U dpp_user -d dpp_db

# Directly (if PostgreSQL installed locally)
psql -h localhost -U dpp_user -d dpp_db
```

**Create sample data**:
```bash
docker-compose exec postgres psql -U dpp_user -d dpp_db < apps/backend-api/db/seed.sql
```

---

## Docker Compose Commands

### Manage Services

```bash
# Start all services in background
docker-compose up -d

# View running services
docker-compose ps

# View logs
docker-compose logs -f

# View logs for specific service
docker-compose logs -f backend-api
docker-compose logs -f frontend-app
docker-compose logs -f postgres

# Stop all services
docker-compose stop

# Restart services
docker-compose restart
docker-compose restart backend-api

# Stop and remove containers
docker-compose down

# Remove volumes too (WARNING: deletes database)
docker-compose down -v

# Rebuild images
docker-compose build
docker-compose build --no-cache backend-api

# Rebuild and restart
docker-compose up -d --build
```

### Execute Commands in Containers

```bash
# Run command in container
docker-compose exec backend-api npm test

# Start interactive shell
docker-compose exec backend-api bash
docker-compose exec postgres bash

# Run one-off command
docker-compose run backend-api npm test
```

---

## Development Workflow

### Making Changes

**Frontend Changes**:
1. Edit files in `apps/frontend-app/src/`
2. Changes automatically reload (HMR)
3. Check http://localhost:3000
4. Run tests: `npm test`

**Backend Changes**:
1. Edit files in `apps/backend-api/`
2. Restart container: `docker-compose restart backend-api`
3. Or use nodemon for auto-restart
4. Check logs: `docker-compose logs backend-api`
5. Run tests: `npm test`

**Database Changes**:
1. Create migration in `apps/backend-api/db/migrations/`
2. Run migration: `npm run migrate`
3. Update schema.sql
4. Restart backend

### Testing

**Run Backend Tests**:
```bash
cd apps/backend-api
npm test
npm test -- --watch
npm test -- --coverage
```

**Run Frontend Tests**:
```bash
cd apps/frontend-app
npm test
npm test -- --watch
```

**Run Integration Tests**:
```bash
# From project root
npm run test:integration
```

### Debugging

**Backend Debugging**:

1. Add debugger statement:
```javascript
// server.js
debugger;  // Code stops here
const app = express();
```

2. Run with debug:
```bash
docker-compose exec backend-api node --inspect=0.0.0.0:9229 Server/server.js
```

3. Open DevTools: http://localhost:9229

**Frontend Debugging**:

1. Vue DevTools browser extension
2. Browser console (F12)
3. VS Code debugger (launch.json config)

---

## Common Development Tasks

### Reset Database

```bash
# Keep containers, reset data
docker-compose exec postgres psql -U dpp_user -d dpp_db -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

# Or completely remove and restart
docker-compose down -v
docker-compose up -d
```

### View Database Schema

```bash
docker-compose exec postgres psql -U dpp_user -d dpp_db -c "\dt"
docker-compose exec postgres psql -U dpp_user -d dpp_db -c "\d digital_product_passports"
```

### View API Response

```bash
# Without auth
curl http://localhost:3001/api/health

# With auth (after login)
curl -H "Authorization: Bearer <JWT_TOKEN>" \
  http://localhost:3001/api/workspaces
```

### Check Port Usage

```bash
# macOS/Linux
lsof -i :3000
lsof -i :3001

# Windows
netstat -ano | findstr :3000
```

### Clear Docker Cache

```bash
docker system prune -a
docker volume prune
```

---

## Environment Variables

### .env File Location

Place `.env` in project root:

```
Digital-Product-Passport/
├── .env              # ← Put environment variables here
├── apps/
├── docker-compose.yml
└── ...
```

### Available Variables

**Database**:
- `DB_HOST` - Database hostname
- `DB_PORT` - Database port
- `DB_NAME` - Database name
- `DB_USER` - Database user
- `DB_PASSWORD` - Database password

**API**:
- `API_PORT` - API server port
- `API_BASE_URL` - Public API URL
- `NODE_ENV` - development, production
- `LOG_LEVEL` - debug, info, warn, error

**JWT**:
- `JWT_SECRET` - Secret key for signing tokens
- `JWT_EXPIRY` - Token expiration time (e.g., 24h)
- `JWT_ALGORITHM` - HS256 or RS256

**Frontend**:
- `VITE_API_URL` - Backend API URL
- `VITE_PUBLIC_VIEWER_URL` - Public viewer URL
- `VITE_APP_TITLE` - App title

---

## Troubleshooting

### Port Already in Use

```bash
# Find process using port
lsof -i :3000
lsof -i :3001
lsof -i :5432

# Kill process
kill -9 <PID>

# Or change port in docker-compose.yml
```

### Database Connection Error

```bash
# Check database is running
docker-compose ps postgres

# Check logs
docker-compose logs postgres

# Restart database
docker-compose restart postgres

# Wait for database to initialize
sleep 30
```

### Frontend Can't Connect to API

1. Check backend is running: `docker-compose ps backend-api`
2. Check API endpoint: `curl http://localhost:3001/api/health`
3. Check `VITE_API_URL` in .env
4. Clear browser cache and localStorage
5. Restart frontend: `docker-compose restart frontend-app`

### Out of Memory

Increase Docker memory:
- **macOS/Windows**: Docker Desktop → Preferences → Resources → Memory
- **Linux**: Edit `/etc/docker/daemon.json`

### Services Won't Start

```bash
# Check Docker status
docker info

# Check Docker images
docker images

# Rebuild everything
docker-compose build --no-cache
docker-compose up -d

# Check startup logs
docker-compose logs
```

### Database Migration Issues

```bash
# Check pending migrations
docker-compose exec backend-api npm run migrate:status

# Run migrations
docker-compose exec backend-api npm run migrate

# Rollback last migration
docker-compose exec backend-api npm run migrate:rollback
```

---

## Performance Tips

### Memory Usage

```bash
# Check container memory
docker stats

# Reduce PostgreSQL cache (if low memory)
# Edit docker-compose.yml postgres environment
```

### Database Performance

```bash
# Analyze query performance
EXPLAIN ANALYZE SELECT * FROM digital_product_passports;

# Rebuild indexes
REINDEX TABLE digital_product_passports;

# Vacuum to reclaim space
VACUUM ANALYZE;
```

### Frontend Build Size

```bash
# Analyze bundle
npm run build -- --report

# Check vendor chunks
npm run build --profile
```

---

## IDE Setup

### VS Code

**Extensions**:
- Docker
- Remote - Containers
- Vue - Official
- Prettier
- ESLint
- REST Client
- Postman

**Settings** (.vscode/settings.json):
```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "[javascript]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "eslint.validate": ["javascript", "vue"],
  "docker.showExplorer": true
}
```

**Debug Config** (.vscode/launch.json):
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Backend Debug",
      "program": "${workspaceFolder}/apps/backend-api/Server/server.js",
      "restart": true,
      "console": "integratedTerminal"
    }
  ]
}
```

### WebStorm/IntelliJ

1. Open project
2. File → Settings → Languages → Node.js and NPM
3. Configure Node.js interpreter
4. Create run configs for each service

---

## Best Practices

1. **Always** use `.env` for configuration
2. **Never** commit `.env` to git
3. **Use** docker-compose for consistency
4. **Restart** containers after env changes
5. **Clear** cache if issues persist
6. **Check** logs first for errors
7. **Keep** database backups before major changes
8. **Use** meaningful commit messages

---

## Next Steps

1. Create a test DPP: See [guides/GETTING_STARTED.md](../guides/GETTING_STARTED.md)
2. API Reference: See [api/ENDPOINTS.md](../api/ENDPOINTS.md)
3. Development Guidelines: See [development/DEVELOPMENT.md](../development/DEVELOPMENT.md)
4. Deploy to Production: See [deployment/OCI.md](./OCI.md)

