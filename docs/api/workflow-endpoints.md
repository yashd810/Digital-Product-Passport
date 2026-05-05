# Workflow API Endpoints

Workflow endpoints manage the review and approval process for Digital Product Passports before release to production.

**Base URL:** `http://localhost:3001`  
**Authentication:** Bearer token in `Authorization` header  
**Authorization:** Company access required (users must belong to company)

---

## Workflow States

### Overall Status
- `in_progress` - Workflow is active, awaiting review/approval
- `approved` - Workflow completed, passport released
- `rejected` - Workflow rejected, passport reverted to revision

### Review Status
- `pending` - Awaiting reviewer decision
- `approved` - Reviewer approved, awaiting approver (if configured)
- `rejected` - Reviewer rejected

### Approval Status
- `pending` - Awaiting approver decision
- `skipped` - No approver configured, skipped to release
- `approved` - Approver approved, passport released
- `rejected` - Approver rejected

### Release Status
- `draft` - Initial creation
- `in_revision` - Multiple versions, under revision
- `in_review` - Submitted to workflow
- `released` - Published and approved

---

## Submit Passport to Workflow

### Submit for Review

**POST** `/api/companies/:companyId/passports/:dppId/submit-review`

Submit a passport to the review/approval workflow. Passport must pass compliance validation before submission.

**Parameters:**
- `companyId` (path parameter, required) - Company ID
- `dppId` (path parameter, required) - Passport DPP ID

**Request Body:**
```json
{
  "passportType": "battery-passport",
  "reviewerId": "user-id-1",
  "approverId": "user-id-2"
}
```

**Request Parameters:**
- `passportType` (string, required) - Type of passport
- `reviewerId` (string, optional) - User ID of reviewer
- `approverId` (string, optional) - User ID of final approver
- Note: At least one reviewer or approver must be specified

**Response (200 OK):**
```json
{
  "success": true,
  "workflowId": "uuid",
  "compliance": {
    "workflowReleaseAllowed": true,
    "blockingIssues": [],
    "warnings": []
  }
}
```

**Error Codes:**
- `400` - passportType required OR no reviewer/approver specified
- `404` - Passport not found
- `422` - Passport failed compliance validation
  - Returns `code: "PASSPORT_COMPLIANCE_FAILED"`
  - Includes compliance details showing what must be fixed
- `500` - Failed to submit passport

---

## Workflow Actions

### Approve or Reject Passport

**POST** `/api/passports/:dppId/workflow/:action`

Reviewer or approver takes action on a passport in workflow.

**Parameters:**
- `dppId` (path parameter, required) - Passport DPP ID
- `action` (path parameter, required) - `"approve"` or `"reject"`

**Request Body:**
```json
{
  "passportType": "battery-passport",
  "comment": "Looks good, approved for release"
}
```

**Request Parameters:**
- `passportType` (string) - Passport type (required if not in workflow record)
- `comment` (string, optional) - Review/approval comment

**Response (200 OK):**
```json
{
  "success": true,
  "status": "approved"
}
```

**Workflow Behavior:**

**If action = "approve" and user is REVIEWER:**
- If no approver configured or approval is skipped:
  - Passport passes compliance check
  - Passport status changed to `released`
  - Digital signature created and stored
  - Notification sent to passport creator
  - Overall status set to `approved`
- If approver configured:
  - Review status set to `approved`
  - Notification sent to approver for final approval
  - Awaiting approver action

**If action = "approve" and user is APPROVER:**
- Passport passes compliance check
- Passport status changed to `released`
- Digital signature created and stored
- Notification sent to passport creator
- Overall status set to `approved`

**If action = "reject":**
- Passport reverted to previous status (draft or in_revision)
- Workflow marked as `rejected`
- Comment stored for rejection reason
- Notification sent to passport creator with rejection details

**Error Codes:**
- `400` - Invalid action (not "approve" or "reject") OR passportType required
- `403` - User is not the reviewer or approver for this passport
- `404` - No active workflow found for passport
- `422` - Passport failed compliance validation
  - Returns `code: "PASSPORT_COMPLIANCE_FAILED"`
  - Includes compliance details
- `500` - Failed to process workflow action

---

## Remove Workflow

### Delete Workflow

**DELETE** `/api/passports/:dppId/workflow`

Remove a passport from workflow and revert it to previous status. Only workflow creator or admin can remove.

