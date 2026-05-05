# Admin API Endpoints

All admin endpoints require `super_admin` role and Bearer token authentication.

**Base URL:** `http://localhost:3001`  
**Authentication:** Bearer token in `Authorization` header  
**Required Role:** `super_admin`

---

## Response Format

All responses are JSON. Successful responses (2xx) contain data or operation status. Error responses (4xx, 5xx) include error messages.

### Success Response
```json
{
  "id": "uuid",
  "name": "Example",
  "created_at": "2025-05-05T10:30:00Z",
  ...
}
```

### Error Response
```json
{
  "error": "Error message describing what went wrong"
}
```

---

## Umbrella Categories (Product Type Categories)

### List All Categories

**GET** `/api/admin/umbrella-categories`

Returns all umbrella categories used for organizing passport types.

**Parameters:** None

**Response (200 OK):**
```json
[
  {
    "id": "uuid",
    "name": "Batteries",
    "icon": "🔋",
    "created_at": "2025-05-05T10:30:00Z"
  }
]
```

**Error Codes:**
- `500` - Failed to fetch categories

---

### Create Category

**POST** `/api/admin/umbrella-categories`

Create a new umbrella category for organizing passport types.

**Request Body:**
```json
{
  "name": "Electronics",
  "icon": "📱"
}
```

**Parameters:**
- `name` (string, required) - Category name
- `icon` (string, optional, default: "📋") - Emoji icon representing category

**Response (201 Created):**
```json
{
  "id": "uuid",
  "name": "Electronics",
  "icon": "📱",
  "created_at": "2025-05-05T10:30:00Z"
}
```

**Error Codes:**
- `400` - Name is required or category already exists (23505)
- `500` - Failed to create category

---

### Delete Category

**DELETE** `/api/admin/umbrella-categories/:id`

Delete an umbrella category. Requires password confirmation. Category must not be in use by any passport types.

**Parameters:**
- `id` (path parameter, required) - Category ID to delete

**Request Body:**
```json
{
  "password": "user_password"
}
```

**Response (200 OK):**
```json
{
  "success": true
}
```

**Error Codes:**
- `400` - Password is required OR category is in use by passport types
- `401` - User not found
- `403` - Incorrect password
- `404` - Category not found
- `500` - Failed to delete category

---

## Passport Types

### List All Passport Types

**GET** `/api/admin/passport-types`

Returns all passport types (both active and inactive). Super admin only.

**Parameters:** None

**Response (200 OK):**
```json
[
  {
    "id": "uuid",
    "type_name": "battery-passport",
    "display_name": "Battery Digital Product Passport",
    "umbrella_category": "Batteries",
    "umbrella_icon": "🔋",
    "semantic_model_key": "battery",
    "fields_json": {...},
    "is_active": true,
    "created_at": "2025-05-05T10:30:00Z",
    "created_by_email": "admin@company.com"
  }
]
```

**Error Codes:**
- `500` - Failed to fetch passport types

---

### Get Passport Type by Name (Public)

**GET** `/api/passport-types/:typeName`

Get a single passport type definition by type name. **No authentication required** (public endpoint).

**Parameters:**
- `typeName` (path parameter, required) - Passport type name (e.g., "battery-passport")

**Response (200 OK):**
```json
{
  "id": "uuid",
  "type_name": "battery-passport",
  "display_name": "Battery Digital Product Passport",
  "umbrella_category": "Batteries",
  "umbrella_icon": "🔋",
  "semantic_model_key": "battery",
  "fields_json": {
    "sections": [
      {
        "id": "section-1",
        "title": "Product Information",
        "fields": [...]
      }
    ]
  },
  "is_active": true,
  "created_at": "2025-05-05T10:30:00Z"
}
```

**Error Codes:**
- `404` - Passport type not found

---

### Create Passport Type

**POST** `/api/admin/passport-types`

Create a new passport type definition with field schema.

