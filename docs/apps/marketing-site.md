# Marketing Site

Source: `apps/marketing-site`

The marketing site is a static HTML/CSS/JS site served by Nginx. It contains public product, service, contact, sample passport, timeline, and legal pages.

## Table of Contents

- [Important Files](#important-files)
- [Local Runtime](#local-runtime)
- [Notes](#notes)
- [Related Documentation](#related-documentation)

## Important Files

| Path | Purpose |
| --- | --- |
| `index.html` | Home page |
| `product.html`, `services.html`, `about.html`, `contact.html` | Public information pages |
| `privacy-policy.html`, `terms-of-service.html` | Legal pages |
| `shared.js` | Shared navigation/footer behavior |
| `styles.css` | Site styling |
| `sitemap.xml`, `robots.txt`, `site.webmanifest` | SEO/browser metadata |
| `Dockerfile` | Production image |

## Local Runtime

In Docker Compose, the site is served by the `marketing-site` service at http://localhost:8080.

## Notes

Keep durable documentation in `docs/`. Keep this folder focused on deployable static site assets.

## Related Documentation

- [Project Structure](../architecture/PROJECT_STRUCTURE.md) - Repository organization
- [Architecture Overview](../architecture/ARCHITECTURE.md) - System services
- [Deployment Guide](../deployment/) - Deployment instructions
- [Public Passport Viewer](./public-passport-viewer.md) - Related application
- [Backend API](./backend-api.md) - Backend services
