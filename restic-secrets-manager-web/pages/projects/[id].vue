<template>
  <div v-if="project">
    <div class="page-header">
      <div>
        <h1><i class="bi bi-box-seam"/> {{ project.name }}</h1>
        <small class="text-muted">{{ project.description || "No description" }}</small>
      </div>
      <button @click="openCreateSecret">
        <i class="bi bi-plus-lg"/> Add Secret
      </button>
    </div>

    <div v-if="error" class="error-message">{{ error }}</div>

    <template v-if="secrets.length > 0">
      <div class="secrets-filter">
        <i class="bi bi-search"/>
        <input
          v-model="filter"
          type="text"
          placeholder="Filter secrets by name or key…"
          aria-label="Filter secrets by name or key"
        >
        <button
          v-if="filter"
          type="button"
          class="icon-btn"
          title="Clear filter"
          @click="filter = ''"
        >
          <i class="bi bi-x-lg"/>
        </button>
      </div>
      <figure v-if="filteredSecrets.length > 0">
        <table>
          <thead>
            <tr>
              <th>Secret</th>
              <th>Keys</th>
              <th>Updated</th>
              <th class="col-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="secret in filteredSecrets" :key="secret.id">
              <td><i class="bi bi-key"/> {{ secret.name }}</td>
              <td>{{ Object.keys(secret.data).length }}</td>
              <td class="text-muted">{{ formatTime(secret.dateUpdated) }}</td>
              <td class="col-actions">
                <ActionMenu
                  :items="secretMenuItems"
                  :title="`Actions for ${secret.name}`"
                  @select="onSecretAction(secret, $event)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </figure>
      <div v-else class="empty-state">
        <i class="bi bi-search"/>
        <p>No secrets match the filter.</p>
      </div>
    </template>
    <div v-else class="empty-state">
      <i class="bi bi-key"/>
      <p>No secrets in this project yet.</p>
      <button @click="openCreateSecret">
        <i class="bi bi-plus-lg"/> Add your first secret
      </button>
    </div>

    <h3>Repository Settings</h3>
    <article class="settings-card">
      <div class="settings-grid">
        <div><small class="text-muted">Repository URL</small><div class="mono">{{ project.repositoryUrl }}</div></div>
        <div><small class="text-muted">S3 Endpoint</small><div>{{ project.s3Endpoint }}</div></div>
        <div><small class="text-muted">S3 Bucket</small><div>{{ project.s3Bucket }}</div></div>
        <div><small class="text-muted">Repository Prefix</small><div>{{ project.repoPrefix }}</div></div>
        <div v-if="project.s3Region"><small class="text-muted">S3 Region</small><div>{{ project.s3Region }}</div></div>
        <div><small class="text-muted">S3 Bucket Lookup</small><div>{{ project.s3BucketLookup }}</div></div>
        <div><small class="text-muted">Last Synchronized</small><div>{{ project.lastSyncSnapshotTime ? formatTime(project.lastSyncSnapshotTime) : "Never" }}</div></div>
      </div>
      <small class="text-muted">
        <i class="bi bi-shield-lock"/> Credentials (access key, secret key and
        restic password) are stored in the project and are never displayed.
      </small>
    </article>
    <!-- SECRET EDITOR MODAL -->
    <dialog v-if="showSecretModal" ref="secret-editor" @click.self="requestCloseSecretModal" @cancel="onSecretModalCancel" @close="onSecretModalClosed">
      <article class="secret-editor">
        <header>
          <button aria-label="Close" class="close-btn" @click="requestCloseSecretModal"><i class="bi bi-x-lg"/></button>
          <h3>
            <i class="bi bi-key"/>
            {{ editingSecret ? `Edit Secret: ${editingSecret.name}` : "Add Secret" }}
          </h3>
        </header>

        <label v-if="!editingSecret">
          Secret Name
          <input v-model="secretForm.name" type="text" placeholder="e.g. api-keys" required >
          <small class="text-muted">Letters, digits, '.', '_' and '-' only. It is the JSON file name in the repository.</small>
        </label>

        <fieldset v-if="secretForm.name || editingSecret">
          <legend>
            Key / Value Pairs
            <small class="text-muted">(values are edited as plain text, never as raw JSON)</small>
          </legend>
          <div v-for="(row, index) in secretForm.rows" :key="index" class="key-value-row" :class="{ 'key-value-row--multiline': multilineRows.has(index) }">
            <input
              v-model="row.key"
              type="text"
              placeholder="KEY"
            >
            <div class="value-input">
              <textarea
                v-if="multilineRows.has(index)"
                v-model="row.value"
                rows="3"
                class="multiline-value"
                aria-label="Value (multiline)"
              />
              <input
                v-else
                v-model="row.value"
                :type="revealedRows.has(index) ? 'text' : 'password'"
                placeholder="value"
                @paste="onValuePaste($event, index)"
              >
              <button
                v-if="!multilineRows.has(index)"
                type="button"
                class="icon-btn reveal-btn"
                :title="revealedRows.has(index) ? 'Hide value' : 'Reveal value'"
                @click="toggleReveal(index)"
              >
                <i class="bi" :class="revealedRows.has(index) ? 'bi-eye-slash' : 'bi-eye'"/>
              </button>
              <button
                type="button"
                class="icon-btn"
                :title="multilineRows.has(index) ? 'Switch to single-line value' : 'Switch to multiline value'"
                aria-label="Toggle multiline value"
                @click="toggleMultiline(index)"
              >
                <i class="bi bi-card-text"/>
              </button>
              <button
                type="button"
                class="icon-btn"
                :disabled="row.value.length === 0"
                :title="copiedRows.has(index) ? 'Copied' : 'Copy value (cleared from the clipboard after 30 s)'"
                aria-label="Copy value"
                @click="copyRowValue(index)"
              >
                <i class="bi" :class="copiedRows.has(index) ? 'bi-clipboard-check' : 'bi-clipboard'"/>
              </button>
            </div>
            <ActionMenu
              :items="keyMenuItems"
              :title="`Actions for key ${row.key || index + 1}`"
              @select="onKeyAction(index, $event)"
            />
          </div>
          <div>
            <button type="button" class="secondary" @click="addRow">
              <i class="bi bi-plus-lg"/> Add Key / Value
            </button>
          </div>
        </fieldset>

        <details v-if="!editingSecret" class="import-block">
          <summary><i class="bi bi-box-arrow-in-down"/> Import from .env or JSON</summary>
          <label>
            Paste .env or JSON content
            <textarea
              v-model="importText"
              rows="5"
              placeholder="KEY=value lines or a flat JSON object"
            />
          </label>
          <div v-if="importError" class="error-message">{{ importError }}</div>
          <div v-if="importWarnings.length > 0" class="warning-message">
            <div v-for="warning in importWarnings" :key="warning">
              <i class="bi bi-exclamation-triangle-fill"/> {{ warning }}
            </div>
          </div>
          <div class="import-actions">
            <button type="button" class="secondary" @click="importSecretRows">
              <i class="bi bi-box-arrow-in-down"/> Import
            </button>
            <small class="text-muted">Replaces the current key/value rows; duplicate keys keep the last value.</small>
          </div>
        </details>

        <div v-if="secretError" class="error-message">{{ secretError }}</div>

        <footer class="dialog-footer">
          <button class="secondary footer-home" @click="backToHome">
            <i class="bi bi-house"/> Home
          </button>
          <button class="secondary" @click="requestCloseSecretModal">Cancel</button>
          <button :disabled="savingSecret" @click="saveSecret">
            {{ savingSecret ? "Saving…" : "Save" }}
          </button>
        </footer>
      </article>
    </dialog>

    <!-- DELETE CONFIRM MODAL -->
    <dialog v-if="showDeleteConfirm" ref="delete-confirm" @click.self="deleteModal.close()" @close="onDeleteModalClosed">
      <article>
        <header>
          <button aria-label="Close" class="close-btn" @click="deleteModal.close()"><i class="bi bi-x-lg"/></button>
          <h3><i class="bi bi-exclamation-triangle-fill"/> Delete Secret</h3>
        </header>
        <p>
          Are you sure you want to delete secret
          <strong>{{ deleteTarget?.name }}</strong
          >?
        </p>
        <p>This action cannot be undone (until the next pull restores it).</p>
        <footer>
          <button class="secondary" @click="deleteModal.close()">Cancel</button>
          <button class="contrast" :disabled="deleting" @click="executeDelete">
            {{ deleting ? "Deleting…" : "Delete" }}
          </button>
        </footer>
      </article>
    </dialog>

    <!-- DUPLICATE SECRET MODAL -->
    <dialog v-if="showDuplicateModal" ref="duplicate-secret" @click.self="duplicateModal.close()" @close="onDuplicateModalClosed">
      <article>
        <header>
          <button aria-label="Close" class="close-btn" @click="duplicateModal.close()"><i class="bi bi-x-lg"/></button>
          <h3><i class="bi bi-copy"/> Duplicate Secret</h3>
        </header>
        <p>
          Duplicate secret <strong>{{ duplicateTarget?.name }}</strong> with
          all its key/value entries.
        </p>
        <label>
          New name
          <input v-model="duplicateName" type="text" placeholder="e.g. api-keys-copy" required >
          <small class="text-muted">Letters, digits, '.', '_' and '-' only. It is the JSON file name in the repository.</small>
        </label>
        <div v-if="duplicateError" class="error-message">{{ duplicateError }}</div>
        <footer>
          <button class="secondary" @click="duplicateModal.close()">Cancel</button>
          <button :disabled="duplicating" @click="executeDuplicate">
            {{ duplicating ? "Duplicating…" : "Duplicate" }}
          </button>
        </footer>
      </article>
    </dialog>

    <!-- RENAME SECRET MODAL -->
    <dialog v-if="showRenameModal" ref="rename-secret" @click.self="renameModal.close()" @close="onRenameModalClosed">
      <article>
        <header>
          <button aria-label="Close" class="close-btn" @click="renameModal.close()"><i class="bi bi-x-lg"/></button>
          <h3><i class="bi bi-input-cursor-text"/> Rename Secret</h3>
        </header>
        <p>
          Rename secret <strong>{{ renameTarget?.name }}</strong>.
        </p>
        <label>
          New name
          <input v-model="renameName" type="text" required >
          <small class="text-muted">Letters, digits, '.', '_' and '-' only. It is the JSON file name in the repository.</small>
        </label>
        <div v-if="renameError" class="error-message">{{ renameError }}</div>
        <footer>
          <button class="secondary" @click="renameModal.close()">Cancel</button>
          <button :disabled="renaming" @click="executeRename">
            {{ renaming ? "Renaming…" : "Rename" }}
          </button>
        </footer>
      </article>
    </dialog>

    <!-- COPY KEY MODAL -->
    <dialog v-if="showCopyKeyModal" ref="copy-key" @click.self="copyKeyModal.close()" @close="onCopyKeyModalClosed">
      <article>
        <header>
          <button aria-label="Close" class="close-btn" @click="copyKeyModal.close()"><i class="bi bi-x-lg"/></button>
          <h3><i class="bi bi-files"/> Copy Key to Another Secret</h3>
        </header>
        <template v-if="copyKeySource">
          <p>
            Copy key <strong>{{ copyKeySource.key }}</strong> from secret
            <strong>{{ editingSecret?.name }}</strong>.
          </p>
          <div class="copy-source">
            <small class="text-muted">Value</small>
            <span class="mono copy-value">{{ copyRevealed ? copyKeySource.value : "••••••••" }}</span>
            <button
              type="button"
              class="icon-btn"
              :title="copyRevealed ? 'Hide value' : 'Reveal value'"
              @click="copyRevealed = !copyRevealed"
            >
              <i class="bi" :class="copyRevealed ? 'bi-eye-slash' : 'bi-eye'"/>
            </button>
          </div>
          <template v-if="otherSecrets.length > 0">
            <label>
              Target secret
              <select v-model="copyTargetSecretId">
                <option v-for="secret in otherSecrets" :key="secret.id" :value="secret.id">
                  {{ secret.name }}
                </option>
              </select>
            </label>
            <label>
              Target key name
              <input v-model="copyTargetKey" type="text" placeholder="KEY" >
            </label>
            <div v-if="copyOverwritesKey" class="warning-message">
              <i class="bi bi-exclamation-triangle-fill"/> Secret
              <strong>{{ copyTargetSecret?.name }}</strong> already contains key
              <strong>{{ copyTargetKey.trim() }}</strong>: its value will be
              overwritten.
            </div>
            <div v-if="copyKeyError" class="error-message">{{ copyKeyError }}</div>
          </template>
          <p v-else class="text-muted">
            This project has no other secret to copy the key to. Create another
            secret first.
          </p>
        </template>
        <footer>
          <button class="secondary" @click="copyKeyModal.close()">Cancel</button>
          <button :disabled="copying || !copyTargetSecretId" @click="executeCopyKey">
            {{ copying ? "Copying…" : "Copy" }}
          </button>
        </footer>
      </article>
    </dialog>

    <!-- UNSAVED CHANGES CONFIRM MODAL -->
    <dialog v-if="showUnsavedConfirm" ref="unsaved-changes" @click.self="unsavedModal.close()" @close="onUnsavedModalClosed">
      <article>
        <header>
          <button aria-label="Close" class="close-btn" @click="unsavedModal.close()"><i class="bi bi-x-lg"/></button>
          <h3><i class="bi bi-exclamation-triangle-fill"/> Unsaved changes</h3>
        </header>
        <p>Discard unsaved changes?</p>
        <footer>
          <button class="secondary" @click="keepEditingUnsavedChanges">Keep editing</button>
          <button class="contrast" @click="discardUnsavedChanges">
            Discard
          </button>
        </footer>
      </article>
    </dialog>

    <!-- RESTORE UNSAVED EDITS MODAL -->
    <dialog v-if="showRestoreModal" ref="restore-draft" @click.self="restoreModal.close()" @close="onRestoreModalClosed">
      <article>
        <header>
          <button aria-label="Close" class="close-btn" @click="restoreModal.close()"><i class="bi bi-x-lg"/></button>
          <h3><i class="bi bi-arrow-counterclockwise"/> Restore unsaved edits</h3>
        </header>
        <p v-if="pendingDraft">
          Restore unsaved edits from
          <strong>{{ formatTime(pendingDraft.savedAt) }}</strong> (secret
          <strong>{{ pendingDraft.name || "unnamed" }}</strong>)?
        </p>
        <footer>
          <button class="secondary" @click="discardDraftRestore">Discard</button>
          <button @click="restoreDraftEdits">Restore</button>
        </footer>
      </article>
    </dialog>
  </div>
