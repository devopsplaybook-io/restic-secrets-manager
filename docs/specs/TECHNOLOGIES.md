# Technologies

## Server

- TypeScript
- Fastify 5 (REST API)
- `@devopsplaybook.io/common-utils` (config, database facade, authentication, users management, OTel context)
- `@devopsplaybook.io/otel-utils-fastify` (OpenTelemetry request hooks)
- SQLite via `better-sqlite3` (default) with optional PostgreSQL support
- `restic` CLI invoked for pull/push operations against S3-compatible repositories
- Jest + ts-jest for unit tests, ESLint (typescript-eslint) for linting

## Web

- Nuxt 4 (SPA mode, SSR disabled)
- Pinia for state management
- Pico CSS + Bootstrap Icons
- `@vite-pwa/nuxt` for PWA support
- Axios for API calls, `jwt-decode` for token inspection
- CSS Grid preferred for layout

## Proxy (dev only)

- Traefik v2.9.6

## Packaging

- Single Docker image (node:26-alpine) including the `restic` binary, serving the API and the generated web assets
- GitHub Actions CI reusing the shared devopsplaybook.io workflows

Last spec review: 2026-09-13
