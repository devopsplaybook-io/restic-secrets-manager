# Secrets

Each project holds a set of named secrets. A secret is the equivalent of one JSON file in the backed-up folder: a flat map of `KEY = value` entries.

## Secret management

- [x] Secrets are edited from a user-friendly UI (key/value pairs), not by editing raw JSON
- [x] A secret has a name (used as the JSON file name) and a set of key/value entries
- [x] Users with project access can create, update and delete secrets
- [x] Secret values are masked by default in the UI, with a reveal toggle
- [x] Editing a secret allows updating, adding and removing key/value entries
- [x] Duplicate keys are rejected with an error when saving a secret
- [x] A secret can be duplicated with all its key/value entries under a new name (prefilled with `<name>-copy`)
- [x] A secret can be renamed; the new name follows the creation rules and must be unique within the project (validation and conflict errors shown inline)
- [x] A key/value entry can be copied to another secret of the same project, the target secret and key name being chosen in a dialog (an existing target key is overwritten after an explicit warning)
- [x] The secret list can be filtered by secret name or by key name (case-insensitive); filtering never hides the keys of an opened secret
- [x] A key/value entry can be edited as a multiline value (e.g. certificates, private keys, JSON): a per-row toggle switches to a textarea, and pasting a multiline value into a single-line input switches the row to the multiline editor automatically (multiline values are displayed unmasked)
- [x] A key/value entry can be copied to the clipboard from the editor, with the clipboard cleared automatically 30 seconds after the copy
- [x] A saved secret can be copied to the clipboard as a .env file or as JSON from the secret action menu, with the same 30 seconds clipboard auto-clear
- [x] On secret creation, .env or JSON content can be pasted and imported: it is parsed into key/value rows, replacing the current ones (duplicate keys keep the last value, reported as a warning; parse errors are shown inline)
- [x] Closing the secret editor with unsaved changes (Cancel, ×, backdrop, Esc), leaving the page, or closing the browser tab asks for a confirmation before the edits are discarded
- [x] Unsaved editor changes survive a session expiry: they are preserved before the redirect to the login page and the user is offered to restore them when back on the project page after re-login
- [x] Preserved unsaved edits expire after 15 minutes, are bound to the user who wrote them (never restored for another user) and are cleared on explicit logout and after a successful login
- [x] Secret-bearing API responses (secret list, .env/JSON exports, create and update echoes) are sent with `Cache-Control: no-store`, `Pragma: no-cache` and `Vary: Authorization` so browsers and intermediaries never cache secret material

## Push (backup to restic repository)

- [x] Push serializes the project secrets to JSON files and backs them up to the project's restic repository
- [x] The repository is initialized automatically on first push if needed
- [x] Before pushing, the application checks whether the repository contains a more recent snapshot than the last one synchronized by this project
- [x] Push is rejected with a conflict error when a more recent snapshot exists (the user must pull first)
- [x] After a successful push, the project records the snapshot created by its own backup — the `snapshot_id` of the `restic backup --json` summary and its exact metadata time — never the repository latest (which may belong to another writer); a backup whose created snapshot cannot be identified fails without updating the sync state
- [x] The pushed snapshot is tagged with the pushing user (restic tag `pushed-by:<user>`)

## Pull (restore from restic repository)

- [x] Pull restores exactly the snapshot pinned by its preview (not "latest", resolved again) and replaces the project secrets with its content
- [x] A pull requires the previewed snapshot id: missing or empty ids are rejected with HTTP 400
- [x] When the repository gained a newer snapshot after the preview, the pull is rejected with HTTP 409 asking to preview again, and no secret is replaced
- [x] After a successful pull, the project records the pinned snapshot id and the time from the same snapshot listing
- [x] Pull fails with a clear error when the repository is empty
- [x] A pull can be previewed before it is confirmed: the server computes the diff between the current project secrets and the latest snapshot content (secrets and keys added, changed or removed); no secret value is ever sent to the client, only statuses and value lengths
- [x] The pull preview lists the repository snapshots exactly once and returns the `snapshotId`/`snapshotTime` it diffed, which the execution must send back as the pin

## Local changes detection

- [x] The project records, at every synchronization (push, pull, restore), a hash of the synchronized secrets content
- [x] A project is reported as having local changes not pushed when its current secrets differ from the last synchronized content
- [x] A project that was never synchronized and holds at least one secret is reported as having local changes not pushed
- [x] Projects synchronized before content-hash tracking was introduced report no local changes until the next push or pull records the baseline hash
- [x] Discarding local changes can be previewed before it is confirmed: the server computes the diff between the current project secrets and the content of the last synchronized snapshot (409 when never synchronized, 404 when that snapshot no longer exists); no secret value is ever sent to the client

## Snapshot status and history

- [x] The UI can request, per project, whether the restic repository holds remote changes to pull (a check against the repository snapshots)
- [x] The UI can list the snapshot history of a project repository (id and time, most recent first)
- [x] Any snapshot of the history can be restored as the project secrets, after an explicit confirmation
- [x] Restoring a snapshot replaces the project secrets and records the restored snapshot as the last synchronized state
- [x] A snapshot restore can be previewed before it is confirmed: the server computes the diff between the current project secrets and the content of that snapshot (404 for an unknown snapshot); no secret value is ever sent to the client
- [x] Local changes that were not pushed can be discarded: the last synchronized snapshot is restored, after an explicit confirmation
- [x] Discarding is rejected when the project was never synchronized (there is nothing to restore)
- [x] Snapshot history entries carry the pusher attribution: the `pushed-by:` restic tag when present, falling back to the user and host reported by restic; older snapshots carry no attribution
- [x] Restic synchronization failures surface richer error context: the last 10 output lines, capped at 1000 characters (credentials never appear, they are passed via environment variables)
- [x] Every restic invocation (snapshots, restore, backup, init, connection test) is bounded by a configurable timeout (`RESTIC_TIMEOUT_*`, defaults 30 s / 5 min / 10 min / 60 s / 30 s); on expiry the process receives SIGTERM then SIGKILL after `RESTIC_KILL_GRACE_MS`, the API answers HTTP 504 and the project lock and status-cache slot are released
- [x] A client disconnect aborts the restic process of its operation (SIGTERM/SIGKILL) so no orphan process survives; shared status checks are bounded by the snapshots timeout instead
- [x] Synchronization operations (pull, push, restore, discard and previews) are serialized per project across replicas with a PostgreSQL advisory lock in addition to the in-process queue; SQLite deployments remain single-replica
- [x] Temporary restic working directories are created with mode `0700` and the secret files inside with mode `0600`; stale `restic-secrets-manager-*` directories older than 24 hours are removed at startup (a private tmpfs `TMP_DIR` is recommended so plaintext never reaches persistent disk)

## Programmatic access

- [x] A secret can be exported by name through a read-only API endpoint returning a .env file (default) or JSON (`?format=json`); project access is required
- [x] A programmatic pull first calls `GET /api/projects/:id/preview/pull` and then posts the returned `snapshotId` to `POST /api/projects/:id/pull`; a repository change in between answers 409 with a "preview again" message
- [x] Sync events (push, pull, snapshot restore, discard of local changes, push conflict) emit a notification through the ecosystem notifications server when the integration is configured (`NOTIFICATIONS_API_ENDPOINT` / `NOTIFICATIONS_API_TOKEN`, disabled by default)
- [x] Notification failures never fail the synchronization and notification payloads never contain secret values

Last spec review: 2026-10-22
