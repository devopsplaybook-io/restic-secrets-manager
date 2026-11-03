import {
  computed,
  inject,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  watch,
} from "vue";
import { vi } from "vitest";

/**
 * Stand-ins for the Nuxt auto-imports and Vue reactivity helpers the pages and
 * components rely on. The component tests mount the SFCs directly, outside a
 * Nuxt runtime, so these globals are installed before the modules are imported.
 */
export const routeState = reactive({
  path: "/",
  params: {} as Record<string, string>,
  fullPath: "/",
  query: {} as Record<string, string>,
});

export const routerPush = vi.fn();

export const authState = {
  isAuthenticated: true,
  isAdmin: true,
  user: { userId: "user-1", name: "alice", role: "admin" },
  pendingDraft: null as unknown,
  init: vi.fn(),
  logout: vi.fn(),
  clearPendingDraft: vi.fn(),
};

Object.assign(globalThis, {
  ref,
  computed,
  watch,
  inject,
  onMounted,
  onUnmounted,
  useRoute: () => routeState,
  useRouter: () => ({ push: routerPush }),
  useAuthStore: () => authState,
  useModalDialog: () => {
    const isOpen = ref(false);
    return {
      dialogRef: ref(null),
      isOpen,
      open: () => {
        isOpen.value = true;
      },
      close: () => {
        isOpen.value = false;
      },
      onClose: () => {
        isOpen.value = false;
      },
    };
  },
  onBeforeRouteLeave: () => {},
});

if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}
