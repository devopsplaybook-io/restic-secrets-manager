# User Interface

## Layout

- [x] Single-page application (Nuxt SPA, SSR disabled), installable as a PWA
- [x] Top navigation bar with the application name, links (Projects, API Tokens when authenticated, Users for admins), theme toggle and logout
- [x] Dark and light themes, persisted in localStorage with OS preference fallback

## Pages

- [x] **Login**: sign-in form; first-run detection shows a create-admin-account form
- [x] **Projects** (`/`): grid of project cards showing name, repository target, secret count, last synchronization info and Pull/Push/History actions; admins can create and delete projects
- [x] **Project detail** (`/projects/:id`): list of secrets, secret editor dialog (key/value rows), read-only project settings (sensitive values masked)
- [x] **Users** (`/settings/users`, admin only): user table with role and per-project access; create/edit/delete users
- [x] **API Tokens** (`/settings/tokens`, any authenticated user): table of the personal tokens (name, creation, expiry, last used) with create/revoke actions

## Behavior

- [x] When the session expires or is rejected (HTTP `401`, except a failed login) the user is logged out and redirected to the login page
- [x] A forbidden action (HTTP `403`, e.g. a role or project access revoked in the meantime) shows an inline error and does not log the user out
- [x] A failed login shows a clear error message on the login page without clearing an existing session in other tabs
- [x] Shortly before the session ends (5 minutes or less remaining), a warning banner shows the time left and invites the user to save their work
- [x] After a session-expiry redirect, logging in sends the user back to the page they were working on
- [x] Preserved unsaved edits expire after 15 minutes, are restored only for the user who wrote them and are cleared on logout and after login
- [x] Destructive actions (delete project, delete user, delete secret, revoke API token) ask for confirmation
- [x] A newly created API token is displayed exactly once, with a copy action (no auto-clear) and a warning that it will not be shown again
- [x] Push conflicts (more recent snapshot in the repository) surface a clear error message
- [x] Restic timeout errors (HTTP `504`) and other synchronization errors are shown inline and never log the user out
- [x] All dialogs are modal native `<dialog>` elements (showModal): centered with dimmed backdrop; Esc, backdrop click and Cancel/Close buttons dismiss them
- [x] All dialogs show a visible close (×) icon button in their header
- [x] Dialog and card titles with long names (e.g. "Edit Secret: <name>") wrap instead of overflowing the dialog/card layout

## Home page (Projects)

- [x] A project card shows a badge when secrets were modified locally but not pushed yet, with a Discard action
- [x] The "local changes not pushed" badge is a "Review changes" action: it opens a preview of the diff that discarding would restore (secrets and keys added, changed or removed, values masked), and the Discard action confirms through the same preview
- [x] Discarding the local changes shows a preview of the changes before the last synchronized snapshot is restored, and only executes after confirmation
- [x] The Pull action opens a preview of the changes the pull would apply (values masked) and only executes after confirmation
- [x] The preview displays the exact snapshot that will be applied (short id and time) for pull, discard and snapshot restore; the pull confirmation sends that pinned snapshot id
- [x] When the repository changed between the preview and the confirmation, the pull answers HTTP `409` and the preview dialog shows an inline "repository changed, preview again" error; the confirmation stays disabled until a preview with a pinned snapshot is available
- [x] After the projects load, the UI checks each project for remote changes to pull and shows a badge when the repository holds a more recent snapshot (checking state shown while in progress, degraded to "check failed" on error)
- [x] A History button per project card opens the snapshot history

## Project creation and onboarding

