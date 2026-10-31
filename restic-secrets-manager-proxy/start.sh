#!/usr/bin/env bash
#
# Development-only Traefik proxy. Downloads a pinned, checksum-verified
# Traefik release into ./bin on first run (or after a version change) and
# exposes the dashboard on the loopback interface only.

set -euo pipefail

SERVICE_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="${SERVICE_DIR}/bin"
TRAEFIK_VERSION="3.7.17"
VERSION_STAMP="${BIN_DIR}/.traefik-version"
DOWNLOAD_URL="https://github.com/traefik/traefik/releases/download/v${TRAEFIK_VERSION}"

case "$(uname -s)" in
    Linux) ;;
    *)
        echo "Unsupported platform: $(uname -s). The dev proxy supports Linux only (use WSL2 on Windows)." >&2
        exit 1
        ;;
esac

case "$(uname -m)" in
    x86_64 | amd64) TRAEFIK_ARCH="amd64" ;;
    aarch64 | arm64) TRAEFIK_ARCH="arm64" ;;
    *)
        echo "Unsupported architecture: $(uname -m). Supported: amd64, arm64." >&2
        exit 1
        ;;
esac

ARCHIVE="traefik_v${TRAEFIK_VERSION}_linux_${TRAEFIK_ARCH}.tar.gz"
CHECKSUMS_FILE="traefik_v${TRAEFIK_VERSION}_checksums.txt"

if [ ! -x "${BIN_DIR}/traefik" ] || [ "$(cat "${VERSION_STAMP}" 2>/dev/null || true)" != "${TRAEFIK_VERSION}" ]; then
    echo "Installing Traefik ${TRAEFIK_VERSION} (linux/${TRAEFIK_ARCH})..."
    mkdir -p "${BIN_DIR}"
    WORK_DIR="$(mktemp -d)"
    trap 'rm -rf "${WORK_DIR}"' EXIT

    curl -fsSL -o "${WORK_DIR}/${ARCHIVE}" "${DOWNLOAD_URL}/${ARCHIVE}"
    curl -fsSL -o "${WORK_DIR}/${CHECKSUMS_FILE}" "${DOWNLOAD_URL}/${CHECKSUMS_FILE}"

    # Verify the pinned release checksum before extracting anything
    (cd "${WORK_DIR}" && grep "  ${ARCHIVE}\$" "${CHECKSUMS_FILE}" | sha256sum -c -)

    tar -xzf "${WORK_DIR}/${ARCHIVE}" -C "${BIN_DIR}" traefik
    chmod +x "${BIN_DIR}/traefik"
    printf '%s' "${TRAEFIK_VERSION}" > "${VERSION_STAMP}"
fi

# The API/dashboard entrypoint is bound to loopback: it is unauthenticated
# and must never be reachable from another host.
exec "${BIN_DIR}/traefik" \
    --entrypoints.web.address=:9999 \
    --providers.file.watch=true \
    --providers.file.filename="${SERVICE_DIR}/traefik-rules.yml" \
    --entrypoints.dashboard.address=127.0.0.1:9091 \
    --api=true \
    --api.dashboard=true
