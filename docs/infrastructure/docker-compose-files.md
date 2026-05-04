# Docker Configuration

All Docker Compose files for local development and production deployment.

## Files Overview

| File | Purpose | When to Use |
|------|---------|------------|
| `docker-compose.yml` | Local development environment | `docker-compose up -d` |
| `docker-compose.prod.yml` | Production deployment main config | OCI production server |
| `docker-compose.prod.backend.yml` | Backend-specific prod config | Backend service customization |
| `docker-compose.prod.frontend.yml` | Frontend-specific prod config | Frontend service customization |

## Quick Commands

### Local Development
```bash
# Start all services
docker-compose up -d

# Stop services
docker-compose down

# View logs
docker-compose logs -f

# Restart specific service
docker-compose restart backend-api
```

### Production (OCI)
```bash
# SSH to OCI
ssh -i ~/Desktop/AMD\ keys/ssh-key-2026-04-27.key ubuntu@79.72.16.68

# Start services
cd /opt/dpp
sudo docker-compose -f docker-compose.prod.yml up -d

# View logs
sudo docker-compose -f docker-compose.prod.yml logs -f backend-api
```

## Configuration

### Environment Variables
Set in `../config/` directory:
- `config/.env.local` - Local development
- `config/.env.production` - Production deployment

### Services Defined

**Local Development** (docker-compose.yml):
- backend-api (Node.js, port 3001)
- frontend-app (React/Vite, port 3000)
- public-passport-viewer (React/Vite, port 3004)
- marketing-site (Static, port 8080)
- postgres (Database, port 5432)

**Production** (docker-compose.prod.yml):
- All services optimized for production
- Health checks enabled
- Resource limits configured
- Logging configured

## Building Images

```bash
# Build all images
docker-compose build

# Build specific service
docker-compose build backend-api

# Build without cache
docker-compose build --no-cache
```

## Troubleshooting

**Services won't start**:
```bash
# Check logs
docker-compose logs [service-name]

# Verify images exist
docker images

# Rebuild images
docker-compose build --no-cache
```

**Port conflicts**:
```bash
# Find process using port
lsof -i :3001

# Kill process
kill -9 [PID]
```

---

**[← Back to Docs](../README.md)**
