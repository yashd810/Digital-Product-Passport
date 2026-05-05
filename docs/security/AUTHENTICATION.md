# Authentication & Authorization Guide

Complete guide to JWT authentication, session management, role-based access control (RBAC), and security considerations in Claros DPP.

---

## Table of Contents

1. [Authentication Overview](#authentication-overview)
2. [JWT Implementation](#jwt-implementation)
3. [Authorization & RBAC](#authorization--rbac)
4. [Session Management](#session-management)
5. [Password Security](#password-security)
6. [Token Lifecycle](#token-lifecycle)
7. [Security Best Practices](#security-best-practices)
8. [Troubleshooting](#troubleshooting)

---

## Authentication Overview

### What is Authentication?

Authentication verifies that a user is who they claim to be.

**In Claros DPP**:
- Users register with email and password
- Username/email and password are verified
- JWT token is issued
- Token is used for subsequent requests

### What is Authorization?

Authorization controls what an authenticated user can do.

**In Claros DPP**:
- Three roles: admin, editor, viewer
- Workspace-level permissions
- Role-based access to features

### Authentication Flow

```
┌──────────────────┐
│  User enters     │
│  email/password  │
└────────┬─────────┘
         │
         ▼
┌──────────────────────────┐
│  Backend verifies        │
│  credentials against DB  │
└────────┬─────────────────┘
         │
         ├─ Invalid ──► 401 Unauthorized
         │
         └─ Valid
           │
           ▼
    ┌──────────────┐
    │ Generate JWT │
    └──────┬───────┘
           │
           ▼
    ┌────────────────┐
    │  Return token  │
    │  to client     │
    └────────┬───────┘
             │
             ▼
    ┌──────────────────────┐
    │  Client stores token │
    │  in memory/localStorage
    └────────┬─────────────┘
             │
             ▼
    ┌─────────────────────────┐
    │  Include token in       │
    │  Authorization header   │
    │  for all requests       │
    └────────┬────────────────┘
             │
             ▼
    ┌──────────────────────┐
    │  Backend validates   │
    │  token signature     │
    └──────────┬───────────┘
               │
               ├─ Invalid ──► 401 Unauthorized
               │
               └─ Valid ──► Grant access
```

---

## JWT Implementation

### JWT Structure

JWT tokens have three parts separated by dots: `header.payload.signature`

**Example JWT**:
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.
eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.
SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c
```

**Decoded**:
```json
// Header
{
  "alg": "HS256",
  "typ": "JWT"
}

// Payload
{
  "sub": "user-123",
  "email": "user@example.com",
  "workspace_id": "workspace-123",
  "role": "editor",
  "iat": 1516239022,
  "exp": 1516325422
}

// Signature (verified with secret key)
```

### Token Generation

```javascript
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// Generate token after login
function generateToken(user) {
  const token = jwt.sign(
    {
      userId: user.id,
      email: user.email,
      workspace_id: user.current_workspace_id,
      role: user.role,
    },
    process.env.JWT_SECRET,
    {
      algorithm: 'HS256',
      expiresIn: '24h',
      issuer: 'claros-dpp',
      audience: 'claros-dpp-users'
    }
  );
  
  return token;
}

// Example usage
const user = {
  id: 'user-123',
  email: 'john@example.com',
  current_workspace_id: 'workspace-123',
  role: 'editor'
};

const token = generateToken(user);
console.log(token);
// eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Token Verification

```javascript
const jwt = require('jsonwebtoken');

// Verify token
function verifyToken(token) {
  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET,
      {
        algorithms: ['HS256'],
        issuer: 'claros-dpp',
        audience: 'claros-dpp-users'
      }
    );
    return decoded;
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new Error('Token has expired');
    }
    if (error.name === 'JsonWebTokenError') {
      throw new Error('Invalid token');
    }
    throw error;
  }
}

// Usage
try {
  const decoded = verifyToken(token);
  console.log('User:', decoded.email);
} catch (error) {
  console.error('Authentication failed:', error.message);
}
```

### JWT Configuration

**`.env` settings**:
```bash
# JWT secret (min 32 characters for HS256)
JWT_SECRET=your-very-long-secret-key-min-32-chars

# Token expiration
JWT_EXPIRATION=24h

# For RS256 (RSA public/private key pair)
JWT_PUBLIC_KEY=/path/to/public.pem
JWT_PRIVATE_KEY=/path/to/private.pem
```

### HS256 vs RS256

| Aspect | HS256 | RS256 |
|--------|-------|-------|
| Algorithm | HMAC with SHA-256 | RSA with SHA-256 |
| Keys | Single secret | Public + private key pair |
| Speed | Faster | Slower |
| Scalability | For single service | For microservices |
| Security | Secret must be secure | Private key must be secure |

**Choose HS256** for single monolithic backend (Claros DPP current setup).

**Choose RS256** for microservices with token verification across services.

---

## Authorization & RBAC

### Role Definitions

**Three roles in Claros DPP**:

| Role | Permissions | Use Case |
|------|------------|----------|
| **Admin** | All operations, manage members | Workspace owner/lead |
| **Editor** | Create/edit DPPs, view all | Content creators |
| **Viewer** | Read-only access | Stakeholders, auditors |

### Permission Matrix

```javascript
// Define permissions by role
const PERMISSIONS = {
  'viewer': [
    'view_workspace',
    'view_passport',
    'view_members',
    'export_passport'
  ],
  'editor': [
    'view_workspace',
    'create_passport',
    'edit_passport',
    'view_passport',
    'publish_passport',
    'view_members',
    'invite_member',
    'export_passport'
  ],
  'admin': [
    'view_workspace',
    'create_passport',
    'edit_passport',
    'delete_passport',
    'view_passport',
    'publish_passport',
    'view_members',
    'invite_member',
    'remove_member',
    'update_member_role',
    'delete_workspace',
    'export_passport'
  ]
};
```

### Authorization Middleware

```javascript
// Middleware to check authorization
function authorize(...allowedRoles) {
  return (req, res, next) => {
    // JWT middleware already attached user to req
    const userRole = req.user.role;
    
    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        code: 'FORBIDDEN',
        details: 'You do not have permission for this action'
      });
    }
    
    next();
  };
}

// Usage in routes
router.post('/passports', 
  authenticate,                    // Must be logged in
  authorize('editor', 'admin'),   // Must be editor or admin
  createPassport
);

router.delete('/passports/:id',
  authenticate,
  authorize('admin'),             // Only admin
  deletePassport
);
```

### Workspace-Level RBAC

```javascript
// Check if user has role in specific workspace
async function checkWorkspaceRole(userId, workspaceId, requiredRole) {
  const member = await pool.query(
    'SELECT role FROM workspace_members WHERE user_id = $1 AND workspace_id = $2',
    [userId, workspaceId]
  );
  
  if (!member.rows.length) {
    return false;
  }
  
  const roleHierarchy = { 'viewer': 1, 'editor': 2, 'admin': 3 };
  const userRoleLevel = roleHierarchy[member.rows[0].role];
  const requiredLevel = roleHierarchy[requiredRole];
  
  return userRoleLevel >= requiredLevel;
}

// Middleware for workspace operations
async function requireWorkspaceRole(req, res, next) {
  const { workspaceId } = req.params;
  const userId = req.user.userId;
  
  const hasRole = await checkWorkspaceRole(userId, workspaceId, 'editor');
  
  if (!hasRole) {
    return res.status(403).json({
      success: false,
      error: 'Forbidden',
      code: 'FORBIDDEN',
      details: 'You do not have the required role in this workspace'
    });
  }
  
  next();
}
```

---

## Session Management

### Session Lifecycle

```
1. User logs in
   ↓
2. Backend creates session in database
   ↓
3. JWT token issued
   ↓
4. Client stores token
   ↓
5. Token used in all requests
   ↓
6. Token expires or user logs out
   ↓
7. Session destroyed
```

### Session Table

```sql
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,
  last_activity_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
```

### Create Session

```javascript
const crypto = require('crypto');

async function createSession(userId, ipAddress, userAgent) {
  const token = generateToken(user);
  const tokenHash = crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');
  
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 24);
  
  await pool.query(
    `INSERT INTO sessions 
     (user_id, token_hash, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, tokenHash, ipAddress, userAgent, expiresAt]
  );
  
  return token;
}
```

### Verify Session

```javascript
async function verifySession(token, userId) {
  const tokenHash = crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');
  
  const session = await pool.query(
    `SELECT * FROM sessions 
     WHERE user_id = $1 AND token_hash = $2 AND expires_at > NOW()`,
    [userId, tokenHash]
  );
  
  if (!session.rows.length) {
    return false;
  }
  
  // Update last activity
  await pool.query(
    'UPDATE sessions SET last_activity_at = NOW() WHERE id = $1',
    [session.rows[0].id]
  );
  
  return true;
}
```

### Logout

```javascript
async function logout(token, userId) {
  const tokenHash = crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');
  
  await pool.query(
    'DELETE FROM sessions WHERE user_id = $1 AND token_hash = $2',
    [userId, tokenHash]
  );
}

// Route
router.post('/auth/logout', authenticate, async (req, res) => {
  const token = req.headers.authorization.split(' ')[1];
  await logout(token, req.user.userId);
  
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});
```

---

## Password Security

### Password Hashing

```javascript
const bcrypt = require('bcrypt');

// Hash password on registration
async function hashPassword(plainPassword) {
  const salt = await bcrypt.genSalt(12);  // 12 rounds
  return bcrypt.hash(plainPassword, salt);
}

// Usage
const hashedPassword = await hashPassword('user-password-123');
// Save to database
await pool.query(
  'INSERT INTO users (email, password_hash) VALUES ($1, $2)',
  [email, hashedPassword]
);
```

### Password Verification

```javascript
// Verify password on login
async function verifyPassword(plainPassword, hashedPassword) {
  return bcrypt.compare(plainPassword, hashedPassword);
}

// Usage in login endpoint
const user = await pool.query(
  'SELECT * FROM users WHERE email = $1',
  [email]
);

if (!user.rows.length) {
  return res.status(401).json({
    success: false,
    error: 'Invalid credentials'
  });
}

const isValid = await verifyPassword(password, user.rows[0].password_hash);

if (!isValid) {
  return res.status(401).json({
    success: false,
    error: 'Invalid credentials'
  });
}
```

### Password Policy

**Requirements**:
- Minimum 8 characters
- At least one uppercase letter
- At least one lowercase letter
- At least one number
- At least one special character

```javascript
function validatePassword(password) {
  const rules = [
    { regex: /.{8,}/, message: 'At least 8 characters' },
    { regex: /[A-Z]/, message: 'At least one uppercase letter' },
    { regex: /[a-z]/, message: 'At least one lowercase letter' },
    { regex: /[0-9]/, message: 'At least one number' },
    { regex: /[!@#$%^&*]/, message: 'At least one special character' }
  ];
  
  const errors = [];
  for (const rule of rules) {
    if (!rule.regex.test(password)) {
      errors.push(rule.message);
    }
  }
  
  return { valid: errors.length === 0, errors };
}
```

### Password Reset

```javascript
// Generate reset token
async function createPasswordReset(userId) {
  const resetToken = crypto.randomBytes(32).toString('hex');
  const resetTokenHash = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');
  
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 1);  // 1 hour
  
  await pool.query(
    `INSERT INTO password_resets (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, resetTokenHash, expiresAt]
  );
  
  return resetToken;
}

// Reset password with token
async function resetPassword(resetToken, newPassword) {
  const tokenHash = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');
  
  const reset = await pool.query(
    `SELECT user_id FROM password_resets 
     WHERE token_hash = $1 AND expires_at > NOW()`,
    [tokenHash]
  );
  
  if (!reset.rows.length) {
    throw new Error('Invalid or expired reset token');
  }
  
  const hashedPassword = await hashPassword(newPassword);
  
  await pool.query(
    'UPDATE users SET password_hash = $1 WHERE id = $2',
    [hashedPassword, reset.rows[0].user_id]
  );
  
  // Delete used token
  await pool.query('DELETE FROM password_resets WHERE token_hash = $1', [tokenHash]);
}
```

---

## Token Lifecycle

### Token Generation

1. User logs in with email/password
2. Credentials validated
3. JWT token generated with 24-hour expiration
4. Token returned to client

### Token Usage

1. Client stores token
2. Includes in `Authorization: Bearer <token>` header
3. Backend verifies signature and expiration
4. Request processed

### Token Refresh

**Refresh Token Pattern** (optional):

```javascript
// Issue refresh token (longer expiration)
function generateRefreshToken(userId) {
  return jwt.sign(
    { userId, type: 'refresh' },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '30d' }
  );
}

// Exchange refresh token for new access token
router.post('/auth/refresh', (req, res) => {
  const refreshToken = req.body.refreshToken;
  
  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    
    if (decoded.type !== 'refresh') {
      throw new Error('Invalid token type');
    }
    
    const newAccessToken = generateToken({ userId: decoded.userId });
    
    res.json({
      success: true,
      data: { token: newAccessToken }
    });
  } catch (error) {
    res.status(401).json({
      success: false,
      error: 'Invalid refresh token'
    });
  }
});
```

### Token Expiration

```javascript
// Middleware to check token expiration
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Missing token'
    });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Token expired',
        code: 'TOKEN_EXPIRED'
      });
    }
    
    return res.status(401).json({
      success: false,
      error: 'Invalid token'
    });
  }
}
```

---

## Security Best Practices

### Token Storage

**Frontend**:
- ✅ Store in memory (most secure)
- ✅ Store in HttpOnly cookie (secure, no JS access)
- ⚠️ Store in localStorage (accessible to XSS attacks)
- ❌ Store in regular cookies (vulnerable to CSRF)

```javascript
// Store in memory (recommended for SPA)
let token = null;

function setToken(newToken) {
  token = newToken;
}

function getToken() {
  return token;
}

function clearToken() {
  token = null;
}

// Use with API calls
function makeAPICall(endpoint) {
  return fetch(endpoint, {
    headers: {
      'Authorization': `Bearer ${getToken()}`
    }
  });
}
```

### Sensitive Data in Tokens

**What NOT to include**:
- ❌ Passwords
- ❌ Credit card numbers
- ❌ API keys
- ❌ Personal identification numbers

**What to include**:
- ✅ User ID
- ✅ Email
- ✅ Role
- ✅ Workspace ID
- ✅ Expiration time

### HTTPS Requirement

**Always use HTTPS** in production:
- Tokens transmitted over encrypted channel
- Prevents man-in-the-middle attacks
- Required for secure cookie transmission

### CORS Configuration

```javascript
const cors = require('cors');

app.use(cors({
  origin: process.env.FRONTEND_URL,  // Only allow frontend
  credentials: true,                   // Allow cookies
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
```

### Rate Limiting

```javascript
const rateLimit = require('express-rate-limit');

// Login rate limit
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 5,                     // 5 attempts
  message: 'Too many login attempts, try again later'
});

router.post('/auth/login', loginLimiter, login);

// General API rate limit
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,        // 1 minute
  max: 100,                    // 100 requests
});

app.use('/api/', apiLimiter);
```

---

## Related Documentation

- [Data Protection Guide](DATA_PROTECTION.md) - Encryption and secure storage
- [Audit Logging & Compliance](AUDIT_LOGGING.md) - Audit trail and forensic analysis
- [Access Revocation](access-revocation-process.md) - Permission management
- [Signing and Verification](signing-and-verification.md) - Cryptographic integrity
- [Current State Audit](../architecture/current-state-audit.md) - System deployment status
- [Project Structure](../architecture/PROJECT_STRUCTURE.md) - Repository organization
  keyGenerator: (req) => req.user.userId  // Per user
});

app.use('/api/', apiLimiter);
```

---

## Troubleshooting

### "Invalid token" Error

**Causes**:
- Token signature verification failed
- Wrong JWT_SECRET
- Token altered

**Fix**:
```javascript
// Ensure consistent JWT_SECRET
echo $JWT_SECRET  // Should be 32+ characters

// Verify token manually
const jwt = require('jsonwebtoken');
console.log(jwt.decode(token));
```

### "Token expired" Error

**Causes**:
- Token older than 24 hours
- Clock skew between server and client

**Fix**:
```javascript
// Use refresh token to get new access token
// Sync server time
timedatectl set-ntp true  # Linux
ntpdate -s time.nist.gov  # macOS
```

### "Missing token" Error

**Causes**:
- Authorization header not sent
- Incorrect header format

**Fix**:
```javascript
// Correct format
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

// In JavaScript
fetch('/api/endpoint', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
```

### Authorization Failures

**Check user role**:
```javascript
// Verify role in token
const decoded = jwt.decode(token);
console.log('User role:', decoded.role);

// Verify permissions
const user = await pool.query(
  'SELECT * FROM workspace_members WHERE user_id = $1 AND workspace_id = $2',
  [userId, workspaceId]
);
```

---

**[← Back to Security Docs](../README.md) | [Next: Data Protection →](./DATA_PROTECTION.md)**
