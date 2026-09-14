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
        <footer>
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
        </footer>
        <div class="sync-actions">
          <button class="secondary" :disabled="syncing === project.id" @click="pullProject(project)">
            <i class="bi bi-cloud-download"/> Pull
          </button>
          <button class="secondary" :disabled="syncing === project.id" @click="pushProject(project)">
            <i class="bi bi-cloud-upload"/> Push
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
});

async function loadProjects() {
  try {
    const res = await api.get("/projects");
    projects.value = res.data.projects || [];
  } catch (e) {
    error.value = e.response?.data?.error || "Unable to load projects";
  }
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
  grid-template-columns: 1fr auto;
  align-items: center;
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
  grid-template-columns: 1fr 1fr auto;
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