</template>

<script setup>
import api, { registerUnsavedEditsCapture } from "../../utils/api";
import { copyTextToClipboardWithAutoClear } from "../../utils/clipboard";
import { parseSecretImport } from "../../utils/secret-import";
import { secretToEnvContent, secretToJsonContent } from "../../utils/secret-export";
import {
  saveSecretDraft,
  loadSecretDraft,
  clearSecretDraft,
} from "../../utils/secret-draft";
const authStore = useAuthStore();
const route = useRoute();
const router = useRouter();

const project = ref(null);
const secrets = ref([]);
const error = ref("");

// The filter only narrows the secret list (by secret name or by any key
// name); the secret editor always shows every key of the opened secret
const filter = ref("");
const filteredSecrets = computed(() => {
  const term = filter.value.trim().toLowerCase();
  if (!term) {
    return secrets.value;
  }
  return secrets.value.filter(
    (secret) =>
      secret.name.toLowerCase().includes(term) ||
      Object.keys(secret.data).some((key) => key.toLowerCase().includes(term)),
  );
});

const secretModal = useModalDialog("secret-editor");
const showSecretModal = secretModal.isOpen;
const editingSecret = ref(null);
const savingSecret = ref(false);
const secretForm = ref({ name: "", rows: [] });
const secretError = ref("");
const revealedRows = ref(new Set());
const multilineRows = ref(new Set());
const copiedRows = ref(new Set());

