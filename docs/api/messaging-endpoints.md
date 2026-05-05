# Messaging API Endpoints

Messaging endpoints enable direct communication between users within a company for collaboration on passports and workflows.

**Base URL:** `http://localhost:3001`  
**Authentication:** Bearer token in `Authorization` header  
**Scope:** Company-level (users can only message others in their company)

---

## Conversations

### List Conversations

**GET** `/api/messaging/conversations`

Get all active conversations for current user, sorted by most recent activity.

**Parameters:** None

**Response (200 OK):**
```json
[
  {
    "id": 42,
    "company_id": "uuid",
    "other_id": "uuid",
    "first_name": "John",
    "last_name": "Reviewer",
    "email": "john@company.com",
    "last_message": "Looks good, approved for release",
    "last_message_at": "2025-05-05T10:30:00Z",
    "last_sender_id": "uuid",
    "unread": 0
  },
  {
    "id": 43,
    "company_id": "uuid",
    "other_id": "uuid",
    "first_name": "Jane",
    "last_name": "Editor",
    "email": "jane@company.com",
    "last_message": "Can you review the battery passport?",
    "last_message_at": "2025-05-05T09:45:00Z",
    "last_sender_id": "uuid",
    "unread": 2
  }
]
```

**Response Fields:**
- `id` - Conversation ID
- `company_id` - Company UUID
- `other_id` - ID of the other participant in conversation
- `first_name`, `last_name`, `email` - Other user's details
- `last_message` - Text of most recent message
- `last_message_at` - Timestamp of last message
- `last_sender_id` - ID of who sent last message
- `unread` - Count of unread messages in conversation

**Error Codes:**
- `500` - Failed to fetch conversations

---

### Create or Get Conversation

**POST** `/api/messaging/conversations`

Create a new conversation with another user or get existing conversation. Automatically creates conversation if one doesn't exist between the two users.

**Request Body:**
```json
{
  "otherUserId": "user-uuid"
}
```

**Parameters:**
- `otherUserId` (string, required) - User ID to start/get conversation with

**Response (200 OK):**
```json
{
  "id": 42
}
```

**Error Codes:**
- `400` - otherUserId required OR cannot message yourself
- `403` - Different company (cannot message users from other companies)
- `404` - User not found
- `500` - Failed to create conversation

---

## Messages

### Get Messages in Conversation

**GET** `/api/messaging/conversations/:convId/messages`

Get messages in a conversation, with optional pagination.

**Parameters:**
- `convId` (path parameter, required) - Conversation ID

**Query Parameters:**
- `limit` (number, optional, default: 50, max: 200) - Maximum messages to return
- `before` (number, optional) - Message ID to fetch messages before (for pagination)

**Response (200 OK):**
```json
[
  {
    "id": 1001,
    "body": "Can you review the battery passport?",
    "created_at": "2025-05-05T09:45:00Z",
    "sender_id": "uuid",
    "first_name": "Jane",
    "last_name": "Editor",
    "email": "jane@company.com"
  },
  {
    "id": 1002,
    "body": "Sure, I'll take a look now",
    "created_at": "2025-05-05T09:50:00Z",
    "sender_id": "uuid",
    "first_name": "John",
    "last_name": "Reviewer",
    "email": "john@company.com"
  }
]
```

**Response Fields:**
- `id` - Message ID
- `body` - Message text content
- `created_at` - When message was sent
- `sender_id` - User ID who sent message
- `first_name`, `last_name`, `email` - Sender's user details

**Behavior:**
- Messages returned in chronological order (oldest first)
- Automatically marks all messages in conversation as read for current user
- Updates `last_read_at` timestamp

**Pagination:**
To load older messages, use the `before` parameter with the ID of the oldest message:
```
GET /api/messaging/conversations/42/messages?before=1000&limit=50
```

**Error Codes:**
- `403` - Forbidden (user not member of conversation)
- `500` - Failed to fetch messages

---

### Send Message

**POST** `/api/messaging/conversations/:convId/messages`

Send a message in a conversation.

**Parameters:**
- `convId` (path parameter, required) - Conversation ID

**Request Body:**
```json
{
  "body": "Looks good, approved for release"
}
```

**Parameters:**
- `body` (string, required) - Message text (non-empty)

**Response (201 Created):**
```json
{
  "id": 1003,
  "conversation_id": 42,
  "sender_id": "uuid",
  "body": "Looks good, approved for release",
  "created_at": "2025-05-05T10:30:00Z"
}
```

