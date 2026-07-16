FROM node:24.18.0-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS configuration
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
RUN node configure-runtime.js && rm configure-runtime.js nginx.conf.template

FROM nginxinc/nginx-unprivileged:1.30.3-alpine@sha256:b3f2436575bd5be7386518084d842dac414ab4962712afa31e99e0942a56e3b2
USER root
RUN apk add --no-cache --upgrade curl=8.20.0-r0 libcurl=8.20.0-r0
COPY --from=configuration --chown=101:101 /site/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=configuration --chown=101:101 /site/*.html /usr/share/nginx/html/
COPY --from=configuration --chown=101:101 /site/*.css /site/*.js /usr/share/nginx/html/
COPY --from=configuration --chown=101:101 /site/robots.txt /site/site.webmanifest /site/sitemap.xml /usr/share/nginx/html/
COPY --from=configuration --chown=101:101 /site/assets/ /usr/share/nginx/html/assets/
USER 101:101
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
CMD ["nginx", "-g", "daemon off;"]
