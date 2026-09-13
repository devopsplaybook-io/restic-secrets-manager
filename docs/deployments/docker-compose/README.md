# Docker Compose deployment

Example `docker-compose.yaml`:

```yaml
services:
  restic-secrets-manager:
    image: didierhoarau/restic-secrets-manager:latest
    container_name: restic-secrets-manager
    ports:
      - "8080:8080"
    environment:
      - JWT_KEY=<generate-a-strong-random-key>
    volumes:
      - ./data:/data
    restart: unless-stopped
```

Notes:

- The container exposes the web UI and the API on the same port (`8080` by default).
- The `/data` volume stores the SQLite database.
- Set `JWT_KEY` in production; when not set, a random key is generated and stored in the database at first startup.
- The container includes the `restic` binary; restic repository settings (S3 endpoint, bucket, credentials, repository password) are configured per project from the web UI.
