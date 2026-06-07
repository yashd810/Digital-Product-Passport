# Docker And Compose

## In Plain English

Docker is how this repo brings the apps together locally and in production-like builds.

Use this document when you want to know which compose file to touch or why a container starts the way it does.

## Current Compose Files

| File | Main use |
| --- | --- |
| `docker/docker-compose.yml` | local development stack |
| `docker/docker-compose.prod.yml` | main production-style stack |
| `docker/docker-compose.prod.backend.yml` | backend-focused production variant |
| `docker/docker-compose.prod.frontend.yml` | frontend-focused production variant |

## Current App Dockerfiles

| App | Dockerfile |
| --- | --- |
| Backend API | [apps/backend-api/Dockerfile](/Users/yashdesai/Desktop/Digital Product Passport/Project Files/APP/files/apps/backend-api/Dockerfile:1) |
| Frontend dashboard | [apps/frontend-app/Dockerfile](/Users/yashdesai/Desktop/Digital Product Passport/Project Files/APP/files/apps/frontend-app/Dockerfile:1) |
| Public viewer | [apps/public-passport-viewer/Dockerfile](/Users/yashdesai/Desktop/Digital Product Passport/Project Files/APP/files/apps/public-passport-viewer/Dockerfile:1) |
| Marketing site | [apps/marketing-site/Dockerfile](/Users/yashdesai/Desktop/Digital Product Passport/Project Files/APP/files/apps/marketing-site/Dockerfile:1) |

## Important Current Detail

The backend Docker image copies the shared frontend email stylesheet from:

- `apps/frontend-app/src/shared/styles/email-styles.css`

That is intentional. Transactional email styling is authored with the frontend shared styles, then baked into the backend image.
