# Marketing Site

## In Plain English

The marketing site is not part of the logged-in application. It is a static website for public-facing information.

## Current Structure

The site is plain HTML, CSS, and a shared JavaScript file:

- `apps/marketing-site/index.html`
- `apps/marketing-site/about.html`
- `apps/marketing-site/contact.html`
- `apps/marketing-site/product.html`
- `apps/marketing-site/services.html`
- `apps/marketing-site/shared.js`
- `apps/marketing-site/styles.css`

## Runtime

In Docker, it is served by Nginx.

Relevant files:

- [apps/marketing-site/Dockerfile](/Users/yashdesai/Desktop/Digital Product Passport/Project Files/APP/files/apps/marketing-site/Dockerfile:1)
- [docker/docker-compose.yml](/Users/yashdesai/Desktop/Digital Product Passport/Project Files/APP/files/docker/docker-compose.yml:66)
