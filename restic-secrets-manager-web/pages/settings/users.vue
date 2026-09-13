<template>
  <div>
    <div class="page-header">
      <div>
        <h1>User Management</h1>
        <small class="text-muted">Users are granted access per project; admins can access all projects</small>
      </div>
      <button @click="openCreateUser">
        <i class="bi bi-person-plus"/> Create User
      </button>
    </div>

    <div v-if="error" class="error-message">{{ error }}</div>

    <figure v-if="users.length > 0">
      <table>
        <thead>
          <tr>
            <th>Username</th>
            <th>Role</th>
            <th>Project Access</th>
            <th class="col-actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id">
            <td>
              <span class="user-name">{{ u.name }}</span>
              <span v-if="u.id === currentUserId" class="badge badge-self">You</span>
            </td>
            <td>
              <span class="badge" :class="u.role === 'admin' ? 'badge-admin' : 'badge-user'">{{ u.role }}</span>
            </td>
            <td>
              <span v-if="u.role === 'admin'" class="scope-all">All projects</span>
              <span v-else-if="!userProjectNames(u).length" class="scope-none text-muted">No project access</span>
              <span v-else class="scope-list">
                <span v-for="name in userProjectNames(u)" :key="name" class="tag">{{ name }}</span>
              </span>
            </td>
            <td class="col-actions">
              <button class="icon-btn" title="Edit" @click="openEditUser(u)">
                <i class="bi bi-pencil-fill"/>
              </button>
              <button
                class="icon-btn icon-btn--danger"
                title="Delete"
                :disabled="u.id === currentUserId"
                @click="confirmDeleteUser(u)"
              >
                <i class="bi bi-trash3-fill"/>
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </figure>
    <div v-else class="empty-state">
      <i class="bi bi-people"/>
      <p>No users found.</p>
    </div>
    <!-- CREATE/EDIT USER MODAL -->
    <dialog v-if="showUserModal" ref="user-editor" @click.self="closeUserModal" @close="onUserModalClosed">
      <article>
        <header>
          <button aria-label="Close" rel="prev" @click="closeUserModal"/>
          <h3>
            <i :class="editingUser ? 'bi bi-pencil-fill' : 'bi bi-person-plus'"/>
            {{ editingUser ? "Edit User" : "Create User" }}
          </h3>
        </header>
        <label>
          Username
          <input
            v-model="userForm.name"
            type="text"
            placeholder="Enter username"
            :disabled="!!editingUser"
          >
        </label>
        <label>
          {{ editingUser ? "New Password (leave blank to keep current)" : "Password" }}
          <input
            v-model="userForm.password"
            type="password"
            :placeholder="editingUser ? 'Leave blank to keep' : 'Enter password'"
          >
        </label>
        <fieldset>
          <legend>Role</legend>
          <label><input v-model="userForm.role" type="radio" value="user" > User</label>
          <label><input v-model="userForm.role" type="radio" value="admin" > Admin</label>
        </fieldset>
        <div v-if="userForm.role !== 'admin'">
          <fieldset>
            <legend>Project Access</legend>
            <div v-if="projects.length === 0" class="text-muted">
              No projects exist yet.
            </div>
            <label v-for="project in projects" :key="project.id" class="scope-checkbox">
              <input
                v-model="userForm.scopes"
                type="checkbox"
                :value="`project:${project.id}`"
              >
              {{ project.name }}
            </label>
          </fieldset>
        </div>
        <div v-else>
          <small><i class="bi bi-info-circle-fill"/> Admins can access all projects.</small>
        </div>
        <footer>
          <button class="secondary" @click="closeUserModal">Cancel</button>
          <button :disabled="savingUser" @click="saveUser">
            {{ savingUser ? "Saving…" : "Save" }}
          </button>
        </footer>
      </article>
    </dialog>

    <!-- DELETE CONFIRM MODAL -->
    <dialog v-if="showDeleteConfirm" ref="delete-user" @click.self="deleteModal.close()" @close="onDeleteModalClosed">
      <article>
        <header>
          <button aria-label="Close" rel="prev" @click="deleteModal.close()"/>
          <h3><i class="bi bi-exclamation-triangle-fill"/> Delete User</h3>
        </header>
        <p>
          Are you sure you want to delete user
          <strong>{{ deleteTarget?.name }}</strong
          >?
        </p>
        <p>This action cannot be undone.</p>
        <footer>
          <button class="secondary" @click="deleteModal.close()">Cancel</button>
          <button class="contrast" :disabled="deletingUser" @click="executeDelete">
            {{ deletingUser ? "Deleting…" : "Delete" }}
          </button>
        </footer>
      </article>
    </dialog>
  </div>
</template>

<script setup>
import api from "../../utils/api";
const authStore = useAuthStore();
const router = useRouter();

