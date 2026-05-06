# Docker & Containerization Guide

Complete guide to Docker configuration, container management, image building, and container networking for the Claros DPP platform.

---

## Table of Contents

1. [Docker Overview](#docker-overview)
2. [Installation](#installation)
3. [Docker Images](#docker-images)
4. [Container Building](#container-building)
5. [Docker Compose](#docker-compose)
6. [Container Networking](#container-networking)
7. [Volume Management](#volume-management)
8. [Container Lifecycle](#container-lifecycle)
9. [Performance Optimization](#performance-optimization)
10. [Troubleshooting](#troubleshooting)

---

## Docker Overview

### What is Docker?

Docker is containerization technology that packages applications with all dependencies, ensuring consistent behavior across development, testing, and production environments.

### Benefits for Claros DPP

- **Consistency**: Same environment from local development to production
- **Isolation**: Each service runs independently without conflicts
- **Scalability**: Easy to replicate containers across multiple hosts
- **Simplicity**: Single command to start entire platform

### Architecture

```
┌─────────────────────────────────────────────┐
│         Docker Host (Your Machine)          │
│                                             │
│  ┌──────────────┐  ┌──────────────┐       │
│  │  Frontend    │  │   Backend    │       │
│  │  Container   │  │  Container   │       │
│  └──────────────┘  └──────────────┘       │
│  ┌──────────────┐  ┌──────────────┐       │
│  │   Database   │  │   Marketing  │       │
│  │  Container   │  │  Container   │       │
│  └──────────────┘  └──────────────┘       │
│         (Internal Network)                  │
└─────────────────────────────────────────────┘
```

---

## Installation

### macOS

**Using Homebrew**:
```bash
# Install Docker Desktop
brew install --cask docker

# Verify installation
docker --version
```

**Manual Installation**:
1. Download [Docker Desktop for Mac](https://www.docker.com/products/docker-desktop)
2. Double-click installer
3. Follow installation wizard
4. Launch Docker from Applications

**First Run**:
```bash
docker run hello-world
```

### Linux (Ubuntu/Debian)

**Install Docker**:
```bash
# Update package list
sudo apt-get update

# Install Docker
sudo apt-get install -y docker.io

# Add current user to docker group
sudo usermod -aG docker $USER

# Verify installation
docker --version
```

**Install Docker Compose**:
```bash
# Download Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose

# Make executable
sudo chmod +x /usr/local/bin/docker-compose

# Verify installation
docker-compose --version
```

### Windows (with WSL2)

**Install Docker Desktop**:
1. Download [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop)
2. Run installer
3. Enable WSL2 when prompted
4. Restart computer

**Verify Installation**:
```bash
docker --version
docker-compose --version
```

---

## Docker Images

### Base Images

Images used in Claros DPP:

| Service | Base Image | Version | Size |
|---------|-----------|---------|------|
| Backend API | `node` | 20-alpine | ~150MB |
| Frontend | `node` | 20-alpine | ~150MB |
| Public Viewer | `node` | 20-alpine | ~150MB |
| Marketing Site | `nginxinc/nginx-unprivileged` | 1.27-alpine | ~60MB |
| Reverse Proxy | `caddy` | 2-alpine | ~50MB |

### Why Alpine?

Alpine Linux is used for:
- **Small Size**: ~5MB base vs 900MB+ for full Ubuntu
- **Security**: Minimal attack surface
- **Speed**: Faster download and startup
- **Resource Efficiency**: Lower memory usage

### Prebuilt Images

Pull prebuilt images:
```bash
# Node.js
docker pull node:20-alpine

# Nginx
docker pull nginxinc/nginx-unprivileged:1.27-alpine

# Caddy
docker pull caddy:2-alpine

# PostgreSQL
docker pull postgres:15-alpine
```

### View Local Images

```bash
# List all images
docker images

# List images with size
docker images --format "table {{.Repository}}\t{{.Size}}"

# Remove unused images
docker image prune
```

---

## Container Building

### Dockerfile Structure

Example Dockerfile for backend API:

```dockerfile
# Step 1: Use base image
FROM node:20-alpine

# Step 2: Set working directory
WORKDIR /app

# Step 3: Copy package files
COPY package*.json ./

# Step 4: Install dependencies
RUN npm ci --only=production

# Step 5: Copy application code
COPY . .

# Step 6: Expose port
EXPOSE 3001

# Step 7: Set environment
ENV NODE_ENV=production

# Step 8: Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/api/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Step 9: Run application
CMD ["node", "Server/server.js"]
```

### Build Command

```bash
# Build image
docker build -t claros-backend:latest .

# Build with specific tag
docker build -t claros-backend:v1.0.0 .

# Build with build arguments
docker build --build-arg NODE_ENV=production -t claros-backend:latest .

# View build output
docker build --progress=plain -t claros-backend:latest .
```

### Optimize Build

**Multi-stage builds** reduce final image size:

```dockerfile
# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci

# Stage 2: Production
FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY . .
EXPOSE 3001
CMD ["node", "Server/server.js"]
```

### Push to Registry

```bash
# Tag image
docker tag claros-backend:latest myregistry/claros-backend:latest

# Login to registry
docker login myregistry

# Push image
docker push myregistry/claros-backend:latest

# Pull from registry
docker pull myregistry/claros-backend:latest
```

---

## Docker Compose

### Configuration File

`docker-compose.yml` orchestrates all services:

```yaml
version: '3.8'

services:
  # Backend API
  backend-api:
    build: ./apps/backend-api
    container_name: claros-backend
    ports:
      - "3001:3001"
    environment:
      DB_HOST: postgres
      DB_PORT: 5432
      DB_NAME: claros_dpp
      DB_USER: claros_user
      DB_PASSWORD: claros_password_dev
      NODE_ENV: development
      JWT_SECRET: your-jwt-secret-here
      SERVER_URL: http://localhost:3001
      APP_URL: http://localhost:3000
    depends_on:
      - postgres
    volumes:
      - ./apps/backend-api:/app
      - /app/node_modules
    networks:
      - claros-network
    restart: unless-stopped

  # Frontend
  frontend-app:
    build: ./apps/frontend-app
    container_name: claros-frontend
    ports:
      - "3000:3000"
    environment:
      VITE_API_URL: http://localhost:3001
      VITE_PUBLIC_VIEWER_URL: http://localhost:3004
    volumes:
      - ./apps/frontend-app:/app
      - /app/node_modules
    networks:
      - claros-network
    restart: unless-stopped

  # Database
  postgres:
    image: postgres:15-alpine
    container_name: claros-postgres
    ports:
      - "5432:5432"
    environment:
      POSTGRES_DB: claros_dpp
      POSTGRES_USER: claros_user
      POSTGRES_PASSWORD: claros_password_dev
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - claros-network
    restart: unless-stopped

volumes:
  postgres_data:

networks:
  claros-network:
    driver: bridge
```

### Compose Commands

```bash
# Start all services
docker-compose up -d

# Start specific service
docker-compose up -d postgres

# View running containers
docker-compose ps

# View logs
docker-compose logs

# View logs for specific service
docker-compose logs -f backend-api

# Stop services
docker-compose stop

# Stop and remove containers
docker-compose down

# Remove everything including volumes
docker-compose down -v

# Rebuild images
docker-compose build

# Restart services
docker-compose restart backend-api
```

### Service Management

**Check service status**:
```bash
docker-compose ps
```

**View service logs**:
```bash
# All services
docker-compose logs

# Specific service
docker-compose logs backend-api

# Follow logs
docker-compose logs -f

# Last 100 lines
docker-compose logs --tail=100
```

**Execute commands in container**:
```bash
# Open shell
docker-compose exec backend-api bash

# Run specific command
docker-compose exec backend-api npm test

# Run as root
docker-compose exec -u root backend-api apt-get update
```

---

## Container Networking

### Network Types

**Bridge Network** (default for Compose):
- Containers can communicate via service name
- Containers isolated from host network
- Used for local development

```yaml
services:
  backend:
    networks:
      - claros-network
    
  postgres:
    networks:
      - claros-network

networks:
  claros-network:
    driver: bridge
```

**Host Network** (production):
- Containers share host network stack
- Better performance, less isolation
- Use with caution

```yaml
services:
  backend:
    network_mode: "host"
```

### Service Discovery

Containers discover each other by service name:

```javascript
// Backend connecting to database
const pgConnection = new Pool({
  host: 'postgres',     // Service name from docker-compose.yml
  port: 5432,
  database: 'claros_dpp',
  user: 'claros_user',
  password: 'claros_password_dev'
});

// Frontend connecting to API
const apiUrl = 'http://backend-api:3001';  // Internal service name
```

### Port Mapping

Syntax: `"host_port:container_port"`

```yaml
services:
  backend:
    ports:
      - "3001:3001"     # Expose to host on 3001
      - "3002:3001"     # Multiple ports to same container
```

### Expose vs Ports

```yaml
services:
  backend:
    # Expose: only for internal communication
    expose:
      - "3001"
    
    # Ports: expose to host and internal
    ports:
      - "3001:3001"
```

---

## Volume Management

### Volume Types

**Named Volumes** (persistent data):
```yaml
volumes:
  postgres_data:

services:
  postgres:
    volumes:
      - postgres_data:/var/lib/postgresql/data
```

**Bind Mounts** (development):
```yaml
services:
  backend:
    volumes:
      - ./apps/backend-api:/app        # Development code
      - /app/node_modules              # Prevent overwrite
```

**Anonymous Volumes** (temporary):
```yaml
services:
  cache:
    volumes:
      - /data  # Created but not persisted
```

### Volume Commands

```bash
# List volumes
docker volume ls

# Inspect volume
docker volume inspect claros_postgres_data

# Remove unused volumes
docker volume prune

# Remove specific volume
docker volume rm claros_postgres_data

# Backup volume
docker run --rm -v claros_postgres_data:/data -v $(pwd):/backup \
  ubuntu tar czf /backup/postgres_backup.tar.gz -C /data .

# Restore volume
docker volume create claros_postgres_data_restored
docker run --rm -v claros_postgres_data_restored:/data -v $(pwd):/backup \
  ubuntu tar xzf /backup/postgres_backup.tar.gz -C /data
```

### Database Volume

**Why Named Volume for Database?**
- Persists data when container stops
- Can be backed up and restored
- Survives `docker-compose down`

```bash
# Backup database
docker run --rm -v claros_postgres_data:/data -v $(pwd):/backup \
  ubuntu tar czf /backup/db_backup.tar.gz -C /data .

# View database files
docker run --rm -v claros_postgres_data:/data ubuntu ls -la /data
```

---

## Container Lifecycle

### Container States

```
┌─────────┐
│ created │──────────┐
└────┬────┘          │
     │               │
     ▼               │
┌─────────┐      ┌──────────┐
│ running │◄─────┤  paused  │
└────┬────┘      └──────────┘
     │
     ▼
┌─────────┐
│ stopped │
└────┬────┘
     │
     ▼
┌─────────┐
│ removed │
└─────────┘
```

### Commands

```bash
# Start container
docker start container_name

# Stop container (graceful)
docker stop container_name

# Kill container (force)
docker kill container_name

# Pause container
docker pause container_name

# Unpause container
docker unpause container_name

# Restart container
docker restart container_name

# Remove container
docker rm container_name
```

### Container Inspect

```bash
# View container details
docker inspect container_name

# View container IP
docker inspect -f '{{.NetworkSettings.IPAddress}}' container_name

# View container ports
docker inspect -f '{{.NetworkSettings.Ports}}' container_name

# View environment variables
docker inspect -f '{{json .Config.Env}}' container_name
```

---

## Performance Optimization

### Resource Limits

**Set memory and CPU limits**:

```yaml
services:
  backend:
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 1024M
        reservations:
          cpus: '0.5'
          memory: 512M
```

**Monitor resource usage**:
```bash
# Real-time stats
docker stats

# Container-specific stats
docker stats backend-api

# Memory usage
docker stats --no-stream
```

### Layer Caching

Optimize build speed by ordering Dockerfile steps:

```dockerfile
# ❌ Bad: Changes to code invalidate node_modules cache
FROM node:20-alpine
WORKDIR /app
COPY . .                    # Code changes invalidate this
RUN npm ci --only=production

# ✅ Good: node_modules cached until dependencies change
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./       # Only package files
RUN npm ci --only=production
COPY . .                    # Code changes don't invalidate node_modules
```

### Image Size Reduction

```dockerfile
# Multi-stage build reduces final size
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY . .
RUN npm prune --production
CMD ["node", "Server/server.js"]
```

### Development vs Production

**Development** (fast iteration):
```yaml
services:
  backend:
    volumes:
      - ./apps/backend-api:/app  # Hot reload
      - /app/node_modules
    environment:
      NODE_ENV: development
```

**Production** (optimal performance):
```yaml
services:
  backend:
    environment:
      NODE_ENV: production
    deploy:
      resources:
        limits:
          memory: 2048M
```

---

## Troubleshooting

### Container Won't Start

**Check logs**:
```bash
docker logs container_name
docker-compose logs backend-api
```

**Common causes**:
- Port already in use
- Missing environment variables
- Dependency service not ready
- Out of memory

**Solution**:
```bash
# Check port
lsof -i :3001

# Rebuild image
docker-compose build --no-cache

# Remove dangling images
docker image prune -f
```

### Out of Memory

**Symptoms**:
- Container crashes with OOM kill
- Application slowdown
- `Cannot allocate memory` errors

**Fix**:
```bash
# Increase Docker memory in settings
# macOS: Docker Desktop → Preferences → Resources

# Or set container limits
docker run -m 2048m image_name
```

### Network Issues

**Container can't reach API**:
```bash
# Check network connectivity
docker-compose exec frontend-app ping backend-api

# Check DNS
docker-compose exec frontend-app nslookup backend-api

# Check port
docker-compose exec backend-api netstat -tlnp
```

### Dangling Images and Containers

**Clean up unused resources**:
```bash
# Remove dangling images
docker image prune

# Remove stopped containers
docker container prune

# Remove unused volumes
docker volume prune

# Remove unused networks
docker network prune

# Clean everything
docker system prune -a
```

### Slow Performance

**Optimize**:
```bash
# Use BuildKit for faster builds
DOCKER_BUILDKIT=1 docker build .

# Enable BuildKit in compose
export DOCKER_BUILDKIT=1
docker-compose build

# Reduce layer count
docker image history image_name
```

### Permission Issues

**Linux file permissions**:
```bash
# Fix volume permissions
sudo chown -R $USER:$USER ./apps

# Or run container as current user
docker run --user $(id -u):$(id -g) image_name
```

---

## Best Practices

### Security

- ✅ Use specific image versions, not `latest`
- ✅ Run containers as non-root user
- ✅ Scan images for vulnerabilities
- ✅ Use secrets for sensitive data
- ✅ Minimize image size (fewer attack surface)

### Performance

- ✅ Use Alpine images for small size
- ✅ Leverage layer caching
- ✅ Minimize number of layers
- ✅ Clean up build artifacts
- ✅ Use `.dockerignore` file

### Reliability

- ✅ Include HEALTHCHECK in Dockerfile
- ✅ Set restart policies
- ✅ Use depends_on for service ordering
- ✅ Monitor resource usage
- ✅ Log to stdout/stderr

### Development

- ✅ Use docker-compose for local dev
- ✅ Mount code volumes for hot reload
- ✅ Use separate compose files for prod
- ✅ Version control Dockerfiles
- ✅ Document environment variables

---

## Related Documentation

- [docker-compose-files.md](docker-compose-files.md) - Docker Compose configuration reference
- [CADDY.md](CADDY.md) - Reverse proxy in Docker containers
- [DATABASE.md](DATABASE.md) - PostgreSQL container management
- [LOCAL.md](../deployment/LOCAL.md) - Local Docker setup and development
- [OCI.md](../deployment/OCI.md) - Production Docker deployment on OCI
- [SERVICES.md](../architecture/SERVICES.md) - Service and port mapping

---

**[← Back to Infrastructure Docs](../README.md) | [Next: Caddy Reverse Proxy →](./CADDY.md)**
