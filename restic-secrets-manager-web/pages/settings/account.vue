<template>
  <div>
    <div class="page-header">
      <div>
        <h1>Account</h1>
        <small class="text-muted"
          >Approve a sign-in started on another device</small
        >
      </div>
    </div>

    <AuthorizeDeviceCard
      v-if="loginCodeEnabled"
      :service="loginCodeService"
      :labels="{ title: 'Log in on another device' }"
      :heading-level="2"
    />
  </div>
</template>

<script setup>
import AuthorizeDeviceCard from "@devopsplaybook.io/common-web/components/AuthorizeDeviceCard.vue";
import {
  getLoginCodeService,
  probeLoginCodeAvailability,
} from "../../utils/loginCodes";

const authStore = useAuthStore();
const router = useRouter();

const loginCodeService = getLoginCodeService();
const loginCodeEnabled = ref(false);

onMounted(async () => {
  authStore.init();
  if (!authStore.isAuthenticated) {
    router.push("/login");
    return;
  }
  loginCodeEnabled.value = await probeLoginCodeAvailability(loginCodeService);
});
</script>

<style scoped>
.page-header {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  margin-bottom: var(--space-lg);
}
</style>
