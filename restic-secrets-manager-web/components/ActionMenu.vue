<template>
  <div ref="root" class="action-menu">
    <button
      ref="toggleBtn"
      type="button"
      class="action-menu-toggle"
      :title="title"
      :aria-label="title"
      aria-haspopup="menu"
      :aria-expanded="open"
      :disabled="disabled"
      @click="toggle"
    >
      <i class="bi bi-three-dots-vertical" aria-hidden="true"/>
    </button>
    <div v-if="open" class="action-menu-panel" role="menu" :style="panelStyle">
      <button
        v-for="item in items"
        :key="item.key"
        type="button"
        role="menuitem"
        class="action-menu-item"
        :class="{ 'action-menu-item--danger': item.danger }"
        :disabled="item.disabled"
        @click="select(item)"
      >
        <i v-if="item.icon" class="bi" :class="item.icon" aria-hidden="true"/>
        <span>{{ item.label }}</span>
      </button>
    </div>
  </div>
</template>

<script setup>
defineProps({
  items: { type: Array, required: true },
  title: { type: String, default: "Actions" },
  disabled: { type: Boolean, default: false },
});
const emit = defineEmits(["select"]);

const root = ref(null);
const toggleBtn = ref(null);
const open = ref(false);
const panelStyle = ref({});

// The panel is positioned against the viewport (fixed) inside the inline
// style, so it is never clipped by scrollable ancestors (table figure,
// dialog body)
function toggle() {
  if (open.value) {
    close();
    return;
  }
  const rect = toggleBtn.value.getBoundingClientRect();
  panelStyle.value = {
    top: `${Math.round(rect.bottom + 4)}px`,
    right: `${Math.round(window.innerWidth - rect.right)}px`,
  };
  open.value = true;
}

function close() {
  open.value = false;
}

function select(item) {
  if (item.disabled) {
    return;
  }
  close();
  emit("select", item.key);
}

function onDocumentClick(event) {
  if (!root.value?.contains(event.target)) {
    close();
  }
}

function onDocumentKeydown(event) {
  if (event.key === "Escape") {
    // Keep an enclosing dialog open: the first Esc only dismisses the menu
    event.preventDefault();
    close();
    toggleBtn.value?.focus();
  }
}

function onScroll() {
  close();
}

watch(open, (isOpen) => {
  if (isOpen) {
    document.addEventListener("click", onDocumentClick);
    document.addEventListener("keydown", onDocumentKeydown);
    window.addEventListener("scroll", onScroll, true);
  } else {
    document.removeEventListener("click", onDocumentClick);
    document.removeEventListener("keydown", onDocumentKeydown);
    window.removeEventListener("scroll", onScroll, true);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener("click", onDocumentClick);
  document.removeEventListener("keydown", onDocumentKeydown);
  window.removeEventListener("scroll", onScroll, true);
});
</script>

<style scoped>
.action-menu {
  position: relative;
  display: inline-block;
}

.action-menu-toggle {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.25em 0.5em;
  color: var(--color-text-muted);
  border-radius: var(--radius-sm);
  transition: all 0.15s;
}

.action-menu-toggle:hover:not(:disabled) {
  background: var(--color-surface-hover);
  color: var(--color-text);
}

.action-menu-toggle:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.action-menu-panel {
  position: fixed;
  z-index: 1000;
  display: grid;
  min-width: 190px;
  padding: var(--space-2xs);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
}

.action-menu-item {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: var(--space-sm);
  width: 100%;
  padding: var(--space-xs) var(--space-sm);
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--color-text);
  font-size: var(--text-base);
  font-weight: var(--weight-normal);
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
}

.action-menu-item:hover:not(:disabled) {
  background: var(--color-surface-hover);
}

.action-menu-item:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-menu-item--danger {
  color: var(--color-danger);
}

.action-menu-item--danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-danger) 12%, transparent);
}
</style>
