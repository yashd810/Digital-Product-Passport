# Public Passport Viewer

Vue.js single-page application for viewing published Digital Product Passports without authentication.

---

## Quick Start

```bash
# Install dependencies
cd apps/public-passport-viewer
npm install

# Development server (port 3004)
npm run dev

# Production build
npm run build

# Preview production build
npm run preview
```

**Access**: http://localhost:3004

---

## Overview

### Purpose

Public Passport Viewer is a read-only interface for accessing published Digital Product Passports. It allows public access without authentication, displaying DPP data for:
- Product information
- Environmental impact data
- Recycling instructions
- Material composition
- Supply chain information

### Architecture

```
┌─────────────────────────────────┐
│   Public Passport Viewer        │
│   (Vue 3 SPA)                   │
│   http://localhost:3004         │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│   Backend API                   │
│   GET /api/passports/:id/public │
│   (No authentication required)   │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│   PostgreSQL Database           │
│   (Published DPPs only)         │
└─────────────────────────────────┘
```

### Key Features

- **Public Access**: No login required
- **Read-Only**: Cannot modify data
- **Performance**: Optimized for public internet
- **Share**: Generate and share links
- **Export**: Download passport data
- **Mobile**: Responsive design
- **Speed**: Lazy loading and caching

---

## Directory Structure

```
apps/public-passport-viewer/
├── src/
│   ├── components/          # Reusable components
│   │   ├── PassportViewer.vue
│   │   ├── ProductInfo.vue
│   │   ├── EnvironmentalData.vue
│   │   ├── MaterialComposition.vue
│   │   ├── RecyclingInfo.vue
│   │   └── ShareButton.vue
│   ├── pages/              # Page components
│   │   ├── HomePage.vue
│   │   ├── PassportPage.vue
│   │   └── NotFoundPage.vue
│   ├── services/           # API services
│   │   └── passportService.js
│   ├── stores/             # Pinia stores
│   │   └── passportStore.js
│   ├── App.vue
│   └── main.js
├── public/                 # Static assets
│   └── favicon.ico
├── vite.config.js
├── package.json
└── README.md
```

---

## Environment Variables

```bash
# .env
VITE_API_URL=http://localhost:3001
VITE_PUBLIC_URL=http://localhost:3004
```

**In Production**:
```bash
VITE_API_URL=https://api.claros-dpp.online
VITE_PUBLIC_URL=https://viewer.claros-dpp.online
```

---

## Components

### PassportViewer Component

```vue
<template>
  <div class="passport-viewer">
    <div v-if="loading" class="loading">
      <p>Loading passport...</p>
    </div>
    
    <div v-else-if="passport" class="passport-content">
      <ProductInfo :passport="passport" />
      <EnvironmentalData :passport="passport" />
      <MaterialComposition :passport="passport" />
      <RecyclingInfo :passport="passport" />
      
      <div class="actions">
        <ShareButton :passportId="passport.id" />
        <button @click="exportPassport">Export as JSON</button>
      </div>
    </div>
    
    <div v-else class="not-found">
      <p>Passport not found</p>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { getPublicPassport } from '@/services/passportService';

const route = useRoute();
const passport = ref(null);
const loading = ref(true);

onMounted(async () => {
  try {
    const passportId = route.params.id;
    passport.value = await getPublicPassport(passportId);
  } catch (error) {
    console.error('Failed to load passport:', error);
  } finally {
    loading.value = false;
  }
});

function exportPassport() {
  const json = JSON.stringify(passport.value, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `passport-${passport.value.id}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
</script>

<style scoped>
.passport-viewer {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
}

.passport-content {
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  padding: 2rem;
}

.actions {
  display: flex;
  gap: 1rem;
  margin-top: 2rem;
}

