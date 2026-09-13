<template>
  <div id="page-layout">
    <header>
      <Navigation />
    </header>
    <main>
      <NuxtPage />
    </main>
  </div>
</template>

<script setup>
const authStore = useAuthStore();
const router = useRouter();

// Initialize the auth session (local token expiry check only)
authStore.init();
if (!authStore.isAuthenticated) {
  router.push("/login");
}

// Theme management
const theme = ref(localStorage.getItem("theme") || "system");

function getEffectiveTheme() {
  if (theme.value === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return theme.value;
}

function applyTheme() {
  document.documentElement.setAttribute("data-theme", getEffectiveTheme());
}

function toggleTheme() {
  const current = getEffectiveTheme();
  theme.value = current === "dark" ? "light" : "dark";
}

watch(theme, (val) => {
  localStorage.setItem("theme", val);
  applyTheme();
});

// Layout height
function updateAppHeight() {
  const height = window.visualViewport?.height ?? window.innerHeight;
  document.documentElement.style.setProperty("--app-height", `${height}px`);
}

onMounted(() => {
  applyTheme();
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", applyTheme);
  updateAppHeight();
  window.addEventListener("resize", updateAppHeight);
  window.visualViewport?.addEventListener("resize", updateAppHeight);
});

onUnmounted(() => {
  window.removeEventListener("resize", updateAppHeight);
  window.visualViewport?.removeEventListener("resize", updateAppHeight);
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .removeEventListener("change", applyTheme);
});

// Provide theme to child components
provide("theme", theme);
provide("toggleTheme", toggleTheme);
</script>

<style>
#page-layout {
  display: grid;
  grid-template-columns: 1fr;
  grid-template-rows: auto 1fr;
  width: 100vw;
  height: var(--app-height, 100dvh);
  overflow: hidden !important;
}

#page-layout > header {
  height: var(--header-height, 3em);
}

#page-layout > header,
main {
  padding: var(--space-sm);
}

main {
  grid-column: 1;
  grid-row: 2;
  overflow-x: hidden;
  overflow-y: auto;
  width: 100%;
  height: auto;
}

/* Common Component */

.actions i {
  color: var(--color-text);
  font-size: var(--text-xl);
  cursor: pointer;
  margin-left: var(--space-sm);
  margin-right: var(--space-sm);
}

.fab-button {
  position: fixed;
  bottom: var(--space-xl);
  right: var(--space-xl);
  z-index: 1000;
  opacity: 0.3;
  color: var(--color-on-primary);
  border: none;
  border-radius: var(--radius-full);
  padding: var(--space-sm) var(--space-lg);
  font-size: var(--text-default);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.13);
  cursor: pointer;
  background: var(--color-primary);
  transition:
    background var(--transition-normal),
    opacity var(--transition-normal);
}
.fab-button:hover {
  background: var(--color-primary);
  opacity: 0.9;
}
</style>
