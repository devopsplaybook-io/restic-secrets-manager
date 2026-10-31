# restic-secrets-manager

Web UI to manage application secrets backed by [restic](https://restic.net) repositories.

Secrets are edited through a user-friendly interface as flat key/value pairs (never raw JSON), organized per project. Each project is connected to a restic repository (S3-compatible backend), and secrets can be **pulled** from or **pushed** to the repository as JSON files.

## Features

- **Projects** — each project holds the settings of a target restic repository (S3 endpoint, bucket, prefix, region, bucket lookup, credentials and repository password). Projects can be created and deleted, never updated. The creation dialog offers a read-only **connection test** of the settings (empty repository, snapshots found, or a clear error, plus warnings when the target is already in use or the repository holds uncorrelated snapshots) and a **review step** before creating, since settings are immutable afterwards. Repository targets (normalized endpoint, bucket and prefix) are unique across projects, and deletion removes the project and its secrets in one transaction.
- **Secrets** — each secret is a named set of key/value pairs, edited through a dedicated dialog with masked values and reveal toggles. Secret names map to JSON file names in the repository. Values can be edited multiline (certificates, private keys, JSON), copied to the clipboard (auto-cleared after 30 seconds), whole secrets can be copied as .env or JSON, and .env/JSON content can be pasted to import key/value pairs when creating a secret. Updates are versioned: a save based on a stale version is rejected instead of overwriting another user's changes, and copy-key only touches the selected key. Unsaved edits are protected by a confirmation before leaving, and survive a session expiry.
- **Secret organization** — secrets can be duplicated or renamed, a key/value entry can be copied from one secret to another, and the secret list can be filtered by secret name or key name.
- **Pull** — restores the snapshot chosen by the preview of the changes it would apply, and replaces the project secrets in the application. The preview pins the snapshot id: when the repository gains a newer snapshot before the confirmation, the pull is rejected with HTTP 409 and the preview must be run again.
- **Push** — serializes the project secrets and creates a new snapshot tagged with the pushing user. Push is **rejected** when the repository contains a more recent snapshot than the last synchronized one (pull first). The snapshot recorded as the project's sync state is always the one created by this push, even when another writer pushed concurrently.
- **Sync reliability** — every restic invocation (snapshots, restore, backup, init, connection test) is bounded by a configurable timeout, with a SIGTERM→SIGKILL escalation and HTTP 504 on expiry; disconnecting the client aborts its operation. Synchronizations are serialized per project — in-process queue plus a PostgreSQL advisory lock across replicas (SQLite deployments stay single-replica).
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
| `restic-secrets-manager-proxy`  | Development proxy routing `/` to the web dev server and `/api/` to the server | Traefik 3 (dev only)                     |

The `restic` binary must be available on the machine running the server (it is included in the Docker image).

The application release version is the **root `package.json` version**: it is used for the Docker image tag and is the version the server reports in development and in the container (OpenTelemetry service version). The `VERSION` setting overrides it when explicitly set. The dev proxy pins Traefik 3.7.17, verifies the release checksum before extraction and keeps its dashboard on the loopback interface only — see [restic-secrets-manager-proxy/README.md](./restic-secrets-manager-proxy/README.md).

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

> **Note:** `JWT_KEY` in [`base/secret.yaml`](./docs/deployments/kubernetes/restic-secrets-manager/base/secret.yaml) is empty by default, so the signing key is generated once and kept in the database. Set a strong random key to manage it yourself; changing it invalidates all issued sessions.

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

# Trigger a pull from CI: the preview returns snapshotId, the pull requires it
SNAPSHOT_ID=$(curl -fsS -H "Authorization: Bearer $RSM_TOKEN" \
  "$RSM_URL/api/projects/$PROJECT_ID/preview/pull" | jq -r .preview.snapshotId)
curl -fsS -X POST -H "Authorization: Bearer $RSM_TOKEN" -H "Content-Type: application/json" \
  -d "{\"snapshotId\": \"$SNAPSHOT_ID\"}" "$RSM_URL/api/projects/$PROJECT_ID/pull"

# Trigger a push from CI (answers 409 when the repository holds a more recent snapshot)
curl -fsS -X POST -H "Authorization: Bearer $RSM_TOKEN" "$RSM_URL/api/projects/$PROJECT_ID/push"
```

A pull answers `409` when the repository latest changed after the preview: run the preview again and send the new snapshot id. A restic operation that exceeds its timeout answers `504`.

The `.env` export uses the canonical server serializer (special characters and control characters are escaped, Unicode passes through) and rejects keys that are not valid environment variable names with HTTP `400`; use `?format=json` to export such secrets unchanged. Secret updates through the API (`PUT /api/projects/:id/secrets/:secretId`) must send the `version` returned by a read; a stale version answers `409` with `SECRET_VERSION_CONFLICT`, and `PUT /api/projects/:id/secrets/:secretId/keys` updates a single key without touching the others.

## Sync notifications

restic-secrets-manager can notify the ecosystem notifications server ([notifications](https://github.com/devopsplaybook-io/notifications)) on sync events: push success, pull success, snapshot restore, discard of local changes and push conflict. Set `NOTIFICATIONS_API_ENDPOINT` and `NOTIFICATIONS_API_TOKEN` to enable the integration; it is disabled by default, failures never break a synchronization, and payloads carry project/snapshot/actor information but never secret values. Changes to these settings in `config.json` are applied when the file is reloaded (no server restart needed).

## Configuration

Configuration is provided by environment variables (a `config.json` file next to the server can also be used):

| Variable                               | Default                  | Description                                         |
| -------------------------------------- | ------------------------ | --------------------------------------------------- |
| `API_PORT`                             | `8080`                   | Server (API + web) port                             |
| `JWT_KEY`                              | database-managed         | JWT signing key — when set, it takes precedence over the key stored in the database; changing it invalidates issued sessions |
| `JWT_VALIDITY_DURATION`                | `3600`                   | Session duration in seconds (1 hour, not renewed)   |
| `JWT_REVOCATION_ENABLED`               | `true`                   | Invalidate sessions on role, scope or password changes and user deletion |
| `AUTH_RATE_LIMIT_LOGIN_MAX`            | `10`                     | Login attempts allowed per window (per IP and username; `0` disables) |
| `AUTH_RATE_LIMIT_REFRESH_MAX`          | `60`                     | Session refresh requests allowed per window (per IP; `0` disables) |
| `AUTH_RATE_LIMIT_WINDOW_SECONDS`       | `60`                     | Rate-limit window in seconds                        |
| `TRUST_PROXY`                          | `false`                  | Trust `X-Forwarded-For` from a reverse proxy (needed for correct client IPs behind a proxy) |
| `CORS_POLICY_ORIGIN`                   |                          | CORS allowed origin                                 |
| `DATA_DIR`                             | `/data`                  | Data directory (SQLite database)                    |
| `DATABASE_TYPE`                        | `sqlite`                 | `sqlite` or `postgres`                              |
| `DATABASE_POSTGRES_HOST`               |                          | PostgreSQL host (when `DATABASE_TYPE=postgres`)     |
| `DATABASE_POSTGRES_PORT`               | `5432`                   | PostgreSQL port                                     |
| `DATABASE_POSTGRES_USER`               |                          | PostgreSQL user                                     |
| `DATABASE_POSTGRES_PASSWORD`           |                          | PostgreSQL password                                 |
| `DATABASE_POSTGRES_DATABASE`           |                          | PostgreSQL database                                 |
| `LOG_LEVEL`                            | `info`                   | Log level                                           |
| `TMP_DIR`                              | `/tmp`                   | Directory used for temporary restic working folders (use a private/tmpfs mount when possible) |
| `RESTIC_TIMEOUT_SNAPSHOTS_MS`          | `30000`                  | Timeout of `restic snapshots` operations and sync status checks |
| `RESTIC_TIMEOUT_RESTORE_MS`            | `300000`                 | Timeout of `restic restore` operations (pull and previews) |
| `RESTIC_TIMEOUT_BACKUP_MS`             | `600000`                 | Timeout of `restic backup` operations (push)        |
| `RESTIC_TIMEOUT_INIT_MS`               | `60000`                  | Timeout of repository initialization                |
| `RESTIC_TIMEOUT_CONNECTION_TEST_MS`    | `30000`                  | Timeout of the project connection test              |
| `RESTIC_KILL_GRACE_MS`                 | `5000`                   | Grace period between SIGTERM and SIGKILL when a restic operation is timed out or aborted |
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
- Authorization resolves the live user and role from the database on every request (cached per request); the role claim in the JWT is never authoritative. Role, scope and password changes and user deletion invalidate existing sessions through the `users.tokenVersion` column, so access changes take effect immediately.
- Unauthenticated requests answer `401` with a machine-readable `code` (`UNAUTHENTICATED`, `INVALID_CREDENTIALS`); authenticated-but-forbidden requests answer `403` (`FORBIDDEN`). The web UI only logs out on `401`, so a forbidden action shows an inline error instead of ending the session.
- Secret-bearing API responses (secret lists, environment/JSON exports, create and update echoes) carry `Cache-Control: no-store`, `Pragma: no-cache` and `Vary: Authorization` so browsers and intermediaries never store secret material.
- Login and session refresh are rate limited per client IP (and per username for login), answering `429` with `Retry-After` when exceeded. Behind a reverse proxy set `TRUST_PROXY=true` so the real client IP is used.
- Unsaved secret edits are kept in `sessionStorage` for at most 15 minutes, are bound to the user who wrote them and are cleared on explicit logout and after login. They are never sent to the server before the secrets are saved.
- Temporary restic working directories are created with mode `0700` and files with mode `0600`; stale `restic-secrets-manager-*` directories older than 24 hours are removed at startup. Prefer a private tmpfs mount for `TMP_DIR` so plaintext never touches persistent disk.
- Push is rejected with HTTP 409 when the target repository holds a more recent snapshot, preventing accidental overwrites.
- Secret updates are versioned: a stale write answers HTTP 409 instead of overwriting a concurrent change, and copy-key uses a partial update so unrelated keys are never replaced. Project deletion cascades to its secrets in one transaction.
- The `.env` export only emits portable environment variable names and canonical escaping; secrets with other key names remain available through the JSON export.
- Sessions are short-lived (1 hour) and not renewed; expired sessions require a new login.
- `JWT_KEY`: when set (environment or `config.json`), it is used as the signing key and is never written to the database; when empty, the key is generated once and stored in the database. Changing the configured key (or the database value when unset) invalidates all issued sessions, which is the intended rotation mechanism.

## License

[MIT](./LICENSE)
