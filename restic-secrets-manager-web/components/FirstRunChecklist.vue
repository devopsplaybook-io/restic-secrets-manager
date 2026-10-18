<template>
  <article v-if="visible" class="first-run-checklist">
    <header>
      <h3><i class="bi bi-list-check"/> Getting started</h3>
      <button
        class="icon-btn"
        aria-label="Dismiss the getting started checklist"
        title="Dismiss"
        @click="dismiss"
      >
        <i class="bi bi-x-lg"/>
      </button>
    </header>
    <ol class="checklist-steps">
      <li :class="{ done: createDone }">
        <i class="bi" :class="createDone ? 'bi-check-circle-fill' : 'bi-circle'"/>
        <div class="step-text">
          <strong>Create a project</strong>
          <small class="text-muted">
            Define the S3 endpoint, bucket and restic repository settings.
          </small>
        </div>
        <button v-if="!createDone" class="secondary" @click="emit('createProject')">
          <i class="bi bi-plus-lg"/> Create project
        </button>
      </li>
      <li :class="{ done: grantDone }">
        <i class="bi" :class="grantDone ? 'bi-check-circle-fill' : 'bi-circle'"/>
        <div class="step-text">
          <strong>Grant users access</strong>
          <small class="text-muted">
            Give regular users a project scope so they can read the secrets.
          </small>
        </div>
        <NuxtLink v-if="!grantDone" to="/settings/users" class="outline-link">
          <i class="bi bi-people"/> Manage users
        </NuxtLink>
      </li>
      <li :class="{ done: syncDone }">
        <i class="bi" :class="syncDone ? 'bi-check-circle-fill' : 'bi-circle'"/>
        <div class="step-text">
          <strong>Sync your secrets</strong>
          <small class="text-muted">
            Add secrets, then use the Pull or Push buttons on the project card.
          </small>
        </div>
      </li>
    </ol>
  </article>
</template>

<script setup>
import api from "../utils/api";
import {
  dismissFirstRunChecklist,
  isFirstRunChecklistDismissed,
  isCreateProjectStepDone,
  isGrantAccessStepDone,
  isSyncSecretsStepDone,
} from "../utils/first-run";

const props = defineProps({
  projects: { type: Array, default: () => [] },
});

const emit = defineEmits(["createProject"]);

const authStore = useAuthStore();

const dismissed = ref(isFirstRunChecklistDismissed());
// Fetched once, best effort: on failure the step simply stays unchecked
const users = ref([]);

const createDone = computed(() => isCreateProjectStepDone(props.projects));
const grantDone = computed(() => isGrantAccessStepDone(users.value));
const syncDone = computed(() => isSyncSecretsStepDone(props.projects));
const visible = computed(
  () =>
    authStore.isAdmin &&
    !dismissed.value &&
    !(createDone.value && grantDone.value && syncDone.value),
);

onMounted(() => {
  if (authStore.isAdmin) {
    loadUsers();
  }
});

async function loadUsers() {
  try {
    const res = await api.get("/users");
    users.value = res.data || [];
  } catch {
    users.value = [];
  }
}

function dismiss() {
  dismissed.value = true;
  dismissFirstRunChecklist();
}
</script>

<style scoped>
.first-run-checklist > header {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
}

.first-run-checklist h3 {
  margin: 0;
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

.checklist-steps {
  display: grid;
  gap: var(--space-sm);
  margin: var(--space-sm) 0 0;
  padding: 0;
  list-style: none;
}

.checklist-steps li {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: var(--space-sm);
}

.checklist-steps li > i {
  color: var(--color-text-muted);
}

.checklist-steps li.done > i {
  color: var(--color-success);
}

.checklist-steps li.done .step-text strong {
  color: var(--color-text-muted);
  text-decoration: line-through;
}

.step-text {
  display: grid;
}

.step-text small {
  margin-top: 0.1em;
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
</style>