// Unsaved-changes detection: view state (reveal/multiline) is excluded
const savedSnapshot = ref("");

function snapshotForm() {
  return JSON.stringify({
    name: secretForm.value.name,
    rows: secretForm.value.rows,
  });
}

const isDirty = computed(() => snapshotForm() !== savedSnapshot.value);

function resetFormEditorState() {
  secretForm.value = { name: "", rows: [] };
  revealedRows.value = new Set();
  multilineRows.value = new Set();
  savedSnapshot.value = snapshotForm();
}

const deleteModal = useModalDialog("delete-confirm");
const showDeleteConfirm = deleteModal.isOpen;
const deleteTarget = ref(null);
const deleting = ref(false);

onMounted(async () => {
  authStore.init();
  if (!authStore.isAuthenticated) {
    router.push("/login");
    return;
  }
  await loadProject();
  await loadSecrets();
  offerDraftRestore();
});

onUnmounted(() => {
  unregisterUnsavedEditsCapture();
  window.removeEventListener("beforeunload", onBeforeUnload);
});

// Lost-work protection: on a 403 session expiry the API layer invokes this
// hook before redirecting to /login, so the unsaved editor content is stored
// in sessionStorage and can be restored after re-login.
function captureUnsavedEdits() {
  if (!showSecretModal.value || !isDirty.value) {
    return;
  }
  saveSecretDraft({
    projectId: String(route.params.id),
    secretId: editingSecret.value?.id ?? null,
    name: editingSecret.value?.name ?? secretForm.value.name,
    rows: secretForm.value.rows.map((row) => ({ key: row.key, value: row.value })),
    savedAt: new Date().toISOString(),
  });
}

