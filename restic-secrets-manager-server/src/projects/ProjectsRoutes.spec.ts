import Fastify, { FastifyInstance } from "fastify";
import { Project } from "../model/Project";
import { ProjectsRoutes } from "./ProjectsRoutes";

jest.mock("@devopsplaybook.io/common-utils", () => ({
  ...jest.requireActual("@devopsplaybook.io/common-utils"),
  AuthGetUserSession: jest.fn(),
  AuthMustBeAdmin: jest.fn(),
}));

jest.mock("../users/ProjectAccess", () => ({
  ProjectAccessCanAccess: jest.fn(),
  ProjectAccessCanAccessMany: jest.fn(),
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
}));

jest.mock("../restic/SyncStatusCache", () => ({
  SyncStatusCacheGet: jest.fn(),
  SyncStatusCacheInvalidate: jest.fn(),
}));

import {
  AuthGetUserSession,
  AuthMustBeAdmin,
} from "@devopsplaybook.io/common-utils";
import { ProjectAccessCanAccessMany } from "../users/ProjectAccess";
import {
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
  ProjectScopesPruneFromUsers,
  ProjectScopesRemove,
} from "./ProjectScopes";
import {
  ResticSyncDiscardLocalChanges,
  ResticSyncError,
  ResticSyncPull,
  ResticSyncPush,
  ResticSyncRestoreSnapshot,
} from "../restic/SyncService";
import {
  SyncStatusCacheGet,
  SyncStatusCacheInvalidate,
} from "../restic/SyncStatusCache";

const userSessionMock = AuthGetUserSession as jest.Mock;
const mustBeAdminMock = AuthMustBeAdmin as jest.Mock;
const accessManyMock = ProjectAccessCanAccessMany as jest.Mock;
const dataListMock = ProjectsDataList as jest.Mock;
const dataGetMock = ProjectsDataGet as jest.Mock;
const dataDeleteMock = ProjectsDataDelete as jest.Mock;
const countsAllMock = SecretsDataCountsAll as jest.Mock;
const countForProjectMock = SecretsDataCountForProject as jest.Mock;
const secretsDeleteByProjectMock = SecretsDataDeleteByProjectId as jest.Mock;
const secretsListMock = SecretsDataListForProject as jest.Mock;
const scopesPruneMock = ProjectScopesPruneFromUsers as jest.Mock;
const scopesRemoveMock = ProjectScopesRemove as jest.Mock;
const cacheGetMock = SyncStatusCacheGet as jest.Mock;
const cacheInvalidateMock = SyncStatusCacheInvalidate as jest.Mock;
const syncPullMock = ResticSyncPull as jest.Mock;
const syncPushMock = ResticSyncPush as jest.Mock;
const syncRestoreMock = ResticSyncRestoreSnapshot as jest.Mock;
const syncDiscardMock = ResticSyncDiscardLocalChanges as jest.Mock;

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

function adminSession() {
  return {
    isAuthenticated: true,
    userId: "admin-1",
    userName: "admin",
    role: "admin",
    scopes: [],
  };
}

let fastify: FastifyInstance;

beforeEach(async () => {
  jest.clearAllMocks();
  userSessionMock.mockResolvedValue(adminSession());
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
    accessManyMock.mockResolvedValue(new Set(["p1"]));

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

  it("should return 403 when the session is not authenticated", async () => {
    userSessionMock.mockResolvedValue({
      isAuthenticated: false,
      userId: undefined,
      userName: undefined,
      role: "user",
      scopes: [],
    });
    const res = await fastify.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(403);
    expect(dataListMock).not.toHaveBeenCalled();
  });
});

describe("GET /status", () => {
  it("should aggregate the sync status of the visible projects", async () => {
    dataListMock.mockResolvedValue([projectFixture({ id: "p1" })]);
    accessManyMock.mockResolvedValue(new Set(["p1"]));
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
    accessManyMock.mockResolvedValue(new Set(["p1"]));
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
});
