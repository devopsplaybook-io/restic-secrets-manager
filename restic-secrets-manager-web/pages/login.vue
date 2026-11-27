<template>
  <div class="login-container">
    <div class="login-grid">
      <article class="login-card">
        <header>
          <hgroup>
            <h1>Secrets Manager</h1>
            <p v-if="isSetup">Create your admin account to get started</p>
            <p v-else>Sign in to your account</p>
          </hgroup>
        </header>

        <form @submit.prevent="handleSubmit">
          <div v-if="error" class="error-message">{{ error }}</div>

          <label>
            Username
            <input
              v-model="name"
              type="text"
              placeholder="Your username"
              required
              autocomplete="username"
            >
          </label>

          <label>
            Password
            <input
              ref="passwordInput"
              v-model="password"
              type="password"
              placeholder="Your password"
              required
              autocomplete="current-password"
            >
          </label>

          <label v-if="isSetup">
            Confirm Password
            <input
              v-model="passwordConfirm"
              type="password"
              placeholder="Confirm password"
              required
              autocomplete="new-password"
            >
          </label>

          <footer>
            <button type="submit" :aria-busy="loading">
              {{ isSetup ? "Create Admin Account" : "Login" }}
            </button>
          </footer>
        </form>
      </article>

      <LoginWithCodeCard
        v-if="showLoginCode"
        :service="loginCodeService"
        :heading-level="2"
        @approved="onCodeApproved"
        @use-password="focusPassword"
      />
    </div>
  </div>
</template>

<script setup>
import LoginWithCodeCard from "@devopsplaybook.io/common-web/components/LoginWithCodeCard.vue";
import api from "../utils/api";
import {
  getLoginCodeService,
  probeLoginCodeAvailability,
} from "../utils/loginCodes";

const authStore = useAuthStore();
const router = useRouter();

const name = ref("");
const password = ref("");
const passwordConfirm = ref("");
const loading = ref(false);
const error = ref("");
const isSetup = ref(false);
const checkingInit = ref(true);
const passwordInput = ref(null);

const loginCodeService = getLoginCodeService();
const loginCodeEnabled = ref(false);
const showLoginCode = computed(
  () => !checkingInit.value && !isSetup.value && loginCodeEnabled.value,
);

onMounted(async () => {
  authStore.init();
  if (authStore.isAuthenticated) {
    router.push("/");
    return;
  }
  // Check if any users exist (first-time setup)
  try {
    const res = await api.get("/status/initialization");
    isSetup.value = !res.data.initialized;
  } catch {
    isSetup.value = false;
  }
  checkingInit.value = false;
  if (!isSetup.value) {
    loginCodeEnabled.value =
      await probeLoginCodeAvailability(loginCodeService);
  }
});

function onCodeApproved() {
  // The service already persisted the redeemed session.
  router.push(postLoginPath());
}

function focusPassword() {
  passwordInput.value?.focus();
}

async function handleSubmit() {
  error.value = "";
  loading.value = true;
  try {
    if (isSetup.value) {
      if (password.value !== passwordConfirm.value) {
        error.value = "Passwords do not match";
        loading.value = false;
        return;
      }
      await api.post("/users", { name: name.value, password: password.value });
    }
    await authStore.login(name.value, password.value);
    router.push(postLoginPath());
  } catch (e) {
    error.value = e.response?.data?.error || "An error occurred";
  } finally {
    loading.value = false;
  }
}

// After a session-expiry redirect, send the user back to the page they were
// working on (same-site paths only)
function postLoginPath() {
  let redirect = null;
  try {
    redirect = sessionStorage.getItem("redirectAfterLogin");
    sessionStorage.removeItem("redirectAfterLogin");
  } catch {
    return "/";
  }
  if (redirect && redirect.startsWith("/") && !redirect.startsWith("//")) {
    return redirect;
  }
  return "/";
}
</script>

<style scoped>
.login-container {
  display: grid;
  place-items: center;
  min-height: 80vh;
}

.login-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-lg);
  align-items: start;
  width: 100%;
  max-width: 900px;
}

.login-card {
  max-width: 400px;
  width: 100%;
}

@media (max-width: 900px) {
  .login-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

.error-message {
  color: var(--color-danger);
  margin-bottom: var(--space-sm);
  padding: var(--space-sm);
  border: 1px solid var(--color-danger);
  border-radius: var(--radius-sm);
}

footer {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  align-items: center;
}
</style>
