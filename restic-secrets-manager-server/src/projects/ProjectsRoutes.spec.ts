import Fastify, { FastifyInstance } from "fastify";
import { Project } from "../model/Project";
import { ProjectsRoutes } from "./ProjectsRoutes";

jest.mock("@devopsplaybook.io/common-utils", () => ({
  ...jest.requireActual("@devopsplaybook.io/common-utils"),
  AuthMustBeAdmin: jest.fn(),
}));

jest.mock("../users/ProjectAccess", () => ({
  ProjectAccessCanAccessMany: jest.fn(),
  ProjectAccessEnsure: jest.fn(),
  ProjectAccessGetUser: jest.fn(),
}));

// Keeps the route tests independent from the on-disk configuration
jest.mock("../Config", () => ({
  Config: jest.fn().mockImplementation(() => ({
    reload: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock("./ProjectsData", () => ({
  ProjectsDataAdd: jest.fn(),
  ProjectsDataDelete: jest.fn(),
  ProjectsDataGet: jest.fn(),
  ProjectsDataGetByName: jest.fn(),
  ProjectsDataList: jest.fn(),
}));

jest.mock("../secrets/SecretsData", () => ({
  SecretsDataCountForProject: jest.fn(),
  SecretsDataCountsAll: jest.fn(),
  SecretsDataDeleteByProjectId: jest.fn(),
  SecretsDataListForProject: jest.fn(),
}));

jest.mock("./ProjectScopes", () => ({
  ProjectScopesAdd: jest.fn(),
  ProjectScopesPruneFromUsers: jest.fn(),
  ProjectScopesRemove: jest.fn(),
}));

jest.mock("../restic/SyncService", () => ({
  ...jest.requireActual("../restic/SyncService"),
  ResticSyncDiscardLocalChanges: jest.fn(),
  ResticSyncListSnapshots: jest.fn(),
  ResticSyncPull: jest.fn(),
  ResticSyncPush: jest.fn(),
  ResticSyncRestoreSnapshot: jest.fn(),
  ResticSyncTestConnection: jest.fn(),
}));

jest.mock("../restic/SyncPreview", () => ({
  ResticSyncPreviewDiscardLocalChanges: jest.fn(),
  ResticSyncPreviewPull: jest.fn(),
  ResticSyncPreviewRestoreSnapshot: jest.fn(),
}));

jest.mock("../restic/SyncStatusCache", () => ({
  SyncStatusCacheGet: jest.fn(),
  SyncStatusCacheInvalidate: jest.fn(),
}));

jest.mock("../restic/SyncNotifications", () => ({
  SyncNotificationsNotify: jest.fn(),
}));

import { AuthMustBeAdmin } from "@devopsplaybook.io/common-utils";
import {
  ProjectAccessCanAccessMany,
  ProjectAccessEnsure,
  ProjectAccessGetUser,
} from "../users/ProjectAccess";
import {
  ProjectsDataAdd,
  ProjectsDataDelete,
  ProjectsDataGet,
  ProjectsDataList,
} from "./ProjectsData";
import {
  SecretsDataCountForProject,
  SecretsDataCountsAll,
  SecretsDataDeleteByProjectId,
  SecretsDataListForProject,
} from "../secrets/SecretsData";
import {
  ProjectScopesAdd,
  ProjectScopesPruneFromUsers,
  ProjectScopesRemove,
} from "./ProjectScopes";
import {
  ResticSyncDiscardLocalChanges,
  ResticSyncError,
  ResticSyncPull,
  ResticSyncPush,
  ResticSyncRestoreSnapshot,
  ResticSyncTestConnection,
} from "../restic/SyncService";
import {
  ResticSyncPreviewDiscardLocalChanges,
  ResticSyncPreviewPull,
  ResticSyncPreviewRestoreSnapshot,
} from "../restic/SyncPreview";
import {
  SyncStatusCacheGet,
  SyncStatusCacheInvalidate,
} from "../restic/SyncStatusCache";
import { SyncNotificationsNotify } from "../restic/SyncNotifications";

const mustBeAdminMock = AuthMustBeAdmin as jest.Mock;
const getUserMock = ProjectAccessGetUser as jest.Mock;
const ensureMock = ProjectAccessEnsure as jest.Mock;
const accessManyMock = ProjectAccessCanAccessMany as jest.Mock;
const dataListMock = ProjectsDataList as jest.Mock;
const dataAddMock = ProjectsDataAdd as jest.Mock;
const dataGetMock = ProjectsDataGet as jest.Mock;
const dataDeleteMock = ProjectsDataDelete as jest.Mock;
const countsAllMock = SecretsDataCountsAll as jest.Mock;
const countForProjectMock = SecretsDataCountForProject as jest.Mock;
const secretsDeleteByProjectMock = SecretsDataDeleteByProjectId as jest.Mock;
const secretsListMock = SecretsDataListForProject as jest.Mock;
const scopesPruneMock = ProjectScopesPruneFromUsers as jest.Mock;
const scopesRemoveMock = ProjectScopesRemove as jest.Mock;
const scopesAddMock = ProjectScopesAdd as jest.Mock;
const cacheGetMock = SyncStatusCacheGet as jest.Mock;
const cacheInvalidateMock = SyncStatusCacheInvalidate as jest.Mock;
const notifyMock = SyncNotificationsNotify as jest.Mock;
const syncPullMock = ResticSyncPull as jest.Mock;
const syncPushMock = ResticSyncPush as jest.Mock;
const syncRestoreMock = ResticSyncRestoreSnapshot as jest.Mock;
const syncDiscardMock = ResticSyncDiscardLocalChanges as jest.Mock;
const syncTestConnectionMock = ResticSyncTestConnection as jest.Mock;
const previewPullMock = ResticSyncPreviewPull as jest.Mock;
const previewRestoreMock = ResticSyncPreviewRestoreSnapshot as jest.Mock;
const previewDiscardMock = ResticSyncPreviewDiscardLocalChanges as jest.Mock;

function projectFixture(overrides: Partial<Project> = {}): Project {
  const project = new Project();
  project.name = "Test Project";
  project.s3Endpoint = "s3.example.com";
  project.s3Bucket = "bucket";
  project.s3AccessKeyId = "access-key";
  project.s3SecretAccessKey = "secret-key";
  project.resticPassword = "restic-password";
  return Object.assign(project, overrides);
}

function liveUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    name: "alice",
    role: "user",
    scopes: [],
    ...overrides,
  };
}

function liveAdmin() {
  return liveUser({ id: "admin-1", name: "admin", role: "admin" });
}

/** Mirrors the real ProjectAccessGetUser denial (401 + null, no throw). */
function denyUnauthenticated(): void {
  getUserMock.mockImplementation(async (_req: unknown, res: any) => {
    res.status(401).send({
      error: "Authentication Required",
      code: "UNAUTHENTICATED",
    });
    return null;
  });
}

/** Mirrors the real ProjectAccessEnsure denial (403 + null, no throw). */
function denyForbidden(): void {
  ensureMock.mockImplementation(async (_req: unknown, res: any) => {
    res.status(403).send({ error: "Access Denied", code: "FORBIDDEN" });
    return null;
  });
}

let fastify: FastifyInstance;

beforeEach(async () => {
  jest.clearAllMocks();
  getUserMock.mockResolvedValue(liveAdmin());
  ensureMock.mockImplementation(async () => liveAdmin());
  mustBeAdminMock.mockResolvedValue(undefined);
  fastify = Fastify();
  await new ProjectsRoutes().getRoutes(fastify);
  await fastify.ready();
});

afterEach(async () => {
  await fastify.close();
});

describe("GET /", () => {
  it("should list the visible projects with counts, without secret bodies", async () => {
    const visible = projectFixture({ id: "p1" });
    const hidden = projectFixture({ id: "p2" });
    dataListMock.mockResolvedValue([visible, hidden]);
    countsAllMock.mockResolvedValue(
      new Map([
        ["p1", 2],
        ["p2", 5],
      ]),
    );
    accessManyMock.mockReturnValue(new Set(["p1"]));

    const res = await fastify.inject({ method: "GET", url: "/" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0]).toMatchObject({
      id: "p1",
      secretCount: 2,
      hasLocalChanges: true,
    });
    // Credentials and secret bodies are never part of the response
    expect(body.projects[0].s3AccessKeyId).toBeUndefined();
    expect(body.projects[0].s3SecretAccessKey).toBeUndefined();
    expect(body.projects[0].resticPassword).toBeUndefined();
    expect(secretsListMock).not.toHaveBeenCalled();
  });

  it("should return 401 with UNAUTHENTICATED when there is no live user", async () => {
    denyUnauthenticated();
    const res = await fastify.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      error: "Authentication Required",
      code: "UNAUTHENTICATED",
    });
    expect(dataListMock).not.toHaveBeenCalled();
  });
});

describe("GET /status", () => {
  it("should aggregate the sync status of the visible projects", async () => {
    dataListMock.mockResolvedValue([projectFixture({ id: "p1" })]);
    accessManyMock.mockReturnValue(new Set(["p1"]));
    cacheGetMock.mockResolvedValue({
      needsPull: true,
      hasLocalChanges: false,
      remoteLatestSnapshotTime: "2026-01-01T00:00:00Z",
    });

    const res = await fastify.inject({ method: "GET", url: "/status" });

    expect(res.statusCode).toBe(200);
    expect(res.json().statuses).toEqual({
      p1: {
        needsPull: true,
        hasLocalChanges: false,
        remoteLatestSnapshotTime: "2026-01-01T00:00:00Z",
      },
    });
  });

  it("should report a per-project error without failing the request", async () => {
    dataListMock.mockResolvedValue([projectFixture({ id: "p1" })]);
    accessManyMock.mockReturnValue(new Set(["p1"]));
    cacheGetMock.mockRejectedValue(new Error("repository unreachable"));

    const res = await fastify.inject({ method: "GET", url: "/status" });

    expect(res.statusCode).toBe(200);
    expect(res.json().statuses).toEqual({ p1: { error: true } });
  });
});

describe("GET /:id", () => {
  it("should return the project with its secret count", async () => {
    dataGetMock.mockResolvedValue(projectFixture({ id: "p1" }));
    countForProjectMock.mockResolvedValue(4);

    const res = await fastify.inject({ method: "GET", url: "/p1" });

    expect(res.statusCode).toBe(200);
    expect(res.json().project.secretCount).toBe(4);
    expect(secretsListMock).not.toHaveBeenCalled();
  });
});

describe("DELETE /:id", () => {
  it("should delete the project, prune its scopes and invalidate the status cache", async () => {
    dataGetMock.mockResolvedValue(projectFixture({ id: "p1" }));

    const res = await fastify.inject({ method: "DELETE", url: "/p1" });

    expect(res.statusCode).toBe(200);
    expect(secretsDeleteByProjectMock).toHaveBeenCalled();
    expect(dataDeleteMock).toHaveBeenCalledWith(undefined, "p1");
    expect(scopesRemoveMock).toHaveBeenCalledWith("p1");
    expect(scopesPruneMock).toHaveBeenCalledWith(undefined, "p1");
    expect(cacheInvalidateMock).toHaveBeenCalledWith("p1");
  });

  it("should return 403 when the caller is not an admin", async () => {
    mustBeAdminMock.mockImplementation(async (_req: unknown, res: any) => {
      res.status(403).send({ error: "Access Denied" });
      throw new Error("Access Denied");
    });
    const res = await fastify.inject({ method: "DELETE", url: "/p1" });
    expect(res.statusCode).toBe(403);
    expect(dataGetMock).not.toHaveBeenCalled();
  });
});

describe("POST /test-connection", () => {
  const body = {
    name: "New Project",
    s3Endpoint: "s3.example.com",
    s3Bucket: "bucket",
    s3AccessKeyId: "access-key",
    s3SecretAccessKey: "secret-key",
    resticPassword: "restic-password",
  };

  it("should return the connection test result envelope", async () => {
    syncTestConnectionMock.mockResolvedValue({
      status: "empty",
      message: "Repository is empty: it will be initialized on the first push",
    });
    const res = await fastify.inject({
      method: "POST",
      url: "/test-connection",
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result).toEqual({
      status: "empty",
      message: "Repository is empty: it will be initialized on the first push",
    });
    // The tested settings are the ones that would be created
    const tested = syncTestConnectionMock.mock.calls[0][0] as Project;
    expect(tested.name).toBe("New Project");
    expect(tested.repositoryUrl()).toBe("s3:https://s3.example.com/bucket/new-project");
  });

  it("should not persist anything", async () => {
    syncTestConnectionMock.mockResolvedValue({ status: "ok", snapshotCount: 2 });
    await fastify.inject({ method: "POST", url: "/test-connection", payload: body });
    expect(dataAddMock).not.toHaveBeenCalled();
    expect(scopesAddMock).not.toHaveBeenCalled();
  });

  it("should return 403 when the caller is not an admin", async () => {
    mustBeAdminMock.mockImplementation(async (_req: unknown, res: any) => {
      res.status(403).send({ error: "Access Denied" });
      throw new Error("Access Denied");
    });
    const res = await fastify.inject({
      method: "POST",
      url: "/test-connection",
      payload: body,
    });
    expect(res.statusCode).toBe(403);
    expect(syncTestConnectionMock).not.toHaveBeenCalled();
  });

  it("should return 400 with the same validation errors as the creation", async () => {
    const res = await fastify.inject({
      method: "POST",
      url: "/test-connection",
      payload: { name: "" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe(
      "Invalid project: name is required Invalid project: s3Endpoint is required Invalid project: s3Bucket is required Invalid project: s3AccessKeyId is required Invalid project: s3SecretAccessKey is required Invalid project: resticPassword is required",
    );
    expect(syncTestConnectionMock).not.toHaveBeenCalled();
  });
});

describe("synchronization endpoints", () => {
  beforeEach(() => {
    dataGetMock.mockResolvedValue(projectFixture({ id: "p1" }));
  });

  it("should pull and invalidate the status cache", async () => {
    syncPullMock.mockResolvedValue({
      snapshotId: "abc12345",
      snapshotTime: "2026-01-01T00:00:00Z",
      secrets: 2,
      keys: 3,
    });
    const res = await fastify.inject({ method: "POST", url: "/p1/pull" });
    expect(res.statusCode).toBe(200);
    expect(res.json().snapshotId).toBe("abc12345");
    expect(cacheInvalidateMock).toHaveBeenCalledWith("p1");
  });

  it("should map a pull conflict to 409 without invalidating the cache", async () => {
    syncPullMock.mockRejectedValue(new ResticSyncError("No snapshot", 409));
    const res = await fastify.inject({ method: "POST", url: "/p1/pull" });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "No snapshot" });
    expect(cacheInvalidateMock).not.toHaveBeenCalled();
  });

  it("should map a push conflict to 409", async () => {
    syncPushMock.mockRejectedValue(
      new ResticSyncError("A newer snapshot exists", 409),
    );
    const res = await fastify.inject({ method: "POST", url: "/p1/push" });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "A newer snapshot exists" });
  });

  it("should map a missing restore snapshot to 404", async () => {
    syncRestoreMock.mockRejectedValue(
      new ResticSyncError("Snapshot Not Found", 404),
    );
    const res = await fastify.inject({
      method: "POST",
      url: "/p1/snapshots/snap-1/restore",
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Snapshot Not Found" });
  });

  it("should map a discard conflict to 409", async () => {
    syncDiscardMock.mockRejectedValue(
      new ResticSyncError("No snapshot to discard", 409),
    );
    const res = await fastify.inject({ method: "POST", url: "/p1/discard" });
    expect(res.statusCode).toBe(409);
  });

  it("should map an unexpected error to 500", async () => {
    syncPushMock.mockRejectedValue(new Error("restic exploded"));
    const res = await fastify.inject({ method: "POST", url: "/p1/push" });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "restic exploded" });
  });

  it("should return 404 when the project does not exist", async () => {
    dataGetMock.mockResolvedValue(null);
    const res = await fastify.inject({ method: "POST", url: "/nope/pull" });
    expect(res.statusCode).toBe(404);
    expect(syncPullMock).not.toHaveBeenCalled();
  });

  it("should forward the authenticated user name to the push", async () => {
    syncPushMock.mockResolvedValue({
      snapshotId: "abc12345",
      snapshotTime: "2026-01-01T00:00:00Z",
    });
    const res = await fastify.inject({ method: "POST", url: "/p1/push" });
    expect(res.statusCode).toBe(200);
    expect(syncPushMock.mock.calls[0][3]).toBe("admin");
  });
});

describe("sync notifications", () => {
  beforeEach(() => {
    dataGetMock.mockResolvedValue(projectFixture({ id: "p1" }));
  });

  it("should notify a successful push", async () => {
    const project = projectFixture({ id: "p1" });
    dataGetMock.mockResolvedValue(project);
    syncPushMock.mockResolvedValue({
      snapshotId: "abc12345",
      snapshotTime: "2026-01-01T00:00:00Z",
    });
    await fastify.inject({ method: "POST", url: "/p1/push" });
    expect(notifyMock).toHaveBeenCalledWith("push", project, "admin", "abc12345");
  });

  it("should notify a successful pull", async () => {
    const project = projectFixture({ id: "p1" });
    dataGetMock.mockResolvedValue(project);
    syncPullMock.mockResolvedValue({
      snapshotId: "abc12345",
      snapshotTime: "2026-01-01T00:00:00Z",
      secrets: 2,
      keys: 3,
    });
    await fastify.inject({ method: "POST", url: "/p1/pull" });
    expect(notifyMock).toHaveBeenCalledWith("pull", project, "admin", "abc12345");
  });

  it("should notify a successful snapshot restore", async () => {
    const project = projectFixture({ id: "p1" });
    dataGetMock.mockResolvedValue(project);
    syncRestoreMock.mockResolvedValue({
      snapshotId: "snap-1",
      snapshotTime: "2026-01-01T00:00:00Z",
      secrets: 2,
      keys: 3,
    });
    await fastify.inject({
      method: "POST",
      url: "/p1/snapshots/snap-1/restore",
    });
    expect(notifyMock).toHaveBeenCalledWith("restore", project, "admin", "snap-1");
  });

  it("should notify a successful discard", async () => {
    const project = projectFixture({ id: "p1" });
    dataGetMock.mockResolvedValue(project);
    syncDiscardMock.mockResolvedValue({
      snapshotId: "abc12345",
      snapshotTime: "2026-01-01T00:00:00Z",
      secrets: 2,
      keys: 3,
    });
    await fastify.inject({ method: "POST", url: "/p1/discard" });
    expect(notifyMock).toHaveBeenCalledWith("discard", project, "admin", "abc12345");
  });

  it("should notify a push conflict and keep the 409 response", async () => {
    const project = projectFixture({ id: "p1" });
    dataGetMock.mockResolvedValue(project);
    syncPushMock.mockRejectedValue(
      new ResticSyncError("A newer snapshot exists", 409),
    );
    const res = await fastify.inject({ method: "POST", url: "/p1/push" });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "A newer snapshot exists" });
    expect(notifyMock).toHaveBeenCalledWith(
      "push_conflict",
      project,
      "admin",
    );
  });

  it("should not notify non-409 sync errors", async () => {
    syncPushMock.mockRejectedValue(new Error("restic exploded"));
    await fastify.inject({ method: "POST", url: "/p1/push" });
    syncPullMock.mockRejectedValue(new ResticSyncError("No snapshot", 409));
    await fastify.inject({ method: "POST", url: "/p1/pull" });
    expect(notifyMock).not.toHaveBeenCalled();
  });
});

