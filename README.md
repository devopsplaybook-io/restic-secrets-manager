# restic-secrets-manager

Web UI to manage application secrets backed by [restic](https://restic.net) repositories.

Secrets are edited through a user-friendly interface as flat key/value pairs (never raw JSON), organized per project. Each project is connected to a restic repository (S3-compatible backend), and secrets can be **pulled** from or **pushed** to the repository as JSON files.

## Features

- **Projects** — each project holds the settings of a target restic repository (S3 endpoint, bucket, prefix, region, bucket lookup, credentials and repository password). Projects can be created and deleted, never updated. The creation dialog offers a read-only **connection test** of the settings (empty repository, snapshots found, or a clear error) and a **review step** before creating, since settings are immutable afterwards.
- **Secrets** — each secret is a named set of key/value pairs, edited through a dedicated dialog with masked values and reveal toggles. Secret names map to JSON file names in the repository. Values can be edited multiline (certificates, private keys, JSON), copied to the clipboard (auto-cleared after 30 seconds), whole secrets can be copied as .env or JSON, and .env/JSON content can be pasted to import key/value pairs when creating a secret. Unsaved edits are protected by a confirmation before leaving, and survive a session expiry.
- **Secret organization** — secrets can be duplicated or renamed, a key/value entry can be copied from one secret to another, and the secret list can be filtered by secret name or key name.
- **Pull** — restores the latest snapshot of the project repository and replaces the project secrets in the application, after a preview of the changes it would apply.
- **Push** — serializes the project secrets and creates a new snapshot tagged with the pushing user. Push is **rejected** when the repository contains a more recent snapshot than the last synchronized one (pull first).
- **Local changes detection** — projects whose secrets were modified since the last synchronization are flagged on the home page, and the UI checks each project for remote changes to pull.
- **Change previews** — every operation that replaces secrets (pull, snapshot restore, discard of local changes) shows first which secrets and keys would be added, changed or removed — values stay masked, only value lengths are exposed — and runs only after confirmation.
- **Snapshot history** — the home page shows the timeline of the repository snapshots with the pushing user of each snapshot; any snapshot can be restored as the project secrets (with a preview before confirmation), and local changes that were not pushed can be discarded by restoring the last synchronized snapshot (also previewed).
- **Users and access control** — users authenticate with username/password (JWT). Access is granted per project: regular users see only the projects they are granted access to (none by default), admins see and manage everything.
- **API tokens** — personal tokens created in the web UI (Settings → API Tokens) let scripts and CI jobs call the API with the same permissions as their user, without the web UI. The token value is shown exactly once at creation; only its hash is stored.
- **Sync notifications** — optional notifications to the ecosystem notifications server on sync events (push, pull, snapshot restore, discard, push conflict); disabled by default and fail-safe.
- **Short-lived sessions** — sessions last one hour and are never renewed: the UI warns shortly before the session ends and preserves unsaved edits across the expiry, so users can simply log in again (and resume where they left off).
- **PWA** — installable single-page application with dark/light theme.

## Architecture

| Component                       | Directory                                                                     | Technology                               |
| ------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------- |
| `restic-secrets-manager-server` | Fastify REST API, serves the web build and calls the `restic` CLI             | TypeScript, Fastify, better-sqlite3 / pg |
| `restic-secrets-manager-web`    | Single-page application                                                       | Nuxt (SPA), Pinia, axios                 |
| `restic-secrets-manager-proxy`  | Development proxy routing `/` to the web dev server and `/api/` to the server | Traefik                                  |

The `restic` binary must be available on the machine running the server (it is included in the Docker image).

## Quick Start

### Docker

Run restic-secrets-manager in Docker:

```bash
mkdir -p data
docker run --name restic-secrets-manager -p 8080:8080 -e JWT_KEY=<generate-a-strong-random-key> -v "$(pwd)/data:/data" -d devopsplaybookio/restic-secrets-manager
```

- Docker image: [`devopsplaybookio/restic-secrets-manager`](https://hub.docker.com/r/devopsplaybookio/restic-secrets-manager)
- Exposes port: `8080` (web UI and API)
- Data volume: `/data` (SQLite database)

### Kubernetes

Deploy restic-secrets-manager on Kubernetes:

```bash
git clone https://github.com/devopsplaybook-io/restic-secrets-manager
cd restic-secrets-manager/docs/deployments/kubernetes/restic-secrets-manager
kubectl kustomize . | kubectl apply -f -
```

> **Warning:** Replace the `CHANGE_ME` value of `JWT_KEY` in [`base/secret.yaml`](./docs/deployments/kubernetes/restic-secrets-manager/base/secret.yaml) with a strong random key before deploying.

> **Note:** The service is exposed as a `ClusterIP` inside the cluster; to access the web UI externally, use an Ingress or a NodePort service.

## Sync secrets into Kubernetes

restic-secrets-manager pairs with [kubernetes-secrets-cloud-sync](https://github.com/devopsplaybook-io/kubernetes-secrets-cloud-sync): secrets authored in the web UI are pushed to a restic repository, and kubernetes-secrets-cloud-sync materializes them as Kubernetes Secrets (`cloudsync-<secret-name>`) in the namespaces you annotate.

A combined Kustomize deployment of both tools is provided — see the [deployment guide](./docs/deployments/kubernetes/restic-secrets-manager-with-cloud-sync).

## Programmatic access

Scripts, CI jobs and homelab automations can consume secrets without the web UI using an API token:

1. Create a token in the web UI (Settings → API Tokens). The token grants the same permissions as its user, resolved live (revoking a project access applies immediately); revoke it anytime from the same page.
2. Call the API with the token:

```bash
export RSM_URL="http://localhost:8080"
export RSM_TOKEN="<api token>"
export PROJECT_ID="<project id>"
export SECRET_NAME="<secret name>"

# Export one secret as a .env file
curl -fsS -H "Authorization: Bearer $RSM_TOKEN" \
  "$RSM_URL/api/projects/$PROJECT_ID/secrets/by-name/$SECRET_NAME/export" -o app.env

# Export it as JSON instead
curl -fsS -H "Authorization: Bearer $RSM_TOKEN" \
  "$RSM_URL/api/projects/$PROJECT_ID/secrets/by-name/$SECRET_NAME/export?format=json"

# List the secrets of the project (JSON, values included)
curl -fsS -H "Authorization: Bearer $RSM_TOKEN" "$RSM_URL/api/projects/$PROJECT_ID/secrets"

# Trigger a pull or a push from CI (push answers 409 when the repository holds a more recent snapshot)
curl -fsS -X POST -H "Authorization: Bearer $RSM_TOKEN" "$RSM_URL/api/projects/$PROJECT_ID/pull"
```

## Sync notifications

restic-secrets-manager can notify the ecosystem notifications server ([notifications](https://github.com/devopsplaybook-io/notifications)) on sync events: push success, pull success, snapshot restore, discard of local changes and push conflict. Set `NOTIFICATIONS_API_ENDPOINT` and `NOTIFICATIONS_API_TOKEN` to enable the integration; it is disabled by default, failures never break a synchronization, and payloads carry project/snapshot/actor information but never secret values.

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
| `NOTIFICATIONS_API_ENDPOINT`           |                          | Notifications server endpoint (empty = disabled)    |
| `NOTIFICATIONS_API_TOKEN`              |                          | Notifications server API token                      |
| `OPENTELEMETRY_COLLECTOR_HTTP_TRACES`  |                          | OTLP HTTP endpoint for traces                       |
| `OPENTELEMETRY_COLLECTOR_HTTP_METRICS` |                          | OTLP HTTP endpoint for metrics                      |
| `OPENTELEMETRY_COLLECTOR_HTTP_LOGS`    |                          | OTLP HTTP endpoint for logs                         |

## Getting started

On first start, the application detects that no user exists and walks you through the creation of the initial administrator account. Then:

1. Create a project with the restic repository settings (S3 endpoint, bucket, prefix, credentials, repository password) — test the connection and review the settings before creating them; a "Getting started" checklist on the home page tracks these steps until they are all done.
2. Grant users access to the project (admins have access to all projects).
3. Pull existing secrets from the repository, or push the secrets created in the UI.

## Development

See [docs/dev/README.md](./docs/dev/README.md) for the development setup (Node.js, pm2, dev server, per-component build/lint/test).

## Deployment

The Docker image is a multi-stage build: it compiles the server, generates the web application, and ships both with the `restic` binary. The web UI and the API are served on the same port (`8080` by default).

```bash
docker build -t restic-secrets-manager .
```

Deployment examples with real deployment files are available in [docs/deployments](./docs/deployments):

- [Docker Compose](./docs/deployments/docker-compose/restic-secrets-manager/docker-compose.yaml)
- Kubernetes (Kustomize): [`docs/deployments/kubernetes/restic-secrets-manager`](./docs/deployments/kubernetes/restic-secrets-manager)
- Kubernetes, combined with [kubernetes-secrets-cloud-sync](https://github.com/devopsplaybook-io/kubernetes-secrets-cloud-sync): [`docs/deployments/kubernetes/restic-secrets-manager-with-cloud-sync`](./docs/deployments/kubernetes/restic-secrets-manager-with-cloud-sync)

## Security notes

- Restic repository credentials and the repository password are stored in the application database and are never returned by the API nor displayed in the UI.
- API tokens are stored as SHA-256 hashes only; the plaintext value is shown exactly once at creation. A token carries the permissions of its owning user, resolved live on each request.
- Sync notification payloads never contain secret values.
- Authorization checks read the user from the database on every request, so access changes take effect immediately.
- Push is rejected with HTTP 409 when the target repository holds a more recent snapshot, preventing accidental overwrites.
- Sessions are short-lived (1 hour) and not renewed; expired sessions require a new login.

## License

[MIT](./LICENSE)
