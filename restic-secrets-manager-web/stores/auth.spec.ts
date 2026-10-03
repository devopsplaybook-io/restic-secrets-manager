import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

import { useAuthStore } from "./auth";

const apiMock = vi.hoisted(() => ({
  post: vi.fn(),
}));

vi.mock("../utils/api", () => ({
  default: { post: apiMock.post },
}));

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function makeToken(payload: Record<string, unknown>): string {
  return `${base64url({ alg: "HS256", typ: "JWT" })}.${base64url(payload)}.sig`;
}

function validPayload(): Record<string, unknown> {
  return {
    exp: Math.floor(Date.now() / 1000) + 3600,
    userId: "user-1",
    userName: "alice",
    role: "admin",
    scopes: ["project:p1"],
  };
}

beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
});

describe("useAuthStore.init", () => {
  it("should restore the session from a valid token", () => {
    localStorage.setItem("token", makeToken(validPayload()));
    const store = useAuthStore();
    store.init();
    expect(store.isAuthenticated).toBe(true);
    expect(store.isAdmin).toBe(true);
    expect(store.user).toEqual({
      userId: "user-1",
      name: "alice",
      role: "admin",
      scopes: ["project:p1"],
    });
    expect(store.initialized).toBe(true);
  });

  it("should logout an expired token", () => {
    localStorage.setItem(
      "token",
      makeToken({ ...validPayload(), exp: Math.floor(Date.now() / 1000) - 10 }),
    );
    const store = useAuthStore();
    store.init();
    expect(store.isAuthenticated).toBe(false);
    expect(store.user).toBeNull();
    expect(localStorage.getItem("token")).toBeNull();
  });

  it("should logout a malformed token", () => {
    localStorage.setItem("token", "not-a-jwt");
    const store = useAuthStore();
    store.init();
    expect(store.isAuthenticated).toBe(false);
    expect(localStorage.getItem("token")).toBeNull();
  });
});

describe("useAuthStore.login / logout", () => {
  it("should store the token and the user on login", async () => {
    apiMock.post.mockResolvedValue({
      data: { token: "tok-1", user: { name: "alice", role: "admin" } },
    });
    const store = useAuthStore();
    await store.login("alice", "secret");
    expect(apiMock.post).toHaveBeenCalledWith("/users/session", {
      name: "alice",
      password: "secret",
    });
    expect(store.token).toBe("tok-1");
    expect(localStorage.getItem("token")).toBe("tok-1");
    expect(localStorage.getItem("user")).toBe(
      JSON.stringify({ name: "alice", role: "admin" }),
    );
  });

  it("should clear the session on logout", () => {
    localStorage.setItem("token", "tok-1");
    localStorage.setItem("user", '{"name":"alice"}');
    const store = useAuthStore();
    store.logout();
    expect(store.token).toBe("");
    expect(store.user).toBeNull();
    expect(localStorage.getItem("token")).toBeNull();
    expect(localStorage.getItem("user")).toBeNull();
  });
});
