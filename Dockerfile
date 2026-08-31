# syntax=docker/dockerfile:1
# ilovetrains — Go caching proxy + static PWA client in one image.
# Built/pushed from this repo via docker-bake.hcl; the infra repo's
# stacks/ilovetrains/ only RUNS it.

FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/trainsd ./cmd/server

FROM alpine:3.22 AS runtime
# tzdata: the server renders Australia/Sydney offsets (time.LoadLocation).
# ca-certificates: TLS to api.transport.nsw.gov.au. wget (busybox) serves the
# compose healthcheck.
RUN apk add --no-cache tzdata ca-certificates
COPY --from=build /out/trainsd /usr/local/bin/trainsd
COPY web /app/web
ENV WEB_DIR=/app/web
USER nobody
ENTRYPOINT ["trainsd"]
