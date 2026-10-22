import { beforeEach, describe, expect, it, vi } from "vitest";

const axiosMock = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock("axios", () => ({
  default: { create: axiosMock.create },
}));

interface AxiosLikeConfig {
  headers: Record<string, string>;
}

type RequestHandler = (config: AxiosLikeConfig) => AxiosLikeConfig;
type ResponseErrorHandler = (error: unknown) => Promise<unknown>;

let requestHandler: RequestHandler;
let responseErrorHandler: ResponseErrorHandler;

function apiError(status: number, code?: string) {
  return { response: { status, data: code ? { code } : {} } };
}

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  sessionStorage.clear();
  window.history.pushState({}, "", "/");
  axiosMock.create.mockImplementation(() => ({
    interceptors: {
      request: {
        use: (handler: RequestHandler) => {
          requestHandler = handler;
        },
      },
      response: {
        use: (_onFulfilled: unknown, onRejected: ResponseErrorHandler) => {
          responseErrorHandler = onRejected;
        },
      },
    },
  }));
  await import("./api");
});

describe("request interceptor", () => {
  it("should add the Bearer token stored in localStorage", () => {
    localStorage.setItem("token", "abc123");
    const config = requestHandler({ headers: {} });
    expect(config.headers.Authorization).toBe("Bearer abc123");
  });

  it("should not add an Authorization header without a token", () => {
    const config = requestHandler({ headers: {} });
    expect(config.headers.Authorization).toBeUndefined();
  });
});

describe("response interceptor (401)", () => {
  it("should clear the session and redirect to /login on 401", async () => {
    localStorage.setItem("token", "abc123");
    localStorage.setItem("user", '{"name":"alice"}');
    const error = apiError(401, "UNAUTHENTICATED");
    await expect(responseErrorHandler(error)).rejects.toBe(error);
    expect(localStorage.getItem("token")).toBeNull();
    expect(localStorage.getItem("user")).toBeNull();
    expect(window.location.pathname).toBe("/login");
  });

  it("should treat a 401 without a code as an expired session", async () => {
    localStorage.setItem("token", "abc123");
    const error = apiError(401);
    await expect(responseErrorHandler(error)).rejects.toBe(error);
    expect(localStorage.getItem("token")).toBeNull();
    expect(window.location.pathname).toBe("/login");
  });

  it("should leave the session untouched on a failed login (401 INVALID_CREDENTIALS)", async () => {
    localStorage.setItem("token", "abc123");
    localStorage.setItem("user", '{"name":"alice"}');
    const error = apiError(401, "INVALID_CREDENTIALS");
    await expect(responseErrorHandler(error)).rejects.toBe(error);
    expect(localStorage.getItem("token")).toBe("abc123");
    expect(localStorage.getItem("user")).toBe('{"name":"alice"}');
    expect(window.location.pathname).toBe("/");
    expect(sessionStorage.getItem("redirectAfterLogin")).toBeNull();
  });
});

describe("response interceptor (403)", () => {
  it("should not log out or redirect on 403: the page shows the error inline", async () => {
    localStorage.setItem("token", "abc123");
    localStorage.setItem("user", '{"name":"alice"}');
    window.history.pushState({}, "", "/projects/p1");
    const error = apiError(403, "FORBIDDEN");
    await expect(responseErrorHandler(error)).rejects.toBe(error);
    expect(localStorage.getItem("token")).toBe("abc123");
    expect(localStorage.getItem("user")).toBe('{"name":"alice"}');
    expect(window.location.pathname).toBe("/projects/p1");
    expect(sessionStorage.getItem("redirectAfterLogin")).toBeNull();
  });

  it("should leave redirectAfterLogin untouched on 403", async () => {
    sessionStorage.setItem("redirectAfterLogin", "/projects/p1");
    const error = apiError(403, "FORBIDDEN");
    await expect(responseErrorHandler(error)).rejects.toBe(error);
    expect(sessionStorage.getItem("redirectAfterLogin")).toBe("/projects/p1");
    expect(window.location.pathname).toBe("/");
  });
});

