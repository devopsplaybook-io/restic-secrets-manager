import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { authState, routerPush } from "./setup";
import LoginPage from "../pages/login.vue";

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock("../utils/api", () => ({
  default: { get: apiMock.get, post: apiMock.post },
}));

const holder = vi.hoisted(() => ({
  service: null as unknown,
  probe: vi.fn(),
}));

vi.mock("../utils/loginCodes", () => ({
  getLoginCodeService: () => holder.service,
  probeLoginCodeAvailability: holder.probe,
}));

function capabilities(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  return {
    enabled: true,
    available: true,
    codeLength: 8,
    rotationSeconds: 30,
    graceSeconds: 60,
    ttlSeconds: 300,
    // A long poll interval keeps timers out of the test window.
    pollIntervalMs: 60000,
    approveRequiresPassword: true,
    serverTime: iso(now),
    ...overrides,
  };
}

function fakeService(caps = capabilities()) {
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  return {
    capabilities: vi.fn(async () => caps),
    create: vi.fn(async () => ({
      requestToken: "req-1",
      code: "BCDFGHJK",
      codeExpiresAt: iso(now + 30_000),
      expiresAt: iso(now + 300_000),
      serverTime: iso(now),
    })),
    poll: vi.fn(async () => ({
      status: "pending",
      codeExpiresAt: iso(now + 30_000),
      expiresAt: iso(now + 300_000),
      serverTime: iso(now),
    })),
    preview: vi.fn(),
    approve: vi.fn(),
    cancel: vi.fn(async () => ({ status: "cancelled", serverTime: iso(now) })),
  };
}

async function mountPage() {
  const wrapper = mount(LoginPage);
  await flushPromises();
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.get.mockResolvedValue({ data: { initialized: true } });
  apiMock.post.mockReset();
  authState.init.mockReset();
  authState.login.mockReset();
  authState.isAuthenticated = false;
  routerPush.mockReset();
  holder.probe.mockReset();
  holder.probe.mockResolvedValue(true);
  holder.service = fakeService();
});

describe("login page", () => {
  it("should hide the code card during first-run setup", async () => {
    apiMock.get.mockResolvedValue({ data: { initialized: false } });
    const wrapper = await mountPage();

    expect(holder.probe).not.toHaveBeenCalled();
    expect(wrapper.find(".login-with-code-card").exists()).toBe(false);
    expect(wrapper.text()).toContain("Create Admin Account");
    wrapper.unmount();
  });

  it("should show the code card when the capability is available", async () => {
    const wrapper = await mountPage();

    expect(holder.probe).toHaveBeenCalled();
    expect(wrapper.find(".login-with-code-card").exists()).toBe(true);
    wrapper.unmount();
  });

  it("should hide the code card when the capability is unavailable", async () => {
    holder.probe.mockResolvedValue(false);
    const wrapper = await mountPage();

    expect(wrapper.find(".login-with-code-card").exists()).toBe(false);
    wrapper.unmount();
  });

  it("should still submit the password form through the auth store", async () => {
    const wrapper = await mountPage();

    await wrapper.find('input[autocomplete="username"]').setValue("alice");
    await wrapper
      .find('input[autocomplete="current-password"]')
      .setValue("secret");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(authState.login).toHaveBeenCalledWith("alice", "secret");
    wrapper.unmount();
  });
});