**Request Body:**
```json
{
  "type_name": "battery-passport",
  "display_name": "Battery Digital Product Passport",
  "umbrella_category": "Batteries",
  "umbrella_icon": "🔋",
  "semantic_model_key": "battery",
  "fields_json": {
    "sections": [
      {
        "id": "section-1",
        "title": "Product Information",
        "fields": [
          {
            "id": "field-1",
            "name": "modelNumber",
            "label": "Model Number",
            "type": "text",
            "required": true,
            "semantic_id": "dpp:modelNumber"
          }
        ]
      }
    ]
  }
}
```

**Parameters:**
- `type_name` (string, required) - Unique identifier for passport type
- `display_name` (string, required) - Human-readable name
- `umbrella_category` (string, required) - Category for organization
- `umbrella_icon` (string, optional) - Emoji icon
- `semantic_model_key` (string, required) - Semantic model identifier
- `fields_json` (object, required) - Schema defining passport fields

**Response (201 Created):**
```json
{
  "id": "uuid",
  "type_name": "battery-passport",
  "display_name": "Battery Digital Product Passport",
  "umbrella_category": "Batteries",
  "umbrella_icon": "🔋",
  "semantic_model_key": "battery",
  "fields_json": {...},
  "is_active": true,
  "created_at": "2025-05-05T10:30:00Z",
  "created_by": "user-id"
}
```

**Error Codes:**
- `400` - Required fields missing OR type name already exists
- `500` - Failed to create passport type

---

### Update Passport Type

**PATCH** `/api/admin/passport-types/:id`

Update an existing passport type definition.

**Parameters:**
- `id` (path parameter, required) - Passport type ID

**Request Body:**
```json
{
  "display_name": "Updated Display Name",
  "fields_json": {...}
}
```

**Response (200 OK):**
```json
{
  "id": "uuid",
  "type_name": "battery-passport",
  "display_name": "Updated Display Name",
  ...
}
```

**Error Codes:**
- `404` - Passport type not found
- `500` - Failed to update passport type

---

### Delete Passport Type

**DELETE** `/api/admin/passport-types/:typeId`

Delete a passport type. Cannot delete if passports exist using this type.

**Parameters:**
- `typeId` (path parameter, required) - Passport type ID

**Response (200 OK):**
```json
{
  "success": true
}
```

**Error Codes:**
- `400` - Cannot delete - passports exist using this type
- `404` - Passport type not found
- `500` - Failed to delete passport type

---

### Activate Passport Type

**PATCH** `/api/admin/passport-types/:id/activate`

Mark a passport type as active (available for use).

**Parameters:**
- `id` (path parameter, required) - Passport type ID

**Response (200 OK):**
```json
{
  "id": "uuid",
  "type_name": "battery-passport",
  "is_active": true,
  ...
}
```

**Error Codes:**
- `404` - Passport type not found
- `500` - Failed to activate passport type

---

### Deactivate Passport Type

**PATCH** `/api/admin/passport-types/:id/deactivate`

Mark a passport type as inactive (unavailable for new passports).

**Parameters:**
- `id` (path parameter, required) - Passport type ID

**Response (200 OK):**
```json
{
  "id": "uuid",
  "type_name": "battery-passport",
  "is_active": false,
  ...
}
```

**Error Codes:**
- `404` - Passport type not found
- `500` - Failed to deactivate passport type

---

### Passport Type Draft

Manage draft versions of passport type schemas before activation.

#### Get Draft

**GET** `/api/admin/passport-type-draft`

Get the current draft of a passport type schema.

**Response (200 OK):**
```json
{
  "id": "uuid",
  "type_name": "battery-passport",
  "fields_json": {...},
  "created_at": "2025-05-05T10:30:00Z"
}
```

---

#### Save Draft

**PUT** `/api/admin/passport-type-draft`

Save a new version of passport type schema as draft.

**Request Body:**
```json
{
  "type_name": "battery-passport",
  "fields_json": {...}
}
```

**Response (200 OK):**
```json
{
  "id": "uuid",
  "type_name": "battery-passport",
  "fields_json": {...},
  "created_at": "2025-05-05T10:30:00Z"
}
```

---

#### Delete Draft

**DELETE** `/api/admin/passport-type-draft`

Delete the current passport type draft.

**Response (200 OK):**
```json
{
  "success": true
}
```

---

## Symbols (Semantic Icons)

### List Symbols

**GET** `/api/symbols`

