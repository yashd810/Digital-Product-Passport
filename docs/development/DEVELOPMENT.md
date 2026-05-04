# Development Guidelines - Claros DPP

Standards, best practices, and coding guidelines for Claros DPP development.

---

## Code Quality Standards

### JavaScript/Node.js

**Style Guide**: Airbnb JavaScript Style Guide (with modifications)

**Key Rules**:

```javascript
// ✅ GOOD: Descriptive names, clear intent
const createDigitalProductPassport = async (data, workspaceId) => {
  const validated = validatePassportSchema(data);
  const passport = await db.passports.create(validated);
  return passport;
};

// ❌ BAD: Unclear naming, nested callbacks
const create = (d, w) => {
  return new Promise((res, rej) => {
    validate(d, (err, v) => {
      if (err) rej(err);
      db.create(v, (er, r) => {
        res(r);
      });
    });
  });
};
```

**Naming Conventions**:
- Variables, functions, methods: `camelCase`
- Classes, components: `PascalCase`
- Constants: `CONSTANT_CASE` (only for true constants)
- File names: `kebab-case.js` or `PascalCase.vue`

**File Organization**:
```
service/
├── AuthService.js         # Authentication logic
├── PassportService.js     # DPP operations
├── WorkspaceService.js    # Workspace management
└── index.js              # Export all services
```

**Comments & Documentation**:

```javascript
/**
 * Creates a new Digital Product Passport
 * 
 * @async
 * @param {Object} data - DPP data with passport information
 * @param {string} data.productId - Unique product identifier
 * @param {string} data.productName - Human-readable product name
 * @param {Object} data.metadata - Additional DPP metadata
 * @param {string} workspaceId - Workspace ID
 * @param {string} userId - User creating the DPP
 * @returns {Promise<Object>} Created passport object
 * @throws {ValidationError} If data doesn't match schema
 * @throws {DatabaseError} If database operation fails
 * 
 * @example
 * const passport = await PassportService.create(
 *   { productId: 'BAT-001', productName: 'Battery' },
 *   'workspace-123',
 *   'user-456'
 * );
 */
export const create = async (data, workspaceId, userId) => {
  // Implementation
};
```

### Vue.js Components

**Single File Component Structure**:

```vue
<template>
  <div class="passport-editor">
    <form @submit.prevent="handleSave">
      <!-- Template content -->
    </form>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { usePassportStore } from '@/stores/passport';

// Props definition
defineProps({
  passportId: {
    type: String,
    required: true
  }
});

// State
const isLoading = ref(false);
const form = ref({});

// Stores
const passportStore = usePassportStore();

// Computed
const isValid = computed(() => {
  return form.value.productName && form.value.productId;
});

// Methods
const handleSave = async () => {
  isLoading.value = true;
  try {
    await passportStore.updatePassport(form.value);
  } finally {
    isLoading.value = false;
  }
};
</script>

<style scoped>
.passport-editor {
  padding: 1rem;
}
</style>
```

**Component Guidelines**:
- Keep components focused (single responsibility)
- Extract complex logic to composables
- Use `<script setup>` syntax (modern Vue 3)
- Define PropTypes for validation
- Emit custom events for parent communication

---

## Backend Development

### API Endpoint Structure

```javascript
// routes/passports.js
import { Router } from 'express';
import { authenticate } from '@/middleware/auth';
import { validate } from '@/middleware/validation';
import PassportService from '@/services/PassportService';

const router = Router();

/**
 * POST /api/passports
 * Create a new digital product passport
 */
router.post('/', authenticate, validate(passportSchema), async (req, res, next) => {
  try {
    const { data, workspaceId } = req.body;
    const userId = req.user.id;
    
    const passport = await PassportService.create(data, workspaceId, userId);
    
    res.status(201).json({
      success: true,
      data: passport,
      message: 'Passport created successfully'
    });
  } catch (error) {
    next(error);
  }
});

export default router;
```

**Response Format**:

```json
{
  "success": true,
  "data": {
    "id": "uuid-123",
    "productName": "Lithium Battery",
    "createdAt": "2026-05-04T12:00:00Z"
  },
  "message": "Passport created successfully"
}
```

**Error Response**:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid passport data",
    "details": [
      {
        "field": "productId",
        "message": "Product ID is required"
      }
    ]
  }
}
```

### Service Layer Pattern

```javascript
// services/PassportService.js
import db from '@/db';
import { validatePassportSchema } from '@/validators';
import { NotFoundError, ValidationError } from '@/errors';

class PassportService {
  /**
   * Create new passport
   */
  async create(data, workspaceId, userId) {
    // Validate
    const validated = validatePassportSchema(data);
    
    // Check workspace access
    const hasAccess = await this.checkWorkspaceAccess(workspaceId, userId);
    if (!hasAccess) {
      throw new ForbiddenError('No access to workspace');
    }
    
    // Create record
    const passport = await db.passports.create({
      ...validated,
      workspaceId,
      createdBy: userId,
      version: 1
    });
    
    return passport;
  }