describe("preview endpoints", () => {
  beforeEach(() => {
    dataGetMock.mockResolvedValue(projectFixture({ id: "p1" }));
    previewPullMock.mockResolvedValue({
      summary: { secretsChanged: 1 },
      secrets: [],
      snapshotId: "abc12345",
      snapshotTime: "2026-01-01T00:00:00Z",
    });
  });

  it("should return the pull preview wrapped in a preview envelope", async () => {
    const res = await fastify.inject({ method: "GET", url: "/p1/preview/pull" });
    expect(res.statusCode).toBe(200);
    expect(res.json().preview.snapshotId).toBe("abc12345");
    expect(previewPullMock).toHaveBeenCalled();
  });

  it("should return the discard preview", async () => {
    previewDiscardMock.mockResolvedValue({
      summary: {},
      secrets: [],
      snapshotId: "abc12345",
      snapshotTime: "2026-01-01T00:00:00Z",
    });
    const res = await fastify.inject({
      method: "GET",
      url: "/p1/preview/discard",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().preview.snapshotId).toBe("abc12345");
  });

  it("should return the snapshot restore preview", async () => {
    previewRestoreMock.mockResolvedValue({
      summary: {},
      secrets: [],
      snapshotId: "snap-1",
      snapshotTime: "2026-01-01T00:00:00Z",
    });
    const res = await fastify.inject({
      method: "GET",
      url: "/p1/preview/snapshots/snap-1",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().preview.snapshotId).toBe("snap-1");
    expect(previewRestoreMock.mock.calls[0][3]).toBe("snap-1");
  });

  it("should map a preview sync error to its status code", async () => {
    previewDiscardMock.mockRejectedValue(
      new ResticSyncError("Project was never synchronized", 409),
    );
    const res = await fastify.inject({
      method: "GET",
      url: "/p1/preview/discard",
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "Project was never synchronized" });
  });

  it("should return 401 when there is no live user", async () => {
    denyUnauthenticated();
    const res = await fastify.inject({ method: "GET", url: "/p1/preview/pull" });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("UNAUTHENTICATED");
    expect(previewPullMock).not.toHaveBeenCalled();
  });

  it("should return 404 when the project does not exist", async () => {
    dataGetMock.mockResolvedValue(null);
    const res = await fastify.inject({ method: "GET", url: "/nope/preview/pull" });
    expect(res.statusCode).toBe(404);
    expect(previewPullMock).not.toHaveBeenCalled();
  });

  it("should return 403 when the live user has no access to the project", async () => {
    denyForbidden();
    const res = await fastify.inject({ method: "GET", url: "/p1/preview/pull" });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "Access Denied", code: "FORBIDDEN" });
    expect(previewPullMock).not.toHaveBeenCalled();
  });
});

