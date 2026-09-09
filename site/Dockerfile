# syntax=docker/dockerfile:1
FROM nginx:stable-alpine
ARG GIT_REVISION=dev
ENV NGINX_ENVSUBST_FILTER=ILOVETRAINSAPP_PORT \
    ILOVETRAINSAPP_PORT=8080
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY index.html /usr/share/nginx/html/index.html
COPY privacy /usr/share/nginx/html/privacy
COPY support /usr/share/nginx/html/support
COPY assets /usr/share/nginx/html/assets
COPY site.css site.js robots.txt sitemap.xml /usr/share/nginx/html/
LABEL org.opencontainers.image.title="ilovetrains app website" \
      org.opencontainers.image.revision="$GIT_REVISION"
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=5 \
    CMD wget -q -O /dev/null "http://127.0.0.1:${ILOVETRAINSAPP_PORT}/healthz" || exit 1
