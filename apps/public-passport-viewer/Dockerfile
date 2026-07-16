FROM node:24.18.0-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS build
WORKDIR /app/apps/public-passport-viewer

COPY apps/public-passport-viewer/package.json apps/public-passport-viewer/package-lock.json apps/public-passport-viewer/.npmrc ./
RUN npm ci

COPY apps/public-passport-viewer/ ./
COPY apps/frontend-app/src /app/apps/frontend-app/src
ARG VITE_API_URL
ARG VITE_PUBLIC_VIEWER_URL
ARG VITE_MARKETING_URL
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_PUBLIC_VIEWER_URL=${VITE_PUBLIC_VIEWER_URL}
ENV VITE_MARKETING_URL=${VITE_MARKETING_URL}
RUN node -e 'const validOrigin = (name) => { const value = process.env[name] || ""; try { const url = new URL(value); return value.trim() === value && !/[\u0000-\u001F\u007F\s\\]/.test(value) && ["http:", "https:"].includes(url.protocol) && !!url.hostname && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash; } catch { return false; } }; const validOptionalOrigin = (name) => !String(process.env[name] || "") || validOrigin(name); if (!validOptionalOrigin("VITE_API_URL") || !validOrigin("VITE_PUBLIC_VIEWER_URL") || !validOrigin("VITE_MARKETING_URL")) process.exit(1);'
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.30.3-alpine@sha256:b3f2436575bd5be7386518084d842dac414ab4962712afa31e99e0942a56e3b2
USER root
RUN apk add --no-cache --upgrade curl=8.20.0-r0 libcurl=8.20.0-r0
ARG VITE_API_URL
ENV DPP_PUBLIC_API_ORIGIN=${VITE_API_URL}
COPY infra/docker/public-passport-viewer/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build --chown=101:101 /app/apps/public-passport-viewer/dist /usr/share/nginx/html
USER 101:101
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
CMD ["/bin/sh", "-c", "export BACKEND_API_UPSTREAM=\"${BACKEND_API_UPSTREAM:-http://backend-api:3001}\" && export DPP_PUBLIC_API_ORIGIN=\"${DPP_PUBLIC_API_ORIGIN:-}\" && envsubst '$BACKEND_API_UPSTREAM $DPP_PUBLIC_API_ORIGIN' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf && exec nginx -g 'daemon off;'"]
