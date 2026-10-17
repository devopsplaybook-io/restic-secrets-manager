import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api",
  headers: {
    "Content-Type": "application/json",
  },
});

// Request interceptor to add auth token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Pages can register a hook invoked when a 403 (expired session) is about to
// redirect to /login, so unsaved editor content can be preserved (e.g. in
// sessionStorage via secret-draft.ts) and restored after re-login.
type UnsavedEditsCapture = () => void;

let unsavedEditsCapture: UnsavedEditsCapture | null = null;

export function registerUnsavedEditsCapture(
  capture: UnsavedEditsCapture | null,
): () => void {
  unsavedEditsCapture = capture;
  return () => {
    if (unsavedEditsCapture === capture) {
      unsavedEditsCapture = null;
    }
  };
}

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 403) {
      if (window.location.pathname !== "/login") {
        try {
          sessionStorage.setItem(
            "redirectAfterLogin",
            window.location.pathname + window.location.search,
          );
        } catch {
          // sessionStorage unavailable: return-to-page continuity is best effort
        }
        if (unsavedEditsCapture) {
          try {
            unsavedEditsCapture();
          } catch {
            // Draft capture must never block the session-expiry redirect
          }
        }
      }
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  },
);

export default api;
