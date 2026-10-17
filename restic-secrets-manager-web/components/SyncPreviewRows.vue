<template>
  <div class="preview-details">
    <p class="preview-summary">{{ summarizePreview(preview) }}</p>
    <div v-if="preview.secrets.length === 0" class="preview-empty">
      <i class="bi bi-check-circle-fill"/> {{ summarizePreview(preview) }}
    </div>
    <template v-else>
      <details
        v-for="secret in preview.secrets"
        :key="secret.name"
        class="preview-secret"
        :open="openByDefault"
      >
        <summary>
          <span class="secret-name mono">{{ secret.name }}</span>
          <span class="badge" :class="badgeClass(secret.status)">
            <i class="bi" :class="statusIcon(secret.status)"/> {{ statusLabel(secret.status) }}
          </span>
          <small class="text-muted">{{ secret.keys.length }} key{{ secret.keys.length === 1 ? "" : "s" }}</small>
        </summary>
        <div class="preview-keys">
          <div v-for="key in secret.keys" :key="key.key" class="preview-key">
            <span class="key-name mono">{{ key.key }}</span>
            <span class="key-value mono">{{ MASKED_VALUE }}</span>
            <small class="text-muted key-hint">{{ keyValueHint(key) }}</small>
            <span class="badge" :class="badgeClass(key.status)">
              <i class="bi" :class="statusIcon(key.status)"/> {{ statusLabel(key.status) }}
            </span>
          </div>
        </div>
      </details>
    </template>
  </div>
</template>

<script setup>
import {
  keyValueHint,
  MASKED_VALUE,
  statusIcon,
  statusLabel,
  summarizePreview,
} from "../utils/sync-preview";

const props = defineProps({
  preview: { type: Object, required: true },
});

const openByDefault = props.preview.secrets.length <= 5;

function badgeClass(status) {
  return {
    added: "badge-added",
    removed: "badge-removed",
    changed: "badge-changed",
  }[status];
}
</script>

<style scoped>
.preview-summary {
  margin: 0 0 var(--space-sm) 0;
}

.preview-empty {
  color: var(--color-success);
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
}

.preview-secret {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  margin-bottom: var(--space-2xs);
}

.preview-secret summary {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-2xs) var(--space-xs);
  cursor: pointer;
}

.secret-name {
  font-weight: var(--weight-semibold);
  word-break: break-all;
}

.mono {
  font-family: var(--font-family-mono);
}

.preview-keys {
  display: grid;
  gap: var(--space-2xs);
  padding: var(--space-2xs) var(--space-xs) var(--space-xs) var(--space-xs);
}

.preview-key {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) auto auto;
  align-items: center;
  gap: var(--space-xs);
}

.key-name {
  word-break: break-all;
}

.key-value {
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
}

.key-hint {
  white-space: nowrap;
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

.badge-added {
  background: color-mix(in srgb, var(--color-success) 15%, transparent);
  color: var(--color-success);
}

.badge-removed {
  background: color-mix(in srgb, var(--color-danger) 15%, transparent);
  color: var(--color-danger);
}

.badge-changed {
  background: color-mix(in srgb, var(--color-warning) 15%, transparent);
  color: var(--color-warning);
}

@media (max-width: 600px) {
  .preview-key {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      "name badge"
      "value badge"
      "hint badge";
  }

  .key-name {
    grid-area: name;
  }

  .key-value {
    grid-area: value;
  }

  .key-hint {
    grid-area: hint;
  }

  .badge {
    grid-area: badge;
  }
}
</style>
