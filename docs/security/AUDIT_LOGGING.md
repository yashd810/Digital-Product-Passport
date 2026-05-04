# Audit Logging & Compliance Guide

Complete guide to audit logging implementation, tracking changes, compliance requirements, and forensic analysis in Claros DPP.

---

## Table of Contents

1. [Audit Logging Overview](#audit-logging-overview)
2. [Implementation](#implementation)
3. [Audit Schema](#audit-schema)
4. [Logging Events](#logging-events)
5. [Query & Analysis](#query--analysis)
6. [Retention Policy](#retention-policy)
7. [Compliance](#compliance)
8. [Troubleshooting](#troubleshooting)

---

## Audit Logging Overview

### What is Audit Logging?

Audit logging is the process of recording who did what, when, and why in your system.

**Purpose**:
- Track all system changes
- Enable forensic analysis
- Meet compliance requirements
- Detect unauthorized access
- Support troubleshooting

### Audit Trail

```
┌─────────────────────────────────────┐
│  User performs action               │
│  (e.g., create/edit/delete DPP)     │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Audit event captured               │
│  - User ID                          │
│  - Action type                      │
│  - Resource type & ID               │
│  - Timestamp                        │
│  - Changes made                     │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Stored in audit_logs table         │
│  (Immutable, append-only)           │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Available for analysis              │
│  - Forensics                         │
│  - Compliance reporting              │
│  - Performance analysis              │
└─────────────────────────────────────┘
```

### Audit Trail Benefits

- **Accountability**: Know who changed what
- **Compliance**: Meet regulatory requirements
- **Security**: Detect suspicious activity
- **Recovery**: Understand state changes
- **Debugging**: Trace issue sources

---

## Implementation

### Audit Middleware

```javascript
// Middleware to capture all requests
function auditMiddleware(req, res, next) {
  // Capture original send
  const originalSend = res.send;
  
  // Store audit data
  const auditData = {
    userId: req.user?.userId,
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    timestamp: new Date()
  };
  
  // Override send to capture response
  res.send = function(data) {
    auditData.statusCode = res.statusCode;
    auditData.responseSize = data?.length || 0;
    
    // Log audit event
    logAuditEvent(auditData).catch(err => {
      console.error('Audit logging failed:', err);
    });
    
    return originalSend.call(this, data);
  };
  
  next();
}

app.use(auditMiddleware);
```

### Action-Specific Logging

```javascript
// Log passport creation
async function createPassport(req, res) {
  try {
    const passport = await PassportService.create(req.body);
    
    // Log audit event
    await logAuditEvent({
      userId: req.user.userId,
      action: 'CREATE',
      entityType: 'digital_product_passport',
      entityId: passport.id,
      workspaceId: req.user.workspaceId,
      changes: {
        new: passport
      }
    });
    
    res.status(201).json(passport);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Log passport update
async function updatePassport(req, res) {
  try {
    const oldPassport = await PassportService.get(req.params.id);
    const newPassport = await PassportService.update(req.params.id, req.body);
    
    // Log audit event
    await logAuditEvent({
      userId: req.user.userId,
      action: 'UPDATE',
      entityType: 'digital_product_passport',
      entityId: req.params.id,
      workspaceId: req.user.workspaceId,
      changes: {
        old: oldPassport,
        new: newPassport
      }
    });
    
    res.json(newPassport);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Log passport deletion
async function deletePassport(req, res) {
  try {
    const passport = await PassportService.get(req.params.id);
    await PassportService.delete(req.params.id);
    
    // Log audit event
    await logAuditEvent({
      userId: req.user.userId,
      action: 'DELETE',
      entityType: 'digital_product_passport',
      entityId: req.params.id,
      workspaceId: req.user.workspaceId,
      changes: {
        deleted: passport
      }
    });
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
```

### Logging Function

```javascript
const pool = require('../db');

async function logAuditEvent(data) {
  const {
    userId,
    action,
    entityType,
    entityId,
    workspaceId,
    changes = {},
    ipAddress,
    userAgent
  } = data;
  
  try {
    await pool.query(
      `INSERT INTO audit_logs 
       (user_id, action, entity_type, entity_id, workspace_id, changes, ip_address, user_agent, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [
        userId,
        action,
        entityType,
        entityId,
        workspaceId,
        JSON.stringify(changes),
        ipAddress,
        userAgent
      ]
    );
  } catch (error) {
    console.error('Failed to log audit event:', error);
    // Don't throw - audit logging should not break application
  }
}

module.exports = { logAuditEvent };
```

---

## Audit Schema

### Audit Logs Table

```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Who
  user_id UUID NOT NULL REFERENCES users(id),
  
  -- What
  action VARCHAR(50) NOT NULL,        -- CREATE, UPDATE, DELETE, READ
  entity_type VARCHAR(100) NOT NULL,  -- passport, workspace, user, etc.
  entity_id VARCHAR(255) NOT NULL,
  
  -- Where
  workspace_id UUID REFERENCES workspaces(id),
  ip_address INET,
  user_agent TEXT,
  
  -- Change Details
  changes JSONB,                       -- Before/after values
  
  -- When
  created_at TIMESTAMP DEFAULT NOW(),
  
  -- Metadata
  status VARCHAR(20),                  -- success, failure
  error_message TEXT,
  duration_ms INTEGER,
  
  -- Soft delete support
  deleted_at TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_audit_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_created_at ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_action ON audit_logs(action);
CREATE INDEX idx_audit_workspace ON audit_logs(workspace_id);
CREATE INDEX idx_audit_timestamp ON audit_logs(created_at DESC) 
  WHERE deleted_at IS NULL;
```

### Audit Log Schema Example

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "user_id": "user-123",
  "action": "UPDATE",
  "entity_type": "digital_product_passport",
  "entity_id": "passport-456",
  "workspace_id": "workspace-789",
  "ip_address": "192.168.1.100",
  "user_agent": "Mozilla/5.0...",
  "changes": {
    "old": {
      "product_name": "Battery Model A",
      "capacity": "50kWh",
      "status": "draft"
    },
    "new": {
      "product_name": "Battery Model A",
      "capacity": "55kWh",
      "status": "published"
    }
  },
  "created_at": "2024-01-15T10:30:00Z",
  "status": "success"
}
```

---

## Logging Events

### Events to Log

**Authentication Events**:
```javascript
await logAuditEvent({
  action: 'LOGIN',
  entityType: 'user',
  entityId: user.id,
  ipAddress: req.ip,
  userAgent: req.get('user-agent')
});

await logAuditEvent({
  action: 'LOGOUT',
  entityType: 'user',
  entityId: user.id,
  ipAddress: req.ip
});

await logAuditEvent({
  action: 'PASSWORD_CHANGE',
  entityType: 'user',
  entityId: user.id
});
```

**Data Events**:
```javascript
// Passport operations
await logAuditEvent({
  action: 'CREATE',
  entityType: 'digital_product_passport',
  entityId: passport.id,
  workspaceId: passport.workspace_id,
  userId: req.user.userId,
  changes: { new: passport }
});

// Workspace operations
await logAuditEvent({
  action: 'ADD_MEMBER',
  entityType: 'workspace_member',
  entityId: member.id,
  workspaceId: workspace.id,
  userId: req.user.userId,
  changes: { new: member }
});
```

**Access Events**:
```javascript
// Track access to public passports
await logAuditEvent({
  action: 'VIEW_PUBLIC',
  entityType: 'digital_product_passport',
  entityId: passport.id,
  userId: null,  // Public access
  ipAddress: req.ip,
  changes: { view_count: passport.view_count + 1 }
});
```

**Admin Events**:
```javascript
await logAuditEvent({
  action: 'ADMIN_ACTION',
  entityType: 'user',
  entityId: targetUser.id,
  userId: adminUser.id,
  changes: {
    action: 'reset_password',
    reason: 'User requested password reset'
  }
});
```

---

## Query & Analysis

### Query Recent Activity

```sql
-- Get last 10 actions by specific user
SELECT 
  created_at,
  action,
  entity_type,
  entity_id,
  changes
FROM audit_logs
WHERE user_id = 'user-123'
ORDER BY created_at DESC
LIMIT 10;

-- Get all changes to specific passport
SELECT 
  created_at,
  user_id,
  action,
  changes
FROM audit_logs
WHERE entity_type = 'digital_product_passport'
  AND entity_id = 'passport-456'
ORDER BY created_at ASC;
```

### Activity Dashboard

```javascript
// Get audit summary for dashboard
router.get('/api/workspaces/:id/audit-summary', authenticate, async (req, res) => {
  const { workspaceId } = req.params;
  
  // Recent activity
  const recentActivity = await pool.query(
    `SELECT 
      DATE(created_at) as date,
      COUNT(*) as event_count,
      action,
      user_id
    FROM audit_logs
    WHERE workspace_id = $1
      AND created_at > NOW() - INTERVAL '30 days'
    GROUP BY DATE(created_at), action, user_id
    ORDER BY created_at DESC
    LIMIT 50`,
    [workspaceId]
  );
  
  // Top users
  const topUsers = await pool.query(
    `SELECT 
      user_id,
      COUNT(*) as action_count,
      MAX(created_at) as last_action
    FROM audit_logs
    WHERE workspace_id = $1
      AND created_at > NOW() - INTERVAL '30 days'
    GROUP BY user_id
    ORDER BY action_count DESC
    LIMIT 10`,
    [workspaceId]
  );
  
  res.json({
    recentActivity: recentActivity.rows,
    topUsers: topUsers.rows
  });
});
```

### Forensic Analysis

```javascript
// Reconstruct passport state at specific time
router.get('/api/passports/:id/history/:timestamp', authenticate, async (req, res) => {
  const { id, timestamp } = req.params;
  const targetTime = new Date(timestamp);
  
  const history = await pool.query(
    `SELECT 
      created_at,
      action,
      changes
    FROM audit_logs
    WHERE entity_id = $1
      AND entity_type = 'digital_product_passport'
      AND created_at <= $2
    ORDER BY created_at DESC`,
    [id, targetTime]
  );
  
  // Reconstruct state by applying changes in reverse
  let state = {};
  for (const log of history.rows.reverse()) {
    if (log.action === 'CREATE') {
      state = log.changes.new;
    } else if (log.action === 'UPDATE') {
      state = log.changes.new;
    }
  }
  
  res.json({
    timestamp: targetTime,
    state,
    history: history.rows
  });
});
```

### Anomaly Detection

```javascript
// Detect unusual activity patterns
async function detectAnomalies() {
  // Find users with unusual access patterns
  const anomalies = await pool.query(
    `SELECT 
      user_id,
      COUNT(*) as action_count,
      COUNT(DISTINCT DATE(created_at)) as active_days,
      MAX(created_at) as last_action
    FROM audit_logs
    WHERE created_at > NOW() - INTERVAL '1 day'
    GROUP BY user_id
    HAVING COUNT(*) > 100  -- More than 100 actions in a day
    ORDER BY action_count DESC`
  );
  
  return anomalies.rows;
}

// Alert on suspicious activity
async function checkForSuspiciousActivity() {
  const suspicious = await pool.query(
    `SELECT 
      user_id,
      ip_address,
      COUNT(*) as failed_attempts
    FROM audit_logs
    WHERE action = 'LOGIN'
      AND status = 'failure'
      AND created_at > NOW() - INTERVAL '1 hour'
    GROUP BY user_id, ip_address
    HAVING COUNT(*) > 5  -- More than 5 failed logins`
  );
  
  for (const record of suspicious.rows) {
    // Send alert
    console.warn('Suspicious activity detected:', record);
  }
}
```

---

## Retention Policy

### Data Retention

```javascript
// Archive old audit logs (keep 2 years)
async function archiveAuditLogs() {
  const ARCHIVE_DATE = new Date();
  ARCHIVE_DATE.setFullYear(ARCHIVE_DATE.getFullYear() - 2);
  
  // Soft delete old records
  const result = await pool.query(
    `UPDATE audit_logs 
    SET deleted_at = NOW()
    WHERE created_at < $1
      AND deleted_at IS NULL`,
    [ARCHIVE_DATE]
  );
  
  console.log(`Archived ${result.rowCount} audit logs`);
}

// Hard delete very old records (keep 5 years for compliance)
async function purgeAuditLogs() {
  const PURGE_DATE = new Date();
  PURGE_DATE.setFullYear(PURGE_DATE.getFullYear() - 5);
  
  const result = await pool.query(
    `DELETE FROM audit_logs 
    WHERE created_at < $1`,
    [PURGE_DATE]
  );
  
  console.log(`Purged ${result.rowCount} audit logs`);
}

// Schedule with cron
// 0 2 * * 0 node -e "require('./audit').archiveAuditLogs()"
// 0 3 * * 0 node -e "require('./audit').purgeAuditLogs()"
```

### Audit Log Export

```javascript
// Export audit logs for compliance
router.get('/api/audit-logs/export', authenticate, authorize('admin'), async (req, res) => {
  const { startDate, endDate, format = 'csv' } = req.query;
  
  const logs = await pool.query(
    `SELECT * FROM audit_logs 
    WHERE created_at BETWEEN $1 AND $2
      AND deleted_at IS NULL
    ORDER BY created_at DESC`,
    [new Date(startDate), new Date(endDate)]
  );
  
  if (format === 'csv') {
    res.header('Content-Type', 'text/csv');
    res.header('Content-Disposition', 'attachment; filename=audit-logs.csv');
    
    // Convert to CSV
    const csv = convertToCSV(logs.rows);
    res.send(csv);
  } else if (format === 'json') {
    res.header('Content-Type', 'application/json');
    res.send(logs.rows);
  }
});

function convertToCSV(logs) {
  const headers = ['ID', 'User ID', 'Action', 'Entity Type', 'Entity ID', 'Created At'];
  const rows = logs.map(log => [
    log.id,
    log.user_id,
    log.action,
    log.entity_type,
    log.entity_id,
    log.created_at
  ]);
  
  return [headers, ...rows]
    .map(row => row.map(cell => `"${cell}"`).join(','))
    .join('\n');
}
```

---

## Compliance

### Compliance Requirements

**GDPR**:
- ✅ Record user consent
- ✅ Track data access (right of access)
- ✅ Log data modifications
- ✅ Enable data export
- ✅ Audit trail for deletions

**SOC 2**:
- ✅ User access logging
- ✅ Change tracking
- ✅ System availability monitoring
- ✅ Incident logging
- ✅ Audit retention

**ISO 27001**:
- ✅ Access control logging
- ✅ Security event logging
- ✅ Incident recording
- ✅ Change management tracking
- ✅ Audit trail maintenance

### Compliance Reporting

```javascript
// Generate compliance report
async function generateComplianceReport(period) {
  const report = {
    period,
    generated_at: new Date(),
    summary: {},
    details: {}
  };
  
  // User access events
  const accessEvents = await pool.query(
    `SELECT COUNT(*) as count
    FROM audit_logs
    WHERE action IN ('LOGIN', 'LOGOUT')
      AND created_at > NOW() - INTERVAL $1`,
    [period]
  );
  report.summary.access_events = accessEvents.rows[0].count;
  
  // Data modification events
  const modificationEvents = await pool.query(
    `SELECT COUNT(*) as count
    FROM audit_logs
    WHERE action IN ('CREATE', 'UPDATE', 'DELETE')
      AND created_at > NOW() - INTERVAL $1`,
    [period]
  );
  report.summary.modification_events = modificationEvents.rows[0].count;
  
  // Security incidents
  const incidents = await pool.query(
    `SELECT COUNT(*) as count
    FROM audit_logs
    WHERE status = 'failure'
      AND created_at > NOW() - INTERVAL $1`,
    [period]
  );
  report.summary.security_incidents = incidents.rows[0].count;
  
  return report;
}
```

---

## Troubleshooting

### Performance Issues

**Slow audit queries**:
```sql
-- Check audit log indexes
SELECT * FROM pg_stat_user_indexes 
WHERE relname = 'audit_logs';

-- Add missing indexes
CREATE INDEX idx_audit_created_at_workspace 
  ON audit_logs(created_at DESC, workspace_id);
```

**Large audit table**:
```bash
# Check table size
du -sh /var/lib/postgresql/data/base/oid/

# Archive old data
psql -U claros_user claros_dpp -c \
  "UPDATE audit_logs SET deleted_at = NOW() WHERE created_at < NOW() - INTERVAL '2 years';"
```

### Missing Events

**Verify middleware is loaded**:
```javascript
// Check if audit middleware is in middleware chain
console.log('Middleware:', app._router.stack.map(r => r.name));
```

**Check for errors**:
```bash
# View application logs
docker-compose logs backend-api | grep -i audit
```

### Audit Table Corruption

**Verify integrity**:
```sql
-- Check for orphaned records
SELECT * FROM audit_logs 
WHERE user_id NOT IN (SELECT id FROM users)
  AND user_id IS NOT NULL;

-- Fix by deleting orphans
DELETE FROM audit_logs 
WHERE user_id NOT IN (SELECT id FROM users)
  AND user_id IS NOT NULL;
```

---

## Best Practices

### What to Log

- ✅ All authentication events (login, logout, password change)
- ✅ All data modifications (create, update, delete)
- ✅ All access to sensitive data
- ✅ All administrative actions
- ✅ All permission changes
- ✅ Failed access attempts
- ✅ System configuration changes

### What NOT to Log

- ❌ Passwords or password hashes
- ❌ API keys or secrets
- ❌ Credit card numbers
- ❌ Personal identification numbers
- ❌ Unnecessary request bodies
- ❌ Excessive debug information

### Audit Log Security

- ✅ Immutable (append-only)
- ✅ Encrypted at rest
- ✅ Encrypted in transit
- ✅ Access controlled
- ✅ Regularly backed up
- ✅ Regularly reviewed

---

**[← Back to Security Docs](../README.md)**
