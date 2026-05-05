# Repository Endpoints

Comprehensive documentation for company document repository and symbol management endpoints. The repository provides storage and organization for company-specific documents, images, and symbols used in passport generation.

## Table of Contents

- [Repository Navigation](#repository-navigation)
- [Folder Management](#folder-management)
- [File Management](#file-management)
- [Symbol Management](#symbol-management)
- [Symbol Migration](#symbol-migration)

---

## Repository Navigation

Browse and query company repository structure.

### GET /api/companies/:companyId/repository

List repository contents at a specified folder level.

**Authentication**: Required (Bearer token)  
**Authorization**: Company access required  
**Rate Limit**: Standard

**Request**

```http
GET /api/companies/123/repository
Authorization: Bearer <token>
```

**Query Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `parentId` | number | Optional folder ID to list contents of. Omit for root level. |

**Response** (200 OK)

```json
[
  {
    "id": 1,
    "parent_id": null,
    "name": "Documentation",
    "type": "folder",
    "file_url": null,
    "storage_key": null,
    "mime_type": null,
    "size_bytes": null,
    "created_at": "2025-01-10T14:20:00Z"
  },
  {
    "id": 2,
    "parent_id": null,
    "name": "Company_Profile.pdf",
    "type": "file",
    "file_url": "https://storage.example.com/company-123/Company_Profile.pdf",
    "storage_key": "company-123/2025-01/Company_Profile_abc123.pdf",
    "mime_type": "application/pdf",
    "size_bytes": 2048576,
    "created_at": "2025-01-10T14:25:00Z"
  },
  {
    "id": 3,
    "parent_id": null,
    "name": "Certifications",
    "type": "folder",
    "file_url": null,
    "storage_key": null,
    "mime_type": null,
    "size_bytes": null,
    "created_at": "2025-01-10T14:30:00Z"
  }
]
```

**Response Fields**

| Field | Type | Description |
|-------|------|-------------|
| `id` | number | Unique item identifier |
| `parent_id` | number \| null | Parent folder ID, null for root items |
| `name` | string | Item name (filename or folder name) |
| `type` | string | "folder" or "file" |
| `file_url` | string \| null | Public URL to file (null for folders) |
| `storage_key` | string \| null | Cloud storage object key |
| `mime_type` | string \| null | MIME type (null for folders) |
| `size_bytes` | number \| null | File size in bytes (null for folders) |
| `created_at` | string | ISO 8601 creation timestamp |

**Ordering**: Results sorted by type (folders first), then by name

**Error Responses**

| Code | Error | Description |
|------|-------|-------------|
| 401 | Unauthorized | Missing or invalid authentication token |
| 403 | Forbidden | No access to specified company |
| 404 | Not Found | Company or parent folder not found |
| 500 | Internal Error | Failed to list repository |

---

### GET /api/companies/:companyId/repository/tree

Fetch complete repository folder tree structure.

**Authentication**: Required (Bearer token)  
**Authorization**: Company access required  
**Rate Limit**: Standard

**Request**

```http
GET /api/companies/123/repository/tree
Authorization: Bearer <token>
```

**Response** (200 OK)

```json
[
  {
    "id": 1,
    "parent_id": null,
    "name": "Documentation",
    "type": "folder"
  },
  {
    "id": 4,
    "parent_id": 1,
    "name": "Product Specs",
    "type": "folder"
  },
  {
    "id": 5,
    "parent_id": 4,
    "name": "BMS_Specification_v2.pdf",
    "type": "file"
  },
  {
    "id": 3,
    "parent_id": null,
    "name": "Certifications",
    "type": "folder"
  }
]
```

**Use Cases**:
- Populate tree navigation UI
- Build hierarchical folder selectors
- Validate parent/child relationships
- Migrate or backup repository structure

**Error Responses**

| Code | Error | Description |
|------|-------|-------------|
| 401 | Unauthorized | Missing or invalid authentication token |
| 403 | Forbidden | No access to specified company |
| 404 | Not Found | Company not found |
| 500 | Internal Error | Failed to fetch tree structure |

---

## Folder Management

Create and organize folders in company repository.

### POST /api/companies/:companyId/repository/folder

Create a new folder in the repository.

**Authentication**: Required (Bearer token)  
**Authorization**: Company editor role required  
**Rate Limit**: Standard

**Request**

```http
POST /api/companies/123/repository/folder
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Compliance Documents",
  "parentId": 1
}
```

**Request Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Required | Folder name (trimmed, duplicates at same level rejected) |
| `parentId` | number | Optional | Parent folder ID. Omit for root level. |

**Response** (201 Created)

```json
{
  "id": 10,
  "parent_id": 1,
  "name": "Compliance Documents",
  "type": "folder",
  "file_url": null,
  "storage_key": null,
  "mime_type": null,
  "size_bytes": null,
  "created_at": "2025-01-15T10:45:00Z"
}
```

**Validation**:
- Name required and must not be empty after trimming
- Duplicate folder names at same parent level rejected with 409 Conflict
- Max folder nesting: system-dependent (typically 10+ levels supported)

**Error Responses**

| Code | Error | Description |
|------|-------|-------------|
| 400 | Bad Request | Folder name required and not empty |
| 401 | Unauthorized | Missing or invalid authentication token |
| 403 | Forbidden | Insufficient permissions or no company access |
| 404 | Not Found | Company or parent folder not found |
| 409 | Conflict | Folder with same name exists at this level |
| 500 | Internal Error | Failed to create folder |

---

## File Management

Upload, copy, rename, and delete files in the repository.

### POST /api/companies/:companyId/repository/upload

Upload a file to the repository.

**Authentication**: Required (Bearer token)  
**Authorization**: Company editor role required  
**Rate Limit**: Standard

**Request**

```http
POST /api/companies/123/repository/upload
Authorization: Bearer <token>
Content-Type: multipart/form-data

file: <binary file>
parentId: 1
displayName: "Technical Specification"
```

**Request Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | file | Required | Binary file content (max 50 MB) |
| `parentId` | number | Optional | Parent folder ID. Omit for root level. |
| `displayName` | string | Optional | Custom display name. Defaults to original filename. |

**Supported File Types**:
- Documents: PDF, DOCX, XLSX, TXT
- Images: PNG, JPG, JPEG, WEBP, SVG
- Archives: ZIP, TAR, GZ
- Data: JSON, XML, CSV
- Others: Any MIME type accepted (system may restrict based on security policies)

**Response** (201 Created)

```json
{
  "id": 20,
  "parent_id": 1,
  "name": "Technical Specification",
  "type": "file",
  "file_url": "https://storage.example.com/company-123/technical_spec_abc123.pdf",
  "storage_key": "company-123/2025-01/Technical_Specification_abc123.pdf",
  "mime_type": "application/pdf",
  "size_bytes": 4096000,
  "created_at": "2025-01-15T11:00:00Z"
}
```

**Storage**:
- Files stored in cloud storage (S3, GCS, or local filesystem)
- Storage key format: `company-{id}/YYYY-MM/filename_hash.ext`
- File URLs publicly accessible with optional authentication
- File path validated to prevent directory traversal attacks

**Error Responses**

| Code | Error | Description |
|------|-------|-------------|
| 400 | Bad Request | No file in request or missing parentId |
| 401 | Unauthorized | Missing or invalid authentication token |
| 403 | Forbidden | Insufficient permissions or no company access |
| 404 | Not Found | Company or parent folder not found |
| 413 | Payload Too Large | File exceeds 50 MB limit |
| 500 | Internal Error | Upload failed or storage error |

**Security**:
- File type validated via MIME type detection
- Files scanned for malware (if configured)
- Original filename preserved in metadata
- Storage path includes random hash to prevent collisions

---

### POST /api/companies/:companyId/repository/copy

Add a copy of an external file to the repository.

**Authentication**: Required (Bearer token)  
**Authorization**: Company editor role required  
**Rate Limit**: Standard

**Request**

```http
POST /api/companies/123/repository/copy
Authorization: Bearer <token>
Content-Type: application/json

{
  "sourceUrl": "https://external-site.example.com/document.pdf",
  "name": "External Document Copy",
  "parentId": 5
}
```

**Request Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sourceUrl` | string | Required | Full URL to external file |
| `name` | string | Required | Display name for copied file |
| `parentId` | number | Optional | Destination folder ID. Omit for root. |

**Response** (201 Created)

```json
{
  "id": 21,
  "parent_id": 5,
  "name": "External Document Copy",
  "type": "file",
  "file_url": "https://external-site.example.com/document.pdf",
  "storage_key": null,
  "mime_type": "application/pdf",
  "size_bytes": null,
  "created_at": "2025-01-15T11:15:00Z"
}
```

**Behavior**:
- Creates reference to external file (not downloaded/stored)
- File URL remains as provided sourceUrl
- No local storage used
- MIME type defaults to "application/pdf"

**Use Cases**:
- Link to external compliance documents
- Reference published specifications
- Catalog third-party resources

**Error Responses**

| Code | Error | Description |
|------|-------|-------------|
| 400 | Bad Request | Missing sourceUrl or name parameters |
| 401 | Unauthorized | Missing or invalid authentication token |
| 403 | Forbidden | Insufficient permissions or no company access |
| 404 | Not Found | Company or parent folder not found |
| 500 | Internal Error | Failed to create reference |

---

### PATCH /api/companies/:companyId/repository/:itemId

Rename a repository item (file or folder).

**Authentication**: Required (Bearer token)  
**Authorization**: Company editor role required  
**Rate Limit**: Standard

**Request**

```http
PATCH /api/companies/123/repository/20
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Specification v2.1 - Updated"
}
```

**Request Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Required | New name for item (not empty after trim) |

**Response** (200 OK)

```json
{
  "id": 20,
  "parent_id": 1,
  "name": "Specification v2.1 - Updated",
  "type": "file",
  "file_url": "https://storage.example.com/company-123/technical_spec_abc123.pdf",
  "storage_key": "company-123/2025-01/Technical_Specification_abc123.pdf",
  "mime_type": "application/pdf",
  "size_bytes": 4096000,
  "updated_at": "2025-01-15T11:20:00Z"
}
```

**Error Responses**

| Code | Error | Description |
|------|-------|-------------|
| 400 | Bad Request | Name required and not empty after trimming |
| 401 | Unauthorized | Missing or invalid authentication token |
| 403 | Forbidden | Insufficient permissions or no company access |
| 404 | Not Found | Item not found in company repository |
| 500 | Internal Error | Failed to rename item |

---

### DELETE /api/companies/:companyId/repository/:itemId

Delete a file or folder from the repository.

**Authentication**: Required (Bearer token)  
**Authorization**: Company editor role required  
**Rate Limit**: Standard

**Request**

```http
DELETE /api/companies/123/repository/20
Authorization: Bearer <token>
```

**Response** (200 OK)

```json
{
  "success": true
}
```

**Deletion Rules**:
- **Folders**: Must be empty (no child items). Returns 409 Conflict if folder has children.
- **Files**: Permanently deleted with all storage cleaned up.
- **Storage**: For uploaded files, associated cloud storage objects deleted. External references simply removed from repository.

**Error Responses**

| Code | Error | Description |
|------|-------|-------------|
| 401 | Unauthorized | Missing or invalid authentication token |
| 403 | Forbidden | Insufficient permissions or no company access |
| 404 | Not Found | Item not found in company repository |
| 409 | Conflict | Folder not empty - must delete contents first |
| 500 | Internal Error | Deletion failed (may be partially completed) |

**Recovery**: Deleted files cannot be recovered (permanent). Consider archiving instead of deleting.

---

## Symbol Management

Store and manage company symbols/logos/badges for use in passport generation.

### GET /api/companies/:companyId/repository/symbols

List all image symbols in company repository.

**Authentication**: Required (Bearer token)  
**Authorization**: Company access required  
**Rate Limit**: Standard

**Request**

```http
GET /api/companies/123/repository/symbols
Authorization: Bearer <token>
```

**Response** (200 OK)

```json
[
  {
    "id": 30,
    "name": "Company Logo",
    "mime_type": "image/png",
    "file_url": "https://storage.example.com/company-123/logo_xyz789.png",
    "storage_key": "company-123/2025-01/logo_xyz789.png",
    "size_bytes": 102400,
    "created_at": "2025-01-10T09:00:00Z"
  },
  {
    "id": 31,
    "name": "Certification Badge",
    "mime_type": "image/svg+xml",
    "file_url": "https://storage.example.com/company-123/badge_abc456.svg",
    "storage_key": "company-123/2025-01/badge_abc456.svg",
    "size_bytes": 5120,
    "created_at": "2025-01-12T14:30:00Z"
  }
]
```

**Filters Applied**:
- Only `type = 'file'`
- Only `mime_type LIKE 'image/%'`
- Results sorted by name

**Image Formats Supported**:
- PNG, JPG/JPEG, WEBP, SVG
- Recommended: PNG (transparency), SVG (scalable)

**Error Responses**

| Code | Error | Description |
|------|-------|-------------|
| 401 | Unauthorized | Missing or invalid authentication token |
| 403 | Forbidden | No access to specified company |
| 404 | Not Found | Company not found |
| 500 | Internal Error | Failed to fetch symbols |

---

### POST /api/companies/:companyId/repository/symbols/upload

Upload a symbol/logo/badge image for use in passports.

**Authentication**: Required (Bearer token)  
**Authorization**: Company editor role required  
**Rate Limit**: Standard

**Request**

```http
POST /api/companies/123/repository/symbols/upload
Authorization: Bearer <token>
Content-Type: multipart/form-data

file: <binary image>
name: "Company Logo - 2025"
```

**Request Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | file | Required | Image file (PNG, JPG, SVG, WEBP) |
| `name` | string | Optional | Symbol name. Defaults to filename without extension. |

**File Constraints**:
- Max file size: 10 MB
- Allowed MIME types: image/png, image/jpeg, image/svg+xml, image/webp
- Recommended dimensions: 512x512px or larger for PNG/JPG

**Response** (201 Created)

```json
{
  "id": 32,
  "company_id": "123",
  "parent_id": null,
  "name": "Company Logo - 2025",
  "type": "file",
  "file_path": "2025-01-repository/company_logo_hash123.png",
  "storage_key": "company-123/2025-01/logo_hash123.png",
  "storage_provider": "s3",
  "file_url": "https://storage.example.com/company-123/logo_hash123.png",
  "mime_type": "image/png",
  "size_bytes": 204800,
  "created_at": "2025-01-15T12:00:00Z"
}
```

**Storage**:
- Files stored with random hash to prevent collisions
- Path: `company-{id}/YYYY-MM/filename_hash.ext`
- Cloud provider: S3, GCS, or local filesystem
- All symbols stored at repository root (parent_id = NULL)

**Error Responses**

| Code | Error | Description |
|------|-------|-------------|
| 400 | Bad Request | No file uploaded |
| 401 | Unauthorized | Missing or invalid authentication token |
| 403 | Forbidden | Insufficient permissions or no company access |
| 404 | Not Found | Company not found |
| 413 | Payload Too Large | File exceeds 10 MB limit |
| 415 | Unsupported Media Type | File type not an image |
| 500 | Internal Error | Upload failed |

**Recommended Usage**:
- Company logo for passport headers
- Certification badges for verified claims
- Facility icons for multi-site passports
- QR code overlays or watermarks

---

## Symbol Migration

Admin function to migrate legacy symbols to company repositories.

### POST /api/admin/migrate-symbols

Migrate all system-wide symbols to individual company repositories.

**Authentication**: Required (Bearer token)  
**Authorization**: Super admin role required  
**Rate Limit**: Standard

**Request**

```http
POST /api/admin/migrate-symbols
Authorization: Bearer <super-admin-token>
```

**Response** (200 OK)

```json
{
  "success": true,
  "inserted": 45,
  "skipped": 15,
  "symbols": 60,
  "companies": 10
}
```

**Response Fields**

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Migration completed successfully |
| `inserted` | number | Count of symbol copies created |
| `skipped` | number | Count of symbols already present in company repo |
| `symbols` | number | Total symbols migrated |
| `companies` | number | Total companies processed |

**Operation**:
1. Fetches all active symbols from global `symbols` table
2. For each company, creates repository entries for each symbol
3. Uses duplicate detection: skips if symbol already exists at that file_url
4. Auto-detects MIME type based on file extension
5. Maps extensions: .svg→svg+xml, .png→png, .jpg→jpeg, .webp→webp
6. Creates repository entries with symbol file_url pointing to original

**MIME Type Mapping**

| Extension | MIME Type |
|-----------|-----------|
| .svg | image/svg+xml |
| .png | image/png |
| .jpg/.jpeg | image/jpeg |
| .webp | image/webp |
| Others | image/png (default) |

**Error Responses**

| Code | Error | Description |
|------|-------|-------------|
| 401 | Unauthorized | Missing or invalid authentication token |
| 403 | Forbidden | Super admin role required |
| 500 | Internal Error | Migration failed with error message |

**Use Cases**:
- One-time migration from old symbol system
- Populate all company repositories after system update
- Refresh symbol references for existing data

**Idempotent**: Safe to run multiple times (duplicates skipped)

---

## Related Documentation

- [Company Extended Endpoints](./company-extended-endpoints.md) - Profile, compliance, facilities
- [Admin Endpoints](./admin-endpoints.md) - Symbol management (admin side)
- [ENDPOINTS.md](./ENDPOINTS.md) - Complete API reference index

---

## Repository Storage Architecture

### Storage Providers

The repository supports multiple storage backends:

**Cloud Storage (Recommended)**
- Amazon S3
- Google Cloud Storage
- Azure Blob Storage
- DigitalOcean Spaces

**Local Filesystem**
- Fallback option for development/testing
- Path validation prevents directory traversal attacks
- Files stored in `REPO_BASE_DIR` with company/date isolation

### Storage Keys

All uploaded files assigned storage keys:
```
company-{companyId}/YYYY-MM/{filename}_{randomHash}.{ext}
```

Example:
```
company-123/2025-01/Technical_Specification_a1b2c3d4.pdf
```

### Public Access

Files accessible via public URLs:
```
https://storage.example.com/company-123/Technical_Specification_a1b2c3d4.pdf
```

URLs returned in API responses for direct browser download/display.

---

## Best Practices

### Organization

1. **Create meaningful folders**: Documentation, Certifications, Assets, Legal
2. **Use clear naming**: Include date or version in filename
3. **Regular cleanup**: Archive or delete obsolete documents
4. **Symbol standardization**: Consistent logo/badge sizing

### File Management

- Keep files under 20 MB for optimal performance
- Use PDF for documents, PNG for images
- Maintain backup copies of critical documents
- Archive old versions rather than deleting

### Symbols

- Logo: 512x512px PNG with transparency (recommended)
- Badges: 256x256px PNG or SVG (scalable)
- Watermark: Keep simple (single color, <50KB)
- Test: View at actual display size before using

---

*Last Updated: January 2025*
*API Version: 1.0*
