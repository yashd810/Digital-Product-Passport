# Frontend App - Claros DPP

Web dashboard for managing Digital Product Passports and workspaces.

---

## Overview

The Frontend App is a modern Vue.js SPA that provides:
- User authentication and account management
- DPP creation, editing, and publishing
- Workspace management
- User invitation and collaboration
- Real-time data updates

**Technology**: Vue 3, Vite, Tailwind CSS

**Port**: 3000 (development), via reverse proxy (production)

---

## Quick Start

### Prerequisites
- Node.js 20+
- npm 10+
- Backend API running on port 3001

### Development

**Install dependencies**:
```bash
cd apps/frontend-app
npm install
```

**Start dev server**:
```bash
npm run dev
```

Server runs at http://localhost:3000 with hot reload.

**Run tests**:
```bash
npm test
npm test -- --watch
npm test -- --coverage
```

**Build for production**:
```bash
npm run build
# Output: dist/ folder
```

### Environment Variables

Create `.env`:
```bash
VITE_API_URL=http://localhost:3001
VITE_PUBLIC_VIEWER_URL=http://localhost:3004
VITE_APP_TITLE=Claros DPP
```

---

## Directory Structure

```
apps/frontend-app/
├── src/
│   ├── components/       # Reusable Vue components
│   │   ├── Button.vue
│   │   ├── Modal.vue
│   │   ├── Form.vue
│   │   └── ...
│   ├── pages/           # Page components
│   │   ├── Dashboard.vue
│   │   ├── Login.vue
│   │   ├── SignUp.vue
│   │   ├── PassportCreate.vue
│   │   └── ...
│   ├── services/        # API communication
│   │   ├── api.js       # Axios instance
│   │   ├── auth.js      # Auth API calls
│   │   ├── passports.js # Passport API calls
│   │   └── ...
│   ├── stores/          # State management (Pinia)
│   │   ├── auth.js      # Auth state
│   │   ├── passport.js  # Passport state
│   │   ├── workspace.js # Workspace state
│   │   └── ...
│   ├── App.vue          # Root component
│   ├── main.js          # Entry point
│   └── style.css        # Global styles
├── index.html           # HTML template
├── vite.config.js       # Build configuration
├── package.json         # Dependencies
└── tailwind.config.js   # Tailwind configuration
```

---

## Pages

### Public Pages
- **Login** (`/login`) - User login
- **Sign Up** (`/signup`) - Account registration
- **Forgot Password** (`/forgot-password`) - Password reset

### Dashboard Pages (Authenticated)
- **Dashboard** (`/`) - Home and overview
- **Workspaces** (`/workspaces`) - List and manage workspaces
- **Create Workspace** (`/workspaces/new`) - Create new workspace
- **Workspace Settings** (`/workspaces/:id/settings`) - Edit workspace

### DPP Pages (Authenticated)
- **Passports** (`/passports`) - List DPPs
- **Create Passport** (`/passports/new`) - Create new DPP
- **Passport Details** (`/passports/:id`) - View DPP details
- **Edit Passport** (`/passports/:id/edit`) - Edit DPP
- **Publish Passport** (`/passports/:id/publish`) - Publish DPP

### Team Pages (Authenticated)
- **Members** (`/workspace/:id/members`) - Manage team members
- **Invitations** (`/workspace/:id/invitations`) - Invite members

---

## Components

### Layout Components
- `AppHeader` - Top navigation bar
- `AppSidebar` - Side navigation menu
- `AppFooter` - Footer

### Form Components
- `FormField` - Input field wrapper
- `FormInput` - Text input
- `FormSelect` - Dropdown select
- `FormButton` - Submit button

### Data Components
- `PassportCard` - DPP preview card
- `PassportTable` - DPP list table
- `WorkspaceCard` - Workspace preview
- `MembersList` - Team member list

### Modal Components
- `ConfirmDialog` - Confirmation modal
- `CreatePassportModal` - Create DPP form
- `InviteUserModal` - Invite team member

---

## State Management (Pinia)

### Auth Store
```javascript
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();

// State
auth.user          // Current user
auth.token         // JWT token
auth.isAuthenticated // Login status

// Actions
await auth.login(email, password);
await auth.register(userData);
await auth.logout();
await auth.refreshToken();
```

### Passport Store
```javascript
import { usePassportStore } from '@/stores/passport';

const passport = usePassportStore();

// State
passport.passports    // List of DPPs
passport.current      // Current DPP
passport.loading      // Loading state

// Actions
await passport.fetchAll(workspaceId);
await passport.create(data, workspaceId);
await passport.update(id, data);
await passport.publish(id);
```

