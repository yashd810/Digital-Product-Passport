# Configuration Files

Environment configuration files for local development and production deployment.

## Table of Contents

1. [Files Overview](#files-overview)
2. [Local Development (.env.local)](#local-development-envlocal)
3. [Production (.env.production)](#production-envproduction)
4. [Using Configuration Files](#using-configuration-files)
5. [Environment Variable Reference](#environment-variable-reference)
6. [Security Best Practices](#security-best-practices)
7. [Troubleshooting](#troubleshooting)

---

## Files Overview

| File | Purpose | When Needed |
|------|---------|------------|
| `.env.local` | Local development environment variables | Local development |
| `.env.production` | Production environment variables | OCI deployment |

## Local Development (.env.local)

Used by Docker Compose for local development.

**Key Variables**:
```bash
# Backend API
API_PORT=3001
API_HOST=localhost
NODE_ENV=development

# Frontend
VITE_API_URL=http://localhost:3001
VITE_PUBLIC_VIEWER_URL=http://localhost:3004

# Database
DB_HOST=postgres
DB_PORT=5432
DB_USER=claros_user
DB_PASSWORD=claros_password_dev
DB_NAME=claros_dpp

# Authentication
JWT_SECRET=your-secret-key-here
JWT_EXPIRATION=24h

# Features
DEBUG=true
REQUIRE_MFA_FOR_CONTROLLED_DATA=false
```

## Production (.env.production)

Used for OCI deployment - NEVER commit actual secrets!

**Key Variables** (template only):
```bash
# Backend API
API_PORT=3001
NODE_ENV=production

# Frontend
VITE_API_URL=https://api.claros-dpp.online
VITE_PUBLIC_VIEWER_URL=https://viewer.claros-dpp.online

# Database
DB_HOST=localhost
DB_PORT=5432
DB_USER=claros_user
DB_PASSWORD=[SECURE_PASSWORD]
DB_NAME=claros_dpp

# Authentication
JWT_SECRET=[SECURE_SECRET_32_CHARS_MIN]
JWT_EXPIRATION=24h

# Production Features
DEBUG=false
REQUIRE_MFA_FOR_CONTROLLED_DATA=true
COOKIE_DOMAIN=.claros-dpp.online
```

## Using Configuration Files

### Local Development
```bash
# Docker Compose automatically uses .env.local
docker-compose up -d

# Or specify explicitly
docker-compose --env-file config/.env.local up -d
```

### Production (OCI)
```bash
# SSH to OCI
ssh -i ~/Desktop/AMD\ keys/ssh-key-2026-04-27.key ubuntu@79.72.16.68

# Copy production config
cp config/.env.production /opt/dpp/.env

# Edit with actual secrets
nano /opt/dpp/.env

# Start services
cd /opt/dpp
sudo docker-compose -f docker-compose.prod.yml up -d
```

## Environment Variable Reference

### Core Settings
- **NODE_ENV**: `development` or `production`
- **DEBUG**: `true` or `false` (verbose logging)

### API Configuration
- **API_PORT**: Port for backend API (default: 3001)
- **API_HOST**: API hostname (localhost or domain)
- **VITE_API_URL**: URL for frontend to reach API

### Frontend Configuration
- **VITE_PUBLIC_VIEWER_URL**: URL for public viewer

### Database Configuration
- **DB_HOST**: Database hostname
- **DB_PORT**: Database port (default: 5432)
- **DB_USER**: Database user
- **DB_PASSWORD**: Database password
- **DB_NAME**: Database name

### Authentication
- **JWT_SECRET**: Secret key for JWT signing (min 32 characters)
- **JWT_EXPIRATION**: Token expiration time (e.g., "24h")
- **COOKIE_DOMAIN**: Domain for session cookies (production only)

### Security Features
- **REQUIRE_MFA_FOR_CONTROLLED_DATA**: Enforce MFA for sensitive data
- **CORS_ORIGINS**: Allowed CORS origins

## Security Best Practices

⚠️ **IMPORTANT**:
1. **Never commit `.env` files** - they contain secrets!
2. **Never share secrets** - keep production passwords secure
3. **Rotate secrets regularly** - especially in production
4. **Use strong passwords** - minimum 12 characters
5. **Use unique secrets** - don't reuse across environments

### For Production
- Use strong, randomly generated JWT_SECRET
- Use secure database password
- Store production config outside git
- Manage secrets with secure vault if possible
- Regularly audit environment variables

## Troubleshooting

**Services can't connect to database**:
```bash
# Check DB_HOST matches Docker service name (local)
# or localhost (production)

# Check DB_PORT is correct (5432)

# Verify DB_USER and DB_PASSWORD match
```

**API not accessible from frontend**:
```bash
# Check VITE_API_URL is correct
# Verify CORS is enabled in backend
# Check firewall rules in production
```

**JWT authentication fails**:
```bash
# Verify JWT_SECRET is set and matches backend
# Check JWT_EXPIRATION format
# Verify token hasn't expired
```

---

## Related Documentation

- [LOCAL.md](../deployment/LOCAL.md) - Local development setup
- [OCI.md](../deployment/OCI.md) - Production OCI deployment
- [DOCKER.md](../infrastructure/DOCKER.md) - Docker configuration
- [docker-compose-files.md](../infrastructure/docker-compose-files.md) - Docker Compose files
- [AUTHENTICATION.md](../security/AUTHENTICATION.md) - JWT and authentication
- [CONFIGURATION_INDEX.md](./CONFIGURATION_INDEX.md) - Configuration documentation index

---

**[← Back to Project](../README.md)**