const unregisterUnsavedEditsCapture = registerUnsavedEditsCapture(
  captureUnsavedEdits,
);

async function loadProject() {
  try {
    const res = await api.get(`/projects/${route.params.id}`);
    project.value = res.data.project;
  } catch (e) {
    error.value = e.response?.data?.error || "Unable to load the project";
  }
}

async function loadSecrets() {
  try {
    const res = await api.get(`/projects/${route.params.id}/secrets`);
    secrets.value = res.data.secrets || [];
  } catch (e) {
    error.value = e.response?.data?.error || "Unable to load secrets";
  }
}

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// Row action menus

const secretMenuItems = [
  { key: "edit", label: "Edit", icon: "bi-pencil-fill" },
  { key: "copy-env", label: "Copy as .env", icon: "bi-file-earmark-code" },
  { key: "copy-json", label: "Copy as JSON", icon: "bi-filetype-json" },
  { key: "duplicate", label: "Duplicate", icon: "bi-copy" },
  { key: "rename", label: "Rename", icon: "bi-input-cursor-text" },
  { key: "delete", label: "Delete", icon: "bi-trash3-fill", danger: true },
];

const keyMenuItems = [
  { key: "copy", label: "Copy to another secret", icon: "bi-files" },
  { key: "remove", label: "Remove", icon: "bi-dash-circle", danger: true },
];