  async getById(id, userId) {
    const passport = await db.passports.findById(id);
    
    if (!passport) {
      throw new NotFoundError('Passport not found');
    }
    
    // Check access
    if (!await this.canAccess(passport, userId)) {
      throw new ForbiddenError('No access to this passport');
    }
    
    return passport;
  }
  
  // Additional methods...
}

export default new PassportService();
```

### Error Handling

```javascript
// errors/index.js
export class ValidationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.code = 'VALIDATION_ERROR';
    this.statusCode = 400;
    this.details = details;
  }
}

export class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.code = 'NOT_FOUND';
    this.statusCode = 404;
  }
}

export class ForbiddenError extends Error {
  constructor(message) {
    super(message);
    this.code = 'FORBIDDEN';
    this.statusCode = 403;
  }
}

// middleware/errorHandler.js
export const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const response = {
    success: false,
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: err.message,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    }
  };
  
  if (err.details) {
    response.error.details = err.details;
  }
  
  res.status(statusCode).json(response);
};
```

---

## Frontend Development

### State Management (Pinia)

```javascript
// stores/passport.js
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { PassportAPI } from '@/api/passports';

export const usePassportStore = defineStore('passport', () => {
  // State
  const passports = ref([]);
  const currentPassport = ref(null);
  const isLoading = ref(false);
  const error = ref(null);

  // Computed
  const publishedPassports = computed(() => {
    return passports.value.filter(p => p.isPublished);
  });

  const totalPassports = computed(() => passports.value.length);

  // Actions
  const fetchPassports = async (workspaceId) => {
    isLoading.value = true;
    error.value = null;
    try {
      const data = await PassportAPI.list(workspaceId);
      passports.value = data;
    } catch (err) {
      error.value = err.message;
      throw err;
    } finally {
      isLoading.value = false;
    }
  };

  const createPassport = async (data, workspaceId) => {
    isLoading.value = true;
    try {
      const newPassport = await PassportAPI.create(data, workspaceId);
      passports.value.push(newPassport);
      currentPassport.value = newPassport;
      return newPassport;
    } finally {
      isLoading.value = false;
    }
  };

  return {
    passports,
    currentPassport,
    isLoading,
    error,
    publishedPassports,
    totalPassports,
    fetchPassports,
    createPassport
  };
});
```

### API Service Layer

```javascript
// api/passports.js
import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL
});

// Add JWT token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('authToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle common errors
api.interceptors.response.use(
  response => response.data,
  error => {
    if (error.response?.status === 401) {
      // Clear auth and redirect to login
      localStorage.removeItem('authToken');
      window.location.href = '/login';
    }
    throw error;
  }
);

export const PassportAPI = {
  list: (workspaceId) => 
    api.get(`/passports?workspace_id=${workspaceId}`),
  
  get: (id) => 
    api.get(`/passports/${id}`),
  
  create: (data, workspaceId) => 
    api.post('/passports', { ...data, workspaceId }),
  
  update: (id, data) => 
    api.put(`/passports/${id}`, data),
  
  publish: (id) => 
    api.post(`/passports/${id}/publish`),
  
  delete: (id) => 
    api.delete(`/passports/${id}`)
};
```

---

## Testing

### Backend Testing (Jest)

```javascript
// tests/services/PassportService.test.js
import PassportService from '@/services/PassportService';
import db from '@/db';

jest.mock('@/db');

describe('PassportService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a passport with valid data', async () => {
      const data = {
        productId: 'BAT-001',
        productName: 'Battery',
        data: {}
      };
      
      db.passports.create.mockResolvedValue({
        id: 'uuid-123',
        ...data
      });

      const result = await PassportService.create(
        data,
        'workspace-123',
        'user-456'
      );

      expect(result.id).toBe('uuid-123');
      expect(db.passports.create).toHaveBeenCalled();
    });

    it('should throw ValidationError for invalid data', async () => {
      const invalidData = { productId: '' }; // Missing required field

      await expect(
        PassportService.create(invalidData, 'workspace-123', 'user-456')
      ).rejects.toThrow('Validation failed');
    });
  });
});
```

### Frontend Testing (Vitest + Vue Test Utils)

```javascript
// tests/components/PassportEditor.test.js
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import PassportEditor from '@/components/PassportEditor.vue';
import { usePassportStore } from '@/stores/passport';

vi.mock('@/stores/passport');

