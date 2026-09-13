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

    <figure v-if="secrets.length > 0">
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
          <tr v-for="secret in secrets" :key="secret.id">
            <td><i class="bi bi-key"/> {{ secret.name }}</td>
            <td>{{ Object.keys(secret.data).length }}</td>
            <td class="text-muted">{{ formatTime(secret.dateUpdated) }}</td>
            <td class="col-actions">
              <button class="icon-btn" title="Edit" @click="openEditSecret(secret)">
                <i class="bi bi-pencil-fill"/>
              </button>
              <button class="icon-btn icon-btn--danger" title="Delete" @click="confirmDeleteSecret(secret)">
                <i class="bi bi-trash3-fill"/>
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </figure>
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
    <dialog v-if="showSecretModal" :open="showSecretModal" @click.self="closeSecretModal">
      <article class="secret-editor">
        <header>
          <button aria-label="Close" rel="prev" @click="closeSecretModal"/>
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
              :disabled="!!editingSecret"
            >
            <div class="value-input">
              <input
                v-model="row.value"
                :type="revealedRows.has(index) ? 'text' : 'password'"
                placeholder="value"
                :disabled="!!editingSecret"
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
            <button
              type="button"
              class="icon-btn icon-btn--danger"
              title="Remove"
              :disabled="!!editingSecret"
              @click="removeRow(index)"
            >
              <i class="bi bi-dash-circle"/>
            </button>
          </div>
          <div v-if="!editingSecret">
            <button type="button" class="secondary" @click="addRow">
              <i class="bi bi-plus-lg"/> Add Key / Value
            </button>
          </div>
        </fieldset>

        <footer>
          <button class="secondary" @click="closeSecretModal">Cancel</button>
          <button :disabled="savingSecret || !!editingSecret" @click="saveSecret">
            {{ savingSecret ? "Saving…" : "Save" }}
          </button>
        </footer>
      </article>
    </dialog>

    <!-- DELETE CONFIRM MODAL -->
    <dialog v-if="showDeleteConfirm" :open="showDeleteConfirm" @click.self="showDeleteConfirm = false">
      <article>
        <header>
          <button aria-label="Close" rel="prev" @click="showDeleteConfirm = false"/>
          <h3><i class="bi bi-exclamation-triangle-fill"/> Delete Secret</h3>
        </header>
        <p>
          Are you sure you want to delete secret
          <strong>{{ deleteTarget?.name }}</strong
          >?
        </p>
        <p>This action cannot be undone (until the next pull restores it).</p>
        <footer>
          <button class="secondary" @click="showDeleteConfirm = false">Cancel</button>
          <button class="contrast" :disabled="deleting" @click="executeDelete">
            {{ deleting ? "Deleting…" : "Delete" }}
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

const showSecretModal = ref(false);
const editingSecret = ref(null);
const savingSecret = ref(false);
const secretForm = ref({ name: "", rows: [] });
const revealedRows = ref(new Set());

const showDeleteConfirm = ref(false);
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

// Secret editor

function openCreateSecret() {
  editingSecret.value = null;
  secretForm.value = { name: "", rows: [{ key: "", value: "" }] };
  revealedRows.value = new Set();
  showSecretModal.value = true;
}

function openEditSecret(secret) {
  editingSecret.value = secret;
  secretForm.value = {
    name: secret.name,
    rows: Object.keys(secret.data).map((key) => ({ key, value: secret.data[key] })),
  };
  revealedRows.value = new Set();
  showSecretModal.value = true;
}

function closeSecretModal() {
  showSecretModal.value = false;
  editingSecret.value = null;
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
  savingSecret.value = true;
  error.value = "";
  try {
    const data = {};
    for (const row of secretForm.value.rows) {
      if (row.key.trim().length > 0) {
        data[row.key.trim()] = row.value;
      }
    }
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
    error.value = e.response?.data?.error || "Unable to save the secret";
  } finally {
    savingSecret.value = false;
  }
}

// Delete

function confirmDeleteSecret(secret) {
  deleteTarget.value = secret;
  showDeleteConfirm.value = true;
}

async function executeDelete() {
  deleting.value = true;
  try {
    await api.delete(
      `/projects/${route.params.id}/secrets/${deleteTarget.value.id}`,
    );
    showDeleteConfirm.value = false;
    deleteTarget.value = null;
    await loadSecrets();
  } catch (e) {
    error.value = e.response?.data?.error || "Unable to delete the secret";
    showDeleteConfirm.value = false;
  } finally {
    deleting.value = false;
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

.icon-btn--danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-danger) 15%, transparent);
  color: var(--color-danger);
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
