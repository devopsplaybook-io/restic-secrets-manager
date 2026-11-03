# BUILD
FROM node:26-alpine as builder

WORKDIR /opt/src

RUN apk add --no-cache bash git python3 perl alpine-sdk

COPY restic-secrets-manager-server restic-secrets-manager-server

RUN cd restic-secrets-manager-server && \
    npm ci && \
    npm run build

COPY restic-secrets-manager-web restic-secrets-manager-web

RUN cd restic-secrets-manager-web && \
    npm ci && \
    npm run generate

# RUN
FROM node:26-alpine

# restic is required at runtime to pull/push secrets snapshots
RUN apk add --no-cache restic gzip

# Dedicated non-root runtime user (fixed uid/gid shared by the K8s manifests
# and the Compose example). /home/app is the writable HOME and /data is the
# persistent data directory; named volumes still need matching ownership.
RUN addgroup -S -g 10001 app && \
    adduser -S -D -H -u 10001 -G app -h /home/app -s /sbin/nologin app && \
    mkdir -p /home/app /data && \
    chown -R app:app /home/app /data

ENV HOME=/home/app \
    TMP_DIR=/tmp \
    RESTIC_CACHE_DIR=/tmp/restic-cache

COPY entrypoint.sh /entrypoint.sh

COPY --from=builder /opt/src/restic-secrets-manager-server/node_modules /opt/app/restic-secrets-manager/node_modules
COPY --from=builder /opt/src/restic-secrets-manager-server/dist /opt/app/restic-secrets-manager/dist
COPY --from=builder /opt/src/restic-secrets-manager-web/.output/public /opt/app/restic-secrets-manager/web
COPY restic-secrets-manager-server/config.json /opt/app/restic-secrets-manager/config.json
COPY restic-secrets-manager-server/sql /opt/app/restic-secrets-manager/sql
# Root manifest: it is the application version reported by the server
# (ResolveAppVersion in src/Config.ts) and the version used for the image tag
COPY package.json /opt/app/restic-secrets-manager/package.json

WORKDIR /opt/app/restic-secrets-manager

USER 10001:10001

ENTRYPOINT [ "/entrypoint.sh" ]
