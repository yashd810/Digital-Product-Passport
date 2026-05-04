# Backend API - Claros DPP

REST API server for the Claros Digital Product Passport platform.

---

## Overview

The Backend API is the core server that handles:
- User authentication and authorization
- DPP creation, reading, updating, and deletion
- Workspace management
- Audit logging
- Database operations

**Technology**: Node.js, Express.js, PostgreSQL

**Port**: 3001 (development), exposed via reverse proxy (production)

---

## Quick Start

### Prerequisites
- Node.js 20+
- npm 10+
- PostgreSQL (via Docker or local)
- Running from project root with Docker: `docker-compose up`

### Development

**Install dependencies** (first time only):
```bash
cd apps/backend-api
npm install
```

**Start development server** (with auto-reload):
```bash
npm run dev
```

**Run tests**:
```bash
npm test
npm test -- --watch
npm test -- --coverage
```

**Build for production**:
```bash
npm run build
```

### Environment Variables

Create `.env` file:
```bash
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=dpp_db
DB_USER=dpp_user
DB_PASSWORD=dev_password

# Server
API_PORT=3001
NODE_ENV=development
LOG_LEVEL=debug

# JWT
JWT_SECRET=your-secret-key-here
JWT_EXPIRY=24h

# Email (optional)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=user@gmail.com
SMTP_PASSWORD=app-password
```

---

## Directory Structure

```
apps/backend-api/
├── Server/
│   └── server.js            # Express app setup
├── routes/                  # API endpoint definitions
│   ├── auth.js             # /api/auth/*
│   ├── passports.js        # /api/passports/*
│   ├── workspaces.js       # /api/workspaces/*
│   └── ...
├── services/                # Business logic
│   ├── AuthService.js       # Authentication
│   ├── PassportService.js   # DPP operations
│   ├── UserService.js       # User management
│   └── ...
├── middleware/              # Express middleware
│   ├── auth.js             # JWT verification
│   ├── validation.js       # Request validation
│   ├── errorHandler.js     # Error handling
│   └── logging.js          # Request logging
├── db/                      # Database operations
│   ├── migrations/         # Schema migrations
│   ├── queries.js          # Common queries
│   └── schema.sql          # Database schema
├── helpers/                 # Utility functions
├── tests/                   # Jest test suites
├── package.json             # Dependencies
├── jest.config.js          # Test configuration
└── .env.example            # Environment variables
```

---

## API Endpoints

### Authentication
- `POST /api/auth/register` - Create account
- `POST /api/auth/login` - Login
- `POST /api/auth/logout` - Logout
- `POST /api/auth/refresh` - Refresh token

### Digital Product Passports
- `GET /api/passports` - List DPPs
- `POST /api/passports` - Create DPP
- `GET /api/passports/:id` - Get DPP
- `PUT /api/passports/:id` - Update DPP
- `DELETE /api/passports/:id` - Delete DPP
- `POST /api/passports/:id/publish` - Publish DPP
- `GET /api/passports/:id/public` - Get public DPP

### Workspaces
- `GET /api/workspaces` - List workspaces
- `POST /api/workspaces` - Create workspace
- `GET /api/workspaces/:id` - Get workspace
- `PUT /api/workspaces/:id` - Update workspace
- `DELETE /api/workspaces/:id` - Delete workspace

### Workspace Members
- `GET /api/workspaces/:id/members` - List members
- `POST /api/workspaces/:id/invite` - Invite user
- `PUT /api/workspaces/:id/members/:userId` - Update role
- `DELETE /api/workspaces/:id/members/:userId` - Remove member

### Health Check
- `GET /api/health` - API health status

---

## Key Features

### Authentication
- JWT-based stateless authentication
- Token expiration and refresh
- Password hashing with bcrypt
- Session management

### Authorization
- Role-based access control (RBAC)
- Three roles: admin, editor, viewer
- Workspace-level permissions
- Resource ownership validation

### Data Validation
- Request schema validation
- Input sanitization
- Type checking
- Error message clarity

### Audit Logging
- Log all DPP operations
- Track who made changes and when
- Record what changed
- Enable compliance audits

### Error Handling
- Consistent error response format
- HTTP status codes
- Error codes for client handling
- Detailed error messages

---

## Service Architecture

### AuthService
Handles authentication:
- User registration
- Login/logout
- Password validation
- JWT token generation
- Token verification

### PassportService
Manages Digital Product Passports:
- CRUD operations
- Schema validation
- Publishing logic
- Version management
- Public access

### UserService
User account management:
- User creation
- Profile updates
- Account deletion
- Email verification

### WorkspaceService
Workspace management:
- Workspace CRUD
- Member management
- Permission checking
- Invitation handling

---

## Database Schema

**Core Tables**:
- `users` - User accounts
- `workspaces` - Workspace containers
- `workspace_members` - User-workspace mappings
- `digital_product_passports` - DPP data
- `passport_versions` - Version history
- `audit_logs` - Change tracking
- `sessions` - Active sessions

**[Complete Schema Documentation →](../docs/DATABASE_SCHEMA.md)**

---

## Middleware

