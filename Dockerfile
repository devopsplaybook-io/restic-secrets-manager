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

COPY entrypoint.sh /entrypoint.sh

COPY --from=builder /opt/src/restic-secrets-manager-server/node_modules /opt/app/restic-secrets-manager/node_modules
COPY --from=builder /opt/src/restic-secrets-manager-server/dist /opt/app/restic-secrets-manager/dist
COPY --from=builder /opt/src/restic-secrets-manager-web/.output/public /opt/app/restic-secrets-manager/web
COPY restic-secrets-manager-server/config.json /opt/app/restic-secrets-manager/config.json
COPY restic-secrets-manager-server/sql /opt/app/restic-secrets-manager/sql
COPY package.json /opt/app/restic-secrets-manager/package.json

WORKDIR /opt/app/restic-secrets-manager

ENTRYPOINT [ "/entrypoint.sh" ]
