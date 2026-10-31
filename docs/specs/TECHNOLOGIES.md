# Technologies

## Server

- TypeScript
- Fastify 5 (REST API)
- `@devopsplaybook.io/common-utils` (config, database facade, authentication, users management, OTel context)
- `@fastify/rate-limit` (login and session-refresh throttling, `429` + `Retry-After`)
- `@devopsplaybook.io/otel-utils-fastify` (OpenTelemetry request hooks)
- SQLite via `better-sqlite3` (default) with optional PostgreSQL support; schema migrations (database version 11) include `users.tokenVersion` for session revocation, `secrets.version` for optimistic concurrency and a cascading `secrets.projectId → projects.id` foreign key (SQLite foreign-key enforcement is enabled after the migrations)
- Secret updates use a single conditional `UPDATE ... WHERE version = ?` (version incremented in the same statement), which is atomic on both database types
- `restic` CLI invoked for pull/push operations against S3-compatible repositories, through a `spawn` runner with per-operation timeouts, SIGTERM→SIGKILL escalation and AbortSignal support for client disconnects
- PostgreSQL advisory locks (via the common-utils database facade) serializing synchronization operations per project across replicas and project creation/name-target checks; SQLite deployments stay single-replica
- Jest with `@swc/jest` and `oxlint` for unit tests and linting on the server

## Web

- Nuxt 4 (SPA mode, SSR disabled)
- Pinia for state management
- Pico CSS + Bootstrap Icons
- `@vite-pwa/nuxt` for PWA support
- Axios for API calls, `jwt-decode` for token inspection
- Vitest for unit tests (page logic extracted into tested utilities), ESLint (typescript-eslint) for linting
- CSS Grid preferred for layout

## Proxy (dev only)

- Traefik 3.7.17, downloaded by `restic-secrets-manager-proxy/start.sh` from the pinned GitHub release and verified against the release `sha256` checksum before extraction; Linux `amd64`/`arm64` only
- Dashboard/API bound to `127.0.0.1:9091` (unauthenticated, loopback-only); routes on port `9999`

## Packaging

- Single Docker image (node:26-alpine) including the `restic` binary, serving the API and the generated web assets
- Static assets are served as immutable; the SPA entry files (`index.html`, `sw.js`, `manifest.webmanifest`) are always revalidated so upgrades are picked up without stale-build chunk errors
- GitHub Actions CI reusing the shared devopsplaybook.io workflows: build/lint/test of the server and web apps, the immutable PR-image promotion, and the shared dependency-audit gate (`npm audit --omit=dev`; unallowlisted high/critical production advisories fail, dev-only advisories are reported, accepted exceptions live in `.github/audit-allowlist.json` with an owner and expiry date)
- The application release version is the root `package.json` version: it drives the Docker image tag and is the version the server reports (OpenTelemetry service version) both in development and in the container; `VERSION` still overrides it per `ConfigBase`

Last spec review: 2026-10-31