**Behavior:**
- Message body is trimmed of whitespace
- Automatically updates sender's `last_read_at` timestamp
- Message visible immediately to both users

**Error Codes:**
- `400` - Message body required or empty
- `403` - Forbidden (user not member of conversation)
- `500` - Failed to send message

---

## Users

### Get Messageable Users

**GET** `/api/messaging/users`

Get list of users in current user's company who can be messaged.

**Parameters:** None

**Response (200 OK):**
```json
[
  {
    "id": "uuid",
    "first_name": "John",
    "last_name": "Reviewer",
    "email": "john@company.com",
    "role": "editor"
  },
  {
    "id": "uuid",
    "first_name": "Jane",
    "last_name": "Editor",
    "email": "jane@company.com",
    "role": "company_admin"
  }
]
```

**Response Fields:**
- `id` - User ID
- `first_name`, `last_name` - User's name
- `email` - User email
- `role` - User's role (super_admin, company_admin, editor, viewer)

**Includes:**
- All active users in same company
- Sorted alphabetically by first name, then last name
- Excludes current user
- Only includes active users (`is_active = true`)

**Error Codes:**
- `500` - Failed to fetch users

---

### Get Unread Message Count

**GET** `/api/messaging/unread`

Get count of unread messages across all conversations.

**Parameters:** None

**Response (200 OK):**
```json
{
  "count": 5
}
```

**Response Fields:**
- `count` - Total number of unread messages

**Calculation:**
- Counts all messages where:
  - Sender is not current user
  - Message created after `last_read_at` for that conversation

**Error Codes:**
- `500` - Failed to fetch unread count

---

## Conversation Workflow

### Typical Usage Flow

1. **Get conversations:**
   ```bash
   GET /api/messaging/conversations
   ```

2. **Select a conversation or create new one:**
   ```bash
   POST /api/messaging/conversations
   Body: { "otherUserId": "..." }
   ```

3. **Get messages:**
   ```bash
   GET /api/messaging/conversations/42/messages
   ```

4. **Send message:**
   ```bash
   POST /api/messaging/conversations/42/messages
   Body: { "body": "My message" }
   ```

5. **Get unread count:**
   ```bash
   GET /api/messaging/unread
   ```

---

## UI Integration Tips

### Badge Count
Display unread message count on messaging icon/button:
```javascript
const { count } = await fetch('/api/messaging/unread').then(r => r.json());
document.querySelector('.messages-badge').textContent = count;
```

### Mark Message as Read
Messages are automatically marked read when fetched via GET `/api/messaging/conversations/:convId/messages`.

### Real-time Updates
Current API does not include WebSocket/real-time updates. Recommended polling strategies:
- Poll unread count: every 5-30 seconds
- Poll conversations: every 30-60 seconds (after user opens messaging panel)
- Poll messages: every 2-5 seconds (while conversation is open)

### Infinite Scroll (Pagination)
Load older messages in conversation using `before` parameter:
```javascript
const oldestMessageId = messages[0].id;
const moreMessages = await fetch(
  `/api/messaging/conversations/42/messages?before=${oldestMessageId}&limit=50`
).then(r => r.json());
```

---

## Security & Privacy

### Company Scoping
- Users can only message others in their company
- Cross-company messaging is blocked
- Attempting to message user from different company returns 403

### Own Conversations Only
- Users can only access conversations they're members of
- Attempting to access other users' conversations returns 403

### Message Content
- Messages are stored as plain text
- No end-to-end encryption (consider HTTPS for transit security)
- System admins can view all messages

---

## Limitations & Constraints

- **Message Length:** No documented limit (consider implementing 10KB max in frontend)
- **Conversation Limit:** No documented limit on number of conversations
- **Message History:** No documented retention policy
- **Real-time:** No WebSocket support; must poll for updates
- **Read Receipts:** Only `last_read_at` timestamp (no per-message receipts)
- **File Attachments:** Not supported

---

## Error Handling

All messaging endpoints return consistent error responses:

```json
{
  "error": "Error message describing what went wrong"
}
```

| Code | Meaning |
|------|---------|
| `400` | Bad Request - Invalid parameters |
| `403` | Forbidden - User not member of conversation or different company |
| `404` | Not Found - User or conversation not found |
| `500` | Server Error - Internal server error |

