# Deployments

restic-secrets-manager can be deployed with Docker images.

Examples of deployments are provided for

- [docker-compose](docker-compose)
- [kubernetes](kubernetes)

The Kubernetes section also includes a combined deployment of restic-secrets-manager together with [kubernetes-secrets-cloud-sync](https://github.com/devopsplaybook-io/kubernetes-secrets-cloud-sync), to sync the managed secrets into Kubernetes namespaces:

- [kubernetes/restic-secrets-manager-with-cloud-sync](kubernetes/restic-secrets-manager-with-cloud-sync)

## CORS

The web UI is served by the same container as the API, so no CORS
configuration is needed by default (the shipped `CORS_POLICY_ORIGIN`
default is empty, which disables CORS). Set `CORS_POLICY_ORIGIN` to an
explicit origin only when the API must be called from a different origin
(for example a separate web deployment); wildcard values are not
recommended for a secrets manager.

## JWT signing key

`JWT_KEY` is optional. When it is empty (as in the provided Compose and
Kubernetes examples), the application generates a key once and stores it in
the database (`metadata.auth_token`). When it is set, the configured value
takes precedence and is never written to the database. Changing the key —
whether the configured value or the stored one — invalidates every issued
session, so plan rotations accordingly; clients simply log in again.

## Authentication and rate limiting

Login (`POST /api/users/session`) is rate limited per client IP and
username, and session refresh per client IP (`AUTH_RATE_LIMIT_LOGIN_MAX`,
`AUTH_RATE_LIMIT_REFRESH_MAX`, `AUTH_RATE_LIMIT_WINDOW_SECONDS`; defaults
10, 60 and 60). Exceeding a limit answers `429` with `Retry-After`.

When the application runs behind a reverse proxy or ingress, set
`TRUST_PROXY=true` so rate limiting and audit logs see the real client IP
instead of the proxy address. Make sure the proxy strips or overwrites
client-supplied `X-Forwarded-For` headers.

## Deployment notes

- **Version**: the Docker image tag and the version the server reports
  (OpenTelemetry service) come from the root `package.json`. The server
  reads the root manifest both in development and in the container (the
  Dockerfile copies it next to `dist`), so both report the same version;
  `VERSION` overrides it when explicitly set.

- **Replicas and locking**: pull/push/restore/discard and previews are
  serialized per project by an in-process queue plus, with
  `DATABASE_TYPE=postgres`, a PostgreSQL advisory lock held on a dedicated
  pool connection during the restic work. Multiple replicas can therefore
  share one PostgreSQL database and the same restic repositories. With the
  default SQLite setup the database is a single file: run exactly one
  replica. The sync status cache stays per-instance either way.
- **Project access scopes across replicas**: every replica keeps the list of
  known project scopes (`project:<id>`) in memory because the shared user
  routes validate submitted scopes against it. The list is refreshed every
  30 seconds and immediately after the replica creates or deletes a project,
  so a project created or deleted on another replica is reflected within
  that window. Within the window, an admin user create/update handled by a
  stale replica can silently drop a newly granted project scope (or re-add a
  just-deleted, inert one): wait for the window after a cross-replica
  project change before editing user scopes, and re-add a dropped grant.
  SQLite single-replica deployments are not affected. The long-term fix is a
  database-backed scope provider in `@devopsplaybook.io/common-utils`.
- **Restic timeouts**: every restic invocation is bounded
  (`RESTIC_TIMEOUT_SNAPSHOTS_MS` 30 s, `RESTIC_TIMEOUT_RESTORE_MS` 5 min,
  `RESTIC_TIMEOUT_BACKUP_MS` 10 min, `RESTIC_TIMEOUT_INIT_MS` 60 s,
  `RESTIC_TIMEOUT_CONNECTION_TEST_MS` 30 s). On expiry the process receives
  SIGTERM, then SIGKILL after `RESTIC_KILL_GRACE_MS` (default 5 s); the API
  answers `504` and the project lock is released. A client disconnect
  aborts its operation (answer `499` when the response can still be sent).
  Status and snapshot-history reads use the same mechanism. Snapshot
  listings are additionally capped at 10 MB of output and fail explicitly
  instead of returning truncated data.
- **Status endpoint bounds**: `GET /api/projects/status` answers within
  `SYNC_STATUS_REQUEST_DEADLINE_MS` (default 5 s): projects whose status is
  not ready are returned with `{error:true}`. Results stay fresh for
  `SYNC_STATUS_CACHE_TTL_MS` (default 30 s) and stale entries are served
  while one background refresh runs; at most three status runs execute at a
  time and at most `SYNC_STATUS_MAX_WAITERS` (default 100) requests wait for
  a slot before the API answers `503 STATUS_QUEUE_FULL`.
- **Snapshot history paging**: `GET /api/projects/:id/snapshots` returns
  `limit` snapshots (default 50, maximum 200) and a `before` cursor. restic
  has no native pagination, so each page parses the full listing (within the
  10 MB cap); very large histories therefore still cost one listing per
  page — clients normally fetch pages one after the other.
- **Temp files**: restic works in a temporary directory on the container
  filesystem (`TMP_DIR`, default `/tmp`). Working directories are created
  with mode `0700` and the secret files inside with mode `0600`; stale
  `restic-secrets-manager-*` directories older than 24 hours are removed at
  startup. Prefer mounting `TMP_DIR` on a private `tmpfs` (for example
  `--tmpfs /tmp:mode=0700` or an `emptyDir: { medium: Memory }` volume) so
  plaintext never reaches persistent disk. Point `TMP_DIR` at a sized
  volume when the temp space must be bounded or shared independently.
- **Resource limits**: restic work is bounded — sync operations are
  serialized per project, every invocation has a timeout, the status cache
  limits concurrent restic checks and caps queued waiters, and snapshot
  listings are capped at 10 MB — so the recommended 500m CPU / 500Mi memory
  limits accommodate typical usage.
- **Security context**: the provided manifests do not set a
  `securityContext`. On hardened clusters, run the container as non-root
  with dropped capabilities (for example `runAsNonRoot: true` and
  `capabilities: drop: ["ALL"]`).
