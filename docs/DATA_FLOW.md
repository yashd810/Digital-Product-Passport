# Data Flow - Claros DPP

This document explains how data moves through the Claros DPP system from user input to persistent storage and back.

---

## Complete Request/Response Cycle

### Example: User Creates a Digital Product Passport

```
1. USER INPUT (Frontend)
   └─ User fills DPP form and clicks "Create"

2. FRONTEND PROCESSING (Vue.js)
   └─ Form validation
   └─ Convert data to JSON
   └─ Add JWT token to headers
   └─ POST /api/passports { data, workspace_id }

3. NETWORK TRANSMISSION
   └─ HTTPS request through Caddy reverse proxy
   └─ Request forwarded to backend (localhost:3001)

4. BACKEND RECEPTION (Express)
   ├─ Parse request body
   ├─ Extract JWT from Authorization header
   └─ Route to /api/passports POST handler

5. MIDDLEWARE CHAIN (Express)
   ├─ authMiddleware()
   │  ├─ Verify JWT signature
   │  ├─ Check token expiration
   │  └─ Extract user_id from token
   ├─ validationMiddleware()
   │  ├─ Validate request schema
   │  ├─ Check required fields
   │  └─ Return 400 if invalid
   └─ requestLogging()
       └─ Log incoming request

6. ROUTE HANDLER (routes/passports.js)
   └─ POST /api/passports handler
       ├─ Extract user_id from request
       ├─ Extract workspace_id from body
       ├─ Call PassportService.create(data, user_id, workspace_id)

7. SERVICE LAYER LOGIC (services/PassportService.js)
   ├─ Validate DPP schema
   ├─ Generate UUID for passport
   ├─ Prepare data for storage
   └─ Call DatabaseService.createPassport()

8. DATABASE INTERACTION (db/)
   ├─ Generate SQL INSERT query
   ├─ Add user_id (who created it)
   ├─ Add timestamp (when created)
   ├─ Add version (1)
   ├─ Add is_published (false)
   └─ Execute query:
       INSERT INTO digital_product_passports
       (id, workspace_id, product_id, product_name, data, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)

9. DATABASE STORAGE (PostgreSQL)
   ├─ Row inserted in "digital_product_passports" table
   ├─ Trigger creates audit log entry (optional)
   ├─ Return generated row with id, timestamps, etc.

10. AUDIT LOGGING (if enabled)
    └─ INSERT INTO audit_logs
        (user_id, action, entity_type, entity_id, created_at)
        VALUES ($1, 'created', 'passport', $2, NOW())

11. RESPONSE CONSTRUCTION (Backend)
    ├─ Create response JSON:
    │  {
    │    "id": "550e8400-e29b-41d4-a716-446655440000",
    │    "workspace_id": "...",
    │    "product_name": "...",
    │    "is_published": false,
    │    "created_at": "2026-05-04T12:00:00Z",
    │    ...
    │  }
    ├─ Set HTTP status to 201 (Created)
    └─ Add response headers

12. NETWORK RESPONSE
    └─ HTTPS response through Caddy
    └─ Return to frontend application

13. FRONTEND HANDLING (Vue.js)
    ├─ Receive response
    ├─ Parse JSON
    ├─ Store in component state/store
    ├─ Navigate to DPP detail page
    └─ Display success message

14. USER SEES RESULT
    └─ Passport created successfully
    └─ Can view, edit, publish, share, or delete
```

---

## Data Flow Diagrams

### Authentication Flow

```
User Login
  ↓
Frontend: POST /api/auth/login
  ↓ (HTTPS)
Backend: Verify credentials
  ├─ SELECT * FROM users WHERE email = ?
  ├─ Compare password hash
  └─ If valid, generate JWT token
  ↓
Backend: Returns { token, user, refresh_token }
  ↓ (HTTPS)
Frontend: Store token in localStorage
  ├─ localStorage.setItem('authToken', token)
  └─ Set Authorization header for future requests
  ↓
Frontend: Redirect to dashboard
  ↓
User is authenticated
```

### DPP Publishing Flow

