FROM node:24.21.0-alpine@sha256:be80f76cf40ec8e42b9bec49f60a55e0660f30af58d3e5a25530785b30ea67e2
WORKDIR /app

COPY --chmod=0644 apps/backend-api/package.json apps/backend-api/package-lock.json apps/backend-api/.npmrc ./
ARG DPP_APK_UPGRADE_CACHE_BUST=source
RUN test -n "$DPP_APK_UPGRADE_CACHE_BUST" \
  && apk upgrade --no-cache \
  && apk add --no-cache --virtual .build-deps python3 build-base \
  && test "$(node --version)" = "v24.21.0" \
  && test "$(npm --version)" = "11.19.0" \
  && npm ci --omit=dev \
  && npm cache clean --force \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
  && apk del .build-deps

COPY --chown=node:node apps/backend-api/src/ ./src/
COPY --chown=node:node apps/backend-api/scripts/ ./scripts/
COPY --chown=node:node apps/backend-api/passport-modules/ ./passport-modules/
RUN install -d -o node -g node -m 0755 \
      /data/passport-files \
      /data/repository-files \
      /data/uploads/symbols

ENV LOCAL_STORAGE_DIR=/data
ENV FILES_DIR=/data/passport-files
ENV REPO_DIR=/data/repository-files
ENV UPLOADS_DIR=/data/uploads

USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