**Parameters:**
- `dppId` (path parameter, required) - Passport DPP ID

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Workflow removed and passport reverted to revision"
}
```

**Behavior:**
- Creates archive snapshot before revert
- Reverts passport status to original status (draft or in_revision)
- Creates archive snapshot after revert
- Deletes workflow record

**Error Codes:**
- `403` - Only creator or admin can remove workflow
- `404` - Workflow not found
- `500` - Failed to remove workflow

---

## Get Workflow Status

### List User's Workflows

**GET** `/api/companies/:companyId/workflow`

Get all workflows for current user in a company.

**Parameters:**
- `companyId` (path parameter, required) - Company ID

**Query Parameters:** None

**Response (200 OK):**
```json
{
  "inProgress": [
    {
      "id": "uuid",
      "passport_dpp_id": "uuid",
      "passport_type": "battery-passport",
      "company_id": "uuid",
      "submitted_by": "user-id",
      "submitted_at": "2025-05-05T10:30:00Z",
      "reviewer_id": "user-id-1",
      "reviewer_name": "John Reviewer",
      "review_status": "pending",
      "approver_id": "user-id-2",
      "approver_name": "Jane Approver",
      "approval_status": "pending",
      "overall_status": "in_progress",
      "model_name": "BAT-01",
      "product_id": "BAT-2024-001",
      "version_number": 2,
      "release_status": "in_review"
    }
  ],
  "history": [
    {
      "id": "uuid",
      "passport_dpp_id": "uuid",
      "overall_status": "approved",
      "submitted_by": "user-id",
      "reviewed_at": "2025-05-05T11:00:00Z",
      "approved_at": "2025-05-05T11:15:00Z",
      "model_name": "BAT-01",
      "version_number": 2,
      "release_status": "released"
    }
  ]
}
```

**Response Includes:**
- **inProgress** - Workflows currently under review/approval
- **history** - Past workflows (completed or rejected), last 50

---

### Get User's Review/Approval Backlog

**GET** `/api/users/me/backlog`

Get all passports awaiting current user's review or approval across all companies.

**Parameters:** None

**Response (200 OK):**
```json
{
  "backlog": [
    {
      "id": "uuid",
      "passport_dpp_id": "uuid",
      "passport_type": "battery-passport",
      "company_id": "uuid",
      "submitted_by": "user-id",
      "submitted_at": "2025-05-05T10:30:00Z",
      "reviewer_id": "user-id-1",
      "review_status": "pending",
      "approver_id": "user-id-2",
      "approval_status": "pending",
      "overall_status": "in_progress",
      "model_name": "BAT-01",
      "product_id": "BAT-2024-001",
      "version_number": 2,
      "created_at": "2025-05-05T10:30:00Z"
    }
  ]
}
```

**Includes:**
- All workflows where user is reviewer and review_status is `pending`
- All workflows where user is approver, approval_status is `pending`, and review_status is not `pending`
- Sorted by creation date (oldest first)

---

## Compliance During Workflow

### Compliance Validation

Passports must pass compliance checks before:
1. Submitting to workflow
2. Reviewer approving (if no approver configured)
3. Approver approving

If compliance check fails during submission:
```json
{
  "error": "Passport failed compliance validation. Fix the blocking issues before submitting it to workflow.",
  "code": "PASSPORT_COMPLIANCE_FAILED",
  "compliance": {
    "workflowReleaseAllowed": false,
    "blockingIssues": [
      {
        "field": "capacity",
        "issue": "Required field missing"
      }
    ],
    "warnings": [
      {
        "field": "manufacturer",
        "warning": "Preferred field not provided"
      }
    ]
  }
}
```

---

## Notifications

Workflow generates notifications at key stages:

| Event | Recipient | Message |
|-------|-----------|---------|
| Submitted to review | Reviewer | "Review needed: {model_name}" |
| Review approved (approver exists) | Approver | "Approval needed: {model_name}" |
| Approved & released | Passport creator | "✅ {model_name} reviewed and released!" |
| Rejected | Passport creator | "❌ {model_name} was rejected" + reason |

---

## Audit Trail

All workflow actions are logged with:
- User performing action
- Passport identifier
- Action type (RELEASE, SIGN_PASSPORT, etc.)
- Status before/after
- Timestamp
- Additional metadata

---

## Error Handling

All workflow endpoints return consistent error responses:

```json
{
  "error": "Error message describing what went wrong"
}
```

| Code | Meaning |
|------|---------|
| `400` | Bad Request - Invalid parameters |
| `403` | Forbidden - Insufficient permissions |
| `404` | Not Found - Passport or workflow not found |
| `422` | Unprocessable Entity - Compliance validation failed |
| `500` | Server Error - Internal server error |

