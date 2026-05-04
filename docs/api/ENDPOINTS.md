# REST API Endpoints - Claros DPP

Complete REST API reference for Claros Digital Product Passport platform.

---

## Base URL

```
Development: http://localhost:3001
Production: https://api.claros-dpp.online
```

## Authentication

All protected endpoints require JWT token in Authorization header:

```
Authorization: Bearer <JWT_TOKEN>
```

**Token Expiration**: 24 hours (configurable)

**Get Token**:
```bash
POST /api/auth/login
{
  "email": "user@example.com",
  "password": "password123"
}
```

---

## Response Format

### Success Response
```json
{
  "success": true,
  "data": {
    "id": "uuid-123",
    "name": "Example"
  },
  "message": "Operation successful"
}
```

### Error Response
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable error",
    "details": [
      {
        "field": "email",
        "message": "Invalid email format"
      }
    ]
  }
}
```

---

## Authentication Endpoints

### Register

**Request**
```
POST /api/auth/register
```

**Body**
```json
{
  "email": "user@example.com",
  "password": "secure_password",
  "firstName": "John",
  "lastName": "Doe",
  "organization": "Acme Corp"
}
```

**Response** (201 Created)
```json
{
  "success": true,
  "data": {
    "id": "uuid-123",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "createdAt": "2026-05-04T12:00:00Z"
  }
}
```

**Errors**:
- 400: Email already registered
- 400: Invalid password (min 8 chars, 1 uppercase, 1 number)
- 400: Missing required fields

---

### Login

**Request**
```
POST /api/auth/login
```

**Body**
```json
{
  "email": "user@example.com",
  "password": "secure_password"
}
```

**Response** (200 OK)
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid-123",
      "email": "user@example.com",
      "firstName": "John"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": 86400
  }
}
```

**Errors**:
- 401: Invalid credentials
- 400: Missing email or password

---

### Logout

**Request**
```
POST /api/auth/logout
Authorization: Bearer <JWT>
```

**Response** (200 OK)
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

---

### Refresh Token

**Request**
```
POST /api/auth/refresh
```

**Body**
```json
{
  "refreshToken": "refresh_token_value"
}
```

**Response** (200 OK)
```json
{
  "success": true,
  "data": {
    "token": "new_jwt_token",
    "expiresIn": 86400
  }
}
```

---

## Workspace Endpoints

### List Workspaces

**Request**
```
GET /api/workspaces
Authorization: Bearer <JWT>
```

**Query Parameters**:
- `page`: Page number (default: 1)
- `limit`: Items per page (default: 20)
- `sort`: Sort field (name, createdAt)
- `order`: asc or desc

**Response** (200 OK)
```json
{
  "success": true,
  "data": [
    {
      "id": "workspace-uuid-1",
      "name": "My Workspace",
      "description": "Company DPPs",
      "ownerId": "user-uuid-1",
      "memberCount": 5,
      "passportCount": 42,
      "createdAt": "2026-01-01T00:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "pages": 3
  }
}
```

---

### Get Workspace

**Request**
```
GET /api/workspaces/:workspaceId
Authorization: Bearer <JWT>
```

**Response** (200 OK)
```json
{
  "success": true,
  "data": {
    "id": "workspace-uuid-1",
    "name": "My Workspace",
    "description": "Company DPPs",
    "ownerId": "user-uuid-1",
    "logoUrl": "https://...",
    "website": "https://example.com",
    "members": [
      {
        "userId": "user-uuid-1",
        "email": "user@example.com",
        "role": "admin",
        "joinedAt": "2026-01-01T00:00:00Z"
      }
    ],
    "createdAt": "2026-01-01T00:00:00Z",
    "updatedAt": "2026-05-04T12:00:00Z"
  }
}
```

---

### Create Workspace

**Request**
```
POST /api/workspaces
Authorization: Bearer <JWT>
```

**Body**
```json
{
  "name": "New Workspace",
  "description": "Description of workspace",
  "logoUrl": "https://...",
  "website": "https://example.com"
}
```

**Response** (201 Created)
```json
{
  "success": true,
  "data": {
    "id": "workspace-uuid-new",
    "name": "New Workspace",
    "ownerId": "user-uuid-1",
    "createdAt": "2026-05-04T12:00:00Z"
  }
}
```

---

### Update Workspace

**Request**
```
PUT /api/workspaces/:workspaceId
Authorization: Bearer <JWT>
```

**Body** (all fields optional)
```json
{
  "name": "Updated Name",
  "description": "Updated description",
  "logoUrl": "https://...",
  "website": "https://..."
}
```

