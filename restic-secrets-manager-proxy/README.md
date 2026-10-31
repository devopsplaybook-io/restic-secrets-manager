# restic-secrets-manager-proxy

Development-only [Traefik](https://traefik.io) reverse proxy: routes `/` to the
Nuxt dev server (`localhost:3000`) and `/api/` to the Fastify server
(`localhost:8080`). Production uses the single all-in-one container instead;
this proxy is never deployed.

Started by `npm run dev` through pm2 (`ecosystem.config.js`), listening on
port `9999` ([`traefik-rules.yml`](./traefik-rules.yml)).

## Pinned version and checksum

`start.sh` pins **Traefik 3.7.17** (current stable 3.x) and downloads the
official GitHub release archive on first run:

- Platform: Linux only, `amd64` or `arm64` (the script fails with an explicit
  message otherwise; use WSL2 on Windows).
- The archive is verified against `traefik_v3.7.17_checksums.txt` from the same
  release with `sha256sum -c` **before** it is extracted.
- Binaries live in `bin/` (git-ignored), stamped with `bin/.traefik-version`.

## Dashboard

The Traefik API/dashboard is served at `http://127.0.0.1:9091/dashboard/`. It
is **unauthenticated** and therefore bound to the loopback interface only:
other hosts on the network cannot reach it. Do not change the binding without
adding authentication.

## Upgrade

1. Change `TRAEFIK_VERSION` in [`start.sh`](./start.sh) to the new release.
2. Update this README and `docs/specs/TECHNOLOGIES.md`.
3. Re-run `npm run dev`: the version stamp mismatch triggers a fresh,
   checksum-verified download.

## Clean reinstall

```bash
rm -rf restic-secrets-manager-proxy/bin
```

The next start downloads and verifies the pinned release again.
