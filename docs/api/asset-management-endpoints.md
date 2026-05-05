# Asset Management API Endpoints

Asset Management APIs enable bulk passport creation, updates, and synchronization from external ERP/inventory systems.

**Base URL:** `http://localhost:3001`  
**Authentication:** Asset management key (API key) in `X-Asset-Management-Key` header  
**Authorization:** Requires asset editor role (`requireAssetEditor`)

---

## Authentication & Security

All Asset Management endpoints require:

1. **Asset Management Key** - Special API key in `X-Asset-Management-Key` header
2. **Company Scope** - Assets are scoped to a specific company
3. **Rate Limiting** - Aggressive rate limiting on write operations
4. **Roles** - Certain endpoints require `asset_editor` role

---

## Bootstrap

### Get Asset Management Configuration

**GET** `/api/asset-management/bootstrap`

Get company configuration, available passport types, and system presets for asset management. This should be called first to understand what passport types are available and how to structure asset payloads.

**Parameters:** None (company determined from asset management key)

**Response (200 OK):**
```json
{
  "company": {
    "id": "uuid",
    "name": "Acme Corp",
    "slug": "acme-corp"
  },
  "passport_types": [
    {
      "id": "uuid",
      "type_name": "battery-passport",
      "display_name": "Battery Digital Product Passport",
      "umbrella_category": "Batteries",
      "umbrella_icon": "🔋",
      "fields_json": {
        "sections": [...]
      }
    }
  ],
  "erp_presets": {
    "sap": {...},
    "oracle": {...}
  },
  "security": {
    "asset_key_required": true,
    "company_scoped": true
  },
  "assumptions": {
    "editable_statuses": ["draft", "in_revision"],
    "dynamic_pushes_do_not_change_passport_versions": true
  }
}
```

**Error Codes:**
- `401` - Invalid or missing asset management key
- `500` - Failed to load bootstrap data

---

## Passports

### List Company Passports

**GET** `/api/asset-management/passports`

Get all passports of a specific type for the company. Returns only editable fields and asset-relevant metadata.

**Query Parameters:**
- `passportType` (string, required) - Type name (e.g., "battery-passport")

**Response (200 OK):**
```json
{
  "company_id": "uuid",
  "passport_type": "battery-passport",
  "display_name": "Battery Digital Product Passport",
  "fields": [
    "modelNumber",
    "productId",
    "productName",
    "manufacturingDate"
  ],
  "passports": [
    {
      "dppId": "uuid",
      "productId": "BAT-2024-001",
      "modelNumber": "BR-3000",
      "productName": "High Capacity Battery",
      "manufacturingDate": "2024-01-15",
      "is_editable": true,
      "release_status": "draft",
      "version_number": 1
    }
  ],
  "summary": {
    "total": 150,
    "editable": 120,
    "released_or_locked": 30
  }
}
```

**Error Codes:**
- `400` - passportType query parameter is required
- `401` - Company doesn't have access to passport type
- `500` - Failed to load passports

---

## Sources & Preview

### Fetch External Records

**POST** `/api/asset-management/source/fetch`

Fetch records from external ERP/inventory system based on source configuration. Used to preview data before pushing to passports.

**Request Body:**
```json
{
  "sourceConfig": {
    "type": "sap",
    "apiEndpoint": "https://sap.acme.com/api",
    "apiKey": "key123",
    "query": {
      "materialType": "BATTERY",
      "plant": "PL-001"
    }
  }
}
```

**Response (200 OK):**
```json
{
  "records": [
    {
      "id": "MAT-001",
      "name": "Battery BR-3000",
      "category": "Energy Storage",
      "quantity": 500,
      "lastUpdated": "2025-05-05T10:00:00Z"
    }
  ],
  "total_records": 1,
  "timestamp": "2025-05-05T10:30:00Z"
}
```

**Error Codes:**
- `400` - Invalid source configuration OR connection failed
- `401` - Invalid ERP credentials
- `500` - Failed to fetch source records

---

### Generate Passport Preview

**POST** `/api/asset-management/preview`

Generate passport JSON preview without pushing to database. Used to validate and preview passport structures before actual push.

