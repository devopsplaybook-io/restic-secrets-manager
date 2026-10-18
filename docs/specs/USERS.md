# Users

## Authentication

- [x] Users authenticate with username and password, receiving a JWT token
- [x] Sessions last 1 hour (`JWT_VALIDITY_DURATION` defaults to `3600` seconds)
- [x] Sessions are never auto-renewed: the web UI does not refresh or extend tokens; when the token expires the user must log in again
- [x] Shortly before a session expires (5 minutes or less remaining), the UI warns the user and invites them to save their work
- [x] Unsaved secret editor changes are preserved across a session expiry and can be restored after re-login; the session model itself is unchanged
- [x] First user created becomes admin (first-run initialization)
- [x] Passwords are stored hashed (bcrypt)

## Roles

- [x] Two roles: `admin` and `user`
- [x] Admins can manage users (create, update role/password/access, delete)
- [x] Admins have access to all projects
- [x] At least 1 admin must remain; users cannot delete themselves

## Project access

- [x] Users are granted or denied access per project
- [x] By default, a new user has access to no project
- [x] Access is granted/revoked by admins from the user management UI
- [x] Access changes take effect immediately (authorization is checked against the database, not the token)

## API tokens

- [x] Authenticated users manage their own API tokens (create, list, revoke) from the web UI; admins can additionally revoke any token
- [x] The token plaintext is returned only at creation and shown exactly once in the UI; only a SHA-256 hash is stored
- [x] A token can have an optional expiry date (must be in the future at creation); a token without expiry never expires
- [x] The last successful authentication with a token is tracked (best effort) and shown in the UI
- [x] A token authenticates as its owning user with the user's live role and project scopes (resolved per request, so access or role changes apply immediately)
- [x] The number of API tokens per user is bounded (`API_TOKENS_MAX_PER_USER`)

Last spec review: 2026-10-18