describe('PassportEditor', () => {
  it('should render form', () => {
    const wrapper = mount(PassportEditor, {
      props: { passportId: 'uuid-123' }
    });

    expect(wrapper.find('form').exists()).toBe(true);
  });

  it('should call store on save', async () => {
    const store = usePassportStore();
    store.createPassport = vi.fn();

    const wrapper = mount(PassportEditor);
    await wrapper.find('form').trigger('submit');

    expect(store.createPassport).toHaveBeenCalled();
  });
});
```

---

## Git Workflow

### Commit Messages

**Format**: `<type>(<scope>): <subject>`

```
feat(auth): add JWT token refresh mechanism
fix(passport): correct data validation schema
docs: update API documentation
style: format code with prettier
test: add passport creation tests
refactor(db): optimize query performance
chore: update dependencies
```

**Good commit messages**:
- ✅ `feat(api): add passport publish endpoint`
- ✅ `fix(frontend): resolve race condition in form`
- ❌ `fixed stuff`
- ❌ `WIP`

### Branch Naming

```
feature/add-passport-sharing
bugfix/fix-auth-token-expiry
docs/update-api-docs
hotfix/critical-security-patch
```

### Pull Request Process

1. Create feature branch from `develop`
2. Make changes with meaningful commits
3. Push to GitHub
4. Create PR with description of changes
5. Request code review
6. Address review feedback
7. Merge when approved
8. Delete branch after merge

---

## Performance Best Practices

### Backend

```javascript
// ✅ GOOD: Use database indexes
const getWorkspacePassports = async (workspaceId) => {
  // Query will use index on workspace_id
  return db.passports.find({ workspaceId });
};

// ❌ BAD: Loading and filtering in memory
const getWorkspacePassports = async (workspaceId) => {
  const all = await db.passports.findAll();
  return all.filter(p => p.workspaceId === workspaceId);
};
```

```javascript
// ✅ GOOD: Pagination
const getPassports = async (workspaceId, page = 1, limit = 20) => {
  const offset = (page - 1) * limit;
  return db.passports.find({ workspaceId }, { offset, limit });
};

// ❌ BAD: Loading all records
const getPassports = async (workspaceId) => {
  return db.passports.find({ workspaceId });
};
```

### Frontend

```javascript
// ✅ GOOD: Memoized computed properties
const publishedPassports = computed(() => {
  return passports.value.filter(p => p.isPublished);
});

// ❌ BAD: Method called on every render
<div v-for="p in getPublished()" :key="p.id">
```

```javascript
// ✅ GOOD: Lazy load modals and heavy components
const HeavyModal = defineAsyncComponent(() =>
  import('@/components/HeavyModal.vue')
);

// ❌ BAD: Import and render everything
import HeavyModal from '@/components/HeavyModal.vue';
```

---

## Security Best Practices

### Authentication
- Hash passwords with bcrypt (min 12 rounds)
- Use JWT for stateless auth
- Implement token expiration
- Support refresh tokens for long sessions

### Authorization
- Check permissions on every API endpoint
- Use role-based access control (RBAC)
- Validate user owns resource before modifying
- Never trust client-side authorization checks

### Data Protection
- Sanitize user inputs (prevent XSS)
- Use parameterized queries (prevent SQL injection)
- Hash sensitive data in database
- Encrypt data in transit (HTTPS/TLS)
- Don't log passwords or tokens

### Common Vulnerabilities

```javascript
// ❌ BAD: SQL injection risk
const query = `SELECT * FROM users WHERE email = '${email}'`;

// ✅ GOOD: Parameterized query
const query = 'SELECT * FROM users WHERE email = $1';
db.query(query, [email]);
```

```javascript
// ❌ BAD: XSS risk (Vue auto-escapes, but still bad practice)
const html = `<div>${userData}</div>`;
element.innerHTML = html;

// ✅ GOOD: Let Vue handle templating
<div>{{ userData }}</div>
```

---

## Documentation Standards

Every new feature should include:

1. **Code comments** - Why, not what
2. **JSDoc blocks** - Function signatures and usage
3. **README updates** - High-level overview
4. **Test documentation** - How to run tests
5. **API documentation** - Endpoint descriptions

---

## Deployment Guidelines

See [deployment/OCI.md](../deployment/OCI.md) for production deployment

Quick checklist:
- [ ] All tests passing
- [ ] Code reviewed and approved
- [ ] Database migrations tested
- [ ] Environment variables configured
- [ ] Backups created
- [ ] Health checks passing
- [ ] Logs monitored
- [ ] Rollback plan ready

---

## Tools & Scripts

### Useful Commands

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Format code
npm run format

# Lint code
npm run lint

# Build for production
npm run build

# Start development server
npm run dev

# Check dependencies for vulnerabilities
npm audit

# Update dependencies
npm update
```

---

## Getting Help

- **Codebase**: Review `/docs/ARCHITECTURE.md`
- **API**: See `/docs/api/ENDPOINTS.md`
- **Database**: See `/docs/DATABASE_SCHEMA.md`
- **Issues**: GitHub Issues
- **PRs**: Create pull request

