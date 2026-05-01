FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY infra/docker/asset-management/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --chown=101:101 apps/asset-management/ /usr/share/nginx/html/
CMD ["/bin/sh", "-c", "export BACKEND_API_UPSTREAM=\"${BACKEND_API_UPSTREAM:-http://backend-api:3001}\" && envsubst '$BACKEND_API_UPSTREAM' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf && exec nginx -g 'daemon off;'"]
