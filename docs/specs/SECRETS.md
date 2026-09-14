# Secrets

Each project holds a set of named secrets. A secret is the equivalent of one JSON file in the backed-up folder: a flat map of `KEY = value` entries.

## Secret management

- [x] Secrets are edited from a user-friendly UI (key/value pairs), not by editing raw JSON
- [x] A secret has a name (used as the JSON file name) and a set of key/value entries
- [x] Users with project access can create, update and delete secrets
- [x] Secret values are masked by default in the UI, with a reveal toggle
- [x] Editing a secret allows updating, adding and removing key/value entries
- [x] Duplicate keys are rejected with an error when saving a secret

## Push (backup to restic repository)

- [x] Push serializes the project secrets to JSON files and backs them up to the project's restic repository
- [x] The repository is initialized automatically on first push if needed
- [x] Before pushing, the application checks whether the repository contains a more recent snapshot than the last one synchronized by this project
- [x] Push is rejected with a conflict error when a more recent snapshot exists (the user must pull first)
- [x] After a successful push, the project records the new snapshot id and time

## Pull (restore from restic repository)

- [x] Pull restores the latest snapshot and replaces the project secrets with its content
- [x] After a successful pull, the project records the snapshot id and time
- [x] Pull fails with a clear error when the repository is empty

## Local changes detection

- [x] The project records, at every synchronization (push, pull, restore), a hash of the synchronized secrets content
- [x] A project is reported as having local changes not pushed when its current secrets differ from the last synchronized content
- [x] A project that was never synchronized and holds at least one secret is reported as having local changes not pushed
- [x] Projects synchronized before content-hash tracking was introduced report no local changes until the next push or pull records the baseline hash

## Snapshot status and history

- [x] The UI can request, per project, whether the restic repository holds remote changes to pull (a check against the repository snapshots)
- [x] The UI can list the snapshot history of a project repository (id and time, most recent first)
- [x] Any snapshot of the history can be restored as the project secrets, after an explicit confirmation
- [x] Restoring a snapshot replaces the project secrets and records the restored snapshot as the last synchronized state
- [x] Local changes that were not pushed can be discarded: the last synchronized snapshot is restored, after an explicit confirmation
- [x] Discarding is rejected when the project was never synchronized (there is nothing to restore)

Last spec review: 2026-09-14