const users = ref([]);
const projects = ref([]);
const currentUserId = ref(null);
const error = ref("");

const userModal = useModalDialog("user-editor");
const showUserModal = userModal.isOpen;
const editingUser = ref(null);
const savingUser = ref(false);
const userForm = ref({ name: "", password: "", role: "user", scopes: [] });

const deleteModal = useModalDialog("delete-user");
const showDeleteConfirm = deleteModal.isOpen;
const deleteTarget = ref(null);
const deletingUser = ref(false);

onMounted(async () => {
  authStore.init();
  if (!authStore.isAuthenticated) {
    router.push("/login");
    return;
  }
  if (!authStore.isAdmin) {
    router.push("/");
    return;
  }
  await loadProjects();
  await loadUsers();
});

async function loadUsers() {
  try {
    const res = await api.get("/users");
    users.value = res.data || [];
    if (!currentUserId.value) {
      currentUserId.value = authStore.currentUser?.userId;
    }
  } catch (e) {
    error.value = e.response?.data?.error || "Unable to load users";
  }
}

async function loadProjects() {
  try {
    const res = await api.get("/projects");
    projects.value = res.data.projects || [];
  } catch (e) {
    error.value = e.response?.data?.error || "Unable to load projects";
  }
}

function userProjectNames(user) {
  const names = [];
  for (const scope of user.scopes || []) {
    if (scope.startsWith("project:")) {
      const projectId = scope.substring("project:".length);
      const project = projects.value.find((p) => p.id === projectId);
      names.push(project ? project.name : projectId);
    }
  }
  return names.sort((a, b) => a.localeCompare(b));
}

function resetUserForm() {
  userForm.value = { name: "", password: "", role: "user", scopes: [] };
}

function openCreateUser() {
  editingUser.value = null;
  resetUserForm();
  userModal.open();
}

function openEditUser(user) {
  editingUser.value = user;
  userForm.value = {
    name: user.name,
    password: "",
    role: user.role,
    scopes: user.scopes ? [...user.scopes] : [],
  };
  userModal.open();
}

function closeUserModal() {
  userModal.close();
  editingUser.value = null;
  resetUserForm();
}

function onUserModalClosed() {
  userModal.onClose();
  editingUser.value = null;
  resetUserForm();
}

async function saveUser() {
  savingUser.value = true;
  error.value = "";
  try {
    if (editingUser.value) {
      const payload = {
        role: userForm.value.role,
        scopes: userForm.value.scopes,
      };
      if (userForm.value.password) {
        payload.password = userForm.value.password;
      }
      await api.put(`/users/${editingUser.value.id}`, payload);
    } else {
      if (!userForm.value.name || !userForm.value.password) {
        error.value = "Username and password are required";
        savingUser.value = false;
        return;
      }
      await api.post("/users", {
        name: userForm.value.name,
        password: userForm.value.password,
        role: userForm.value.role,
        scopes: userForm.value.scopes,
      });
    }
    closeUserModal();
    await loadUsers();
  } catch (e) {
    error.value = e.response?.data?.error || "Unable to save the user";
  } finally {
    savingUser.value = false;
  }
}

function confirmDeleteUser(user) {
  deleteTarget.value = user;
  deleteModal.open();
}

function onDeleteModalClosed() {
  deleteModal.onClose();
  deleteTarget.value = null;
}

async function executeDelete() {
  deletingUser.value = true;
  try {
    await api.delete(`/users/${deleteTarget.value.id}`);
    deleteModal.close();
    await loadUsers();
  } catch (e) {
    error.value = e.response?.data?.error || "Unable to delete the user";
    deleteModal.close();
  } finally {
    deletingUser.value = false;
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

.col-actions {
  text-align: right;
  white-space: nowrap;
}

.badge {
  display: inline-block;
  font-size: 0.75em;
  padding: 0.1em 0.5em;
  border-radius: var(--radius-sm);
  vertical-align: middle;
  font-weight: var(--weight-semibold);
}

.badge-self {
  color: var(--color-primary-text);
  background: var(--color-primary-soft);
  margin-left: 0.4em;
}

.badge-admin {
  color: var(--color-danger);
  background: color-mix(in srgb, var(--color-danger) 15%, transparent);
}

.badge-user {
  color: var(--color-success);
  background: color-mix(in srgb, var(--color-success) 15%, transparent);
}

.scope-all {
  font-style: italic;
  opacity: 0.7;
}

.scope-none {
  font-style: italic;
}

.scope-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2xs);
}

.scope-checkbox {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  font-weight: var(--weight-normal);
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

.error-message {
  color: var(--color-danger);
  margin-bottom: var(--space-sm);
  padding: var(--space-sm);
  border: 1px solid var(--color-danger);
  border-radius: var(--radius-sm);
}
</style>
