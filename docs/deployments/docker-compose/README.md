# Deploying with Docker Compose

In the [`restic-secrets-manager`](./restic-secrets-manager) directory, you will find an example of deployment using a [`docker-compose.yaml`](./restic-secrets-manager/docker-compose.yaml) file.

To launch the application in Docker with Docker Compose:

```bash
git clone https://github.com/devopsplaybook-io/restic-secrets-manager
cd restic-secrets-manager/docs/deployments/docker-compose/restic-secrets-manager
docker compose up -d
```

Notes:

- The container exposes the web UI and the API on the same port (`8080` by default).
- The `./data` volume stores the SQLite database.
- Set `JWT_KEY` in production; when not set, a random key is generated and stored in the database at first startup.
- The container includes the `restic` binary; restic repository settings (S3 endpoint, bucket, credentials, repository password) are configured per project from the web UI.
