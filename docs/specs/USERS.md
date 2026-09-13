# Users

## Authentication

- [x] Users authenticate with username and password, receiving a JWT token
- [x] Sessions last 1 hour (`JWT_VALIDITY_DURATION` defaults to `3600` seconds)
- [x] Sessions are never auto-renewed: the web UI does not refresh or extend tokens; when the token expires the user must log in again
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

Last spec review: 2026-09-13
