# Secrets

Each project holds a set of named secrets. A secret is the equivalent of one JSON file in the backed-up folder: a flat map of `KEY = value` entries.

## Secret management

- [x] Secrets are edited from a user-friendly UI (key/value pairs), not by editing raw JSON
- [x] A secret has a name (used as the JSON file name) and a set of key/value entries
- [x] Users with project access can create, update and delete secrets
- [x] Secret values are masked by default in the UI, with a reveal toggle

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

Last spec review: 2026-09-13
