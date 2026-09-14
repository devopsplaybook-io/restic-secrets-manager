# User Interface

## Layout

- [x] Single-page application (Nuxt SPA, SSR disabled), installable as a PWA
- [x] Top navigation bar with the application name, links (Projects, Users for admins), theme toggle and logout
- [x] Dark and light themes, persisted in localStorage with OS preference fallback

## Pages

- [x] **Login**: sign-in form; first-run detection shows a create-admin-account form
- [x] **Projects** (`/`): grid of project cards showing name, repository target, secret count, last synchronization info and Pull/Push/History actions; admins can create and delete projects
- [x] **Project detail** (`/projects/:id`): list of secrets, secret editor dialog (key/value rows), read-only project settings (sensitive values masked)
- [x] **Users** (`/settings/users`, admin only): user table with role and per-project access; create/edit/delete users

## Behavior

- [x] When the session expires (1 hour, no renewal), the user is redirected to the login page
- [x] Destructive actions (delete project, delete user, delete secret) ask for confirmation
- [x] Push conflicts (more recent snapshot in the repository) surface a clear error message
- [x] All dialogs are modal native `<dialog>` elements (showModal): centered with dimmed backdrop; Esc, backdrop click and Cancel/Close buttons dismiss them
- [x] All dialogs show a visible close (×) icon button in their header
- [x] Dialog and card titles with long names (e.g. "Edit Secret: <name>") wrap instead of overflowing the dialog/card layout

## Home page (Projects)

- [x] A project card shows a badge when secrets were modified locally but not pushed yet, with a Discard action
- [x] Discarding the local changes asks for confirmation before restoring the last synchronized snapshot
- [x] After the projects load, the UI checks each project for remote changes to pull and shows a badge when the repository holds a more recent snapshot (checking state shown while in progress, degraded to "check failed" on error)
- [x] A History button per project card opens the snapshot history

## Snapshot history

- [x] The snapshot history shows a vertical timeline of the repository snapshots (time and short id, most recent first, latest highlighted)
- [x] Each timeline entry offers a Restore action, confirmed before the snapshot replaces the project secrets
- [x] The result of a restore is displayed in the history dialog and the project cards are refreshed

## Secret editor

- [x] The secret editor dialog offers a Home button to go back to the home page without saving (same behavior as Cancel)

Last spec review: 2026-09-14
