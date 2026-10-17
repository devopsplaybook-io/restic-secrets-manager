<template>
  <div v-if="visible" class="session-expiry-banner" role="status">
    <i class="bi bi-exclamation-triangle-fill"/>
    <span>
      Your session ends in {{ remainingText }} — save your work; you will be
      signed out when it expires.
    </span>
  </div>
</template>

<script setup>
const authStore = useAuthStore();
const visible = ref(false);
const remainingText = ref("");
let pollTimer = null;

function update() {
  if (!authStore.isAuthenticated) {
    visible.value = false;
    return;
  }
  const minutes = authStore.sessionMinutesRemaining;
  if (minutes === null || minutes > 5) {
    visible.value = false;
    return;
  }
  remainingText.value =
    minutes <= 1 ? "less than a minute" : `${minutes} min`;
  visible.value = true;
}

watch(() => authStore.isAuthenticated, update);

onMounted(() => {
  update();
  pollTimer = setInterval(update, 30000);
});

onUnmounted(() => {
  if (pollTimer) {
    clearInterval(pollTimer);
  }
  visible.value = false;
});
</script>

<style scoped>
.session-expiry-banner {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin-inline: var(--space-sm);
  padding: var(--space-xs) var(--space-sm);
  color: var(--color-warning);
  border: 1px solid var(--color-warning);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--color-warning) 10%, transparent);
}

.session-expiry-banner i {
  color: var(--color-warning);
}
</style>
