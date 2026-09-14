<template>
  <div>
    <div class="page-header">
      <div>
        <h1>Projects</h1>
        <small class="text-muted">Secrets synchronized with restic repositories</small>
      </div>
      <button v-if="authStore.isAdmin" @click="openCreateProject">
        <i class="bi bi-plus-lg"/> Create Project
      </button>
    </div>

    <div v-if="error" class="error-message">{{ error }}</div>

    <div v-if="projects.length > 0" class="projects-grid">
      <article v-for="project in projects" :key="project.id" class="project-card">
        <header>
          <NuxtLink :to="`/projects/${project.id}`" class="project-name">
            <i class="bi bi-box-seam"/> {{ project.name }}
          </NuxtLink>
          <span v-if="authStore.isAdmin" class="icon-actions">
            <button class="icon-btn icon-btn--danger" title="Delete project" @click="confirmDeleteProject(project)">
              <i class="bi bi-trash3-fill"/>
            </button>
          </span>
        </header>
        <p class="text-muted project-description">{{ project.description || "No description" }}</p>
        <footer class="project-card-footer">
          <div v-if="project.hasLocalChanges || statusOf(project.id)" class="card-badges">
            <template v-if="project.hasLocalChanges">
              <span class="badge badge-warn" title="Secrets were modified since the last synchronization">
                <i class="bi bi-pencil-fill"/> Local changes not pushed
              </span>
              <button
                class="btn-discard"
                :disabled="discarding === project.id"
                title="Restore the last synchronized snapshot, losing the local changes"
                @click="confirmDiscard(project)"
              >
                <i class="bi bi-arrow-counterclockwise"/> Discard
              </button>
            </template>
            <span v-if="statusOf(project.id) === 'checking'" class="badge badge-muted">
              <i class="bi bi-arrow-repeat spin"/> Checking remote…
            </span>
            <span
              v-else-if="statusOf(project.id) === 'failed'"
              class="badge badge-muted"
              title="The repository could not be checked for remote changes"
            >
              <i class="bi bi-exclamation-triangle"/> Remote check failed
            </span>
            <span v-else-if="statusOf(project.id)?.needsPull" class="badge badge-info">
              <i class="bi bi-cloud-download"/> Remote changes available
            </span>
          </div>
          <div class="footer-meta">
            <div class="sync-status">
              <template v-if="project.lastSyncSnapshotTime">
                <i class="bi bi-check-circle-fill sync-ok"/>
                <small>Synced {{ formatTime(project.lastSyncSnapshotTime) }}</small>
              </template>
              <template v-else>
                <i class="bi bi-circle sync-none"/>
                <small>Never synchronized</small>
              </template>
            </div>
            <div class="project-meta">
              <small class="text-muted">
                {{ project.secretCount }} secret{{ project.secretCount === 1 ? "" : "s" }}
              </small>
            </div>
          </div>
        </footer>
        <div class="sync-actions">
          <button class="secondary" :disabled="syncing === project.id" @click="pullProject(project)">
            <i class="bi bi-cloud-download"/> Pull
          </button>
          <button class="secondary" :disabled="syncing === project.id" @click="pushProject(project)">
            <i class="bi bi-cloud-upload"/> Push
          </button>
          <button class="secondary" @click="openHistory(project)">
            <i class="bi bi-clock-history"/> History
          </button>
          <NuxtLink :to="`/projects/${project.id}`" role="button" class="outline-link">
            <i class="bi bi-key"/> Secrets
          </NuxtLink>
        </div>
      </article>
    </div>
    <div v-else class="empty-state">
      <i class="bi bi-box-seam"/>
      <p>No projects yet.</p>
    </div>
    <!-- CREATE PROJECT MODAL -->
    <dialog v-if="showCreateModal" ref="create-project" @click.self="closeCreateModal" @close="onCreateModalClosed">
      <article>
        <header>
          <button aria-label="Close" class="close-btn" @click="closeCreateModal"><i class="bi bi-x-lg"/></button>
          <h3><i class="bi bi-plus-lg"/> Create Project</h3>
        </header>
        <label>
          Name
          <input v-model="projectForm.name" type="text" placeholder="Project name" required >
        </label>
        <label>
          Description
          <input v-model="projectForm.description" type="text" placeholder="Optional description" >
        </label>
        <label>
          S3 Endpoint
          <input v-model="projectForm.s3Endpoint" type="text" placeholder="s3.example.com" required >
        </label>
        <label>
          S3 Bucket
          <input v-model="projectForm.s3Bucket" type="text" placeholder="bucket" required >
        </label>
        <label>
          Repository Prefix
          <input v-model="projectForm.repoPrefix" type="text" placeholder="Defaults to the project name" >
        </label>
        <label>
          S3 Region (optional)
          <input v-model="projectForm.s3Region" type="text" placeholder="Auto-detected when empty" >
        </label>
        <label>
          S3 Bucket Lookup
          <select v-model="projectForm.s3BucketLookup">
            <option value="dns">dns</option>
            <option value="path">path</option>
            <option value="auto">auto</option>
          </select>
        </label>
        <label>
          S3 Access Key ID
          <input v-model="projectForm.s3AccessKeyId" type="text" placeholder="Access key" required >
        </label>
        <label>
          S3 Secret Access Key
          <input v-model="projectForm.s3SecretAccessKey" type="password" placeholder="Secret key" required >
        </label>
        <label>
          Restic Password
          <input v-model="projectForm.resticPassword" type="password" placeholder="Repository password" required >
        </label>
        <footer>
          <button class="secondary" @click="closeCreateModal">Cancel</button>
          <button :disabled="creating" @click="createProject">
            {{ creating ? "Creating…" : "Create" }}
          </button>
        </footer>
      </article>
    </dialog>

    <!-- DELETE CONFIRM MODAL -->
    <dialog v-if="showDeleteConfirm" ref="delete-project" @click.self="deleteModal.close()" @close="onDeleteModalClosed">
      <article>
        <header>
          <button aria-label="Close" class="close-btn" @click="deleteModal.close()"><i class="bi bi-x-lg"/></button>
          <h3><i class="bi bi-exclamation-triangle-fill"/> Delete Project</h3>
        </header>
        <p>
          Are you sure you want to delete project
          <strong>{{ deleteTarget?.name }}</strong
          >? All its secrets will be removed from the application (the restic
          repository is not modified).
        </p>
        <p>This action cannot be undone.</p>
        <footer>
          <button class="secondary" @click="deleteModal.close()">Cancel</button>
          <button class="contrast" :disabled="deleting" @click="executeDelete">
            {{ deleting ? "Deleting…" : "Delete" }}
          </button>
        </footer>
      </article>
    </dialog>

    <!-- SYNC RESULT MODAL -->
    <dialog v-if="showSyncModal" ref="sync-result" @click.self="closeSyncModal" @close="onSyncModalClosed">
      <article>
        <header>
          <button aria-label="Close" class="close-btn" @click="closeSyncModal"><i class="bi bi-x-lg"/></button>
          <h3><i class="bi bi-arrow-repeat"/> Synchronization Result</h3>
        </header>
        <p>{{ syncResult?.message }}</p>
        <footer>
          <button @click="closeSyncModal">Close</button>
        </footer>
      </article>
    </dialog>
    <!-- DISCARD CONFIRM MODAL -->
    <dialog v-if="showDiscardConfirm" ref="discard-confirm" @click.self="discardModal.close()" @close="onDiscardModalClosed">
      <article>
        <header>
          <button aria-label="Close" class="close-btn" @click="discardModal.close()"><i class="bi bi-x-lg"/></button>
          <h3><i class="bi bi-exclamation-triangle-fill"/> Discard Local Changes</h3>
        </header>
        <p>
          Discard the local modifications of project
          <strong>{{ discardTarget?.name }}</strong
          >? The secrets will be restored from the last synchronized snapshot
          and the local changes that were not pushed will be lost.
        </p>
        <p>This action cannot be undone.</p>
        <footer>
          <button class="secondary" @click="discardModal.close()">Cancel</button>
          <!-- :disabled needs a boolean: a raw empty string ("") is truthy for
               boolean attributes in Vue and would permanently disable the button -->
          <button class="contrast" :disabled="discarding !== ''" @click="executeDiscard">
            {{ discarding ? "Discarding…" : "Discard" }}
          </button>
        </footer>
      </article>
    </dialog>

    <!-- SNAPSHOT HISTORY MODAL -->
    <SnapshotHistoryModal
      v-if="historyProject"
      :project="historyProject"
      @closed="historyProject = null"
      @restored="onHistoryRestored"
    />
  </div>
