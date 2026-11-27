import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { authState, routerPush } from "./setup";
import AccountPage from "../pages/settings/account.vue";

const holder = vi.hoisted(() => ({
  service: null as unknown,
  probe: vi.fn(),
}));

vi.mock("../utils/loginCodes", () => ({
  getLoginCodeService: () => holder.service,
  probeLoginCodeAvailability: holder.probe,
}));

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

function fakeService(caps = capabilities()) {
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  return {
    capabilities: vi.fn(async () => caps),
    create: vi.fn(),
    poll: vi.fn(),
    preview: vi.fn(async () => ({
      deviceLabel: "Chrome on Linux",
      userAgent: "Mozilla/5.0 Chrome",
      createdAt: iso(now),
      expiresAt: iso(now + 300_000),
      userName: "alice",
      serverTime: iso(now),
    })),
    approve: vi.fn(async () => ({
      approved: true,
      expiresAt: iso(now + 300_000),
      serverTime: iso(now),
    })),
    cancel: vi.fn(),
  };
}

function approveButton(wrapper: ReturnType<typeof mount>) {
  const button = wrapper
    .findAll("button")
    .find((item) => item.text() === "Approve sign-in");
  if (!button) throw new Error("Approve button not found");
  return button;
}

async function preview(wrapper: ReturnType<typeof mount>) {
  await wrapper.find(".login-code-input-field").setValue("BCDFGHJK");
  await wrapper.find("form.authorize-device-form").trigger("submit");
  await flushPromises();
}

async function mountPage() {
  const wrapper = mount(AccountPage);
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  authState.init.mockReset();
  authState.isAuthenticated = true;
  routerPush.mockReset();
  holder.probe.mockReset();
  holder.probe.mockResolvedValue(true);
  holder.service = fakeService();
});

describe("account page", () => {
  it("should render the authorize card when the capability is available", async () => {
    const wrapper = await mountPage();

    expect(wrapper.find(".authorize-device-card").exists()).toBe(true);
    expect(wrapper.text()).toContain("Log in on another device");
    wrapper.unmount();
  });

  it("should hide the card when the capability is unavailable", async () => {
    holder.probe.mockResolvedValue(false);
    const wrapper = await mountPage();

    expect(wrapper.find(".authorize-device-card").exists()).toBe(false);
    wrapper.unmount();
  });

  it("should require the password before approving once step-up is advertised", async () => {
    const service = fakeService();
    holder.service = service;
    const wrapper = await mountPage();

    await preview(wrapper);

    expect(service.preview).toHaveBeenCalledWith(
      "BCDFGHJK",
      expect.anything(),
    );
    const password = wrapper.find(".authorize-device-password input");
    expect(password.exists()).toBe(true);

    await approveButton(wrapper).trigger("click");
    await flushPromises();

    expect(service.approve).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain(
      "Enter your password to approve this sign-in.",
    );
    wrapper.unmount();
  });

  it("should approve with the entered password", async () => {
    const service = fakeService();
    holder.service = service;
    const wrapper = await mountPage();

    await preview(wrapper);
    await wrapper.find(".authorize-device-password input").setValue("root-pass");
    await approveButton(wrapper).trigger("click");
    await flushPromises();

    expect(service.approve).toHaveBeenCalledWith(
      { code: "BCDFGHJK", password: "root-pass" },
      expect.anything(),
    );
    wrapper.unmount();
  });

  it("should not show a password field when step-up is not required", async () => {
    holder.service = fakeService(
      capabilities({ approveRequiresPassword: false }),
    );
    const wrapper = await mountPage();

    await preview(wrapper);

    expect(wrapper.find(".authorize-device-password").exists()).toBe(false);
    wrapper.unmount();
  });

  it("should redirect an unauthenticated visitor to the login page", async () => {
    authState.isAuthenticated = false;
    const wrapper = await mountPage();

    expect(routerPush).toHaveBeenCalledWith("/login");
    expect(wrapper.find(".authorize-device-card").exists()).toBe(false);
    wrapper.unmount();
  });
});
