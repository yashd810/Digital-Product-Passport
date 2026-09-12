FROM node:24.21.0-alpine@sha256:be80f76cf40ec8e42b9bec49f60a55e0660f30af58d3e5a25530785b30ea67e2 AS configuration
WORKDIR /site
COPY apps/marketing-site/ ./
COPY infra/docker/website/nginx.conf.template ./nginx.conf.template
ARG MARKETING_URL
ARG MARKETING_APP_URL
ARG MARKETING_API_URL
ENV MARKETING_URL=${MARKETING_URL}
ENV MARKETING_APP_URL=${MARKETING_APP_URL}
ENV MARKETING_API_URL=${MARKETING_API_URL}
ENV DPP_MARKETING_RUNTIME_RENDER=true
COPY apps/backend-api/src/shared/security/network-address.js /tmp/dpp-network-address.js
ENV DPP_NETWORK_ADDRESS_MODULE=/tmp/dpp-network-address.js
RUN node configure-runtime.js && rm configure-runtime.js nginx.conf.template

FROM nginxinc/nginx-unprivileged:1.30.3-alpine@sha256:b3f2436575bd5be7386518084d842dac414ab4962712afa31e99e0942a56e3b2
USER root
ARG DPP_APK_UPGRADE_CACHE_BUST=source
RUN test -n "$DPP_APK_UPGRADE_CACHE_BUST" && apk upgrade --no-cache
COPY --from=configuration --chown=101:101 /site/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=configuration --chown=101:101 /site/*.html /usr/share/nginx/html/
COPY --from=configuration --chown=101:101 /site/styles.css /site/shared.js /usr/share/nginx/html/
COPY --from=configuration --chown=101:101 /site/robots.txt /site/site.webmanifest /site/sitemap.xml /usr/share/nginx/html/
COPY --from=configuration --chown=101:101 /site/assets/ /usr/share/nginx/html/assets/
USER 101:101
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
CMD ["nginx", "-g", "daemon off;"]
