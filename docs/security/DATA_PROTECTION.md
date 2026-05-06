# Data Protection & Security Guide

Complete guide to encryption, data protection strategies, secure storage, and compliance considerations in Claros DPP.

---

## Table of Contents

1. [Data Protection Overview](#data-protection-overview)
2. [Encryption Strategies](#encryption-strategies)
3. [Password Security](#password-security)
4. [Sensitive Data Handling](#sensitive-data-handling)
5. [Secure Transport](#secure-transport)
6. [Storage Security](#storage-security)
7. [Access Control](#access-control)
8. [Compliance & Standards](#compliance--standards)

---

## Data Protection Overview

### Data Classification

Classify data by sensitivity level:

| Level | Examples | Protection |
|-------|----------|-----------|
| **Public** | Product names, published DPPs | No special protection needed |
| **Internal** | User emails, workspace names | Access control, encryption at rest |
| **Confidential** | Passwords, API keys, audit logs | Encryption at rest + transit, strict access |
| **Critical** | DPP versions, business data | All protections + backup security |

### Protection Layers

```
┌─────────────────────────────────────┐
│      Application Layer              │
│  - Input validation                 │
│  - Authorization checks             │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│      Transport Layer                │
│  - HTTPS/TLS encryption             │
│  - Secure headers                   │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│      Storage Layer                  │
│  - Database encryption              │
│  - Encrypted volumes                │
│  - File permissions                 │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│      Infrastructure Layer           │
│  - Firewall rules                   │
│  - Network segmentation             │
│  - Physical security                │
└─────────────────────────────────────┘
```

---

## Encryption Strategies

### Encryption at Rest

**Database Encryption**:
```sql
-- PostgreSQL with pgcrypto extension
CREATE EXTENSION pgcrypto;

-- Encrypt sensitive columns
CREATE TABLE users_encrypted AS
SELECT 
  id,
  email,
  pgp_sym_encrypt(password_hash, 'encryption-key') as password_hash_encrypted,
  created_at
FROM users;

-- Query encrypted data
SELECT id, email FROM users_encrypted 
WHERE email = pgp_sym_decrypt(
  pgp_sym_encrypt('user@example.com', 'encryption-key'),
  'encryption-key'
);
```

**File Encryption**:
```bash
# Encrypt backup files
gpg --symmetric --cipher-algo AES256 backup.sql

# Decrypt
gpg --decrypt backup.sql.gpg > backup.sql
```

### Encryption in Transit

**HTTPS/TLS Configuration**:

```javascript
// Enforce HTTPS
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production' && req.protocol !== 'https') {
    return res.redirect(301, `https://${req.get('host')}${req.originalUrl}`);
  }
  next();
});

// Set HSTS header
app.use((req, res, next) => {
  res.setHeader(
    'Strict-Transport-Security',
    'max-age=31536000; includeSubDomains'
  );
  next();
});
```

**Environment Variables**:
```bash
# HTTPS certificate paths
HTTPS_CERT=/etc/ssl/certs/cert.pem
HTTPS_KEY=/etc/ssl/private/key.pem

# In Node.js
const https = require('https');
const fs = require('fs');

const options = {
  key: fs.readFileSync(process.env.HTTPS_KEY),
  cert: fs.readFileSync(process.env.HTTPS_CERT)
};

https.createServer(options, app).listen(3001);
```

### Algorithm Selection

**Recommended Algorithms**:
- **AES-256**: Symmetric encryption for data at rest
- **RSA-2048+**: Asymmetric encryption for key exchange
- **SHA-256**: Hashing for passwords (with bcrypt)
- **HMAC-SHA256**: Message authentication for JWTs

**Avoid**:
- ❌ MD5 (broken)
- ❌ SHA1 (deprecated)
- ❌ DES (insecure)
- ❌ Plain text passwords

---

## Password Security

### Password Hashing

**Bcrypt Implementation**:

```javascript
const bcrypt = require('bcrypt');

// Hash password with 12 rounds
async function hashPassword(password) {
  const salt = await bcrypt.genSalt(12);
  return bcrypt.hash(password, salt);
}

// Verify password
async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// Usage
const hashedPassword = await hashPassword('UserPassword123!');
// Store in database

// Later, verify login
const isValid = await verifyPassword('UserPassword123!', hashedPassword);
```

**Why bcrypt?**
- ✅ Automatically includes salt
- ✅ Adaptive rounds (future-proof)
- ✅ Resistant to GPU/ASIC attacks
- ✅ Industry standard

### Password Policy

**Enforce Strong Passwords**:

```javascript
function validatePassword(password) {
  const rules = [
    { test: password.length >= 12, message: 'At least 12 characters' },
    { test: /[A-Z]/.test(password), message: 'One uppercase letter' },
    { test: /[a-z]/.test(password), message: 'One lowercase letter' },
    { test: /[0-9]/.test(password), message: 'One number' },
    { test: /[!@#$%^&*]/.test(password), message: 'One special character' },
    { test: !/(.)\1{2,}/.test(password), message: 'No repeated characters' },
    { test: !/123|456|789|abc|password/i.test(password), message: 'No common patterns' }
  ];
  
  const violations = rules
    .filter(rule => !rule.test)
    .map(rule => rule.message);
  
  return {
    valid: violations.length === 0,
    violations
  };
}

// Usage
const result = validatePassword('weak');
// {
//   valid: false,
//   violations: [
//     'At least 12 characters',
//     'One uppercase letter',
//     'One number',
//     'One special character'
//   ]
// }
```

### Password Reset Security

```javascript
const crypto = require('crypto');

// Generate secure reset token
function generateResetToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Reset token flow
async function requestPasswordReset(email) {
  const user = await getUserByEmail(email);
  if (!user) return;  // Don't reveal if email exists
  
  const resetToken = generateResetToken();
  const tokenHash = hashToken(resetToken);
  const expiresAt = Date.now() + 3600000;  // 1 hour
  
  // Store token hash (not token itself)
  await saveResetToken(user.id, tokenHash, expiresAt);
  
  // Send email with token (not hash)
  await sendResetEmail(email, resetToken);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Verify and use reset token
async function resetPassword(resetToken, newPassword) {
  const tokenHash = hashToken(resetToken);
  
  const reset = await getResetToken(tokenHash);
  if (!reset || reset.expiresAt < Date.now()) {
    throw new Error('Invalid or expired token');
  }
  
  const hashedPassword = await hashPassword(newPassword);
  await updateUserPassword(reset.userId, hashedPassword);
  await deleteResetToken(tokenHash);
}
```

---

## Sensitive Data Handling

### What is Sensitive Data?

- Passwords and password hashes
- API keys and tokens
- Personal identification numbers
- Credit card information
- Authentication tokens
- Encryption keys

### Data Minimization

```javascript
// ❌ Store unnecessary data
const user = {
  id: 'user-123',
  email: 'user@example.com',
  password_hash: 'bcrypt_hash_here',
  ssn: '123-45-6789',           // Don't store
  credit_card: '4111-1111-1111', // Don't store
  ip_history: ['192.168.1.1'],   // Don't store
};

// ✅ Store only needed data
const user = {
  id: 'user-123',
  email: 'user@example.com',
  password_hash: 'bcrypt_hash_here',
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-01-15T10:00:00Z',
};
```

### Data in Logs

**Never log sensitive data**:

```javascript
// ❌ BAD: Sensitive data in logs
console.log('User login:', { email, password });
logger.info('Reset token:', resetToken);

// ✅ GOOD: Redact sensitive data
console.log('User login:', { email });
logger.info('Password reset initiated');

// Sanitize logs
function sanitizeForLogging(data) {
  const sanitized = { ...data };
  const sensitiveFields = ['password', 'token', 'api_key', 'secret', 'ssn'];
  
  for (const field of sensitiveFields) {
    if (sanitized[field]) {
      sanitized[field] = '[REDACTED]';
    }
  }
  
  return sanitized;
}

// Usage
logger.info('User action:', sanitizeForLogging(userData));
```

### Data in Transit

**Use HTTPS for all communication**:

```javascript
// Redirect HTTP to HTTPS
app.use((req, res, next) => {
  if (req.protocol !== 'https' && process.env.NODE_ENV === 'production') {
    return res.redirect(301, `https://${req.get('host')}${req.originalUrl}`);
  }
  next();
});

// Set security headers
app.use((req, res, next) => {
  res.set({
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'X-XSS-Protection': '1; mode=block',
    'Content-Security-Policy': "default-src 'self'"
  });
  next();
});
```

### Secure Deletion

```javascript
// Safely delete sensitive data
async function secureDelete(tableName, id) {
  // Overwrite with random data before deletion
  const randomData = crypto.randomBytes(256).toString('hex');
  
  await pool.query(
    `UPDATE ${tableName} SET sensitive_field = $1 WHERE id = $2`,
    [randomData, id]
  );
  
  // Then delete
  await pool.query(
    `DELETE FROM ${tableName} WHERE id = $1`,
    [id]
  );
}

// For files
const fs = require('fs');
const { spawn } = require('child_process');

async function secureDeleteFile(filePath) {
  // Overwrite file with random data
  const size = fs.statSync(filePath).size;
  const randomData = crypto.randomBytes(size);
  fs.writeFileSync(filePath, randomData);
  
  // Delete file
  fs.unlinkSync(filePath);
}
```

---

## Secure Transport

### HTTPS Configuration

**Generate self-signed certificate** (development):
```bash
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes
```

**Letsencrypt certificate** (production, via Caddy):
```caddyfile
claros-dpp.online {
  reverse_proxy localhost:3001
  # Caddy automatically handles HTTPS
}
```

### TLS/SSL Headers

```javascript
// Set secure headers
app.use((req, res, next) => {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'");
  next();
});
```

### Certificate Pinning

```javascript
// Pin certificate to prevent MITM
const https = require('https');
const tls = require('tls');

https.globalAgent.options.ca = fs.readFileSync('/path/to/certificate.pem');
```

---

## Storage Security

### Database Encryption

**Enable pgcrypto**:
```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Encrypt sensitive columns
CREATE TABLE users_secure AS
SELECT 
  id,
  email,
  pgp_sym_encrypt(password_hash, 'secret-key') as encrypted_password
FROM users;

-- Query with encryption
SELECT email FROM users_secure
WHERE id = 'user-123'
  AND pgp_sym_decrypt(encrypted_password, 'secret-key') = 'hashed_password';
```

### Volume Encryption

**Linux LUKS encryption**:
```bash
# Create encrypted volume
sudo cryptsetup luksFormat /dev/sdb1
sudo cryptsetup luksOpen /dev/sdb1 encrypted_volume
sudo mkfs.ext4 /dev/mapper/encrypted_volume

# Mount
sudo mount /dev/mapper/encrypted_volume /mnt/data

# Automatic mount on boot
echo "encrypted_volume /dev/sdb1 none luks,discard" | sudo tee -a /etc/crypttab
```

### File Permissions

```bash
# Restrict database directory
sudo chown postgres:postgres /var/lib/postgresql
sudo chmod 700 /var/lib/postgresql

# Restrict secret files
sudo chmod 600 /etc/secrets/jwt.key
sudo chown root:root /etc/secrets/jwt.key

# Docker volumes
docker volume inspect claros_postgres_data
# Check mount point and permissions
```

### Backup Encryption

```bash
#!/bin/bash

# Backup with encryption
BACKUP_FILE="backup_$(date +%s).sql"
ENCRYPTED_FILE="$BACKUP_FILE.gpg"

# Create backup
pg_dump -h localhost -U claros_user claros_dpp > $BACKUP_FILE

# Encrypt
gpg --symmetric --cipher-algo AES256 --output $ENCRYPTED_FILE $BACKUP_FILE

# Remove unencrypted
shred -vfz -n 3 $BACKUP_FILE

# Verify
gpg --decrypt $ENCRYPTED_FILE | pg_restore -d claros_dpp_test

echo "Backup encrypted: $ENCRYPTED_FILE"
```

---

## Access Control

### Role-Based Access Control

```javascript
// Define data access by role
const DATA_ACCESS = {
  'viewer': ['own_workspace_data'],
  'editor': ['own_workspace_data', 'team_workspace_data'],
  'admin': ['all_workspace_data']
};

// Middleware to enforce access
async function authorizeDataAccess(req, res, next) {
  const userRole = req.user.role;
  const resourceWorkspaceId = req.params.workspaceId;
  const userWorkspaces = req.user.workspaces;
  
  if (userRole === 'admin') {
    return next();  // Admin can access all
  }
  
  if (!userWorkspaces.includes(resourceWorkspaceId)) {
    return res.status(403).json({
      success: false,
      error: 'Forbidden'
    });
  }
  
  next();
}
```

### Data Isolation

```javascript
// Ensure data is isolated by workspace
async function getPassports(req, res) {
  const { workspaceId } = req.params;
  
  // Verify user has access to workspace
  const member = await pool.query(
    'SELECT role FROM workspace_members WHERE user_id = $1 AND workspace_id = $2',
    [req.user.userId, workspaceId]
  );
  
  if (!member.rows.length) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  
  // Query only this workspace's data
  const passports = await pool.query(
    'SELECT * FROM digital_product_passports WHERE workspace_id = $1',
    [workspaceId]
  );
  
  res.json(passports.rows);
}
```

### Principle of Least Privilege

```javascript
// Minimize service permissions
const servicePermissions = {
  'backend': {
    'read': ['users', 'passports', 'workspaces'],
    'write': ['passports', 'audit_logs'],
    'delete': []  // Limited deletion
  },
  'api-gateway': {
    'read': ['passports'],
    'write': [],
    'delete': []
  }
};

// Database user with limited privileges
/*
CREATE USER api_service WITH ENCRYPTED PASSWORD 'secure_password';
GRANT CONNECT ON DATABASE claros_dpp TO api_service;
GRANT USAGE ON SCHEMA public TO api_service;
GRANT SELECT, INSERT, UPDATE ON digital_product_passports TO api_service;
GRANT SELECT ON users, workspaces TO api_service;
REVOKE DELETE ON digital_product_passports FROM api_service;
*/
```

---

## Compliance & Standards

### GDPR Compliance

**Key Requirements**:
- ✅ Data subject rights (access, deletion, portability)
- ✅ Privacy policy and consent
- ✅ Data protection impact assessment
- ✅ Breach notification (72 hours)
- ✅ Data processing agreements

```javascript
// Implement data export (right to portability)
router.get('/api/users/:id/data-export', authenticate, async (req, res) => {
  const userData = await pool.query(
    'SELECT * FROM users WHERE id = $1',
    [req.user.userId]
  );
  
  const passports = await pool.query(
    'SELECT * FROM digital_product_passports WHERE owner_id = $1',
    [req.user.userId]
  );
  
  res.json({
    user: userData.rows[0],
    passports: passports.rows
  });
});

// Implement right to deletion
router.delete('/api/users/:id', authenticate, async (req, res) => {
  // Soft delete by setting deleted_at
  await pool.query(
    'UPDATE users SET deleted_at = NOW() WHERE id = $1',
    [req.params.id]
  );
  
  res.json({ success: true, message: 'Account deleted' });
});
```

### Security Checklist

- ✅ All passwords hashed with bcrypt (12+ rounds)
- ✅ All transit encrypted with HTTPS/TLS
- ✅ Sensitive data never logged
- ✅ SQL injection prevented (parameterized queries)
- ✅ XSS prevented (input sanitization)
- ✅ CSRF tokens on state-changing requests
- ✅ Rate limiting on authentication
- ✅ Audit logging enabled
- ✅ Regular security updates
- ✅ Penetration testing performed

### Data Retention Policy

```javascript
// Automatically delete old data
async function archiveOldData() {
  const RETENTION_DAYS = 90;  // Keep 90 days
  
  // Soft delete old records
  await pool.query(
    `UPDATE audit_logs 
     SET deleted_at = NOW() 
     WHERE created_at < NOW() - INTERVAL '${RETENTION_DAYS} days'
       AND deleted_at IS NULL`,
  );
  
  // Hard delete archived records older than 1 year
  await pool.query(
    `DELETE FROM audit_logs 
     WHERE deleted_at < NOW() - INTERVAL '1 year'`,
  );
}

// Schedule with cron
// 0 2 * * * node -e "require('./archive.js').archiveOldData()"
```

---

## Incident Response

### Data Breach Response

1. **Assess**: Determine what data was compromised
2. **Contain**: Stop ongoing breach
3. **Notify**: Inform affected users
4. **Investigate**: Determine root cause
5. **Improve**: Prevent future breaches

```javascript
// Log security incidents
async function logSecurityIncident(type, severity, details) {
  await pool.query(
    `INSERT INTO security_incidents (type, severity, details, reported_at)
     VALUES ($1, $2, $3, NOW())`,
    [type, severity, JSON.stringify(details)]
  );
  
  // Alert security team
  if (severity === 'critical') {
    await sendAlert('security@claros-dpp.online', {
      subject: `Critical Security Incident: ${type}`,
      body: JSON.stringify(details, null, 2)
    });
  }
}
```

---

---

## Related Documentation

- [AUTHENTICATION.md](AUTHENTICATION.md) - User authentication and session management
- [AUDIT_LOGGING.md](AUDIT_LOGGING.md) - Change tracking and compliance
- [signing-and-verification.md](signing-and-verification.md) - Cryptographic signing and verification
- [eidas-qsealc-integration.md](eidas-qsealc-integration.md) - EU qualified electronic seal compliance
- [document-persistence-and-backup.md](document-persistence-and-backup.md) - Data backup and recovery
- [DID and Passport Model](../architecture/did-and-passport-model.md) - Data structure and encryption requirements

---

**[← Back to Security Docs](../README.md) | [Next: Audit Logging →](./AUDIT_LOGGING.md)**
