# restic-secrets-manager

Web UI to manage application secrets backed by [restic](https://restic.net) repositories.

Secrets are edited through a user-friendly interface as flat key/value pairs (never raw JSON), organized per project. Each project is connected to a restic repository (S3-compatible backend), and secrets can be **pulled** from or **pushed** to the repository as JSON files.

## Features

- **Projects** — each project holds the settings of a target restic repository (S3 endpoint, bucket, prefix, region, bucket lookup, credentials and repository password). Projects can be created and deleted, never updated. The creation dialog offers a read-only **connection test** of the settings (empty repository, snapshots found, or a clear error, plus warnings when the target is already in use or the repository holds uncorrelated snapshots) and a **review step** before creating, since settings are immutable afterwards. Repository targets (normalized endpoint, bucket and prefix) are unique across projects, and deletion removes the project and its secrets in one transaction.
- **Secrets** — each secret is a named set of key/value pairs, edited through a dedicated dialog with masked values and reveal toggles. Secret names map to JSON file names in the repository. Values can be edited multiline (certificates, private keys, JSON), copied to the clipboard (auto-cleared after 30 seconds), whole secrets can be copied as .env or JSON, and .env/JSON content can be pasted to import key/value pairs when creating a secret. Updates are versioned: a save based on a stale version is rejected instead of overwriting another user's changes. Copy-key merges the selected key into the fresh secret under the project write lock (per-key last-writer-wins), so concurrent edits to other keys are preserved. Every secret mutation records the new content hash in the same database transaction. Unsaved edits are protected by a confirmation before leaving, and survive a session expiry.
- **Secret organization** — secrets can be duplicated or renamed, a key/value entry can be copied from one secret to another, and the secret list can be filtered by secret name or key name.
- **Pull** — restores the snapshot chosen by the preview of the changes it would apply, and replaces the project secrets in the application. The preview pins the snapshot id and the current secrets content hash: when either changed before the confirmation, the pull is rejected with HTTP 409 (`SYNC_PREVIEW_STALE`, or the repository moved) and the preview must be run again. The secret replacement, the recorded sync state and the content hashes are written in one transaction, after re-checking the pinned content hash under the project write lock.
- **Push** — serializes the project secrets and creates a new snapshot tagged with the pushing user. Push is **rejected** when the repository contains a more recent snapshot than the last synchronized one (pull first). The snapshot recorded as the project's sync state is always the one created by this push, even when another writer pushed concurrently; the pushed content hash and the current content hash (which also accounts for edits made during the backup) are recorded together, and a synchronization that completed meanwhile is detected instead of overwritten.
- **Sync reliability** — every restic invocation (snapshots, restore, backup, init, connection test) is bounded by a configurable timeout, with a SIGTERM→SIGKILL escalation and HTTP 504 on expiry; disconnecting the client aborts its operation, including the status and snapshot-history reads. Synchronizations are serialized per project — an in-process queue wraps the whole operation, while the short database sections (compare-and-swap, secret replacement, sync state) also take a PostgreSQL advisory lock across replicas; SQLite deployments stay single-replica. Project deletion uses the same write lock, so it cannot interleave with a synchronization. Snapshot recency is compared as parsed timestamps (timezone offsets and sub-second precision included), with the id breaking exact ties.
- **Bounded status and history** — `GET /api/projects/status` is a stale-while-revalidate hot path: each project status is cached for `SYNC_STATUS_CACHE_TTL_MS`, concurrent requests share one run per project, at most three status runs execute at a time, and at most `SYNC_STATUS_MAX_WAITERS` requests queue for a slot (the rest answer HTTP 503 `STATUS_QUEUE_FULL`). The response is bounded by `SYNC_STATUS_REQUEST_DEADLINE_MS`: projects that are not ready answer with the existing `{error:true}` marker instead of holding the request. Aborted or failed runs are never cached. `GET /api/projects/:id/snapshots` is paginated with `limit` (default 50, maximum 200) and a `before` snapshot-id cursor, and answers `{snapshots, hasMore, nextBefore}`; because restic has no native pagination, the listing is parsed in memory and capped at 10 MB, reporting an explicit error rather than truncated data.
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

# Trigger a pull from CI: the preview returns snapshotId and contentHash, the pull requires both
PREVIEW=$(curl -fsS -H "Authorization: Bearer $RSM_TOKEN" \
  "$RSM_URL/api/projects/$PROJECT_ID/preview/pull")
SNAPSHOT_ID=$(echo "$PREVIEW" | jq -r .preview.snapshotId)
CONTENT_HASH=$(echo "$PREVIEW" | jq -r .preview.contentHash)
curl -fsS -X POST -H "Authorization: Bearer $RSM_TOKEN" -H "Content-Type: application/json" \
  -d "{\"snapshotId\": \"$SNAPSHOT_ID\", \"contentHash\": \"$CONTENT_HASH\"}" \
  "$RSM_URL/api/projects/$PROJECT_ID/pull"

# Trigger a push from CI (answers 409 when the repository holds a more recent snapshot)
curl -fsS -X POST -H "Authorization: Bearer $RSM_TOKEN" "$RSM_URL/api/projects/$PROJECT_ID/push"
```

A pull answers `409` when the repository latest changed after the preview (`snapshotId` pin) or when the project secrets changed (`SYNC_PREVIEW_STALE`): run the preview again and send the new `snapshotId` and `contentHash`. Snapshot restore (`POST /api/projects/:id/snapshots/:snapshotId/restore`) and discard (`POST /api/projects/:id/discard`) take the same `contentHash`; requests without it keep working (the server captures the current content when the request starts). A restic operation that exceeds its timeout answers `504`.

The `.env` export uses the canonical server serializer (special characters and control characters are escaped, Unicode passes through) and rejects keys that are not valid environment variable names with HTTP `400`; use `?format=json` to export such secrets unchanged. Secret updates through the API (`PUT /api/projects/:id/secrets/:secretId`) must send the `version` returned by a read; a stale version answers `409` with `SECRET_VERSION_CONFLICT`, and `PUT /api/projects/:id/secrets/:secretId/keys` updates a single key without touching the others.

## Sync notifications

restic-secrets-manager can notify the ecosystem notifications server ([notifications](https://github.com/devopsplaybook-io/notifications)) on sync events: push success, pull success, snapshot restore, discard of local changes and push conflict. Set `NOTIFICATIONS_API_ENDPOINT` and `NOTIFICATIONS_API_TOKEN` to enable the integration; it is disabled by default, failures never break a synchronization, and payloads carry project/snapshot/actor information but never secret values. Changes to these settings in `config.json` are applied when the file is reloaded (no server restart needed).

## Configuration

Configuration is provided by environment variables (a `config.json` file next to the server can also be used):

### Configuration reload

`config.json` is watched while the server runs. When the file changes, these settings are applied to running requests **without a restart**:

- `NOTIFICATIONS_API_ENDPOINT` and `NOTIFICATIONS_API_TOKEN` (the notifications client is rebuilt);
- every `RESTIC_TIMEOUT_*` and `RESTIC_KILL_GRACE_MS`;
- `SYNC_STATUS_CACHE_TTL_MS`, `SYNC_STATUS_REQUEST_DEADLINE_MS` and `SYNC_STATUS_MAX_WAITERS`, applied to the next status requests;
- `TMP_DIR`, for restic operations started after the reload (an operation already running keeps its working directory).

The successful reload is logged as `Configuration reloaded: ...`. All other settings are only guaranteed to be applied at startup: `API_PORT`, `TRUST_PROXY`, `CORS_POLICY_ORIGIN`, `DATA_DIR`, `DATABASE_*`, the JWT/auth settings and the OpenTelemetry exporters — restart the server after changing them. Environment variables are only re-read when a file change triggers a reload; prefer a restart after changing them. Each replica watches its own file, so a ConfigMap-based `config.json` update reaches the replicas independently.

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
| `SYNC_STATUS_CACHE_TTL_MS`             | `30000`                  | Freshness window of a project status; stale entries are served while a background refresh runs |
| `SYNC_STATUS_REQUEST_DEADLINE_MS`      | `5000`                   | Deadline of `GET /api/projects/status`; projects not ready in time answer `{error:true}` |
| `SYNC_STATUS_MAX_WAITERS`              | `100`                    | Status requests queued for a run slot before answering HTTP 503 `STATUS_QUEUE_FULL` |
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
- Push is rejected with HTTP 409 when the target repository holds a more recent snapshot, preventing accidental overwrites. The latest snapshot is compared by parsed timestamp, not by string order.
- Secret updates are versioned: a stale write answers HTTP 409 instead of overwriting a concurrent change. Every secret mutation (create, update, delete, copy-key) writes the new project content hash in the same database transaction. Copy-key merges the selected key into a fresh read of the secret under the project write lock, so unrelated concurrent keys are preserved.
- Pull, snapshot restore and discard use a compare-and-swap token: the preview returns the current secrets `contentHash`, the confirmation echoes it, and a mismatch answers HTTP 409 (`SYNC_PREVIEW_STALE`) without changing any secret. Requests without the token remain compatible and capture the current content when they start.
- Project deletion takes the project write lock, so it cannot interleave with a synchronization or with secret writes; the secrets and the project are removed in one transaction.
- The `.env` export only emits portable environment variable names and canonical escaping; secrets with other key names remain available through the JSON export.
- Sessions are short-lived (1 hour) and not renewed; expired sessions require a new login.
- `JWT_KEY`: when set (environment or `config.json`), it is used as the signing key and is never written to the database; when empty, the key is generated once and stored in the database. Changing the configured key (or the database value when unset) invalidates all issued sessions, which is the intended rotation mechanism.

## License

[MIT](./LICENSE)