function onSecretAction(secret, action) {
  if (action === "edit") {
    openEditSecret(secret);
  } else if (action === "copy-env") {
    copySecretAs(secret, "env");
  } else if (action === "copy-json") {
    copySecretAs(secret, "json");
  } else if (action === "duplicate") {
    openDuplicateSecret(secret);
  } else if (action === "rename") {
    openRenameSecret(secret);
  } else if (action === "delete") {
    confirmDeleteSecret(secret);
  }
}

async function copySecretAs(secret, format) {
  const entries = Object.keys(secret.data).map((key) => ({
    key,
    value: secret.data[key],
  }));
  const content =
    format === "env"
      ? secretToEnvContent(entries)
      : secretToJsonContent(entries);
  const copied = await copyTextToClipboardWithAutoClear(content);
  if (!copied) {
    error.value =
      format === "env"
        ? `Unable to copy the secret ${secret.name} as .env`
        : `Unable to copy the secret ${secret.name} as JSON`;
  }
}

function onKeyAction(index, action) {
  if (action === "copy") {
    openCopyKey(index);
  } else if (action === "remove") {
    removeRow(index);
  }
}

// Secret editor

function openCreateSecret() {
  editingSecret.value = null;
  secretForm.value = { name: "", rows: [{ key: "", value: "" }] };
  secretError.value = "";
  revealedRows.value = new Set();
  multilineRows.value = new Set();
  importText.value = "";
  importError.value = "";
  importWarnings.value = [];
  savedSnapshot.value = snapshotForm();
  secretModal.open();
}

function openEditSecret(secret) {
  editingSecret.value = secret;
  secretForm.value = {
    name: secret.name,
    rows: Object.keys(secret.data).map((key) => ({ key, value: secret.data[key] })),
  };
  secretError.value = "";
  revealedRows.value = new Set();
  multilineRows.value = multilineIndices(secretForm.value.rows);
  savedSnapshot.value = snapshotForm();
  secretModal.open();
}

// Rows holding a multiline value are edited in a textarea (a single-line
// input would drop the newlines)
function multilineIndices(rows) {
  const set = new Set();
  rows.forEach((row, index) => {
    if (row.value.includes("\n")) {
      set.add(index);
    }
  });
  return set;
}

// User-initiated close (Cancel, ×, backdrop, Esc): ask for confirmation
// before discarding unsaved edits
function requestCloseSecretModal() {
  if (isDirty.value) {
    secretError.value = "";
    pendingCloseAction = () => secretModal.close();
    unsavedModal.open();
  } else {
    secretModal.close();
  }
}

// Esc on the secret editor dialog: keep it open while unsaved edits remain
function onSecretModalCancel(event) {
  if (isDirty.value) {
    event.preventDefault();
    requestCloseSecretModal();
  }
}

function closeSecretModal() {
  secretModal.close();
  editingSecret.value = null;
}

function onSecretModalClosed() {
  secretModal.onClose();
  editingSecret.value = null;
  resetFormEditorState();
}

// Leave the secret editor and go back to the home page: the route-leave
// guard asks for confirmation when unsaved edits remain
function backToHome() {
  router.push("/");
}

// Unsaved-changes confirmation

const unsavedModal = useModalDialog("unsaved-changes");
const showUnsavedConfirm = unsavedModal.isOpen;
let pendingCloseAction = null;
let resolveRouteLeave = null;

function discardUnsavedChanges() {
  unsavedModal.close();
  const resolve = resolveRouteLeave;
  const action = pendingCloseAction;
  resolveRouteLeave = null;
  pendingCloseAction = null;
  if (resolve) {
    resolve(true);
  } else if (action) {
    action();
  }
}

function keepEditingUnsavedChanges() {
  unsavedModal.close();
  const resolve = resolveRouteLeave;
  resolveRouteLeave = null;
  pendingCloseAction = null;
  if (resolve) {
    resolve(false);
  }
}