- [x] The create-project dialog has a "Test connection" action that checks the entered settings read-only against the restic repository and shows the outcome inline: the repository is empty (it will be initialized on the first push), the connection succeeds with the number of snapshots found, or the connection failed with a clear error
- [x] The connection test result is cleared when any setting is edited afterwards, and the create actions are disabled while a test or a creation is running
- [x] The connection test shows the server warnings inline: the repository target is already used by another project, and the repository already contains snapshots that cannot be correlated with the project (likely a wrong prefix)
- [x] The create-project dialog has a review step before creation: it summarizes the entered settings (access key ID readable, secret key and restic password masked), shows the resolved repository URL and warns that the settings cannot be changed after creation; Back returns to the form with the values preserved
- [x] Creation errors (duplicate name, duplicate repository target, validation) are shown inside the dialog so the settings can be corrected
- [x] The home page empty state invites admins to create their first project and tells other users to ask an administrator for access
- [x] The secrets list empty state invites the user to add their first secret
- [x] Admins see a dismissible "Getting started" checklist on the home page with three steps mirroring the documentation (create a project, grant users access, sync your secrets); each step shows its completion state, the checklist hides itself once every step is done and the dismissal is remembered in the browser

## Snapshot history

- [x] The snapshot history shows a vertical timeline of the repository snapshots (time and short id, most recent first, latest highlighted)
- [x] Each timeline entry shows who pushed the snapshot: the `pushed-by` attribution, falling back to the user and host reported by restic, or "unknown pusher" for older snapshots
- [x] Each timeline entry offers a Restore action, confirmed before the snapshot replaces the project secrets
- [x] The restore confirmation shows a preview of the changes the restore would apply (values masked) and only executes after confirmation
- [x] The result of a restore is displayed in the history dialog and the project cards are refreshed

## Project detail (secrets)

- [x] A filter field above the secrets table narrows the list by secret name or key name (case-insensitive substring); a "No secrets match the filter." state is shown when nothing matches and opening a filtered secret still shows all its keys
- [x] Each secret row has a "..." action menu (Edit, Duplicate, Rename, Delete) replacing the former inline buttons
- [x] The Duplicate and Rename dialogs prefill `<name>-copy` and the current name respectively, and show validation and duplicate-name errors inline

## Secret editor

- [x] The secret editor dialog offers a Home button to go back to the home page without saving (same behavior as Cancel)
- [x] Each key row has a "..." action menu (Copy to another secret, Remove) replacing the former inline remove button; the reveal toggle stays
- [x] The Copy Key dialog shows the source key and its masked value (with reveal), lists the project's other secrets as targets, prefills the target key name with the source key and warns when the target already holds that key
- [x] Each key row can be toggled between a single-line masked input and a multiline unmasked textarea; pasting a multiline value into a single-line input switches the row to the multiline editor
- [x] Each key row has a copy-value button that copies the value to the clipboard (with feedback and an automatic clipboard clear after 30 seconds)
- [x] In create mode, a collapsible "Import from .env or JSON" block parses pasted content into key/value rows and reports parse errors and duplicate-key warnings inline
- [x] Closing the editor (Cancel, ×, backdrop, Esc), navigating away or closing the tab with unsaved changes asks for a confirmation ("Discard unsaved changes?") before discarding them
- [x] When unsaved edits existed during a session-expiry redirect, reopening the project page offers to restore them (as an edit of the same secret when it still exists, otherwise as a new secret with the name prefilled)
- [x] Restored drafts are loaded as unsaved edits (their baseline is the persisted secret), so closing the editor still asks for confirmation
- [x] Saving a secret sends the version that was read: when the secret was modified by another user meanwhile, the editor reloads it, keeps the edits and shows "modified by another user, review and save again" instead of overwriting; if the secret was deleted, the kept edits become a new secret
- [x] Copying a key to another secret uses the partial key update and retries once after a version conflict: unchanged keys of the target are never overwritten
- [x] Keys that cannot be exported as .env (not matching `[A-Za-z_][A-Za-z0-9_]*`) are flagged with a non-blocking warning in the editor
- [x] Importing .env content rejects invalid environment variable names with the offending line number; JSON import keeps accepting any key
- [x] "Copy as .env" uses the server export (canonical escaping and key validation): invalid keys surface the server explanation, and "Copy as JSON" remains available

Last spec review: 2026-10-22
