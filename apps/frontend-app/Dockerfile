FROM node:20-alpine AS build
WORKDIR /app

COPY apps/frontend-app/package.json apps/frontend-app/package-lock.json ./
RUN npm ci

COPY apps/frontend-app/ ./
ARG VITE_API_URL=http://localhost:3001
ARG VITE_PUBLIC_VIEWER_URL=http://localhost:3004
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_PUBLIC_VIEWER_URL=${VITE_PUBLIC_VIEWER_URL}
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY infra/docker/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=101:101 /app/dist /usr/share/nginx/html
