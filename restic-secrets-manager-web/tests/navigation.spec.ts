import { beforeEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { authState, routeState, routerPush } from "./setup";
import Navigation from "../components/Navigation.vue";

const NuxtLinkStub = {
  props: ["to"],
  template: '<a :href="to"><slot /></a>',
};

function mountNavigation() {
  return mount(Navigation, {
    global: { stubs: { NuxtLink: NuxtLinkStub } },
  });
}

function linkClasses(
  wrapper: ReturnType<typeof mountNavigation>,
  text: string,
): string[] {
  const link = wrapper.findAll("a").find((item) => item.text() === text);
  if (!link) {
    throw new Error(`navigation link "${text}" not found`);
  }
  return link.classes();
}

beforeEach(() => {
  authState.isAuthenticated = true;
  authState.isAdmin = true;
  routerPush.mockReset();
  routeState.params = {};
  routeState.query = {};
});

describe("navigation active state", () => {
  it("highlights only the API Tokens link on /settings/tokens", () => {
    routeState.path = "/settings/tokens";
    routeState.fullPath = "/settings/tokens";

    const wrapper = mountNavigation();

    expect(linkClasses(wrapper, "API Tokens")).toContain("active");
    expect(linkClasses(wrapper, "API Tokens")).not.toContain("inactive");
    expect(linkClasses(wrapper, "Users")).toContain("inactive");
    expect(linkClasses(wrapper, "Users")).not.toContain("active");
  });

  it("highlights only the Users link on /settings/users, ignoring the query string", () => {
    routeState.path = "/settings/users";
    routeState.fullPath = "/settings/users?page=2";

    const wrapper = mountNavigation();

    expect(linkClasses(wrapper, "Users")).toContain("active");
    expect(linkClasses(wrapper, "Users")).not.toContain("inactive");
    expect(linkClasses(wrapper, "API Tokens")).toContain("inactive");
    expect(linkClasses(wrapper, "API Tokens")).not.toContain("active");
  });
});
