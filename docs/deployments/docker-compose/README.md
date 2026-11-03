# Deploying with Docker Compose

In the [`restic-secrets-manager`](./restic-secrets-manager) directory, you will find an example of deployment using a [`docker-compose.yaml`](./restic-secrets-manager/docker-compose.yaml) file.

To launch the application in Docker with Docker Compose:

```bash
git clone https://github.com/devopsplaybook-io/restic-secrets-manager
cd restic-secrets-manager/docs/deployments/docker-compose/restic-secrets-manager
# The container runs as uid/gid 10001: the bind-mounted data directory must
# be writable by that user (run once, before the first start).
mkdir -p data && sudo chown -R 10001:10001 data
docker compose up -d
```

Notes:

- The container exposes the web UI and the API on the same port (`8080` by default).
- The `./data` volume stores the SQLite database. It must be writable by uid/gid `10001` (see the `chown` above); using a different `user:` in the compose file also requires matching the ownership.
- The container is hardened: it runs as the non-root user `10001`, with a read-only root filesystem, all capabilities dropped, `no-new-privileges` and a memory-backed `/tmp` tmpfs (`TMP_DIR` and the restic cache). Set `RESTIC_CACHE_DIR`/`TMP_DIR` only if you mount another writable volume.
- `JWT_KEY` is optional: set it (`JWT_KEY=... docker compose up -d`) to manage the signing key yourself; when empty, a random key is generated once and stored in the database. Changing the key invalidates all issued sessions.
- `TRUST_PROXY` stays `false` by default. Set `TRUST_PROXY=true` only when the container sits behind a trusted reverse proxy that **overwrites** client-supplied `X-Forwarded-For`; otherwise clients can spoof their IP and bypass the login rate limiting.
- The container includes the `restic` binary; restic repository settings (S3 endpoint, bucket, credentials, repository password) are configured per project from the web UI.