**Response** (200 OK)
```json
{
  "success": true,
  "data": {
    "id": "workspace-uuid-1",
    "name": "Updated Name",
    "updatedAt": "2026-05-04T12:30:00Z"
  }
}
```

---

### Delete Workspace

**Request**
```
DELETE /api/workspaces/:workspaceId
Authorization: Bearer <JWT>
```

**Response** (200 OK)
```json
{
  "success": true,
  "message": "Workspace deleted successfully"
}
```

---

## Digital Product Passport (DPP) Endpoints

### List DPPs

**Request**
```
GET /api/passports
Authorization: Bearer <JWT>
```

**Query Parameters**:
- `workspaceId`: Required - Filter by workspace
- `page`: Page number (default: 1)
- `limit`: Items per page (default: 20)
- `published`: true/false - Filter by published status
- `sort`: Field to sort by (default: createdAt)

**Response** (200 OK)
```json
{
  "success": true,
  "data": [
    {
      "id": "passport-uuid-1",
      "workspaceId": "workspace-uuid-1",
      "productId": "BAT-2026-001",
      "productName": "Lithium Battery Pack",
      "version": 2,
      "isPublished": true,
      "publishedAt": "2026-05-03T10:00:00Z",
      "createdBy": "user-uuid-1",
      "createdAt": "2026-05-01T09:00:00Z",
      "updatedAt": "2026-05-04T12:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "pages": 8
  }
}
```

---

### Get DPP

**Request**
```
GET /api/passports/:passportId
Authorization: Bearer <JWT>
```

**Response** (200 OK)
```json
{
  "success": true,
  "data": {
    "id": "passport-uuid-1",
    "productId": "BAT-2026-001",
    "productName": "Lithium Battery Pack",
    "data": {
      "battery": {
        "capacity": "50 kWh",
        "chemistry": "LFP",
        "voltage": "400V"
      },
      "manufacturer": {
        "name": "Battery Corp",
        "location": "Germany"
      }
    },
    "version": 2,
    "isPublished": true,
    "createdBy": {
      "id": "user-uuid-1",
      "email": "creator@example.com"
    },
    "createdAt": "2026-05-01T09:00:00Z",
    "updatedAt": "2026-05-04T12:00:00Z"
  }
}
```

**Errors**:
- 404: Passport not found
- 403: No access to workspace

---

### Create DPP

**Request**
```
POST /api/passports
Authorization: Bearer <JWT>
```

**Body**
```json
{
  "workspaceId": "workspace-uuid-1",
  "productId": "BAT-2026-001",
  "productName": "Lithium Battery Pack",
  "data": {
    "battery": {
      "capacity": "50 kWh",
      "chemistry": "LFP",
      "voltage": "400V",
      "weight": "500 kg"
    },
    "manufacturer": {
      "name": "Battery Corp",
      "location": "Germany",
      "contact": "info@batterycorp.com"
    },
    "certifications": ["UN 38.3", "CE"],
    "environmental": {
      "recyclable": true,
      "co2_per_kwh": 45
    }
  }
}
```

**Response** (201 Created)
```json
{
  "success": true,
  "data": {
    "id": "passport-uuid-new",
    "productId": "BAT-2026-001",
    "productName": "Lithium Battery Pack",
    "version": 1,
    "isPublished": false,
    "createdAt": "2026-05-04T12:00:00Z"
  }
}
```

**Errors**:
- 400: Invalid data schema
- 403: No write access to workspace
- 409: Duplicate productId in workspace

---

### Update DPP

**Request**
```
PUT /api/passports/:passportId
Authorization: Bearer <JWT>
```

**Body** (partial update)
```json
{
  "productName": "Updated Battery Name",
  "data": {
    "battery": {
      "capacity": "60 kWh"
    }
  }
}
```

**Response** (200 OK)
```json
{
  "success": true,
  "data": {
    "id": "passport-uuid-1",
    "productName": "Updated Battery Name",
    "version": 3,
    "updatedAt": "2026-05-04T12:30:00Z"
  }
}
```

---

### Publish DPP

**Request**
```
POST /api/passports/:passportId/publish
Authorization: Bearer <JWT>
```

**Body** (optional)
```json
{
  "message": "First public release"
}
```

**Response** (200 OK)
```json
{
  "success": true,
  "data": {
    "id": "passport-uuid-1",
    "isPublished": true,
    "publishedAt": "2026-05-04T12:00:00Z",
    "publicLink": "https://claros-dpp.online/viewer?dpp-id=passport-uuid-1"
  }
}
```

---

### Get Public DPP (No Auth Required)

**Request**
```
GET /api/passports/:passportId/public
```

