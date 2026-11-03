import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { authState, routeState, routerPush } from "./setup";

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("../utils/api", () => ({
  default: {
    get: apiMock.get,
    put: apiMock.put,
    post: apiMock.post,
    delete: apiMock.delete,
  },
  registerUnsavedEditsCapture: vi.fn(() => () => {}),
}));

function projectFixture() {
  return {
    id: "p1",
    name: "My Project",
    description: "A project",
    repositoryUrl: "s3:https://s3.example.com/bucket/prefix",
    s3Endpoint: "https://s3.example.com",
    s3Bucket: "bucket",
    repoPrefix: "prefix",
    s3Region: "",
    s3BucketLookup: "auto",
    lastSyncSnapshotTime: null,
  };
}

const mountOptions = {
  global: { stubs: { ActionMenu: true, NuxtLink: true } },
};

async function mountPage() {
  const ProjectPage = (await import("../pages/projects/[id].vue")).default;
  const wrapper = mount(ProjectPage, mountOptions);
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.put.mockReset();
  apiMock.post.mockReset();
  apiMock.delete.mockReset();
  routerPush.mockReset();
  authState.isAuthenticated = true;
  authState.isAdmin = true;
  authState.pendingDraft = null;
  routeState.path = "/projects/p1";
  routeState.fullPath = "/projects/p1";
  routeState.params = { id: "p1" };
  routeState.query = {};
});

describe("project page load state", () => {
  it("shows an error state instead of a blank page when the project cannot be loaded", async () => {
    apiMock.get.mockRejectedValueOnce({
      response: { status: 404, data: { error: "Project Not Found" } },
    });

    const wrapper = await mountPage();

    expect(wrapper.text().trim().length).toBeGreaterThan(0);
    const errorState = wrapper.get('[data-testid="project-load-error"]');
    expect(errorState.text()).toContain("Project Not Found");
    expect(wrapper.find('[data-testid="retry-project-load"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="back-to-projects"]').exists()).toBe(
      true,
    );
  });

  it("falls back to a generic message for a network failure", async () => {
    apiMock.get.mockRejectedValueOnce(new Error("Network Error"));

    const wrapper = await mountPage();

    expect(
      wrapper.get('[data-testid="project-load-error"]').text(),
    ).toContain("Unable to load the project");
  });

  it("retries the load and renders the project when it succeeds", async () => {
    apiMock.get.mockRejectedValueOnce({
      response: { status: 403, data: { error: "Forbidden" } },
    });
    const wrapper = await mountPage();
    expect(wrapper.find('[data-testid="project-load-error"]').exists()).toBe(
      true,
    );

    apiMock.get.mockResolvedValueOnce({ data: { project: projectFixture() } });
    apiMock.get.mockResolvedValueOnce({ data: { secrets: [] } });

    await wrapper.get('[data-testid="retry-project-load"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="project-load-error"]').exists()).toBe(
      false,
    );
    expect(wrapper.text()).toContain("My Project");
    expect(apiMock.get).toHaveBeenCalledWith("/projects/p1/secrets");
  });
});
