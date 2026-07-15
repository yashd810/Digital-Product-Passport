# The upstream PostgreSQL 18.4 images include a gosu binary built with Go 1.24.6,
# which has fixed high-severity CVEs. Rebuild that small privilege-drop helper
# from the pinned upstream 1.19 source using the patched Go 1.26.5 toolchain.
FROM golang:1.26.5-alpine3.24@sha256:0178a641fbb4858c5f1b48e34bdaabe0350a330a1b1149aabd498d0699ff5fb2 AS gosu-build

RUN apk add --no-cache git
ARG GOSU_VERSION=1.19
ARG GOSU_COMMIT=6456aaa0f3c854d199d0f037f068eb97515b7513
RUN git clone --depth 1 --branch "$GOSU_VERSION" https://github.com/tianon/gosu.git /src \
  && test "$(git -C /src rev-parse HEAD)" = "$GOSU_COMMIT" \
  && cd /src \
  && go build -buildvcs=false -trimpath -ldflags='-s -w' -o /gosu .

FROM postgres:18.4-trixie@sha256:22c89fe0d0f507606260237fd55e51f6137f58b2d5bcf6152242b96d9fe8f9a4

COPY --from=gosu-build --chmod=0555 /gosu /usr/local/bin/gosu