```
User clicks "Publish" on DPP
  ↓
Frontend: PUT /api/passports/:id/publish
  ├─ Header: Authorization: Bearer <JWT>
  └─ Body: { status: 'published' }
  ↓ (HTTPS through Caddy)
Backend: Verify user owns passport
  ├─ SELECT * FROM digital_product_passports WHERE id = ? AND created_by = ?
  └─ If not found/unauthorized, return 403
  ↓
Backend: Update passport record
  ├─ UPDATE digital_product_passports
  │  SET is_published = true, published_at = NOW()
  │  WHERE id = ?
  └─ Generate public link token
  ↓
Backend: Log publish action
  ├─ INSERT INTO audit_logs
  │  VALUES (user_id, 'published', 'passport', passport_id)
  ↓
Backend: Return updated passport
  ├─ Include public_link URL
  └─ HTTP 200 OK
  ↓
Frontend: Receive updated data
  ├─ Update UI to show "Published"
  └─ Show public link to user
  ↓
User: Copy public link
  └─ Share with others
    ↓
Public Access (No login needed)
  ├─ Anyone can access /viewer?dpp-id=...
  ├─ Public Viewer app fetches GET /api/passports/:id/public
  ├─ Backend verifies is_published=true
  └─ Display passport to public
```

### File Upload Flow (Asset Management)

```
User uploads file/asset
  ↓
Frontend: FormData with file
  ├─ multipart/form-data
  └─ POST /api/passports/:id/assets
      ├─ Header: Authorization: Bearer <JWT>
      └─ Body: File binary
  ↓ (HTTPS through Caddy)
Backend: Receive file
  ├─ Check authentication
  ├─ Validate file type/size
  └─ Save to disk or cloud storage
  ↓
Backend: Store metadata
  ├─ INSERT INTO assets
  │  (passport_id, filename, mime_type, size, url)
  └─ Return asset metadata
  ↓
Frontend: Receive asset URL
  ├─ Store URL in DPP data
  └─ Update passport with asset reference
  ↓
Database: Asset metadata persisted
  ├─ Asset can be referenced in multiple DPPs
  └─ Asset deleted only when no DPPs reference it
```

### User Invitation Flow

```
Admin invites user to workspace
  ↓
Frontend: POST /api/workspaces/:workspace_id/invite
  ├─ Header: Authorization: Bearer <JWT>
  └─ Body: { email: 'newuser@example.com', role: 'editor' }
  ↓
Backend: Verify admin permission
  ├─ SELECT role FROM workspace_members
  │  WHERE workspace_id = ? AND user_id = ?
  └─ Check if user has admin role
  ↓
Backend: Check if user exists
  ├─ SELECT id FROM users WHERE email = ?
  └─ If not found, create invitation record
  ↓
Backend: Create invitation
  ├─ INSERT INTO invitations
  │  (workspace_id, inviter_id, email, token, expires_at)
  └─ Generate secure token
  ↓
Backend: Send email
  ├─ Generate invitation link
  │  https://claros-dpp.online/join?token=<token>
  └─ Email to invitee
  ↓
Email arrives in invitee's inbox
  ↓
Invitee clicks link
  ├─ Frontend verifies token
  └─ Accepts invitation
  ↓
Backend: Accept invitation
  ├─ Verify token not expired
  ├─ INSERT INTO workspace_members
  │  (workspace_id, user_id, role)
  └─ DELETE FROM invitations WHERE token = ?
  ↓
Invitee now has workspace access
```

---

## Data Lifecycle

### DPP Creation → Deletion

```
1. CREATE (is_published = false)
   ├─ Data enters system
   ├─ Validated against schema
   └─ Stored in database
   
2. EDIT (multiple times)
   ├─ User modifies data
   ├─ Each change creates version
   └─ Previous versions retained
   
3. PUBLISH (is_published = true)
   ├─ Data locked (optional)
   ├─ Public link generated
   └─ Audit log created
   
4. SHARE
   ├─ Public link distributed
   ├─ Public viewer accesses data
   └─ No login required for public viewing
   
5. UNPUBLISH (optional)
   ├─ DPP hidden from public
   ├─ Existing links no longer work
   └─ Data still in database
   
6. DELETE (soft or hard)
   ├─ Soft delete: Mark deleted_at timestamp
   ├─ Hard delete: Remove from database
   ├─ Audit log entry created
   └─ Data archived (if configured)
```

### User Data Lifecycle

```
Registration
  ↓
Email verification (optional)
  ↓
Account active
  ├─ Can create workspaces
  ├─ Can create DPPs
  └─ Can invite other users
  ↓
Activity logged in audit_logs
  ├─ Every action recorded
  ├─ Timestamp and user tracked
  └─ Enables audit trail
  ↓
Account suspension (if needed)
  ├─ Set active = false
  ├─ Sessions invalidated
  └─ Cannot login or access
  ↓
Account deletion
  ├─ Soft delete: Mark deleted_at
  ├─ Hard delete: Remove from database
  └─ User data in audit logs retained
```

