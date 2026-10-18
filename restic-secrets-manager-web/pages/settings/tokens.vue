<template>
  <div>
    <div class="page-header">
      <div>
        <h1>API Tokens</h1>
        <small class="text-muted">Personal tokens for scripts and CI: they grant the same access as your user</small>
      </div>
      <button @click="openCreateToken">
        <i class="bi bi-key"/> Create Token
      </button>
    </div>

    <div v-if="error" class="error-message">{{ error }}</div>

    <figure v-if="tokens.length > 0">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Created</th>
            <th>Expires</th>
            <th>Last used</th>
            <th class="col-actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in tokens" :key="t.id">
            <td>
              <span class="token-name">{{ t.name }}</span>
            </td>
            <td>{{ formatDate(t.dateCreated) }}</td>
            <td>
              <span v-if="t.expiresAt">{{ formatDate(t.expiresAt) }}</span>
              <span v-else class="text-muted">Never</span>
            </td>
            <td>
              <span v-if="t.lastUsedAt">{{ formatDate(t.lastUsedAt) }}</span>
              <span v-else class="text-muted">&mdash;</span>
            </td>
            <td class="col-actions">
              <button
                class="icon-btn icon-btn--danger"
                title="Revoke"
                @click="confirmRevokeToken(t)"
              >
                <i class="bi bi-trash3-fill"/>
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </figure>
    <div v-else class="empty-state">
      <i class="bi bi-key"/>
      <p>No API tokens yet.</p>
    </div>

    <!-- CREATE TOKEN MODAL -->
    <dialog v-if="showCreateModal" ref="create-token" @click.self="closeCreateModal" @close="onCreateModalClosed">
      <article>
        <header>
          <button aria-label="Close" class="close-btn" @click="closeCreateModal"><i class="bi bi-x-lg"/></button>
          <h3><i class="bi bi-key"/> Create API Token</h3>
        </header>
        <label>
          Token name
          <input
            v-model="tokenForm.name"
            type="text"
            placeholder="e.g. ci-pipeline"
            maxlength="255"
          >
        </label>
        <label>
          Expires (optional)
          <input v-model="tokenForm.expiresAt" type="datetime-local">
        </label>
        <small><i class="bi bi-info-circle-fill"/> A token grants the same permissions as your user, resolved live.</small>
        <footer>
          <button class="secondary" @click="closeCreateModal">Cancel</button>
          <button :disabled="creatingToken" @click="createToken">
            {{ creatingToken ? "Creating…" : "Create" }}
          </button>
        </footer>
      </article>
    </dialog>

    <!-- TOKEN CREATED MODAL -->
    <dialog v-if="showCreatedModal" ref="created-token" @click.self="closeCreatedModal" @close="onCreatedModalClosed">
      <article>
        <header>
          <button aria-label="Close" class="close-btn" @click="closeCreatedModal"><i class="bi bi-x-lg"/></button>
          <h3><i class="bi bi-check-circle"/> Token created</h3>
        </header>
        <label>
          Token value
          <input :value="createdTokenValue" type="text" readonly>
        </label>
        <p class="warning-text">
          <i class="bi bi-exclamation-triangle-fill"/>
          Store it now — it will not be shown again.
        </p>
        <footer>
          <button class="secondary" @click="closeCreatedModal">Close</button>
          <button @click="copyCreatedToken">
            <i class="bi" :class="tokenCopied ? 'bi-check2' : 'bi-clipboard'"/>
            {{ tokenCopied ? "Copied" : "Copy" }}
          </button>
        </footer>
      </article>
    </dialog>

    <!-- REVOKE CONFIRM MODAL -->
    <dialog v-if="showRevokeConfirm" ref="revoke-token" @click.self="revokeModal.close()" @close="onRevokeModalClosed">
      <article>
        <header>
          <button aria-label="Close" class="close-btn" @click="revokeModal.close()"><i class="bi bi-x-lg"/></button>
          <h3><i class="bi bi-exclamation-triangle-fill"/> Revoke Token</h3>
        </header>
        <p>
          Are you sure you want to revoke token
          <strong>{{ revokeTarget?.name }}</strong
          >?
        </p>
        <p>Scripts or CI jobs using it will stop working. This action cannot be undone.</p>
        <footer>
          <button class="secondary" @click="revokeModal.close()">Cancel</button>
          <button class="contrast" :disabled="revokingToken" @click="executeRevoke">
            {{ revokingToken ? "Revoking…" : "Revoke" }}
          </button>
        </footer>
      </article>
    </dialog>
  </div>
