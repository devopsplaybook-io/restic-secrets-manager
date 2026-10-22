import { acceptHMRUpdate, defineStore } from "pinia";
import { jwtDecode } from "jwt-decode";
import api from "../utils/api";
import {
  clearSecretDraft,
  takeSecretDraftForUser,
  type SecretDraft,
} from "../utils/secret-draft";

export interface UserSession {
  isAuthenticated: boolean;
  userId?: string;
  userName?: string;
  role?: "admin" | "user";
  scopes?: string[];
}

interface JwtPayload {
  exp: number;
  userId: string;
  userName: string;
  role: "admin" | "user";
  scopes: string[];
}

// The warning banner shows how long is left once this much time remains
const SESSION_EXPIRY_WARNING_MS = 5 * 60 * 1000;

export const useAuthStore = defineStore("auth", {
  state: () => ({
    token: localStorage.getItem("token") || "",
    user: JSON.parse(localStorage.getItem("user") || "null") as Record<
      string,
      unknown
    > | null,
    initialized: false,
    // Epoch milliseconds at which the current token expires (0 = unknown)
    expiresAt: 0,
    // Same-user draft carried over a re-login, offered for restoration on the
    // project page (memory only: never stored across users)
    pendingDraft: null as SecretDraft | null,
  }),

  getters: {
    isAuthenticated: (state) => !!state.token,
    isAdmin: (state) => state.user?.role === "admin",
    currentUser: (state) => state.user,
    sessionMinutesRemaining: (state) => {
      if (!state.expiresAt) {
        return null;
      }
      return Math.max(0, Math.ceil((state.expiresAt - Date.now()) / 60000));
    },
    sessionExpiresSoon: (state) =>
      state.expiresAt > 0 &&
      state.expiresAt - Date.now() <= SESSION_EXPIRY_WARNING_MS,
  },

  actions: {
    /**
     * Sessions last 1 hour and are never renewed: the token expiry is only
     * checked locally (no server-side session verification or renewal call).
     */
    init() {
      const token = localStorage.getItem("token");
      if (token) {
        try {
          const decoded = jwtDecode<JwtPayload>(token);
          if (decoded.exp * 1000 > Date.now()) {
            this.token = token;
            this.expiresAt = decoded.exp * 1000;
            this.user = {
              userId: decoded.userId,
              name: decoded.userName,
              role: decoded.role,
              scopes: decoded.scopes || [],
            };
            localStorage.setItem("user", JSON.stringify(this.user));
          } else {
            this.logout();
          }
        } catch {
          this.logout();
        }
      }
      this.initialized = true;
    },

    async login(name: string, password: string) {
      const res = await api.post("/users/session", { name, password });
      this.token = res.data.token;
      this.user = res.data.user;
      try {
        this.expiresAt = jwtDecode<JwtPayload>(this.token).exp * 1000;
      } catch {
        this.expiresAt = 0;
      }
      localStorage.setItem("token", res.data.token);
      localStorage.setItem("user", JSON.stringify(res.data.user));
      // The sessionStorage draft is always cleared at login; only a draft
      // captured for this same user is kept in memory for the restore offer.
      this.pendingDraft = takeSecretDraftForUser(
        String(res.data.user?.id ?? ""),
      );
      return res.data;
    },

    clearPendingDraft() {
      this.pendingDraft = null;
    },

    logout() {
      this.token = "";
      this.user = null;
      this.expiresAt = 0;
      this.pendingDraft = null;
      clearSecretDraft();
      localStorage.removeItem("token");
      localStorage.removeItem("user");
    },
  },
});

// Enable HMR for this store
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useAuthStore, import.meta.hot));
}