### Authentication
```javascript
import { authenticate } from '@/middleware/auth';

router.get('/protected', authenticate, (req, res) => {
  // req.user contains authenticated user
});
```

### Request Validation
```javascript
import { validate } from '@/middleware/validation';

router.post('/endpoint', validate(schema), (req, res) => {
  // Request validated against schema
});
```

### Error Handling
```javascript
// Errors automatically caught and formatted
try {
  throw new ValidationError('Invalid data', [{field: 'email', message: '...'}]);
} catch (error) {
  // Middleware sends proper response
}
```

---

## Testing

**Run all tests**:
```bash
npm test
```

**Watch mode**:
```bash
npm test -- --watch
```

**Coverage report**:
```bash
npm test -- --coverage
```

**Example test**:
```javascript
describe('AuthService', () => {
  it('should register new user', async () => {
    const user = await AuthService.register({
      email: 'test@example.com',
      password: 'secure_password'
    });

    expect(user.email).toBe('test@example.com');
  });
});
```

---

## Performance

### Database Optimization
- Indexes on frequently queried columns
- Connection pooling
- Query optimization
- Caching where appropriate

### API Response
- Response compression (gzip)
- Pagination for large datasets
- Filtering and sorting
- Error handling efficiency

**[See ARCHITECTURE.md for details →](../docs/ARCHITECTURE.md)**

---

## Security

### Password Security
- Bcrypt hashing (12+ rounds)
- Never store plain text
- Validate on login

### Token Security
- JWT signing with secret key
- Token expiration (24 hours default)
- Refresh token mechanism
- Token validation on every request

### Data Protection
- Parameterized database queries (prevent SQL injection)
- Input validation and sanitization (prevent XSS)
- HTTPS/TLS in production
- Sensitive data not logged

### CORS & Headers
- CORS configured for frontend domains
- Security headers (X-Frame-Options, etc.)
- Rate limiting (optional)

---

## Deployment

### Local Development
```bash
docker-compose up backend-api
# or
npm run dev
```

### Production (Docker)
```bash
# Build image
docker-compose build backend-api

# Run in production
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d backend-api
```

### Scaling
```bash
# Run multiple instances
docker-compose up -d --scale backend-api=3
```

**[Production Deployment Guide →](../docs/deployment/OCI.md)**

---

## Monitoring

### Health Check
```bash
curl http://localhost:3001/api/health
```

**Response**:
```json
{
  "status": "healthy",
  "timestamp": "2026-05-04T12:00:00Z",
  "version": "1.0.0",
  "database": "connected"
}
```

### Logs
```bash
# View logs
docker-compose logs backend-api

# Follow logs
docker-compose logs -f backend-api

# Check specific errors
docker-compose logs backend-api | grep error
```

### Database Monitoring
```bash
# Connect to database
docker-compose exec postgres psql -U dpp_user -d dpp_db

# Check table sizes
SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) 
FROM pg_tables WHERE schemaname='public' ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

---

## Development Tips

### Debug Mode
```bash
# Enable debug logging
DEBUG=dpp:* npm run dev
```

### Database Inspection
```javascript
// In service
const result = await db.query('SELECT ...');
console.log('Result:', result); // Log for inspection
```

### API Testing
```bash
# Test endpoint with authentication
curl -H "Authorization: Bearer <JWT>" http://localhost:3001/api/workspaces

# Test with curl/Postman
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password"
}
```

### Common Issues

**Database Connection Error**:
```bash
# Verify PostgreSQL is running
docker-compose ps postgres

# Check connection string in .env
DB_HOST=postgres  # Use 'postgres' in Docker, 'localhost' locally
```

**Port Already in Use**:
```bash
# Find process using port 3001
lsof -i :3001

# Kill process
kill -9 <PID>
```

---

## Contributing

1. Create feature branch
2. Follow [Development Guidelines](../docs/development/DEVELOPMENT.md)
3. Write tests for new features
4. Ensure all tests pass
5. Submit pull request

---

## Documentation

- **[API Endpoints →](../docs/api/ENDPOINTS.md)** - Complete REST API reference
- **[Database Schema →](../docs/DATABASE_SCHEMA.md)** - Database structure
- **[Architecture →](../docs/ARCHITECTURE.md)** - System design
- **[Development Guide →](../docs/development/DEVELOPMENT.md)** - Coding standards
- **[Data Flow →](../docs/DATA_FLOW.md)** - How data moves through system

---

## Useful Commands

```bash
# Development
npm run dev              # Start dev server
npm test                # Run tests
npm run lint            # Check code quality
npm run format          # Format code

# Database
npm run migrate         # Run migrations
npm run migrate:status  # Check migration status
npm run seed           # Load sample data

# Production
npm run build          # Build for production
npm start              # Start production server
npm run audit          # Check for vulnerabilities
npm update             # Update dependencies
```

---

## Stack

- **Framework**: Express.js
- **Runtime**: Node.js
- **Database**: PostgreSQL
- **Testing**: Jest
- **Authentication**: JWT
- **Password Hashing**: bcrypt
- **Validation**: joi or yup
- **Logging**: winston or pino

---

**Status**: ✅ Production Ready

**Version**: 1.0.0

**Last Updated**: May 4, 2026