Get all available symbols/icons (authenticated users).

**Parameters:** None

**Response (200 OK):**
```json
[
  {
    "id": "uuid",
    "name": "battery-icon",
    "url": "https://cdn.example.com/icons/battery.svg",
    "created_at": "2025-05-05T10:30:00Z"
  }
]
```

---

### Get Symbol Categories

**GET** `/api/symbols/categories`

Get categories of symbols for organization.

**Response (200 OK):**
```json
[
  {
    "id": "uuid",
    "name": "Energy",
    "description": "Energy-related symbols"
  }
]
```

---

### Upload Symbol

**POST** `/api/admin/symbols`

Upload a new symbol/icon file. Requires multipart form data with file upload.

**Parameters:**
- `name` (string, required) - Symbol name
- `category` (string, optional) - Symbol category
- `file` (file, required) - SVG or PNG file

**Response (201 Created):**
```json
{
  "id": "uuid",
  "name": "battery-icon",
  "url": "https://cdn.example.com/icons/battery.svg",
  "created_at": "2025-05-05T10:30:00Z"
}
```

**Error Codes:**
- `400` - File or name missing
- `500` - Failed to upload symbol

---

### Delete Symbol

**DELETE** `/api/admin/symbols/:id`

Delete a symbol. Requires password confirmation.

**Request Body:**
```json
{
  "password": "user_password"
}
```

**Response (200 OK):**
```json
{
  "success": true
}
```

**Error Codes:**
- `400` - Password is required OR symbol in use
- `403` - Incorrect password
- `404` - Symbol not found

---

## Companies (Admin Management)

### List Companies

**GET** `/api/admin/companies`

Get all companies. Super admin only.

**Query Parameters:**
- `limit` (number, optional, default: 50) - Maximum records to return
- `offset` (number, optional, default: 0) - Record offset for pagination

**Response (200 OK):**
```json
[
  {
    "id": "uuid",
    "name": "Acme Corp",
    "slug": "acme-corp",
    "website": "https://acme.com",
    "industry": "Manufacturing",
    "created_at": "2025-05-05T10:30:00Z",
    "created_by": "user-id"
  }
]
```

---

### Create Company

**POST** `/api/admin/companies`

Create a new company. Super admin only.

**Request Body:**
```json
{
  "name": "New Company Ltd",
  "slug": "new-company",
  "website": "https://newcompany.com",
  "industry": "Electronics"
}
```

**Parameters:**
- `name` (string, required) - Company name
- `slug` (string, required) - URL-friendly identifier
- `website` (string, optional) - Company website URL
- `industry` (string, optional) - Industry classification

**Response (201 Created):**
```json
{
  "id": "uuid",
  "name": "New Company Ltd",
  "slug": "new-company",
  "website": "https://newcompany.com",
  "industry": "Electronics",
  "created_at": "2025-05-05T10:30:00Z"
}
```

**Error Codes:**
- `400` - Required fields missing OR slug already exists
- `500` - Failed to create company

---

### Delete Company

**DELETE** `/api/admin/companies/:companyId`

Delete a company. Requires password confirmation. Cascades delete to related data.

**Request Body:**
```json
{
  "password": "user_password"
}
```

**Response (200 OK):**
```json
{
  "success": true
}
```

**Error Codes:**
- `400` - Password is required
- `403` - Incorrect password
- `404` - Company not found

---

### Configure Asset Management

**PATCH** `/api/admin/companies/:companyId/asset-management`

Enable/disable asset management features for a company.

**Request Body:**
```json
{
  "enabled": true,
  "settings": {
    "auto_sync": true,
    "batch_size": 100
  }
}
```

**Response (200 OK):**
```json
{
  "company_id": "uuid",
  "enabled": true,
  "settings": {...}
}
```

---

## DPP Policy (Company-Specific Settings)

See [company-granularity-policy.md](company-granularity-policy.md) for complete DPP policy documentation.

---

## Super Admins

### List Super Admins

**GET** `/api/admin/super-admins`

List all users with super_admin role.

**Response (200 OK):**
```json
[
  {
    "id": "uuid",
    "email": "admin1@company.com",
    "full_name": "Admin User",
    "role": "super_admin",
    "created_at": "2025-05-05T10:30:00Z"
  }
]
```