function onUnsavedModalClosed() {
  unsavedModal.onClose();
  // Closing the confirmation by any other means (Esc, ×, backdrop) keeps the
  // editor open and cancels a pending navigation
  const resolve = resolveRouteLeave;
  resolveRouteLeave = null;
  pendingCloseAction = null;
  if (resolve) {
    resolve(false);
  }
}

onBeforeRouteLeave(() => {
  if (!isDirty.value) {
    return true;
  }
  secretError.value = "";
  unsavedModal.open();
  return new Promise((resolve) => {
    resolveRouteLeave = resolve;
  });
});

function onBeforeUnload(event) {
  event.preventDefault();
  event.returnValue = "";
}

watch(isDirty, (dirty) => {
  if (dirty) {
    window.addEventListener("beforeunload", onBeforeUnload);
  } else {
    window.removeEventListener("beforeunload", onBeforeUnload);
  }
});

// Restore unsaved edits captured before a session expiry

const restoreModal = useModalDialog("restore-draft");
const showRestoreModal = restoreModal.isOpen;
const pendingDraft = ref(null);

function offerDraftRestore() {
  const draft = loadSecretDraft();
  if (draft && draft.projectId === String(route.params.id)) {
    pendingDraft.value = draft;
    restoreModal.open();
  }
}

function discardDraftRestore() {
  restoreModal.close();
  pendingDraft.value = null;
  clearSecretDraft();
}

function restoreDraftEdits() {
  const draft = pendingDraft.value;
  restoreModal.close();
  pendingDraft.value = null;
  clearSecretDraft();
  if (!draft) {
    return;
  }
  const secret = draft.secretId
    ? secrets.value.find((item) => item.id === draft.secretId) ?? null
    : null;
  if (secret) {
    editingSecret.value = secret;
    secretForm.value = {
      name: secret.name,
      rows: draft.rows.map((row) => ({ key: row.key, value: row.value })),
    };
  } else {
    // The secret no longer exists: restore as a new secret, name prefilled
    editingSecret.value = null;
    secretForm.value = {
      name: draft.name,
      rows: draft.rows.map((row) => ({ key: row.key, value: row.value })),
    };
  }
  secretError.value = "";
  revealedRows.value = new Set();
  multilineRows.value = multilineIndices(secretForm.value.rows);
  savedSnapshot.value = snapshotForm();
  secretModal.open();
}

function onRestoreModalClosed() {
  restoreModal.onClose();
  pendingDraft.value = null;
}

function addRow() {
  secretForm.value.rows.push({ key: "", value: "" });
}

function removeRow(index) {
  secretForm.value.rows.splice(index, 1);
}

function toggleReveal(index) {
  const set = new Set(revealedRows.value);
  if (set.has(index)) {
    set.delete(index);
  } else {
    set.add(index);
  }
  revealedRows.value = set;
}

function toggleMultiline(index) {
  const set = new Set(multilineRows.value);
  if (set.has(index)) {
    set.delete(index);
    // Values are masked again when returning to a single-line input
    const revealed = new Set(revealedRows.value);
    revealed.delete(index);
    revealedRows.value = revealed;
  } else {
    set.add(index);
  }
  multilineRows.value = set;
}

// A multiline paste would lose its newlines in a single-line input: switch
// the row to the multiline editor and keep the pasted text as-is
function onValuePaste(event, index) {
  const text = event.clipboardData?.getData("text") ?? "";
  if (text.includes("\n")) {
    event.preventDefault();
    secretForm.value.rows[index].value = text;
    const set = new Set(multilineRows.value);
    set.add(index);
    multilineRows.value = set;
  }
}

let copiedRowsTimer = null;

async function copyRowValue(index) {
  const row = secretForm.value.rows[index];
  if (!row || row.value.length === 0) {
    return;
  }
  const copied = await copyTextToClipboardWithAutoClear(row.value);
  if (!copied) {
    secretError.value = "Unable to copy the value to the clipboard";
    return;
  }
  const set = new Set(copiedRows.value);
  set.add(index);
  copiedRows.value = set;
  if (copiedRowsTimer) {
    clearTimeout(copiedRowsTimer);
  }
  copiedRowsTimer = setTimeout(() => {
    copiedRows.value = new Set();
  }, 1500);
}

// Import from .env or JSON (secret creation only)

const importText = ref("");
const importError = ref("");
const importWarnings = ref([]);

function importSecretRows() {
  importError.value = "";
  importWarnings.value = [];
  let result;
  try {
    result = parseSecretImport(importText.value);
  } catch (e) {
    importError.value = e instanceof Error ? e.message : "Unable to parse the pasted content";
    return;
  }
  if (result.rows.length === 0) {
    importError.value = "Nothing to import: no entries found";
    return;
  }
  secretForm.value.rows = result.rows.map((row) => ({ key: row.key, value: row.value }));
  revealedRows.value = new Set();
  multilineRows.value = multilineIndices(secretForm.value.rows);
  importWarnings.value = result.warnings;
}