</template>

<script setup>
import api from "../../utils/api";
import { copyTextToClipboard } from "../../utils/clipboard";
const authStore = useAuthStore();
const router = useRouter();

const tokens = ref([]);
const error = ref("");

const createModal = useModalDialog("create-token");
const showCreateModal = createModal.isOpen;
const creatingToken = ref(false);
const tokenForm = ref({ name: "", expiresAt: "" });

const createdModal = useModalDialog("created-token");
const showCreatedModal = createdModal.isOpen;
const createdTokenValue = ref("");
const tokenCopied = ref(false);

const revokeModal = useModalDialog("revoke-token");
const showRevokeConfirm = revokeModal.isOpen;
const revokeTarget = ref(null);
const revokingToken = ref(false);

onMounted(async () => {
  authStore.init();
  if (!authStore.isAuthenticated) {
    router.push("/login");
    return;
  }
  await loadTokens();
});

async function loadTokens() {
  try {
    const res = await api.get("/users/tokens");
    tokens.value = res.data || [];
  } catch (e) {
    error.value = e.response?.data?.error || "Unable to load API tokens";
  }
}

function formatDate(iso) {
  return new Date(iso).toLocaleString();
}

function openCreateToken() {
  tokenForm.value = { name: "", expiresAt: "" };
  createModal.open();
}

function closeCreateModal() {
  createModal.close();
  tokenForm.value = { name: "", expiresAt: "" };
}

function onCreateModalClosed() {
  createModal.onClose();
  tokenForm.value = { name: "", expiresAt: "" };
}

async function createToken() {
  if (!tokenForm.value.name) {
    error.value = "Token name is required";
    return;
  }
  creatingToken.value = true;
  error.value = "";
  try {
    const payload = { name: tokenForm.value.name };
    if (tokenForm.value.expiresAt) {
      payload.expiresAt = new Date(tokenForm.value.expiresAt).toISOString();
    }
    const res = await api.post("/users/tokens", payload);
    createdTokenValue.value = res.data.token;
    tokenCopied.value = false;
    createModal.close();
    createdModal.open();
    await loadTokens();
  } catch (e) {
    error.value = e.response?.data?.error || "Unable to create the API token";
  } finally {
    creatingToken.value = false;
  }
}

function closeCreatedModal() {
  createdModal.close();
  createdTokenValue.value = "";
}

function onCreatedModalClosed() {
  createdModal.onClose();
  createdTokenValue.value = "";
}

async function copyCreatedToken() {
  const copied = await copyTextToClipboard(createdTokenValue.value);
  if (copied) {
    tokenCopied.value = true;
  }
}

function confirmRevokeToken(token) {
  revokeTarget.value = token;
  revokeModal.open();
}

function onRevokeModalClosed() {
  revokeModal.onClose();
  revokeTarget.value = null;
}

async function executeRevoke() {
  revokingToken.value = true;
  try {
    await api.delete(`/users/tokens/${revokeTarget.value.id}`);
    revokeModal.close();
    await loadTokens();
  } catch (e) {
    error.value = e.response?.data?.error || "Unable to revoke the API token";
    revokeModal.close();
  } finally {
    revokingToken.value = false;
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

.token-name {
  font-weight: var(--weight-semibold);
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

.icon-btn--danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-danger) 15%, transparent);
  color: var(--color-danger);
}

.warning-text {
  color: var(--color-danger);
  margin: 0;
}

.error-message {
  color: var(--color-danger);
  margin-bottom: var(--space-sm);
  padding: var(--space-sm);
  border: 1px solid var(--color-danger);
  border-radius: var(--radius-sm);
}
</style>
