# User Interface

## Layout

- [x] Single-page application (Nuxt SPA, SSR disabled), installable as a PWA
- [x] Top navigation bar with the application name, links (Projects, Users for admins), theme toggle and logout
- [x] Dark and light themes, persisted in localStorage with OS preference fallback

## Pages

- [x] **Login**: sign-in form; first-run detection shows a create-admin-account form
- [x] **Projects** (`/`): grid of project cards showing name, repository target, secret count, last synchronization info and Pull/Push actions; admins can create and delete projects
- [x] **Project detail** (`/projects/:id`): list of secrets, secret editor dialog (key/value rows), read-only project settings (sensitive values masked)
- [x] **Users** (`/settings/users`, admin only): user table with role and per-project access; create/edit/delete users

## Behavior

- [x] When the session expires (1 hour, no renewal), the user is redirected to the login page
- [x] Destructive actions (delete project, delete user, delete secret) ask for confirmation
- [x] Push conflicts (more recent snapshot in the repository) surface a clear error message
- [x] All dialogs are modal native `<dialog>` elements (showModal): centered with dimmed backdrop; Esc, backdrop click and Cancel/Close buttons dismiss them

Last spec review: 2026-09-13
