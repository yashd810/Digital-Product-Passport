# App Documentation

Service-specific documentation lives here so application folders stay focused on source code and runtime files.

## Applications Overview

| App | Doc | Source | Purpose |
| --- | --- | --- | --- |
| Backend API | [backend-api.md](./backend-api.md) | `apps/backend-api` | Express.js REST API with PostgreSQL persistence |
| Frontend dashboard | [frontend-app.md](./frontend-app.md) | `apps/frontend-app` | React 18 authenticated dashboard application |
| Public passport viewer | [public-passport-viewer.md](./public-passport-viewer.md) | `apps/public-passport-viewer` | React 18 public passport viewer shell |
| Marketing site | [marketing-site.md](./marketing-site.md) | `apps/marketing-site` | Static HTML/CSS/JS marketing and legal pages |
| Asset management | See [Service Map](../architecture/SERVICES.md) | `apps/asset-management` | Static UI for asset management operations |

## Quick Links

- **Starting the backend?** See [backend-api.md](./backend-api.md#commands)
- **Working on the dashboard?** See [frontend-app.md](./frontend-app.md#routing-notes)
- **Deploying public viewer?** See [public-passport-viewer.md](./public-passport-viewer.md#commands)
- **Understanding services?** See [Services Map](../architecture/SERVICES.md)

## Related Documentation

- [Architecture Overview](../architecture/ARCHITECTURE.md) - System design and services
- [Project Structure](../architecture/PROJECT_STRUCTURE.md) - Repository organization
- [Data Flow](../architecture/DATA_FLOW.md) - Request/response patterns
- [API Endpoints](../api/ENDPOINTS.md) - Complete endpoint reference