</template>

<script setup>
import api from "../utils/api";
const authStore = useAuthStore();

const projects = ref([]);
const error = ref("");

const createModal = useModalDialog("create-project");
const showCreateModal = createModal.isOpen;
const creating = ref(false);
const projectForm = ref({});

const deleteModal = useModalDialog("delete-project");
const showDeleteConfirm = deleteModal.isOpen;
const deleteTarget = ref(null);
const deleting = ref(false);

const syncModal = useModalDialog("sync-result");
const showSyncModal = syncModal.isOpen;
const syncing = ref("");
const syncResult = ref(null);

// Remote snapshot check per project card:
// "checking" | "failed" | { needsPull, remoteLatestSnapshotTime }
const statuses = ref({});

const discardModal = useModalDialog("discard-confirm");
const showDiscardConfirm = discardModal.isOpen;
const discardTarget = ref(null);
const discarding = ref("");

const historyProject = ref(null);

const defaultForm = () => ({
  name: "",
  description: "",
  s3Endpoint: "",
  s3Bucket: "",
  repoPrefix: "",
  s3Region: "",
  s3BucketLookup: "dns",
  s3AccessKeyId: "",
  s3SecretAccessKey: "",
  resticPassword: "",
});

onMounted(async () => {
  authStore.init();
  if (!authStore.isAuthenticated) {
    useRouter().push("/login");
    return;
  }
  await loadProjects();
  await checkStatuses();
});

