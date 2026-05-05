# Notifications API Endpoints

Notifications keep users informed of events related to passports, workflows, and system activities.

**Base URL:** `http://localhost:3001`  
**Authentication:** Bearer token in `Authorization` header

---

## Notification Types

| Type | Event | Example |
|------|-------|---------|
| `workflow_rejected` | Passport rejected in workflow | "❌ BAT-01 was rejected" |
| `workflow_approval` | Passport awaiting approver | "Approval needed: BAT-01" |
| `workflow_approved` | Passport approved and released | "✅ BAT-01 reviewed and released!" |
| `passport_updated` | Passport modified by another user | "BAT-01 has been updated" |
| `passport_published` | Passport published | "BAT-01 is now public" |
| `access_grant_issued` | Access to passport granted to user | "You have access to BAT-01" |
| `access_revoked` | Access to passport revoked | "Your access to BAT-01 has been revoked" |
| `system_alert` | System-level notification | "Maintenance scheduled" |

---

## Get Notifications

### List User Notifications

**GET** `/api/users/me/notifications`

Get current user's notifications.

**Query Parameters:**
- `limit` (number, optional, default: 25, max: 100) - Maximum notifications to return

**Response (200 OK):**
```json
[
  {
    "id": "uuid",
    "user_id": "uuid",
    "notification_type": "workflow_approved",
    "title": "✅ BAT-01 reviewed and released!",
    "message": null,
    "passport_dpp_id": "uuid",
    "related_url": "/passports/battery-passport/view/BAT-01",
    "read": false,
    "created_at": "2025-05-05T10:30:00Z"
  },
  {
    "id": "uuid",
    "user_id": "uuid",
    "notification_type": "workflow_approval",
    "title": "Approval needed: BAT-01",
    "message": "Review passed — your approval is required",
    "passport_dpp_id": "uuid",
    "related_url": "/dashboard/workflow",
    "read": false,
    "created_at": "2025-05-05T10:15:00Z"
  }
]
```

**Response Fields:**
- `id` - Notification UUID
- `user_id` - Recipient user ID
- `notification_type` - Type of notification
- `title` - Short notification title
- `message` - Optional detailed message
- `passport_dpp_id` - Related passport ID (if applicable)
- `related_url` - URL to navigate to for context
- `read` - Whether notification has been read
- `created_at` - Notification creation timestamp

**Error Codes:**
- `500` - Failed to fetch notifications

---

### Get Full Notifications with Context

**GET** `/api/users/me/notifications/full`

Get notifications enriched with full workflow and user context. Returns workflow details, reviewer/approver information, and submitter details.

**Query Parameters:**
- `limit` (number, optional, default: 100, max: 200) - Maximum notifications to return

**Response (200 OK):**
```json
[
  {
    "id": "uuid",
    "user_id": "uuid",
    "notification_type": "workflow_approval",
    "title": "Approval needed: BAT-01",
    "message": "Review passed — your approval is required",
    "passport_dpp_id": "uuid",
    "read": false,
    "created_at": "2025-05-05T10:30:00Z",
    "reviewer_id": "reviewer-uuid",
    "reviewer_name": "John Reviewer",
    "reviewer_email": "john@company.com",
    "approver_id": "approver-uuid",
    "approver_name": "Jane Approver",
    "approver_email": "jane@company.com",
    "review_status": "approved",
    "approval_status": "pending",
    "overall_status": "in_progress",
    "reviewed_at": "2025-05-05T10:20:00Z",
    "approved_at": null,
    "submitter_name": "Alice Editor",
    "submitter_email": "alice@company.com",
    "workflow_submitted_at": "2025-05-05T10:00:00Z"
  }
]
```

**Additional Fields (compared to basic notifications):**
- `reviewer_id`, `reviewer_name`, `reviewer_email` - Reviewer details
- `approver_id`, `approver_name`, `approver_email` - Approver details
- `submitter_name`, `submitter_email` - Who submitted passport to workflow
- `review_status` - Reviewer's decision status
- `approval_status` - Approver's decision status
- `overall_status` - Overall workflow status
- `reviewed_at` - When reviewer acted
- `approved_at` - When approver acted
- `rejected_at` - When rejected
- `workflow_submitted_at` - When submitted to workflow

**Error Codes:**
- `500` - Failed to fetch full notifications

---

## Mark as Read

### Mark All Notifications Read

**PATCH** `/api/users/me/notifications/read-all`

Mark all of current user's notifications as read.

**Request Body:** Empty or omitted

**Response (200 OK):**
```json
{
  "success": true
}
```

**Error Codes:**
- `500` - Failed to update notifications

---

### Mark Single Notification Read

**PATCH** `/api/users/me/notifications/:id/read`

Mark a specific notification as read.

**Parameters:**
- `id` (path parameter, required) - Notification ID

**Request Body:** Empty or omitted

**Response (200 OK):**
```json
{
  "success": true
}
```

**Error Codes:**
- `500` - Failed to update notification

---

## Notification Events

### When Notifications Are Created

**Workflow Submission:**
- Reviewer receives: "Review needed: {model_name}"

**Workflow Approval (with subsequent approver):**
- Approver receives: "Approval needed: {model_name}"

**Workflow Approval/Release (no subsequent approver):**
- Passport creator receives: "✅ {model_name} reviewed and released!"

**Workflow Rejection:**
- Passport creator receives: "❌ {model_name} was rejected"
- Message includes rejection reason if provided

**Passport Published:**
- Passport creator receives: "{model_name} is now public"

**Access Grant:**
- User receives: "You have access to {model_name}"

**Access Revocation:**
- User receives: "Your access to {model_name} has been revoked"

---

## UI Integration

### Unread Count
To get unread notification count:
1. Fetch notifications via GET `/api/users/me/notifications`
2. Filter where `read === false`
3. Count the array

### Real-time Updates
Note: Current API doesn't include WebSocket support. Poll the notifications endpoint periodically (recommended: every 5-30 seconds based on user activity).

### Filtering by Type
Example filter workflow notifications:
```javascript
const workflowNotifications = notifications.filter(n => 
  ['workflow_rejected', 'workflow_approval', 'workflow_approved'].includes(n.notification_type)
);
```

---

## Error Handling

All notification endpoints return consistent error responses:

```json
{
  "error": "Error message describing what went wrong"
}
```

| Code | Meaning |
|------|---------|
| `500` | Server Error - Failed to process notification request |

