# restic-secrets-manager — Agent Instructions

## Specifications

### Spec files are the source of truth

Specifications are defined in [docs/specs/](docs/specs/). Each spec file embeds its own implementation status using inline markers:

- `[x]` = Implemented
- `[~]` = Partially implemented
- `[ ]` = Not yet implemented
- `[NEEDS CLARIFICATION: ...]` = Ambiguity that needs user input before proceeding

When starting any development task, read all spec files first. Items marked `[ ]` are what needs to be built. Items marked `[x]` are already done. Items marked `[NEEDS CLARIFICATION]` signal incomplete requirements that need user input before proceeding.

### Development workflow

#### Before starting

1. Read all spec files in `docs/specs/`
2. Identify items marked `[ ]` — these are what needs to be built
3. Identify items marked `[~]` — these are partially implemented, check what remains
4. Identify any `[NEEDS CLARIFICATION: ...]` markers — flag these to the user before proceeding
5. Review items marked `[x]` for context on existing patterns

#### During implementation

1. Build features exactly matching spec requirements
2. For each ambiguity encountered, use `[NEEDS CLARIFICATION]` to flag it rather than guessing
3. Follow existing patterns from what is already marked `[x]`

#### After implementation

1. Change `[ ]` to `[x]` (or `[~]` for partial implementation)
2. Update the "Last spec review" date in the footer to the current date
3. Run automated checks (tests, build, lint) — see Post-Change Validation for project-specific commands
4. Verify the implementation against the relevant spec file

### Anti-patterns awareness

- **Specification Theater**: Specs must be living documents actively used in the workflow, not static documents no one references
- **Spec-Implementation Drift**: Always update markers immediately after implementation to keep specs and code aligned
- **Implementation Detail Leakage**: Specs focus on WHAT users need, not HOW to implement it
- **Speculative Features**: Only implement what is specified

## Project Structure

```
restic-secrets-manager/
  restic-secrets-manager-proxy/       # Traefik reverse proxy (routing, dev only)
  restic-secrets-manager-server/      # Fastify API server (TypeScript)
    src/                              # TypeScript source
    config.json                       # Server configuration
    sql/                              # SQL migrations (sqlite + postgres)
  restic-secrets-manager-web/         # Nuxt SPA frontend
  docs/
    dev/                              # Development scripts
    deployments/                      # Deployment examples
    specs/                            # Application specifications (with inline [x]/[ ] status markers)
```

## Coding Conventions

### Server (`restic-secrets-manager-server/`)

- **Language**: TypeScript
- **Framework**: Fastify
- **Database**: SQLite via `better-sqlite3` (with optional PostgreSQL support)
- **Libraries**: `@devopsplaybook.io/common-utils`, `@devopsplaybook.io/otel-utils-fastify`
- **Build**: `tsc` (compiles `src/` to `dist/`)
- **Dev mode**: `ts-node-dev` (hot-reload)
- **Tests**: Jest with `ts-jest`, files named `*.spec.ts` alongside source
- **Linting**: ESLint with `typescript-eslint`
- **Config**: Loaded from `config.json`, overridable via environment variables (`ConfigBase`)
- **Sessions**: JWT validity is 1 hour by default and sessions are never auto-renewed
- **Secrets handling**: restic credentials are per-project settings; never log sensitive values

### Web (`restic-secrets-manager-web/`)

- **Framework**: Nuxt 4 (SSR disabled, SPA mode)
- **State management**: Pinia stores in `stores/` directory
- **UI library**: `@picocss/pico` for base styling, `bootstrap-icons` for icons
- **Layout preference**: **CSS Grid is strongly preferred over Flexbox** for UI layout. Use `display: grid` with `grid-template-columns`, `grid-template-areas`, etc. for page layouts, card arrangements, form sections, and any multi-column/multi-row composition. Reserve `display: flex` for simple one-dimensional alignments (e.g., centering content, inline button rows, single-axis item lists with `align-items`/`justify-content`).
- **PWA**: Enabled via `@vite-pwa/nuxt`, manifest configured in `nuxt.config.ts`
- **API calls**: Axios for HTTP requests to the backend API
- **Generating**: `nuxt generate` produces static output in `.output/public/`

### Proxy (`restic-secrets-manager-proxy/`)

- **Traefik v2.9.6** for local development reverse proxy
- Routes: web UI on port 3000, API on port 8080, proxy listens on port 9999
- Only used in development; production uses the all-in-one container

### Docker

- Multi-stage build: builder stage compiles server + generates web, runtime stage uses `node:26-alpine`
- Runtime image includes the `restic` binary
- Single container serves both API and static web files
- Application title ("Restic Secrets Manager") is hardcoded in `restic-secrets-manager-web/nuxt.config.ts` (browser tab and PWA manifest)

## CI/CD

GitHub Actions workflows are defined in `.github/workflows/`, reusing shared workflows from `devopsplaybook-io/common-utils`:

- **`main-build.yml`**: On push to `main`. Runs `npm run build`, `npm run lint`, `npm run test` on `restic-secrets-manager-server`, then builds & pushes multi-arch Docker image to Docker Hub.
- **`pr-check.yml`**: On PR to `main`. Runs `npm run build`, `npm run lint`, `npm run test` on `restic-secrets-manager-server`, then builds & pushes a `beta` Docker image.

Secrets required in GitHub repository:

- `DOCKER_HUB_USERNAME` - Docker Hub username
- `DOCKER_HUB_ACCESS_TOKEN` - Docker Hub access token
- `QUALITY_DASHBOARD_URL` - Quality Dashboard URL (optional)
- `QUALITY_DASHBOARD_TOKEN` - Quality Dashboard token (optional)

## Post-Change Validation

Refer to the **After implementation** workflow above for the standard validation sequence. The project-specific commands for running checks are:

- **Server update**: Run `npm run test`, `npm run build`, and `npm run lint` in `restic-secrets-manager-server/`. Also update unit tests: remove unused tests and add new coverage for new code.
- **Web update**: Run `npm run build` (or `npm run generate`) in `restic-secrets-manager-web/`
