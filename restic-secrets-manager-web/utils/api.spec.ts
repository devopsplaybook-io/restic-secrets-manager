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

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
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

describe("response interceptor", () => {
  it("should clear the session and redirect to /login on 403", async () => {
    localStorage.setItem("token", "abc123");
    localStorage.setItem("user", '{"name":"alice"}');
    const error = { response: { status: 403 } };
    await expect(responseErrorHandler(error)).rejects.toBe(error);
    expect(localStorage.getItem("token")).toBeNull();
    expect(localStorage.getItem("user")).toBeNull();
    expect(window.location.pathname).toBe("/login");
  });

  it("should leave the session untouched on other errors", async () => {
    localStorage.setItem("token", "abc123");
    const error = { response: { status: 500 } };
    await expect(responseErrorHandler(error)).rejects.toBe(error);
    expect(localStorage.getItem("token")).toBe("abc123");
    expect(window.location.pathname).toBe("/");
  });
});
