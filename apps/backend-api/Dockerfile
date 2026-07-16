FROM node:24.18.0-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd
WORKDIR /app

COPY apps/backend-api/package.json apps/backend-api/package-lock.json apps/backend-api/.npmrc ./
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