**Response** (200 OK)
```json
{
  "success": true,
  "data": {
    "id": "passport-uuid-1",
    "productName": "Lithium Battery Pack",
    "data": {
      "battery": { ... },
      "manufacturer": { ... }
    },
    "publishedAt": "2026-05-04T12:00:00Z"
  }
}
```

**Errors**:
- 404: Passport not found
- 403: Passport is not published

---

### Delete DPP

**Request**
```
DELETE /api/passports/:passportId
Authorization: Bearer <JWT>
```

**Response** (200 OK)
```json
{
  "success": true,
  "message": "Passport deleted successfully"
}
```

---

## Workspace Members Endpoints

### Get Workspace Members

**Request**
```
GET /api/workspaces/:workspaceId/members
Authorization: Bearer <JWT>
```

**Response** (200 OK)
```json
{
  "success": true,
  "data": [
    {
      "userId": "user-uuid-1",
      "email": "admin@example.com",
      "firstName": "John",
      "role": "admin",
      "joinedAt": "2026-01-01T00:00:00Z"
    },
    {
      "userId": "user-uuid-2",
      "email": "editor@example.com",
      "firstName": "Jane",
      "role": "editor",
      "joinedAt": "2026-02-15T00:00:00Z"
    }
  ]
}
```

---

### Invite User to Workspace

**Request**
```
POST /api/workspaces/:workspaceId/invite
Authorization: Bearer <JWT>
```

**Body**
```json
{
  "email": "newuser@example.com",
  "role": "editor"
}
```

**Response** (200 OK)
```json
{
  "success": true,
  "data": {
    "invitationId": "invite-uuid-1",
    "email": "newuser@example.com",
    "role": "editor",
    "expiresAt": "2026-05-11T12:00:00Z"
  },
  "message": "Invitation sent to newuser@example.com"
}
```

---

### Update Member Role

**Request**
```
PUT /api/workspaces/:workspaceId/members/:userId
Authorization: Bearer <JWT>
```

**Body**
```json
{
  "role": "admin"
}
```

**Response** (200 OK)
```json
{
  "success": true,
  "data": {
    "userId": "user-uuid-2",
    "role": "admin",
    "updatedAt": "2026-05-04T12:00:00Z"
  }
}
```

---

### Remove Member from Workspace

**Request**
```
DELETE /api/workspaces/:workspaceId/members/:userId
Authorization: Bearer <JWT>
```

**Response** (200 OK)
```json
{
  "success": true,
  "message": "Member removed from workspace"
}
```

---

## Audit Logs Endpoints

### Get Passport Audit Trail

**Request**
```
GET /api/passports/:passportId/audit
Authorization: Bearer <JWT>
```

**Response** (200 OK)
```json
{
  "success": true,
  "data": [
    {
      "id": "audit-uuid-1",
      "action": "created",
      "user": {
        "id": "user-uuid-1",
        "email": "user@example.com"
      },
      "changes": {
        "productName": "Lithium Battery Pack"
      },
      "createdAt": "2026-05-04T12:00:00Z"
    },
    {
      "id": "audit-uuid-2",
      "action": "published",
      "user": {
        "id": "user-uuid-1",
        "email": "user@example.com"
      },
      "changes": {
        "isPublished": true
      },
      "createdAt": "2026-05-04T12:30:00Z"
    }
  ]
}
```

---

## Health Check Endpoints

### API Health

**Request**
```
GET /api/health
```

**Response** (200 OK)
```json
{
  "status": "healthy",
  "timestamp": "2026-05-04T12:00:00Z",
  "version": "1.0.0",
  "database": "connected"
}
```

---

## Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| VALIDATION_ERROR | 400 | Invalid request data |
| UNAUTHORIZED | 401 | Missing or invalid JWT |
| FORBIDDEN | 403 | Insufficient permissions |
| NOT_FOUND | 404 | Resource not found |
| CONFLICT | 409 | Resource already exists |
| INTERNAL_ERROR | 500 | Server error |

---

## Rate Limiting

- **Limit**: 100 requests per minute per user
- **Header**: `X-RateLimit-Remaining`, `X-RateLimit-Reset`
- **Error**: 429 Too Many Requests

---

## Pagination

All list endpoints support pagination:

```
GET /api/passports?page=2&limit=50
```

**Response includes**:
```json
{
  "pagination": {
    "page": 2,
    "limit": 50,
    "total": 150,
    "pages": 3
  }
}
```

---

## Next Steps

- See [ARCHITECTURE.md](../ARCHITECTURE.md) for system design
- See [development/DEVELOPMENT.md](../development/DEVELOPMENT.md) for coding guidelines
- See [DATABASE_SCHEMA.md](../DATABASE_SCHEMA.md) for data model

