FROM node:20-alpine AS build
WORKDIR /app

COPY apps/frontend-app/package.json apps/frontend-app/package-lock.json ./
RUN npm install

COPY apps/frontend-app/ ./
ARG VITE_API_URL=http://localhost:3001
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build

FROM nginx:1.27-alpine
COPY infra/docker/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