---

## Database Query Examples

### Creating a DPP

```sql
-- Insert new passport
INSERT INTO digital_product_passports 
(id, workspace_id, product_id, product_name, data, created_by, created_at, updated_at, version)
VALUES 
('550e8400-e29b-41d4-a716-446655440000', 
 '123e4567-e89b-12d3-a456-426614174000',
 'BAT-2026-001',
 'Lithium Battery Pack',
 '{"capacity": "50kWh", "chemistry": "LFP"}'::jsonb,
 '98765432-1098-7654-3210-fedcba987654',
 NOW(),
 NOW(),
 1);

-- Create audit log entry
INSERT INTO audit_logs (user_id, action, entity_type, entity_id, changes, created_at)
VALUES ('98765432-1098-7654-3210-fedcba987654', 
        'created', 
        'passport', 
        '550e8400-e29b-41d4-a716-446655440000',
        '{"new": {"product_name": "Lithium Battery Pack"}}'::jsonb,
        NOW());
```

### Publishing a DPP

```sql
-- Update passport to published
UPDATE digital_product_passports 
SET is_published = true, 
    published_at = NOW(),
    updated_at = NOW()
WHERE id = '550e8400-e29b-41d4-a716-446655440000';

-- Create audit log
INSERT INTO audit_logs (user_id, action, entity_type, entity_id, changes, created_at)
VALUES ('98765432-1098-7654-3210-fedcba987654',
        'published',
        'passport',
        '550e8400-e29b-41d4-a716-446655440000',
        '{"action": "published", "public_link": "viewer?dpp-id=550e8400..."}'::jsonb,
        NOW());
```

### Retrieving Public DPP

```sql
-- Get passport for public viewing (no auth required)
SELECT id, product_name, data, version, published_at
FROM digital_product_passports
WHERE id = '550e8400-e29b-41d4-a716-446655440000'
  AND is_published = true;
```

### Getting User's Workspaces

```sql
-- Get workspaces where user has access
SELECT w.* 
FROM workspaces w
INNER JOIN workspace_members wm ON w.id = wm.workspace_id
WHERE wm.user_id = '98765432-1098-7654-3210-fedcba987654'
ORDER BY w.created_at DESC;
```

---

## Caching Strategy

### Frontend Caching
- User object: Cached in Pinia store
- Workspace list: Cached with 5-minute TTL
- DPP list: Cached with 1-minute TTL
- DPP details: Cached until published

### Backend Caching (Optional)
- User permissions: Cached for 10 minutes
- Public DPPs: Cached for 1 hour
- Database connection pool: Reused across requests

---

## Data Consistency

### ACID Transactions
```sql
BEGIN;

-- Multiple operations in single transaction
UPDATE workspace_members SET role = 'admin' WHERE ...;
INSERT INTO audit_logs VALUES (...);
UPDATE workspaces SET updated_at = NOW() WHERE ...;

-- All succeed or all rollback
COMMIT;  -- or ROLLBACK on error
```

### Eventual Consistency
- Audit logs created asynchronously (fire-and-forget)
- Public cache invalidated after DPP publish
- Email notifications sent after account creation

---

## Error Handling in Data Flow

```
Invalid Request
  ↓
Validation error caught
  ├─ Log error (not returned to client)
  ├─ Return 400 Bad Request
  └─ Frontend shows user-friendly message
  ↓
Database constraint violation
  ├─ Transaction rolled back
  ├─ Error logged
  └─ Return 409 Conflict or 400 Bad Request
  ↓
Authentication failure
  ├─ Invalid/expired JWT
  ├─ Log attempt
  └─ Return 401 Unauthorized
  ↓
Authorization failure
  ├─ User lacks permission
  ├─ Log denied access attempt
  └─ Return 403 Forbidden
  ↓
Server error
  ├─ Unexpected exception
  ├─ Log full stack trace
  ├─ Return 500 Internal Server Error
  └─ User sees generic error message
```

---

## Performance Considerations

### Database Indexing
- Index on `user_id` for quick lookups
- Index on `workspace_id` for workspace queries
- Index on `is_published` for public passport queries
- Composite index on (workspace_id, created_at) for listing

### Query Optimization
- Fetch only needed columns
- Use JOINs instead of multiple queries
- Paginate large result sets
- Use database views for complex queries

### API Response Optimization
- Compress responses with GZIP
- Paginate large collections
- Return links instead of full nested objects
- Cache headers for static content

