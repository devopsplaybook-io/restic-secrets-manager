import { acceptHMRUpdate, defineStore } from "pinia";
import { jwtDecode } from "jwt-decode";
import api from "../utils/api";

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

export const useAuthStore = defineStore("auth", {
  state: () => ({
    token: localStorage.getItem("token") || "",
    user: JSON.parse(localStorage.getItem("user") || "null") as Record<
      string,
      unknown
    > | null,
    initialized: false,
  }),

  getters: {
    isAuthenticated: (state) => !!state.token,
    isAdmin: (state) => state.user?.role === "admin",
    currentUser: (state) => state.user,
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
      localStorage.setItem("token", res.data.token);
      localStorage.setItem("user", JSON.stringify(res.data.user));
      return res.data;
    },

    logout() {
      this.token = "";
      this.user = null;
      localStorage.removeItem("token");
      localStorage.removeItem("user");
    },
  },
});

// Enable HMR for this store
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useAuthStore, import.meta.hot));
}
