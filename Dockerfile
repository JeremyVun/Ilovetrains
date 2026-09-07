# syntax=docker/dockerfile:1
# ilovetrains — Go caching proxy + static PWA client in one image.
# Built/pushed from this repo via docker-bake.hcl; the infra repo's
# stacks/ilovetrains/ only RUNS it.

FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY go.sum ./
COPY third_party ./third_party
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/trainsd ./cmd/server

FROM alpine:3.22 AS runtime
ARG GIT_REVISION=dev
# tzdata: the server renders Australia/Sydney offsets (time.LoadLocation).
# ca-certificates: TLS to api.transport.nsw.gov.au. Python compiles the daily
# static timetable; wget (busybox) serves the compose healthcheck.
RUN apk add --no-cache tzdata ca-certificates python3 \
    && mkdir -p /data /app/tools/fixtures /app/internal/stations \
    && chown nobody:nobody /data
COPY --from=build /out/trainsd /usr/local/bin/trainsd
COPY web /app/web
COPY native-data/bootstrap /app/native-data/bootstrap
COPY tools/compile-timetable.py /app/tools/compile-timetable.py
COPY tools/fixtures/ferry_stop_mapping.json /app/tools/fixtures/ferry_stop_mapping.json
COPY internal/stations/stations.json /app/internal/stations/stations.json
LABEL org.opencontainers.image.revision="$GIT_REVISION"
WORKDIR /app
ENV WEB_DIR=/app/web \
    NATIVE_BOOTSTRAP_DIR=/app/native-data/bootstrap \
    NATIVE_DATA_DIR=/data \
    TIMETABLE_COMPILER=/app/tools/compile-timetable.py
USER nobody
ENTRYPOINT ["trainsd"]
