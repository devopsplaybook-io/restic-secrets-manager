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
        restic password) are stored encrypted at rest and are never displayed.
      </small>
    </article>
    <!-- SECRET EDITOR MODAL -->
    <dialog v-if="showSecretModal" ref="secret-editor" @click.self="secretModal.close()" @close="onSecretModalClosed">
      <article class="secret-editor">
        <header>
          <button aria-label="Close" class="close-btn" @click="closeSecretModal"><i class="bi bi-x-lg"/></button>
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
          <div v-for="(row, index) in secretForm.rows" :key="index" class="key-value-row">
            <input
              v-model="row.key"
              type="text"
              placeholder="KEY"
            >
            <div class="value-input">
              <input
                v-model="row.value"
                :type="revealedRows.has(index) ? 'text' : 'password'"
                placeholder="value"
              >
              <button
                type="button"
                class="icon-btn reveal-btn"
                :title="revealedRows.has(index) ? 'Hide value' : 'Reveal value'"
                @click="toggleReveal(index)"
              >
                <i class="bi" :class="revealedRows.has(index) ? 'bi-eye-slash' : 'bi-eye'"/>
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

        <div v-if="secretError" class="error-message">{{ secretError }}</div>

        <footer class="dialog-footer">
          <button class="secondary footer-home" @click="backToHome">
            <i class="bi bi-house"/> Home
          </button>
          <button class="secondary" @click="closeSecretModal">Cancel</button>
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
  </div>
</template>

<script setup>
import api from "../../utils/api";
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
});

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
  } else if (action === "duplicate") {
    openDuplicateSecret(secret);
  } else if (action === "rename") {
    openRenameSecret(secret);
  } else if (action === "delete") {
    confirmDeleteSecret(secret);
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
  secretModal.open();
}

function closeSecretModal() {
  secretModal.close();
  editingSecret.value = null;
}

function onSecretModalClosed() {
  secretModal.onClose();
  editingSecret.value = null;
}

// Leave the secret editor and go back to the home page without saving
function backToHome() {
  secretModal.close();
  router.push("/");
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

.value-input {
  display: grid;
  grid-template-columns: 1fr auto;
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
