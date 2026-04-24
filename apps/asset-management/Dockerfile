FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY infra/docker/asset-management/nginx.conf /etc/nginx/conf.d/default.conf
COPY --chown=101:101 apps/asset-management/ /usr/share/nginx/html/