async function loadProjects() {
  try {
    const res = await api.get("/projects");
    projects.value = res.data.projects || [];
  } catch (e) {
    error.value = e.response?.data?.error || "Unable to load projects";
  }
}

function statusOf(id) {
  return statuses.value[id] || null;
}

// Ask the server, for each project, whether the repository holds remote
// changes to pull; each card updates independently as its check completes
async function checkStatuses() {
  await Promise.all(
    projects.value.map(async (project) => {
      statuses.value = { ...statuses.value, [project.id]: "checking" };
      try {
        const res = await api.get(`/projects/${project.id}/status`);
        statuses.value = {
          ...statuses.value,
          [project.id]: {
            needsPull: res.data.needsPull,
            remoteLatestSnapshotTime: res.data.remoteLatestSnapshotTime,
          },
        };
      } catch {
        statuses.value = { ...statuses.value, [project.id]: "failed" };
      }
    }),
  );
}

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// Create

function openCreateProject() {
  projectForm.value = defaultForm();
  createModal.open();
}

function closeCreateModal() {
  createModal.close();
}

function onCreateModalClosed() {
  createModal.onClose();
}

async function createProject() {
  creating.value = true;
  error.value = "";
  try {
    await api.post("/projects", projectForm.value);
    closeCreateModal();
    await loadProjects();
  } catch (e) {
    error.value = e.response?.data?.error || "Unable to create the project";
  } finally {
    creating.value = false;
  }
}

// Delete

function confirmDeleteProject(project) {
  deleteTarget.value = project;
  deleteModal.open();
}

function onDeleteModalClosed() {
  deleteModal.onClose();
  deleteTarget.value = null;
}

async function executeDelete() {
  deleting.value = true;
  try {
    await api.delete(`/projects/${deleteTarget.value.id}`);
    deleteModal.close();
    await loadProjects();
  } catch (e) {
    error.value = e.response?.data?.error || "Unable to delete the project";
    deleteModal.close();
  } finally {
    deleting.value = false;
  }
}

// Pull / Push

function closeSyncModal() {
  syncModal.close();
  syncResult.value = null;
}

function onSyncModalClosed() {
  syncModal.onClose();
  syncResult.value = null;
}

async function pullProject(project) {
  syncing.value = project.id;
  error.value = "";
  try {
    const res = await api.post(`/projects/${project.id}/pull`);
    syncResult.value = {
      message: `Pulled ${res.data.secrets} secret(s) and ${res.data.keys} key(s) from snapshot ${res.data.snapshotId.substring(0, 8)}.`,
    };
    syncModal.open();
    await loadProjects();
    await checkStatuses();
  } catch (e) {
    error.value = e.response?.data?.error || "Pull failed";
  } finally {
    syncing.value = "";
  }
}

