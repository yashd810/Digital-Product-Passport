FROM node:20-alpine
WORKDIR /app

COPY apps/backend-api/package.json apps/backend-api/package-lock.json ./
RUN npm install --omit=dev

COPY apps/backend-api/ ./
COPY apps/frontend-app/src/assets/styles/email-styles.css /app/shared/email-styles.css

ENV EMAIL_STYLES_PATH=/app/shared/email-styles.css

EXPOSE 3001
CMD ["node", "Server/server.js"]