### Workspace Store
```javascript
import { useWorkspaceStore } from '@/stores/workspace';

const workspace = useWorkspaceStore();

// State
workspace.workspaces  // List of workspaces
workspace.current     // Current workspace

// Actions
await workspace.fetchAll();
await workspace.create(data);
await workspace.addMember(workspaceId, email);
```

---

## API Integration

### Axios Setup
```javascript
// src/services/api.js
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

// Handle 401 errors
api.interceptors.response.use(
  response => response.data,
  error => {
    if (error.response?.status === 401) {
      localStorage.removeItem('authToken');
      window.location.href = '/login';
    }
    throw error;
  }
);

export default api;
```

### Service Functions
```javascript
// src/services/passports.js
import api from './api';

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

## Styling

### Tailwind CSS

```vue
<template>
  <div class="flex flex-col gap-4">
    <h1 class="text-2xl font-bold text-gray-900">My Passports</h1>
    <button class="px-4 py-2 bg-blue-600 text-white rounded">Create</button>
  </div>
</template>
```

### Custom CSS

```css
/* src/style.css */
:root {
  --primary: #0db5b0;
  --primary-dark: #0a8b85;
  --text: #071727;
  --border: #e5e7eb;
}

.app-card {
  @apply bg-white rounded-lg shadow-sm border border-gray-200 p-4;
}
```

---

## Testing

**Unit Tests**:
```javascript
describe('AuthStore', () => {
  it('should login user', async () => {
    const auth = useAuthStore();
    await auth.login('test@example.com', 'password');
    
    expect(auth.isAuthenticated).toBe(true);
    expect(auth.token).toBeDefined();
  });
});
```

**Component Tests**:
```javascript
describe('PassportCard', () => {
  it('should render passport data', () => {
    const wrapper = mount(PassportCard, {
      props: {
        passport: {
          id: '123',
          productName: 'Battery'
        }
      }
    });
    
    expect(wrapper.text()).toContain('Battery');
  });
});
```

---

## Deployment

### Development
```bash
npm run dev
```

### Production Build
```bash
npm run build
# Creates dist/ folder with optimized bundle
```

### Docker
```bash
# Build image
docker-compose build frontend-app

# Run container
docker-compose up frontend-app
```

---

## Performance

### Bundle Optimization
- Code splitting for routes
- Lazy loading for heavy components
- Tree-shaking for unused code
- Image optimization

### Caching
- API responses cached with TTL
- User data cached in Pinia store
- Browser cache for static assets

### Metrics
```bash
# Analyze bundle size
npm run build -- --report
```

---

## Browser Support

- Chrome/Edge (latest 2 versions)
- Firefox (latest 2 versions)
- Safari (latest 2 versions)
- Modern browser features required

---

## Key Features

### User Management
- Sign up / Login
- Profile management
- Password reset
- Account settings

### Workspace Management
- Create workspaces
- Invite team members
- Manage permissions
- Edit workspace settings

### DPP Management
- Create digital passports
- Edit passport data
- Version tracking
- Publish for public access
- Share links
- Export data

### Collaboration
- Invite users to workspace
- Role-based access (admin, editor, viewer)
- Activity feed
- Comments (if implemented)

---

## Security

### Authentication
- JWT token stored in localStorage
- Auto logout on token expiry
- Login required for protected routes
- Password validation

### Data Protection
- HTTPS in production
- No sensitive data in localStorage
- Sanitized user input
- XSS prevention via Vue template escaping

### Authorization
- Client-side route guards
- Server-side permission checks
- Role-based UI rendering

---

## Troubleshooting

### API Not Responding
```bash
# Check backend is running
curl http://localhost:3001/api/health

# Update VITE_API_URL in .env if needed
```

### Build Errors
```bash
# Clear node modules
rm -rf node_modules package-lock.json
npm install

# Rebuild
npm run build
```

### Hot Reload Not Working
```bash
# Restart dev server
npm run dev
```

---

## Documentation

- **[Backend API →](../../docs/api/ENDPOINTS.md)** - API reference
- **[Architecture →](../../docs/ARCHITECTURE.md)** - System design
- **[Development Guide →](../../docs/development/DEVELOPMENT.md)** - Coding standards
- **[Deployment →](../../docs/deployment/LOCAL.md)** - Local setup

---

## Useful Commands

```bash
# Development
npm run dev            # Start dev server
npm test              # Run tests
npm run lint          # Check code quality
npm run format        # Format code

# Production
npm run build         # Build for production
npm run preview       # Preview production build

# Analysis
npm run build -- --report  # Bundle analysis
```

---

**Status**: ✅ Production Ready

**Version**: 1.0.0

**Last Updated**: May 4, 2026

