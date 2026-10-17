<template>
  <dialog ref="sync-preview-modal" @click.self="close" @close="onClosed">
    <article class="preview-modal">
      <header>
        <button aria-label="Close" class="close-btn" @click="close"><i class="bi bi-x-lg"/></button>
        <h3><i class="bi bi-eye-fill"/> {{ title }} — {{ project.name }}</h3>
      </header>

      <div v-if="error" class="error-message">{{ error }}</div>

      <div v-if="loading" class="loading-state">
        <i class="bi bi-arrow-repeat spin"/> Computing preview…
      </div>
      <SyncPreviewRows v-else-if="preview" :preview="preview"/>

      <footer>
        <button class="secondary" :disabled="executing" @click="close">Cancel</button>
        <button class="contrast" :disabled="loading || executing" @click="execute">
          {{ executing ? "Working…" : confirmLabel }}
        </button>
      </footer>
    </article>
  </dialog>
</template>

<script setup>
import api from "../utils/api";

const props = defineProps({
  project: { type: Object, required: true },
  // What the confirmed operation will be: "pull", "discard" or "snapshot"
  mode: { type: String, required: true },
  // Snapshot to restore when the mode is "snapshot"
  snapshotId: { type: String, default: "" },
});
const emit = defineEmits(["closed", "done"]);

const modal = useModalDialog("sync-preview-modal");
const preview = ref(null);
const loading = ref(true);
const executing = ref(false);
const error = ref("");

const TITLES = {
  pull: "Pull Preview",
  discard: "Discard Preview",
  snapshot: "Restore Preview",
};
const CONFIRM_LABELS = {
  pull: "Pull",
  discard: "Discard changes",
  snapshot: "Restore",
};

const title = computed(() => TITLES[props.mode] || "Change Preview");
const confirmLabel = computed(() => CONFIRM_LABELS[props.mode] || "Confirm");

onMounted(async () => {
  modal.open();
  await loadPreview();
});

function close() {
  modal.close();
}

function onClosed() {
  modal.onClose();
  emit("closed");
}

async function loadPreview() {
  loading.value = true;
  error.value = "";
  try {
    const endpoint =
      props.mode === "snapshot"
        ? `snapshots/${props.snapshotId}`
        : props.mode;
    const res = await api.get(`/projects/${props.project.id}/preview/${endpoint}`);
    preview.value = res.data.preview;
  } catch (e) {
    error.value = e.response?.data?.error || "Unable to compute the change preview";
  } finally {
    loading.value = false;
  }
}

async function execute() {
  executing.value = true;
  error.value = "";
  try {
    let res;
    if (props.mode === "pull") {
      res = await api.post(`/projects/${props.project.id}/pull`);
    } else if (props.mode === "discard") {
      res = await api.post(`/projects/${props.project.id}/discard`);
    } else {
      res = await api.post(
        `/projects/${props.project.id}/snapshots/${props.snapshotId}/restore`,
      );
    }
    modal.close();
    emit("done", resultMessage(res.data));
  } catch (e) {
    error.value = e.response?.data?.error || "The operation failed";
  } finally {
    executing.value = false;
  }
}

function resultMessage(data) {
  const snapshot = data.snapshotId ? data.snapshotId.substring(0, 8) : "";
  if (props.mode === "pull") {
    return `Pulled ${data.secrets} secret(s) and ${data.keys} key(s) from snapshot ${snapshot}.`;
  }
  if (props.mode === "discard") {
    return `Discarded local changes: restored ${data.secrets} secret(s) and ${data.keys} key(s) from snapshot ${snapshot}.`;
  }
  return `Restored snapshot ${snapshot}: ${data.secrets} secret(s) and ${data.keys} key(s).`;
}
</script>

<style scoped>
.preview-modal {
  min-width: min(560px, 90vw);
}

.loading-state {
  color: var(--color-text-muted);
  padding: var(--space-lg) 0;
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

.error-message {
  color: var(--color-danger);
  margin-bottom: var(--space-sm);
  padding: var(--space-sm);
  border: 1px solid var(--color-danger);
  border-radius: var(--radius-sm);
}
</style>