async function pushProject(project) {
  syncing.value = project.id;
  error.value = "";
  try {
    const res = await api.post(`/projects/${project.id}/push`);
    syncResult.value = {
      message: `Pushed secrets to snapshot ${res.data.snapshotId.substring(0, 8)}.`,
    };
    syncModal.open();
    await loadProjects();
    await checkStatuses();
  } catch (e) {
    if (e.response?.status === 409) {
      syncResult.value = {
        message: e.response.data.error,
      };
      syncModal.open();
    } else {
      error.value = e.response?.data?.error || "Push failed";
    }
  } finally {
    syncing.value = "";
  }
}

// Discard local changes

function confirmDiscard(project) {
  discardTarget.value = project;
  discardModal.open();
}

function onDiscardModalClosed() {
  discardModal.onClose();
  discardTarget.value = null;
}

async function executeDiscard() {
  discarding.value = discardTarget.value.id;
  try {
    const res = await api.post(`/projects/${discardTarget.value.id}/discard`);
    discardModal.close();
    syncResult.value = {
      message: `Discarded local changes: restored ${res.data.secrets} secret(s) and ${res.data.keys} key(s) from snapshot ${res.data.snapshotId.substring(0, 8)}.`,
    };
    syncModal.open();
    await loadProjects();
    await checkStatuses();
  } catch (e) {
    error.value =
      e.response?.data?.error || "Unable to discard the local changes";
    discardModal.close();
  } finally {
    discarding.value = "";
  }
}

// Snapshot history

function openHistory(project) {
  historyProject.value = project;
}

async function onHistoryRestored() {
  await loadProjects();
  await checkStatuses();
}
</script>

<style scoped>
.page-header {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  margin-bottom: var(--space-lg);
}

.projects-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--space-md);
}

.project-card {
  display: grid;
  grid-template-rows: auto auto 1fr auto;
  gap: var(--space-sm);
}

.project-card > header {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
}

.project-name {
  font-weight: var(--weight-semibold);
  color: var(--color-text);
  text-decoration: none;
  font-size: var(--text-lg);
}
.project-name:hover {
  color: var(--color-primary);
}

.project-description {
  margin: 0;
}

.project-card > footer {
  display: grid;
  gap: var(--space-xs);
  align-content: start;
}

.footer-meta {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
}

.card-badges {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs);
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  font-size: var(--text-sm);
  border-radius: var(--radius-full);
  padding: 0.15em 0.7em;
  width: fit-content;
}

.badge-warn {
  background: color-mix(in srgb, var(--color-warning) 15%, transparent);
  color: var(--color-warning);
}

.badge-info {
  background: var(--color-primary-soft);
  color: var(--color-primary-text);
}

.badge-muted {
  background: var(--color-surface-hover);
  color: var(--color-text-muted);
}

.btn-discard {
  background: none;
  border: 1px solid color-mix(in srgb, var(--color-danger) 40%, transparent);
  color: var(--color-danger);
  border-radius: var(--radius-full);
  font-size: var(--text-sm);
  padding: 0.15em 0.7em;
  cursor: pointer;
}
.btn-discard:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-danger) 12%, transparent);
}
.btn-discard:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.spin {
  display: inline-block;
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.sync-status {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
}

.sync-ok {
  color: var(--color-success);
}

.sync-none {
  color: var(--color-text-muted);
}

.sync-actions {
  display: grid;
  grid-template-columns: 1fr 1fr auto auto;
  gap: var(--space-xs);
}

.outline-link {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: var(--space-xs) var(--space-sm);
  color: var(--color-text);
  text-decoration: none;
  font-size: var(--text-base);
}
.outline-link:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.icon-actions {
  display: flex;
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

.icon-btn:hover {
  background: var(--color-surface-hover);
  color: var(--color-text);
}

.icon-btn--danger:hover {
  background: color-mix(in srgb, var(--color-danger) 15%, transparent);
  color: var(--color-danger);
}

.error-message {
  color: var(--color-danger);
  margin-bottom: var(--space-sm);
  padding: var(--space-sm);
  border: 1px solid var(--color-danger);
  border-radius: var(--radius-sm);
}
</style>
