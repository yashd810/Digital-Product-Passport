FROM nginx:1.27-alpine
COPY infra/docker/website/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/marketing-site/ /usr/share/nginx/html/
