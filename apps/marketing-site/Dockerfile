FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY infra/docker/website/nginx.conf /etc/nginx/conf.d/default.conf
COPY --chown=101:101 apps/marketing-site/ /usr/share/nginx/html/
CMD ["nginx", "-g", "daemon off;"]
