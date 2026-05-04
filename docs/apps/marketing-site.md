# Marketing Site

Source: `apps/marketing-site`

The marketing site is a static HTML/CSS/JS site served by Nginx. It contains public product, service, contact, sample passport, timeline, and legal pages.

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