describe("response interceptor (other errors)", () => {
  it("should leave the session untouched on 500", async () => {
    localStorage.setItem("token", "abc123");
    const error = apiError(500);
    await expect(responseErrorHandler(error)).rejects.toBe(error);
    expect(localStorage.getItem("token")).toBe("abc123");
    expect(window.location.pathname).toBe("/");
    expect(sessionStorage.getItem("redirectAfterLogin")).toBeNull();
  });
});

describe("response interceptor (session expiry continuity)", () => {
  let registerUnsavedEditsCapture: (
    capture: (() => void) | null,
  ) => () => void;

  // The registry lives in the module instance re-imported by the outer
  // beforeEach (vi.resetModules): grab the function from that same instance
  beforeEach(async () => {
    const apiModule = await import("./api");
    registerUnsavedEditsCapture = apiModule.registerUnsavedEditsCapture;
  });

  it("should store the current path, invoke the unsaved-edits capture and clear the session on 401", async () => {
    localStorage.setItem("token", "abc123");
    localStorage.setItem("user", '{"name":"alice"}');
    window.history.pushState({}, "", "/projects/p1?q=2");
    const capture = vi.fn();
    registerUnsavedEditsCapture(capture);
    const error = apiError(401, "UNAUTHENTICATED");
    await expect(responseErrorHandler(error)).rejects.toBe(error);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("redirectAfterLogin")).toBe("/projects/p1?q=2");
    expect(localStorage.getItem("token")).toBeNull();
    expect(localStorage.getItem("user")).toBeNull();
    expect(window.location.pathname).toBe("/login");
  });

  it("should still clear the session and redirect when the capture hook throws", async () => {
    localStorage.setItem("token", "abc123");
    registerUnsavedEditsCapture(() => {
      throw new Error("capture failed");
    });
    const error = apiError(401, "UNAUTHENTICATED");
    await expect(responseErrorHandler(error)).rejects.toBe(error);
    expect(sessionStorage.getItem("redirectAfterLogin")).toBe("/");
    expect(localStorage.getItem("token")).toBeNull();
    expect(window.location.pathname).toBe("/login");
  });

  it("should not invoke the capture hook on 403", async () => {
    const capture = vi.fn();
    registerUnsavedEditsCapture(capture);
    const error = apiError(403, "FORBIDDEN");
    await expect(responseErrorHandler(error)).rejects.toBe(error);
    expect(capture).not.toHaveBeenCalled();
  });

  it("should not invoke the capture hook on a failed login", async () => {
    const capture = vi.fn();
    registerUnsavedEditsCapture(capture);
    const error = apiError(401, "INVALID_CREDENTIALS");
    await expect(responseErrorHandler(error)).rejects.toBe(error);
    expect(capture).not.toHaveBeenCalled();
  });

  it("should not invoke an unregistered capture hook", async () => {
    const capture = vi.fn();
    const unregister = registerUnsavedEditsCapture(capture);
    unregister();
    const error = apiError(401, "UNAUTHENTICATED");
    await expect(responseErrorHandler(error)).rejects.toBe(error);
    expect(capture).not.toHaveBeenCalled();
  });

  it("should not redirect or store a return path when already on /login", async () => {
    window.history.pushState({}, "", "/login");
    const capture = vi.fn();
    registerUnsavedEditsCapture(capture);
    localStorage.setItem("token", "abc123");
    const error = apiError(401, "UNAUTHENTICATED");
    await expect(responseErrorHandler(error)).rejects.toBe(error);
    expect(capture).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("redirectAfterLogin")).toBeNull();
    expect(localStorage.getItem("token")).toBeNull();
    expect(window.location.pathname).toBe("/login");
  });
});
