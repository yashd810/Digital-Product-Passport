FROM nginxinc/nginx-unprivileged:stable-alpine
USER root
RUN apk upgrade --no-cache c-ares
COPY infra/docker/website/nginx.conf /etc/nginx/conf.d/default.conf
COPY --chown=101:101 apps/marketing-site/ /usr/share/nginx/html/
USER 101:101
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
CMD ["nginx", "-g", "daemon off;"]
