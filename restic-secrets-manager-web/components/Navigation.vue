<template>
  <nav>
    <ul class="menu-links">
      <li>
        <NuxtLink to="/" class="brand-link"
          ><img src="/images/logo.svg" alt="Restic Secrets Manager" class="nav-logo" >
          <strong class="brand-name">Secrets Manager</strong></NuxtLink
        >
      </li>
    </ul>
    <ul class="menu-links">
      <li>
        <NuxtLink to="/" :class="activeRoute == '/' ? 'active' : 'inactive'"
          ><i class="bi bi-box-seam"/>
          <span class="nav-label">Projects</span></NuxtLink
        >
      </li>
      <li v-if="authStore.isAdmin">
        <NuxtLink
          to="/settings/users"
          :class="activeRoute == '/settings' ? 'active' : 'inactive'"
          ><i class="bi bi-people"/>
          <span class="nav-label">Users</span></NuxtLink
        >
      </li>
      <li>
        <button class="theme-toggle" aria-label="Toggle theme" @click="toggleTheme">
          <i
            class="bi"
            :class="effectiveTheme === 'dark' ? 'bi-sun' : 'bi-moon'"
          />
        </button>
      </li>
      <li>
        <button class="logout-btn" aria-label="Logout" @click="logout">
          <i class="bi bi-box-arrow-right"/>
          <span class="nav-label">Logout</span>
        </button>
      </li>
    </ul>
  </nav>
</template>

<script setup>
const authStore = useAuthStore();
const router = useRouter();
const route = useRoute();

const theme = inject("theme", ref("system"));
const toggleTheme = inject("toggleTheme", () => {});

const effectiveTheme = computed(() => {
  if (theme.value === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return theme.value;
});

const activeRoute = computed(() => {
  const segments = route.fullPath.split("?")[0].split("/");
  return segments.length > 1 ? `/${segments[1]}` : "/";
});

function logout() {
  authStore.logout();
  router.push("/login");
}
</script>

<style scoped>
.menu-links {
  gap: var(--space-sm);
  font-weight: var(--weight-bold);
}

.menu-links li {
  padding-top: var(--space-2xs);
  padding-bottom: var(--space-2xs);
  font-size: var(--text-md);
}
.menu-links .inactive {
  opacity: 0.5;
}
.menu-links .active {
  color: var(--color-primary);
}

.menu-links a,
.menu-links button {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: none;
  border: none;
  padding: 0;
  color: inherit;
  font: inherit;
  cursor: pointer;
  box-shadow: none;
}

.nav-logo {
  height: 1.4em;
  vertical-align: middle;
  margin-right: 0.5rem;
}

.menu-links i {
  margin-right: var(--space-2xs);
  flex-shrink: 0;
}

.theme-toggle,
.logout-btn {
  opacity: 0.7;
}
.theme-toggle:hover,
.logout-btn:hover {
  opacity: 1;
}

/* Hide brand name on mobile and intermediate screens */
@media (max-width: 999px) {
  .brand-name {
    display: none;
  }
}

/* Hide nav labels on narrow screens */
@media (max-width: 767px) {
  .nav-label {
    display: none;
  }

  .menu-links li {
    font-size: calc(var(--text-md) * 1.5);
  }
}

:root[data-theme="light"] .menu-links .inactive {
  opacity: 0.8;
}
:root[data-theme="light"] .menu-links .active {
  color: var(--color-primary);
}
</style>