async function saveSecret() {
  const data = {};
  const seen = new Set();
  for (const row of secretForm.value.rows) {
    const key = row.key.trim();
    if (key.length === 0) {
      continue;
    }
    if (seen.has(key)) {
      secretError.value = `Duplicate key '${key}': each key must appear only once`;
      return;
    }
    seen.add(key);
    data[key] = row.value;
  }
  savingSecret.value = true;
  secretError.value = "";
  try {
    if (editingSecret.value) {
      await api.put(
        `/projects/${route.params.id}/secrets/${editingSecret.value.id}`,
        { data },
      );
    } else {
      await api.post(`/projects/${route.params.id}/secrets`, {
        name: secretForm.value.name,
        data,
      });
    }
    closeSecretModal();
    clearSecretDraft();
    await loadSecrets();
  } catch (e) {
    secretError.value = e.response?.data?.error || "Unable to save the secret";
  } finally {
    savingSecret.value = false;
  }
}

// Delete

function confirmDeleteSecret(secret) {
  deleteTarget.value = secret;
  deleteModal.open();
}

function onDeleteModalClosed() {
  deleteModal.onClose();
  deleteTarget.value = null;
}

async function executeDelete() {
  deleting.value = true;
  try {
    await api.delete(
      `/projects/${route.params.id}/secrets/${deleteTarget.value.id}`,
    );
    deleteModal.close();
    await loadSecrets();
  } catch (e) {
    error.value = e.response?.data?.error || "Unable to delete the secret";
    deleteModal.close();
  } finally {
    deleting.value = false;
  }
}

// Duplicate

const duplicateModal = useModalDialog("duplicate-secret");
const showDuplicateModal = duplicateModal.isOpen;
const duplicateTarget = ref(null);
const duplicateName = ref("");
const duplicating = ref(false);
const duplicateError = ref("");

function openDuplicateSecret(secret) {
  duplicateTarget.value = secret;
  duplicateName.value = `${secret.name}-copy`;
  duplicateError.value = "";
  duplicateModal.open();
}

function onDuplicateModalClosed() {
  duplicateModal.onClose();
  duplicateTarget.value = null;
}

async function executeDuplicate() {
  duplicating.value = true;
  duplicateError.value = "";
  try {
    await api.post(`/projects/${route.params.id}/secrets`, {
      name: duplicateName.value,
      data: duplicateTarget.value.data,
    });
    duplicateModal.close();
    await loadSecrets();
  } catch (e) {
    duplicateError.value =
      e.response?.data?.error || "Unable to duplicate the secret";
  } finally {
    duplicating.value = false;
  }
}

// Rename

const renameModal = useModalDialog("rename-secret");
const showRenameModal = renameModal.isOpen;
const renameTarget = ref(null);
const renameName = ref("");
const renaming = ref(false);
const renameError = ref("");

function openRenameSecret(secret) {
  renameTarget.value = secret;
  renameName.value = secret.name;
  renameError.value = "";
  renameModal.open();
}

function onRenameModalClosed() {
  renameModal.onClose();
  renameTarget.value = null;
}

async function executeRename() {
  renaming.value = true;
  renameError.value = "";
  try {
    await api.put(
      `/projects/${route.params.id}/secrets/${renameTarget.value.id}`,
      { name: renameName.value },
    );
    renameModal.close();
    await loadSecrets();
  } catch (e) {
    renameError.value =
      e.response?.data?.error || "Unable to rename the secret";
  } finally {
    renaming.value = false;
  }
}

// Copy a key to another secret

const copyKeyModal = useModalDialog("copy-key");
const showCopyKeyModal = copyKeyModal.isOpen;
const copyKeySource = ref(null);
const copyRevealed = ref(false);
const copyTargetSecretId = ref("");
const copyTargetKey = ref("");
const copying = ref(false);
const copyKeyError = ref("");

const otherSecrets = computed(() =>
  secrets.value.filter((secret) => secret.id !== editingSecret.value?.id),
);

const copyTargetSecret = computed(
  () =>
    secrets.value.find((secret) => secret.id === copyTargetSecretId.value) ||
    null,
);

const copyOverwritesKey = computed(() => {
  const targetKey = copyTargetKey.value.trim();
  return (
    copyTargetSecret.value !== null &&
    targetKey.length > 0 &&
    Object.hasOwn(copyTargetSecret.value.data, targetKey)
  );
});

