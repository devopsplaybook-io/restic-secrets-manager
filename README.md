# restic-secrets-manager

Web UI to manage application secrets backed by [restic](https://restic.net) repositories.

Secrets are edited through a user-friendly interface as flat key/value pairs (never raw JSON), organized per project. Each project is connected to a restic repository (S3-compatible backend), and secrets can be **pulled** from or **pushed** to the repository as JSON files.

## Features

- **Projects** — each project holds the settings of a target restic repository (S3 endpoint, bucket, prefix, region, bucket lookup, credentials and repository password). Projects can be created and deleted, never updated.
- **Secrets** — each secret is a named set of key/value pairs, edited through a dedicated dialog with masked values and reveal toggles. Secret names map to JSON file names in the repository.
- **Pull** — restores the latest snapshot of the project repository and replaces the project secrets in the application.
- **Push** — serializes the project secrets and creates a new snapshot. Push is **rejected** when the repository contains a more recent snapshot than the last synchronized one (pull first).
- **Users and access control** — users authenticate with username/password (JWT). Access is granted per project: regular users see only the projects they are granted access to (none by default), admins see and manage everything.
- **Short-lived sessions** — sessions last one hour and are never renewed: users simply log in again when the session expires.
- **PWA** — installable single-page application with dark/light theme.

## Architecture

| Component                       | Directory                                                                     | Technology                               |
| ------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------- |
| `restic-secrets-manager-server` | Fastify REST API, serves the web build and calls the `restic` CLI             | TypeScript, Fastify, better-sqlite3 / pg |
| `restic-secrets-manager-web`    | Single-page application                                                       | Nuxt (SPA), Pinia, axios                 |
| `restic-secrets-manager-proxy`  | Development proxy routing `/` to the web dev server and `/api/` to the server | Traefik                                  |

The `restic` binary must be available on the machine running the server (it is included in the Docker image).

## Configuration

Configuration is provided by environment variables (a `config.json` file next to the server can also be used):

| Variable                               | Default                  | Description                                         |
| -------------------------------------- | ------------------------ | --------------------------------------------------- |
| `API_PORT`                             | `8080`                   | Server (API + web) port                             |
| `JWT_KEY`                              | random, persisted        | JWT signing key — set it explicitly in production   |
| `JWT_VALIDITY_DURATION`                | `3600`                   | Session duration in seconds (1 hour, not renewed)   |
| `CORS_POLICY_ORIGIN`                   |                          | CORS allowed origin                                 |
| `DATA_DIR`                             | `/data`                  | Data directory (SQLite database)                    |
| `DATABASE_TYPE`                        | `sqlite`                 | `sqlite` or `postgres`                              |
| `DATABASE_POSTGRES_HOST`               |                          | PostgreSQL host (when `DATABASE_TYPE=postgres`)     |
| `DATABASE_POSTGRES_PORT`               | `5432`                   | PostgreSQL port                                     |
| `DATABASE_POSTGRES_USER`               |                          | PostgreSQL user                                     |
| `DATABASE_POSTGRES_PASSWORD`           |                          | PostgreSQL password                                 |
| `DATABASE_POSTGRES_DATABASE`           |                          | PostgreSQL database                                 |
| `LOG_LEVEL`                            | `info`                   | Log level                                           |
| `TMP_DIR`                              | `/tmp`                   | Directory used for temporary restic working folders |
| `OPENTELEMETRY_COLLECTOR_HTTP_TRACES`  |                          | OTLP HTTP endpoint for traces                       |
| `OPENTELEMETRY_COLLECTOR_HTTP_METRICS` |                          | OTLP HTTP endpoint for metrics                      |
| `OPENTELEMETRY_COLLECTOR_HTTP_LOGS`    |                          | OTLP HTTP endpoint for logs                         |
| `APPLICATION_TITLE`                    | `Restic Secrets Manager` | Application title in the browser tab and PWA (set by Docker image entrypoint) |

## Getting started

On first start, the application detects that no user exists and walks you through the creation of the initial administrator account. Then:

1. Create a project with the restic repository settings (S3 endpoint, bucket, prefix, credentials, repository password).
2. Grant users access to the project (admins have access to all projects).
3. Pull existing secrets from the repository, or push the secrets created in the UI.

## Development

Requirements: Node.js 26+, npm, [pm2](https://pm2.keymetrics.io/) and the `restic` CLI (for pull/push).

```bash
# Install dependencies and start proxy (:9999), server (:8080) and web (:3000)
npm run dev

# Rebuild native dependencies (e.g. after a Node.js upgrade)
npm run dependencies
```

Verification per component:

```bash
cd restic-secrets-manager-server
npm run build && npm run lint && npm run test

cd ../restic-secrets-manager-web
npm run generate && npm run lint
```

## Deployment

The Docker image is a multi-stage build: it compiles the server, generates the web application, and ships both with the `restic` binary. The web UI and the API are served on the same port (`8080` by default).

```bash
docker build -t restic-secrets-manager .

docker run -d \
  -p 8080:8080 \
  -e JWT_KEY=<generate-a-strong-random-key> \
  -v ./data:/data \
  --name restic-secrets-manager \
  restic-secrets-manager
```

Additional examples are available in [docs/deployments](./docs/deployments) (Docker Compose and Kubernetes).

## Security notes

- Restic repository credentials and the repository password are stored in the application database and are never returned by the API nor displayed in the UI.
- Authorization checks read the user from the database on every request, so access changes take effect immediately.
- Push is rejected with HTTP 409 when the target repository holds a more recent snapshot, preventing accidental overwrites.
- Sessions are short-lived (1 hour) and not renewed; expired sessions require a new login.

## License

[MIT](./LICENSE)
