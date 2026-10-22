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

- **Single replica**: pull/push operations are serialized per project by an
  in-process lock, and the sync status cache is per-instance. Run a single
  replica per database (as the provided manifests do); scaling out would
  need a shared locking mechanism first.
- **Temp files**: restic works in a temporary directory on the container
  filesystem (`TMP_DIR`, default `/tmp`). Working directories are created
  with mode `0700` and the secret files inside with mode `0600`; stale
  `restic-secrets-manager-*` directories older than 24 hours are removed at
  startup. Prefer mounting `TMP_DIR` on a private `tmpfs` (for example
  `--tmpfs /tmp:mode=0700` or an `emptyDir: { medium: Memory }` volume) so
  plaintext never reaches persistent disk. Point `TMP_DIR` at a sized
  volume when the temp space must be bounded or shared independently.
- **Resource limits**: restic work is bounded — sync operations are
  serialized per project and the status cache caps concurrent restic
  checks — so the recommended 500m CPU / 500Mi memory limits
  accommodate typical usage.
- **Security context**: the provided manifests do not set a
  `securityContext`. On hardened clusters, run the container as non-root
  with dropped capabilities (for example `runAsNonRoot: true` and
  `capabilities: drop: ["ALL"]`).
