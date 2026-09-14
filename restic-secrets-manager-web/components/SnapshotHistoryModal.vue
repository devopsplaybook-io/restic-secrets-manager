<template>
  <dialog ref="history-modal" @click.self="close" @close="onClosed">
    <article class="history-modal">
      <header>
        <button aria-label="Close" class="close-btn" @click="close"><i class="bi bi-x-lg"/></button>
        <h3><i class="bi bi-clock-history"/> Snapshot History — {{ project.name }}</h3>
      </header>

      <div v-if="restoredMessage" class="success-message">
        <i class="bi bi-check-circle-fill"/> {{ restoredMessage }}
      </div>
      <div v-if="error" class="error-message">{{ error }}</div>

      <div v-if="loading" class="loading-state">
        <i class="bi bi-arrow-repeat spin"/> Loading snapshots…
      </div>

      <ol v-else-if="snapshots.length > 0" class="timeline">
        <li v-for="(snapshot, index) in snapshots" :key="snapshot.id" class="timeline-entry">
          <div class="timeline-marker" :class="{ latest: index === 0 }">
            <i class="bi" :class="index === 0 ? 'bi-record-circle-fill' : 'bi-record-circle'"/>
          </div>
          <div class="timeline-content">
            <div class="timeline-time">
              {{ formatTime(snapshot.time) }}
              <span v-if="index === 0" class="latest-tag">latest</span>
            </div>
            <small class="text-muted mono">{{ shortId(snapshot.id) }}</small>
            <div class="timeline-actions">
              <button class="secondary" :disabled="restoring" @click="askRestore(snapshot)">
                <i class="bi bi-arrow-counterclockwise"/> Restore
              </button>
            </div>
            <div v-if="confirming === snapshot.id" class="timeline-confirm">
              <p>
                Restore this snapshot? All the project secrets will be
                replaced with the content of snapshot
                <strong>{{ shortId(snapshot.id) }}</strong>.
              </p>
              <div class="confirm-actions">
                <button class="secondary" :disabled="restoring" @click="confirming = ''">Cancel</button>
                <button class="contrast" :disabled="restoring" @click="restoreSnapshot(snapshot)">
                  {{ restoring ? "Restoring…" : "Restore" }}
                </button>
              </div>
            </div>
          </div>
        </li>
      </ol>
      <div v-else class="empty-state">
        <i class="bi bi-clock-history"/>
        <p>No snapshots in this repository yet. Push secrets to create one.</p>
      </div>

      <footer>
        <button class="secondary" @click="close">Close</button>
      </footer>
    </article>
  </dialog>
</template>

<script setup>
import api from "../utils/api";

const props = defineProps({
  project: { type: Object, required: true },
});
const emit = defineEmits(["closed", "restored"]);

const modal = useModalDialog("history-modal");
const snapshots = ref([]);
const loading = ref(true);
const error = ref("");
const confirming = ref("");
const restoring = ref(false);
const restoredMessage = ref("");

onMounted(async () => {
  modal.open();
  await loadSnapshots();
});

function close() {
  modal.close();
}

function onClosed() {
  modal.onClose();
  emit("closed");
}

async function loadSnapshots() {
  loading.value = true;
  error.value = "";
  try {
    const res = await api.get(`/projects/${props.project.id}/snapshots`);
    snapshots.value = res.data.snapshots || [];
  } catch (e) {
    error.value = e.response?.data?.error || "Unable to load the snapshot history";
  } finally {
    loading.value = false;
  }
}

function askRestore(snapshot) {
  confirming.value = snapshot.id;
}

async function restoreSnapshot(snapshot) {
  restoring.value = true;
  error.value = "";
  try {
    const res = await api.post(
      `/projects/${props.project.id}/snapshots/${snapshot.id}/restore`,
    );
    confirming.value = "";
    restoredMessage.value = `Restored snapshot ${shortId(res.data.snapshotId)}: ${res.data.secrets} secret(s) and ${res.data.keys} key(s).`;
    emit("restored");
  } catch (e) {
    error.value = e.response?.data?.error || "Unable to restore the snapshot";
  } finally {
    restoring.value = false;
  }
}

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function shortId(id) {
  return id ? id.substring(0, 8) : id;
}
</script>

<style scoped>
.history-modal {
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

.timeline {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-md);
  max-height: 55vh;
  overflow-y: auto;
}

.timeline-entry {
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-areas: "marker content";
  column-gap: var(--space-sm);
}

.timeline-marker {
  grid-area: marker;
  position: relative;
  color: var(--color-text-muted);
  font-size: var(--text-md);
}
.timeline-marker.latest {
  color: var(--color-primary);
}
.timeline-marker i {
  margin-top: 0.25em;
}
.timeline-entry:not(:last-child) .timeline-marker::after {
  content: "";
  position: absolute;
  top: 1.6em;
  bottom: calc(-1 * var(--space-md));
  width: 1px;
  background: var(--color-border);
}

.timeline-content {
  grid-area: content;
  display: grid;
  gap: var(--space-2xs);
  justify-items: start;
}

.timeline-time {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  font-weight: var(--weight-semibold);
}

.latest-tag {
  font-size: var(--text-xs);
  text-transform: uppercase;
  background: var(--color-primary-soft);
  color: var(--color-primary-text);
  border-radius: var(--radius-full);
  padding: 0.1em 0.6em;
}

.mono {
  font-family: var(--font-family-mono);
  word-break: break-all;
}

.timeline-actions {
  display: flex;
}

.timeline-confirm {
  border: 1px solid var(--color-warning);
  border-radius: var(--radius-sm);
  padding: var(--space-sm);
  background: color-mix(in srgb, var(--color-warning) 8%, transparent);
}
.timeline-confirm p {
  margin: 0 0 var(--space-sm) 0;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-xs);
}

.error-message {
  color: var(--color-danger);
  margin-bottom: var(--space-sm);
  padding: var(--space-sm);
  border: 1px solid var(--color-danger);
  border-radius: var(--radius-sm);
}

.success-message {
  color: var(--color-success);
  margin-bottom: var(--space-sm);
  padding: var(--space-sm);
  border: 1px solid var(--color-success);
  border-radius: var(--radius-sm);
}
</style>
