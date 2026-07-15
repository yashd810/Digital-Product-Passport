FROM node:22.23.1-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2
WORKDIR /app

COPY apps/backend-api/package.json apps/backend-api/package-lock.json ./
RUN apk add --no-cache --virtual .build-deps python3 build-base \
  && npm ci --omit=dev \
  && npm cache clean --force \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
  && apk del .build-deps

COPY apps/backend-api/ ./
RUN install -d -o node -g node -m 0755 \
      /data/passport-files \
      /data/repository-files \
      /data/uploads/symbols \
  && chown -R node:node /app

ENV LOCAL_STORAGE_DIR=/data
ENV FILES_DIR=/data/passport-files
ENV REPO_DIR=/data/repository-files
ENV UPLOADS_DIR=/data/uploads

USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
