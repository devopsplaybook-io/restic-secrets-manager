import { beforeEach, describe, expect, it, vi } from "vitest";

import { authState } from "./setup";
import {
  getLoginCodeService,
  probeLoginCodeAvailability,
} from "../utils/loginCodes";

const BASE = "/api/users/login-codes";

function capabilities(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    available: true,
    codeLength: 8,
    rotationSeconds: 30,
    graceSeconds: 60,
    ttlSeconds: 300,
    pollIntervalMs: 2000,
    approveRequiresPassword: true,
    serverTime: new Date().toISOString(),
    ...overrides,
  };
}

type StubHttp = {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
};

function installHttp(stub: StubHttp): void {
  (getLoginCodeService() as unknown as { http: StubHttp }).http = stub;
}

beforeEach(() => {
  localStorage.clear();
  authState.setSession.mockReset();
});

describe("login-code service wiring", () => {
  it("should probe the capabilities on the app route prefix", async () => {
    const get = vi.fn(async () => ({ data: capabilities() }));
    installHttp({ get, post: vi.fn() });

    const result = await getLoginCodeService().capabilities();

    expect(result.enabled).toBe(true);
    expect(get).toHaveBeenCalledWith(
      `${BASE}/capabilities`,
      expect.anything(),
    );
  });

  it("should create a code on the collection route", async () => {
    const post = vi.fn(async () => ({
      data: {
        requestToken: "req-1",
        code: "BCDFGHJK",
        codeExpiresAt: "2030-01-01T00:00:00.000Z",
        expiresAt: "2030-01-01T00:05:00.000Z",
        serverTime: "2030-01-01T00:00:00.000Z",
      },
    }));
    installHttp({ get: vi.fn(), post });

    const request = await getLoginCodeService().create();

    expect(request.code).toBe("BCDFGHJK");
    expect(post).toHaveBeenCalledWith(`${BASE}/`, undefined, expect.anything());
  });

  it("should send the bearer token on preview and approve", async () => {
    localStorage.setItem("token", "session-tok");
    const post = vi.fn(async (url: string) => {
      if (url.endsWith("/preview")) {
        return {
          data: {
            deviceLabel: "Chrome on Linux",
            userAgent: "ua",
            createdAt: "2030-01-01T00:00:00.000Z",
            expiresAt: "2030-01-01T00:05:00.000Z",
            userName: "alice",
            serverTime: "2030-01-01T00:00:00.000Z",
          },
        };
      }
      return {
        data: {
          approved: true,
          expiresAt: "2030-01-01T00:05:00.000Z",
          serverTime: "2030-01-01T00:00:00.000Z",
        },
      };
    });
    installHttp({ get: vi.fn(), post });

    const service = getLoginCodeService();
    await service.preview("BCDFGHJK");
    await service.approve({ code: "BCDFGHJK", password: "pw" });

    const previewCall = post.mock.calls[0];
    expect(previewCall[0]).toBe(`${BASE}/preview`);
    expect(previewCall[2].headers).toEqual({
      Authorization: "Bearer session-tok",
    });

    const approveCall = post.mock.calls[1];
    expect(approveCall[0]).toBe(`${BASE}/approve`);
    expect(approveCall[1]).toEqual({
      code: "BCDFGHJK",
      password: "pw",
    });
    expect(approveCall[2].headers).toEqual({
      Authorization: "Bearer session-tok",
    });
  });

  it("should persist the redeemed session through the auth store", async () => {
    const post = vi.fn(async () => ({
      data: {
        status: "approved",
        token: "redeemed-tok",
        user: { userId: "user-1", name: "alice" },
        expiresAt: "2030-01-01T00:05:00.000Z",
        serverTime: "2030-01-01T00:00:00.000Z",
      },
    }));
    installHttp({ get: vi.fn(), post });

    const result = await getLoginCodeService().poll("req-1");

    expect(result.status).toBe("approved");
    expect(authState.setSession).toHaveBeenCalledWith("redeemed-tok", {
      userId: "user-1",
      name: "alice",
    });
  });
});

describe("probeLoginCodeAvailability", () => {
  it("should be true only when enabled and available", async () => {
    installHttp({
      get: vi.fn(async () => ({ data: capabilities() })),
      post: vi.fn(),
    });
    await expect(
      probeLoginCodeAvailability(getLoginCodeService()),
    ).resolves.toBe(true);
  });

  it("should be false when the capability is disabled", async () => {
    installHttp({
      get: vi.fn(async () => ({ data: capabilities({ enabled: false }) })),
      post: vi.fn(),
    });
    await expect(
      probeLoginCodeAvailability(getLoginCodeService()),
    ).resolves.toBe(false);
  });

  it("should be false when the capabilities call fails", async () => {
    installHttp({
      get: vi.fn(async () => {
        throw new Error("404");
      }),
      post: vi.fn(),
    });
    await expect(
      probeLoginCodeAvailability(getLoginCodeService()),
    ).resolves.toBe(false);
  });
});
