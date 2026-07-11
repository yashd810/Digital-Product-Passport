FROM node:22-alpine AS build
WORKDIR /app

COPY apps/frontend-app/package.json apps/frontend-app/package-lock.json ./
RUN npm ci

COPY apps/frontend-app/ ./
ARG VITE_API_URL=http://localhost:3001
ARG VITE_PUBLIC_VIEWER_URL=http://localhost:3004
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_PUBLIC_VIEWER_URL=${VITE_PUBLIC_VIEWER_URL}
RUN npm run build

FROM nginxinc/nginx-unprivileged:stable-alpine
USER root
RUN apk upgrade --no-cache c-ares
COPY infra/docker/frontend/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build --chown=101:101 /app/dist /usr/share/nginx/html
USER 101:101
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
CMD ["/bin/sh", "-c", "export BACKEND_API_UPSTREAM=\"${BACKEND_API_UPSTREAM:-http://backend-api:3001}\" && envsubst '$BACKEND_API_UPSTREAM' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf && exec nginx -g 'daemon off;'"]
