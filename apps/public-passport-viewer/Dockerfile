FROM node:20-alpine AS build
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

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY infra/docker/public-passport-viewer/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=101:101 /app/dist /usr/share/nginx/html
