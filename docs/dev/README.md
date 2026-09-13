# Development

In order to start development on restic-secrets-manager execute the following:

```bash
git clone https://github.com/devopsplaybook-io/restic-secrets-manager
cd restic-secrets-manager
npm run dev
```

Requirements: Node.js 26+, npm, [pm2](https://pm2.keymetrics.io/) and the `restic` CLI (for pull/push).

`npm run dev` (via [`docs/dev/run-dev-env.sh`](./run-dev-env.sh)) installs the dependencies of all components, then starts through pm2:

- the proxy on port `9999` ([`restic-secrets-manager-proxy`](../../restic-secrets-manager-proxy)) — main entry point, routing `/` to the web dev server and `/api/` to the API server
- the server on port `8080` ([`restic-secrets-manager-server`](../../restic-secrets-manager-server))
- the web application on port `3000` ([`restic-secrets-manager-web`](../../restic-secrets-manager-web))

`pm2 logs` streams the combined logs of all three processes.

To rebuild native dependencies (e.g. after a Node.js upgrade):

```bash
npm run dependencies
```

This runs [`docs/dev/run-dev-dependencies-rebuild.sh`](./run-dev-dependencies-rebuild.sh), which refreshes the dependencies of every component.

Verification per component:

```bash
cd restic-secrets-manager-server
npm run build && npm run lint && npm run test

cd ../restic-secrets-manager-web
npm run generate && npm run lint
```