---

### Invite Super Admin

**POST** `/api/admin/super-admins/invite`

Send invitation to make a user a super admin.

**Request Body:**
```json
{
  "email": "neweadmin@company.com",
  "full_name": "New Admin"
}
```

**Response (201 Created):**
```json
{
  "id": "uuid",
  "email": "newadmin@company.com",
  "full_name": "New Admin",
  "invite_token": "token-value",
  "invite_expires_at": "2025-05-12T10:30:00Z"
}
```

---

### Update Super Admin Access

**PATCH** `/api/admin/super-admins/:userId/access`

Grant or revoke super admin privileges.

**Request Body:**
```json
{
  "grant_access": true
}
```

**Response (200 OK):**
```json
{
  "id": "uuid",
  "email": "admin@company.com",
  "role": "super_admin",
  "access_granted_at": "2025-05-05T10:30:00Z"
}
```

---

### Get Super Admin Access Details

**GET** `/api/admin/super-admins/:userId/access`

Get access details and permissions for a super admin user.

**Response (200 OK):**
```json
{
  "user_id": "uuid",
  "role": "super_admin",
  "permissions": ["read", "write", "admin", "delete"],
  "granted_at": "2025-05-05T10:30:00Z"
}
```

---

## Analytics

### System Analytics

**GET** `/api/admin/analytics`

Get system-wide analytics and statistics.

**Query Parameters:**
- `period` (string, optional, default: "30d") - "7d", "30d", "90d", "1y"

**Response (200 OK):**
```json
{
  "period": "30d",
  "total_companies": 45,
  "total_users": 1230,
  "total_passports": 5600,
  "active_sessions": 234,
  "api_calls_total": 45600,
  "api_calls_by_endpoint": {...},
  "error_rate": 0.02,
  "average_response_time_ms": 145
}
```

---

### Company Analytics

**GET** `/api/admin/companies/:companyId/analytics`

Get analytics for a specific company.

**Query Parameters:**
- `period` (string, optional, default: "30d") - "7d", "30d", "90d", "1y"

**Response (200 OK):**
```json
{
  "company_id": "uuid",
  "company_name": "Acme Corp",
  "period": "30d",
  "users_count": 45,
  "passports_count": 1200,
  "active_users_30d": 32,
  "passports_created": 150,
  "passports_updated": 320,
  "passports_published": 110,
  "access_grants_issued": 450,
  "access_revocations": 25
}
```

---

## User Role Management

### Change User Role

**PATCH** `/api/admin/users/:userId/role`

Change a user's role across all companies.

**Request Body:**
```json
{
  "role": "super_admin",
  "reason": "Promotion to system administrator"
}
```

**Response (200 OK):**
```json
{
  "user_id": "uuid",
  "email": "user@company.com",
  "role": "super_admin",
  "updated_at": "2025-05-05T10:30:00Z"
}
```

**Error Codes:**
- `400` - Invalid role
- `404` - User not found

---

## Company Access

### Create Company Access Type

**POST** `/api/admin/company-access`

Create a new type of company access or audience for access control.

**Request Body:**
```json
{
  "type_name": "partner-network",
  "display_name": "Partner Network",
  "description": "External partner organizations"
}
```

**Response (201 Created):**
```json
{
  "id": "uuid",
  "type_name": "partner-network",
  "display_name": "Partner Network",
  "description": "External partner organizations"
}
```

---

### Remove Company Access Type

**DELETE** `/api/admin/company-access/:companyId/:typeId`

Remove a company from an access type or delete access type configuration.

**Response (200 OK):**
```json
{
  "success": true
}
```

---

## Error Handling

All endpoints return standard error responses:

| Code | Meaning |
|------|---------|
| `400` | Bad Request - Missing or invalid parameters |
| `401` | Unauthorized - Missing or invalid authentication |
| `403` | Forbidden - Insufficient permissions or incorrect password |
| `404` | Not Found - Resource does not exist |
| `500` | Server Error - Internal server error |

Example error response:
```json
{
  "error": "Failed to create passport type"
}
```

