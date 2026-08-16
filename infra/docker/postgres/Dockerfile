# The upstream PostgreSQL 18.4 images include a gosu binary built with Go 1.24.6,
# which has fixed high-severity CVEs. Rebuild that small privilege-drop helper
# from the pinned upstream 1.19 source using the fixed Go 1.26.6 toolchain.
#
# Keep the builder image digest-pinned. The Go toolchain is downloaded directly
# from go.dev and verified against the upstream per-architecture SHA-256 values
# so the final binary is fixed without introducing a mutable builder-image tag.
FROM golang:1.26.5-alpine3.24@sha256:0178a641fbb4858c5f1b48e34bdaabe0350a330a1b1149aabd498d0699ff5fb2 AS gosu-build

ARG GO_VERSION=1.26.6
ARG GO_AMD64_SHA256=708effb774be8237570d0add163225abbdfaf4fca28b2611df167beba4feef89
ARG GO_ARM64_SHA256=d0507e9e9d7fe012aae570108cbd76c15de879e17130ab8cb90d4d7445cb1f2e
ARG GO_ARM_SHA256=e1379a2fe77bd30fa29833074388247e7c65416e09279f746f20de2d5cf4dfea
ARG GO_386_SHA256=f09a71029fc5cd2940fbe36b0eb1fb2d8f3407cd6adb6b7b4de3eaf04007f8c4
ARG GO_PPC64LE_SHA256=232b65543a42eda95df6a63f76235c1795bb535eba5c74e509faec71bc648388
ARG GO_RISCV64_SHA256=7b3b526099181b40f5122c8ebf5c851486c7c92977e1f7f39dba9456c6ce42ff
ARG GO_S390X_SHA256=958757933d38172dd544085d253c8738cf09793d24c8bc0422e5e1e1fffa4fde
RUN set -eux; \
  apk add --no-cache ca-certificates curl git; \
  case "$(apk --print-arch)" in \
    x86_64) go_arch=amd64; go_sha256="$GO_AMD64_SHA256" ;; \
    aarch64) go_arch=arm64; go_sha256="$GO_ARM64_SHA256" ;; \
    armhf|armv7) go_arch=armv6l; go_sha256="$GO_ARM_SHA256" ;; \
    x86) go_arch=386; go_sha256="$GO_386_SHA256" ;; \
    ppc64le) go_arch=ppc64le; go_sha256="$GO_PPC64LE_SHA256" ;; \
    riscv64) go_arch=riscv64; go_sha256="$GO_RISCV64_SHA256" ;; \
    s390x) go_arch=s390x; go_sha256="$GO_S390X_SHA256" ;; \
    *) echo "unsupported architecture: $(apk --print-arch)" >&2; exit 1 ;; \
  esac; \
  curl --fail --location --retry 3 --proto '=https' --proto-redir '=https' \
    "https://go.dev/dl/go${GO_VERSION}.linux-${go_arch}.tar.gz" -o /tmp/go.tgz; \
  echo "${go_sha256}  /tmp/go.tgz" | sha256sum -c -; \
  rm -rf /usr/local/go; \
  tar -C /usr/local -xzf /tmp/go.tgz; \
  rm /tmp/go.tgz; \
  go version | grep -F "go${GO_VERSION}"

ENV GOTOOLCHAIN=local

ARG GOSU_VERSION=1.19
ARG GOSU_COMMIT=6456aaa0f3c854d199d0f037f068eb97515b7513
RUN git clone --depth 1 --branch "$GOSU_VERSION" https://github.com/tianon/gosu.git /src \
  && test "$(git -C /src rev-parse HEAD)" = "$GOSU_COMMIT" \
  && cd /src \
  && go build -buildvcs=false -trimpath -ldflags='-s -w' -o /gosu .

FROM postgres:18.4-trixie@sha256:22c89fe0d0f507606260237fd55e51f6137f58b2d5bcf6152242b96d9fe8f9a4

COPY --from=gosu-build /gosu /usr/local/bin/gosu
RUN chmod 0555 /usr/local/bin/gosu