button {
  padding: 0.5rem 1rem;
  background: #0066cc;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

button:hover {
  background: #0052a3;
}
</style>
```

### ShareButton Component

```vue
<template>
  <div class="share-button">
    <button @click="openShareDialog" class="btn-share">
      📤 Share Passport
    </button>
    
    <div v-if="showDialog" class="dialog">
      <div class="dialog-content">
        <h3>Share Passport</h3>
        
        <div class="share-options">
          <!-- Social media links -->
          <a :href="shareLinks.twitter" class="share-link twitter">
            Share on Twitter
          </a>
          <a :href="shareLinks.linkedin" class="share-link linkedin">
            Share on LinkedIn
          </a>
          
          <!-- Copy link -->
          <div class="copy-link">
            <input type="text" :value="passportUrl" readonly />
            <button @click="copyToClipboard">Copy Link</button>
          </div>
        </div>
        
        <button @click="showDialog = false" class="btn-close">
          Close
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';

const props = defineProps({
  passportId: String
});

const showDialog = ref(false);

const passportUrl = computed(() => {
  const base = import.meta.env.VITE_PUBLIC_URL || 'http://localhost:3004';
  return `${base}/passport/${props.passportId}`;
});

const shareLinks = computed(() => ({
  twitter: `https://twitter.com/intent/tweet?url=${encodeURIComponent(passportUrl.value)}&text=Check%20out%20this%20Digital%20Product%20Passport`,
  linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(passportUrl.value)}`
}));

function openShareDialog() {
  showDialog.value = true;
}

function copyToClipboard() {
  navigator.clipboard.writeText(passportUrl.value);
  alert('Link copied to clipboard!');
}
</script>

<style scoped>
.share-button {
  position: relative;
}

.btn-share {
  padding: 0.5rem 1rem;
  background: #28a745;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 1rem;
}

.btn-share:hover {
  background: #218838;
}

.dialog {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}

.dialog-content {
  background: white;
  padding: 2rem;
  border-radius: 8px;
  max-width: 500px;
}

.share-options {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin: 1rem 0;
}

.share-link {
  padding: 0.75rem;
  text-align: center;
  text-decoration: none;
  color: white;
  border-radius: 4px;
  font-weight: 500;
}

.share-link.twitter {
  background: #1da1f2;
}

.share-link.linkedin {
  background: #0a66c2;
}

.copy-link {
  display: flex;
  gap: 0.5rem;
}

.copy-link input {
  flex: 1;
  padding: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 4px;
}

.copy-link button {
  padding: 0.5rem 1rem;
  background: #0066cc;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
</style>
```

---

## API Integration

### Passport Service

```javascript
// src/services/passportService.js
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// Get published passport (public endpoint, no auth required)
export async function getPublicPassport(passportId) {
  try {
    const response = await axios.get(
      `${API_URL}/api/passports/${passportId}/public`
    );
    return response.data;
  } catch (error) {
    if (error.response?.status === 404) {
      throw new Error('Passport not found');
    }
    throw error;
  }
}

// Search published passports
export async function searchPublicPassports(query) {
  try {
    const response = await axios.get(
      `${API_URL}/api/passports/search`,
      { params: { q: query, published: true } }
    );
    return response.data;
  } catch (error) {
    throw error;
  }
}

// Get passport by product ID
export async function getPassportByProductId(productId) {
  try {
    const response = await axios.get(
      `${API_URL}/api/passports/by-product/${productId}`
    );
    return response.data;
  } catch (error) {
    throw error;
  }
}

// Track passport view
export async function trackPassportView(passportId) {
  try {
    await axios.post(
      `${API_URL}/api/passports/${passportId}/track-view`,
      {},
      { headers: { 'User-Agent': navigator.userAgent } }
    );
  } catch (error) {
    console.error('Failed to track view:', error);
  }
}
```

---

## Performance Optimization

### Caching Strategy

```javascript
// Cache API responses in localStorage
const CACHE_DURATION = 1000 * 60 * 60; // 1 hour

function getCachedPassport(passportId) {
  const cached = localStorage.getItem(`passport:${passportId}`);
  if (!cached) return null;
  
  const { data, timestamp } = JSON.parse(cached);
  if (Date.now() - timestamp > CACHE_DURATION) {
    localStorage.removeItem(`passport:${passportId}`);
    return null;
  }
  
  return data;
}

function setCachedPassport(passportId, data) {
  localStorage.setItem(
    `passport:${passportId}`,
    JSON.stringify({ data, timestamp: Date.now() })
  );
}
```

### Code Splitting

```javascript
// Lazy load components
const PassportViewer = defineAsyncComponent(() =>
  import('@/components/PassportViewer.vue')
);

const EnvironmentalData = defineAsyncComponent(() =>
  import('@/components/EnvironmentalData.vue')
);
```

---

## Deployment

### Docker

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

RUN npm run build

EXPOSE 3004

CMD ["npm", "run", "preview"]
```

### Docker Compose

```yaml
services:
  public-viewer:
    build: ./apps/public-passport-viewer
    ports:
      - "3004:3004"
    environment:
      VITE_API_URL: http://localhost:3001
      VITE_PUBLIC_URL: http://localhost:3004
    depends_on:
      - backend-api
```

---

## Styling

Uses Tailwind CSS for styling. Customizable theme in `vite.config.js`.

---

**[← Back to Main Docs](../../README.md)**
