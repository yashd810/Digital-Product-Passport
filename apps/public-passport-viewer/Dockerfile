FROM node:20.11-alpine AS build
WORKDIR /app

COPY apps/public-passport-viewer/package.json apps/public-passport-viewer/package-lock.json ./
RUN npm ci

COPY apps/public-passport-viewer/ ./
COPY apps/frontend-app/src ./frontend-app/src
ARG VITE_API_URL=http://localhost:3001
ARG VITE_PUBLIC_VIEWER_URL=http://localhost:3004
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_PUBLIC_VIEWER_URL=${VITE_PUBLIC_VIEWER_URL}
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27.0-alpine
COPY infra/docker/public-passport-viewer/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build --chown=101:101 /app/dist /usr/share/nginx/html
CMD ["/bin/sh", "-c", "export BACKEND_API_UPSTREAM=\"${BACKEND_API_UPSTREAM:-http://backend-api:3001}\" && envsubst '$BACKEND_API_UPSTREAM' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf && exec nginx -g 'daemon off;'"]