describe("live authorization regressions", () => {
  const projectBody = {
    name: "New Project",
    s3Endpoint: "s3.example.com",
    s3Bucket: "bucket",
    s3AccessKeyId: "access-key",
    s3SecretAccessKey: "secret-key",
    resticPassword: "restic-password",
  };

  it("should reject a demoted admin on admin-only routes with 403", async () => {
    getUserMock.mockResolvedValue(liveUser({ role: "user", scopes: [] }));
    mustBeAdminMock.mockImplementation(async (_req: unknown, res: any) => {
      res.status(403).send({ error: "Access Denied", code: "FORBIDDEN" });
      throw new Error("Access Denied");
    });

    const res = await fastify.inject({
      method: "POST",
      url: "/",
      payload: projectBody,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
    expect(dataAddMock).not.toHaveBeenCalled();
    expect(scopesAddMock).not.toHaveBeenCalled();
  });

  it("should deny a demoted admin the project access they had as admin", async () => {
    dataGetMock.mockResolvedValue(projectFixture({ id: "p1" }));
    denyForbidden();

    const res = await fastify.inject({ method: "GET", url: "/p1" });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "Access Denied", code: "FORBIDDEN" });
  });

  it("should list only the projects allowed by the live scopes", async () => {
    dataListMock.mockResolvedValue([
      projectFixture({ id: "p1" }),
      projectFixture({ id: "p2" }),
    ]);
    countsAllMock.mockResolvedValue(new Map());
    accessManyMock.mockReturnValue(new Set(["p2"]));
    getUserMock.mockResolvedValue(liveUser({ scopes: ["project:p2"] }));

    const res = await fastify.inject({ method: "GET", url: "/" });

    expect(res.statusCode).toBe(200);
    expect(res.json().projects.map((p: any) => p.id)).toEqual(["p2"]);
    expect(accessManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user-1" }),
      ["p1", "p2"],
    );
  });

  it("should return 401 for a deleted user on a project route", async () => {
    denyUnauthenticated();

    const res = await fastify.inject({ method: "GET", url: "/p1" });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("UNAUTHENTICATED");
    expect(dataGetMock).not.toHaveBeenCalled();
  });

  it("should use the live user name as the push actor", async () => {
    getUserMock.mockResolvedValue(liveUser({ name: "alice" }));
    dataGetMock.mockResolvedValue(projectFixture({ id: "p1" }));
    syncPushMock.mockResolvedValue({
      snapshotId: "abc12345",
      snapshotTime: "2026-01-01T00:00:00Z",
    });

    const res = await fastify.inject({ method: "POST", url: "/p1/push" });

    expect(res.statusCode).toBe(200);
    expect(syncPushMock.mock.calls[0][3]).toBe("alice");
    expect(notifyMock).toHaveBeenCalledWith(
      "push",
      expect.anything(),
      "alice",
      "abc12345",
    );
  });
});