function openCopyKey(index) {
  const row = secretForm.value.rows[index];
  const key = row.key.trim();
  if (key.length === 0) {
    secretError.value = "Enter a key name before copying it to another secret";
    return;
  }
  // The value is the one currently displayed in the editor, so unsaved
  // edits are copied as well; the source secret is not saved by this action
  copyKeySource.value = { key, value: row.value };
  copyTargetSecretId.value =
    otherSecrets.value.length > 0 ? otherSecrets.value[0].id : "";
  copyTargetKey.value = key;
  copyRevealed.value = false;
  copyKeyError.value = "";
  copyKeyModal.open();
}

function onCopyKeyModalClosed() {
  copyKeyModal.onClose();
  copyKeySource.value = null;
}

async function executeCopyKey() {
  const targetKey = copyTargetKey.value.trim();
  if (targetKey.length === 0) {
    copyKeyError.value = "The target key name is required";
    return;
  }
  const target = copyTargetSecret.value;
  if (!target) {
    copyKeyError.value = "The target secret could not be found";
    return;
  }
  copying.value = true;
  copyKeyError.value = "";
  try {
    await api.put(`/projects/${route.params.id}/secrets/${target.id}`, {
      data: { ...target.data, [targetKey]: copyKeySource.value.value },
    });
    copyKeyModal.close();
    await loadSecrets();
  } catch (e) {
    copyKeyError.value = e.response?.data?.error || "Unable to copy the key";
  } finally {
    copying.value = false;
  }
}
</script>

<style scoped>
.page-header {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  margin-bottom: var(--space-lg);
}

.page-header h1 i {
  color: var(--color-primary);
}

.col-actions {
  text-align: right;
  white-space: nowrap;
}

.secrets-filter {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: var(--space-sm);
  max-width: 420px;
  margin-bottom: var(--space-md);
  padding: 0 0 0 var(--space-sm);
  background: var(--color-surface);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
}

.secrets-filter > i {
  color: var(--color-text-muted);
}

.secrets-filter input {
  border: none;
  background: none;
  padding-inline: 0;
}

.secrets-filter input:focus {
  outline: none;
  box-shadow: none;
}

.copy-source {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-xs) var(--space-sm);
  margin-bottom: var(--space-sm);
  background: var(--color-code-bg);
  border-radius: var(--radius-sm);
}

.copy-value {
  overflow-wrap: anywhere;
}

.warning-message {
  color: var(--color-warning);
  margin-bottom: var(--space-sm);
  padding: var(--space-sm);
  border: 1px solid var(--color-warning);
  border-radius: var(--radius-sm);
}

.settings-card {
  padding: var(--space-md);
}

.settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--space-md);
  margin-bottom: var(--space-md);
}

.settings-grid > div > small {
  display: block;
  margin-bottom: var(--space-2xs);
}

.mono {
  font-family: var(--font-family-mono);
  font-size: var(--text-sm);
  word-break: break-all;
}

.secret-editor {
  min-width: min(640px, 90vw);
}

.dialog-footer {
  display: flex;
  gap: var(--space-xs);
}

.footer-home {
  margin-right: auto;
}

.key-value-row {
  display: grid;
  grid-template-columns: minmax(120px, 1fr) minmax(160px, 2fr) auto;
  gap: var(--space-xs);
  align-items: center;
  margin-bottom: var(--space-xs);
}

.key-value-row--multiline {
  align-items: start;
}

.multiline-value {
  width: 100%;
  min-height: 6em;
  resize: vertical;
}

.import-block {
  margin-bottom: var(--space-md);
}

.import-block summary {
  cursor: pointer;
  font-weight: var(--weight-semibold);
}

.import-block label {
  margin-top: var(--space-sm);
}

.import-actions {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--space-sm);
  align-items: center;
}

.import-actions .secondary {
  justify-self: start;
}

.value-input {
  display: grid;
  grid-template-columns: 1fr auto auto auto;
  gap: 0;
  align-items: center;
}

.reveal-btn {
  margin-left: calc(-1 * var(--space-sm));
}

.icon-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.25em 0.5em;
  color: var(--color-text-muted);
  border-radius: var(--radius-sm);
  transition: all 0.15s;
}

.icon-btn:hover:not(:disabled) {
  background: var(--color-surface-hover);
  color: var(--color-text);
}

.icon-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

fieldset {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: var(--space-md);
  margin-bottom: var(--space-md);
}

fieldset legend {
  font-weight: var(--weight-semibold);
  padding-inline: var(--space-xs);
}

.error-message {
  color: var(--color-danger);
  margin-bottom: var(--space-sm);
  padding: var(--space-sm);
  border: 1px solid var(--color-danger);
  border-radius: var(--radius-sm);
}
</style>