**Request Body:**
```json
{
  "passport_type": "battery-passport",
  "records": [
    {
      "product_id": "BAT-2024-001",
      "model_number": "BR-3000",
      "manufacturing_date": "2024-01-15"
    }
  ],
  "options": {
    "auto_publish": false,
    "create_if_not_exists": true,
    "update_fields": ["manufacturingDate"]
  }
}
```

**Response (200 OK):**
```json
{
  "generated_payload": {
    "passport_type": "battery-passport",
    "records": [
      {
        "product_id": "BAT-2024-001",
        "model_number": "BR-3000",
        "manufacturing_date": "2024-01-15",
        "generated_dpp_id": "uuid"
      }
    ],
    "validation": {
      "valid": true,
      "errors": [],
      "warnings": []
    }
  }
}
```

**Error Codes:**
- `400` - Invalid passport structure OR missing required fields
- `401` - Company doesn't have access to passport type
- `500` - Failed to generate preview

---

## Push

### Push Asset Passports

**POST** `/api/asset-management/push`

Create or update passports with asset data. This is the main endpoint for bulk passport operations.

**Request Body:**
```json
{
  "passport_type": "battery-passport",
  "records": [
    {
      "product_id": "BAT-2024-001",
      "model_number": "BR-3000",
      "manufacturing_date": "2024-01-15",
      "capacity_wh": 3000
    }
  ],
  "options": {
    "auto_publish": false,
    "create_if_not_exists": true,
    "match_field": "product_id",
    "update_fields": ["modelNumber", "capacity"]
  }
}
```

**Parameters:**
- `passport_type` (string, required) - Type of passport
- `records` (array, required) - Passport records to push
- `options` (object, optional):
  - `auto_publish` (boolean) - Automatically publish after push
  - `create_if_not_exists` (boolean) - Create new passports if not found
  - `match_field` (string) - Field to match for updates (default: "product_id")
  - `update_fields` (array) - Only update these fields on existing passports
  - `source_kind` (string) - Source system type ("manual", "api", "sap", etc.)

**Response (200 OK):**
```json
{
  "status": "success",
  "run": {
    "id": "uuid",
    "company_id": "uuid",
    "passport_type": "battery-passport",
    "trigger_type": "manual",
    "source_kind": "manual",
    "status": "success",
    "summary": {
      "total_records": 150,
      "passports_created": 45,
      "passports_updated": 105,
      "dynamic_fields_pushed": 0,
      "failed": 0
    },
    "created_at": "2025-05-05T10:30:00Z"
  },
  "summary": {
    "total_records": 150,
    "passports_created": 45,
    "passports_updated": 105,
    "dynamic_fields_pushed": 0,
    "failed": 0
  },
  "details": [
    {
      "product_id": "BAT-2024-001",
      "action": "created",
      "generated_dpp_id": "uuid"
    }
  ],
  "generated_payload": {...}
}
```

**Error Codes:**
- `400` - Invalid records OR missing required fields
- `401` - Invalid asset management key OR unauthorized
- `500` - Push operation failed

---

## Jobs

### List Asset Management Jobs

**GET** `/api/asset-management/jobs`

List all recurring or scheduled asset management jobs for the company.

**Parameters:** None

**Response (200 OK):**
```json
{
  "jobs": [
    {
      "id": 1,
      "company_id": "uuid",
      "passport_type": "battery-passport",
      "name": "Daily Battery Sync",
      "source_kind": "api",
      "source_config": {
        "type": "sap",
        "apiEndpoint": "https://sap.acme.com/api"
      },
      "is_active": true,
      "start_at": "2025-05-05T09:00:00Z",
      "interval_minutes": 1440,
      "next_run_at": "2025-05-06T09:00:00Z",
      "created_at": "2025-05-05T10:30:00Z",
      "updated_at": "2025-05-05T10:30:00Z"
    }
  ]
}
```

---

### Create Asset Job

**POST** `/api/asset-management/jobs`

Create a new recurring or one-time asset management job.

**Request Body:**
```json
{
  "passport_type": "battery-passport",
  "name": "Daily Battery Sync",
  "sourceKind": "api",
  "sourceConfig": {
    "type": "sap",
    "apiEndpoint": "https://sap.acme.com/api",
    "apiKey": "key123"
  },
  "records": [],
  "options": {
    "create_if_not_exists": true,
    "match_field": "product_id"
  },
  "isActive": true,
  "startAt": "2025-05-05T09:00:00Z",
  "intervalMinutes": 1440
}
```

