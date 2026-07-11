# Getting Started

## In Plain English

To run the system locally, you usually need five things:

- the dashboard frontend
- the backend API
- the public passport viewer
- PostgreSQL
- the static marketing site

The easiest way to start them together is Docker Compose.

## Main Local URLs

| Part | URL |
| --- | --- |
| Dashboard | `http://localhost:3000` |
| Backend API | `http://localhost:3001` |
| Public passport viewer | `http://localhost:3004` |
| Marketing site | `http://localhost:8080` |
| PostgreSQL | `localhost:5432` |

## Fastest Start

From the repository root:

```bash
docker compose -f docker/docker-compose.yml up -d --build
```

That local compose file is [docker/docker-compose.yml](/Users/yashdesai/Desktop/Digital Product Passport/Project Files/APP/files/docker/docker-compose.yml:1).

## What That Compose File Does

- runs the dashboard from `apps/frontend-app`
- runs the public viewer from `apps/public-passport-viewer`
- runs the backend from `apps/backend-api/src/server.js`
- starts PostgreSQL
- serves the static marketing site through Nginx

## If You Want To Run Apps Individually

### Frontend dashboard

```bash
cd apps/frontend-app
npm install
npm run start
```

### Backend API

```bash
cd apps/backend-api
npm install
npm run start
```

### Public viewer

```bash
cd apps/public-passport-viewer
npm install
npm run start
```

## First Places To Read

- [System Overview](../architecture/system-overview.md)
- [Runtime Wiring](../architecture/runtime-wiring.md)
- [Backend API](../apps/backend-api.md)
- [Frontend Dashboard](../apps/frontend-dashboard.md)

## Important Local Storage Paths

In local development, the backend uses the `.docker-data` folder as mounted storage when you run Docker Compose.

- `.docker-data/postgres`
- `.docker-data/local-storage/passport-files`
- `.docker-data/local-storage/repository-files`
- `.docker-data/local-storage/uploads`

The backend runtime path logic is in [apps/backend-api/src/bootstrap/runtime-config.js](/Users/yashdesai/Desktop/Digital Product Passport/Project Files/APP/files/apps/backend-api/src/bootstrap/runtime-config.js:12).