**Parameters:**
- `passport_type` (string, required) - Type of passport
- `name` (string, required) - Job name
- `sourceKind` (string, required) - "api" or "manual"
- `sourceConfig` (object) - Configuration for API source
- `records` (array) - Records for manual jobs
- `options` (object) - Push options
- `isActive` (boolean, default: true) - Job enabled
- `startAt` (ISO string) - When to start
- `intervalMinutes` (number) - Recurrence interval in minutes

**Response (201 Created):**
```json
{
  "job": {
    "id": 1,
    "company_id": "uuid",
    "passport_type": "battery-passport",
    "name": "Daily Battery Sync",
    "source_kind": "api",
    "source_config": {...},
    "is_active": true,
    "start_at": "2025-05-05T09:00:00Z",
    "interval_minutes": 1440,
    "next_run_at": "2025-05-06T09:00:00Z",
    "created_at": "2025-05-05T10:30:00Z"
  }
}
```

**Error Codes:**
- `400` - Invalid job configuration
- `401` - User not authorized

---

### Update Asset Job

**PATCH** `/api/asset-management/jobs/:jobId`

Update an existing asset management job configuration.

**Parameters:**
- `jobId` (path parameter, required) - Job ID to update

**Request Body:** (same as POST, all fields optional)

**Response (200 OK):**
```json
{
  "job": {...}
}
```

**Error Codes:**
- `400` - Invalid configuration
- `404` - Job not found

---

### Run Asset Job

**POST** `/api/asset-management/jobs/:jobId/run`

Manually trigger execution of an asset management job immediately.

**Parameters:**
- `jobId` (path parameter, required) - Job ID to run

**Response (200 OK):**
```json
{
  "run": {
    "id": "uuid",
    "job_id": 1,
    "company_id": "uuid",
    "status": "success",
    "summary": {
      "total_records": 150,
      "passports_created": 45,
      "passports_updated": 105,
      "failed": 0
    },
    "triggered_at": "2025-05-05T10:30:00Z",
    "completed_at": "2025-05-05T10:32:15Z"
  }
}
```

**Error Codes:**
- `400` - Job execution failed
- `404` - Job not found

---

## Runs

### Get Asset Job Runs

**GET** `/api/asset-management/runs`

Get execution history of all asset management jobs and pushes.

**Query Parameters:**
- `limit` (number, optional, default: 25, max: 100) - Maximum results

**Response (200 OK):**
```json
{
  "runs": [
    {
      "id": "uuid",
      "job_id": 1,
      "company_id": "uuid",
      "passport_type": "battery-passport",
      "trigger_type": "scheduled",
      "source_kind": "api",
      "status": "success",
      "summary": {
        "total_records": 150,
        "passports_created": 45,
        "passports_updated": 105,
        "dynamic_fields_pushed": 0,
        "failed": 0
      },
      "request_json": {...},
      "generated_json": {...},
      "created_at": "2025-05-05T10:30:00Z",
      "completed_at": "2025-05-05T10:32:15Z"
    }
  ]
}
```

---

## Status Values

### Job Status
- `success` - All passports created/updated successfully
- `partial` - Some passports succeeded, some failed
- `failed` - Job execution failed completely

### Trigger Type
- `manual_job_run` - User triggered manual run
- `scheduled` - Automatic scheduled execution
- `api_push` - Direct API push

### Source Kind
- `api` - External API (SAP, Oracle, etc.)
- `manual` - Manual records provided
- `sap` - SAP ERP system
- `oracle` - Oracle ERP system

---

## Error Handling

All Asset Management endpoints return consistent error responses:

```json
{
  "error": "Error message describing what went wrong"
}
```

| Code | Meaning |
|------|---------|
| `400` | Bad Request - Invalid configuration or data |
| `401` | Unauthorized - Invalid asset key or insufficient permissions |
| `404` | Not Found - Resource doesn't exist |
| `429` | Too Many Requests - Rate limit exceeded |
| `500` | Server Error - Internal server error |

