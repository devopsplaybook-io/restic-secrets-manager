import Fastify, { FastifyInstance } from "fastify";
import { Project } from "../model/Project";
import { Secret } from "../model/Secret";
import { SecretsRoutes } from "./SecretsRoutes";
import { computeSecretsHash } from "./SecretsHash";

jest.mock("../users/ProjectAccess", () => ({
  ProjectAccessEnsure: jest.fn(),
}));

jest.mock("../projects/ProjectsData", () => ({
  ProjectsDataGet: jest.fn(),
}));

jest.mock("./SecretsData", () => ({
  SecretsDataAdd: jest.fn(),
  SecretsDataDelete: jest.fn(),
  SecretsDataGetByName: jest.fn(),
  SecretsDataListForProject: jest.fn(),
  SecretsDataUpdate: jest.fn(),
}));

jest.mock("../restic/SyncLocks", () => ({
  ProjectWriteLocksRun: jest.fn(
    (_projectId: string, task: () => Promise<unknown>) => task(),
  ),
}));

import { ProjectAccessEnsure } from "../users/ProjectAccess";
import { ProjectsDataGet } from "../projects/ProjectsData";
import {
  SecretsDataAdd,
  SecretsDataDelete,
  SecretsDataGetByName,
  SecretsDataListForProject,
  SecretsDataUpdate,
} from "./SecretsData";
import { ProjectWriteLocksRun } from "../restic/SyncLocks";

const ensureMock = ProjectAccessEnsure as jest.Mock;
const projectGetMock = ProjectsDataGet as jest.Mock;
const addMock = SecretsDataAdd as jest.Mock;
const deleteMock = SecretsDataDelete as jest.Mock;
const getByNameMock = SecretsDataGetByName as jest.Mock;
const listMock = SecretsDataListForProject as jest.Mock;
const updateMock = SecretsDataUpdate as jest.Mock;
const writeLockMock = ProjectWriteLocksRun as jest.Mock;

function secretFixture(overrides: Partial<Secret> = {}): Secret {
  const secret = new Secret();
  secret.projectId = "p1";
  secret.name = "existing";
  secret.data = { KEY: "value" };
  return Object.assign(secret, overrides);
}

function projectFixture(): Project {
  const project = new Project();
  project.id = "p1";
  project.name = "Project 1";
  return project;
}

/** Applies the version bump the real data layer performs on success. */
function updateSucceeds(): void {
  updateMock.mockImplementation(
    async (_context: unknown, secret: Secret, expectedVersion: number) => {
      secret.version = expectedVersion + 1;
      return "updated";
    },
  );
}

/** Mirrors the real ProjectAccessEnsure denial (403 + null, no throw). */
function denyAccess(): void {
  ensureMock.mockImplementation(async (_req: unknown, res: any) => {
    res.status(403).send({ error: "Access Denied", code: "FORBIDDEN" });
    return null;
  });
}

/** Mirrors the real ProjectAccessEnsure 401 (no live user). */
function denyUnauthenticated(): void {
  ensureMock.mockImplementation(async (_req: unknown, res: any) => {
    res.status(401).send({
      error: "Authentication Required",
      code: "UNAUTHENTICATED",
    });
    return null;
  });
}

let fastify: FastifyInstance;

beforeEach(async () => {
  jest.clearAllMocks();
  ensureMock.mockResolvedValue(true);
  projectGetMock.mockResolvedValue(projectFixture());
  listMock.mockResolvedValue([]);
  fastify = Fastify();
  await new SecretsRoutes().getRoutes(fastify);
  await fastify.ready();
});

afterEach(async () => {
  await fastify.close();
});

describe("authorization", () => {
  it("should return 403 and skip the data layer when access is denied", async () => {
    denyAccess();
    const res = await fastify.inject({ method: "GET", url: "/p1/secrets" });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "Access Denied", code: "FORBIDDEN" });
    expect(listMock).not.toHaveBeenCalled();
  });

  it("should return 401 and skip the data layer when there is no live user", async () => {
    denyUnauthenticated();
    const res = await fastify.inject({ method: "GET", url: "/p1/secrets" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      error: "Authentication Required",
      code: "UNAUTHENTICATED",
    });
    expect(listMock).not.toHaveBeenCalled();
  });
});

describe("GET /:id/secrets", () => {
  it("should list the secrets of the project", async () => {
    listMock.mockResolvedValue([secretFixture()]);
    const res = await fastify.inject({ method: "GET", url: "/p1/secrets" });
    expect(res.statusCode).toBe(200);
    expect(res.json().secrets).toHaveLength(1);
    expect(res.json().secrets[0].name).toBe("existing");
  });
});

describe("GET /:id/secrets/by-name/:name/export", () => {
  it("should export a secret as .env text by default", async () => {
    getByNameMock.mockResolvedValue(
      secretFixture({ name: "app-config", data: { KEY: "value" } }),
    );
    const res = await fastify.inject({
      method: "GET",
      url: "/p1/secrets/by-name/app-config/export",
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.body).toBe("KEY=value\n");
  });

  it("should export a secret as JSON with format=json", async () => {
    getByNameMock.mockResolvedValue(
      secretFixture({ name: "app-config", data: { KEY: "value" } }),
    );
    const res = await fastify.inject({
      method: "GET",
      url: "/p1/secrets/by-name/app-config/export?format=json",
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.body).toBe('{\n  "KEY": "value"\n}\n');
  });

  it("should escape values that the .env format would alter", async () => {
    getByNameMock.mockResolvedValue(
      secretFixture({ name: "app-config", data: { CERT: "line1\nline2" } }),
    );
    const res = await fastify.inject({
      method: "GET",
      url: "/p1/secrets/by-name/app-config/export",
    });
    expect(res.body).toBe('CERT="line1\\nline2"\n');
  });

  it("should reject an export with non-env-safe keys with a clear 400", async () => {
    getByNameMock.mockResolvedValue(
      secretFixture({ name: "app-config", data: { "A B": "value" } }),
    );
    const res = await fastify.inject({
      method: "GET",
      url: "/p1/secrets/by-name/app-config/export",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('invalid key(s) "A B"');
    expect(res.json().error).toContain("Use the JSON export instead");
  });

  it("should still export non-env-safe keys as JSON", async () => {
    getByNameMock.mockResolvedValue(
      secretFixture({ name: "app-config", data: { "A B": "value" } }),
    );
    const res = await fastify.inject({
      method: "GET",
      url: "/p1/secrets/by-name/app-config/export?format=json",
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ "A B": "value" });
  });

  it("should export empty data as an empty file", async () => {
    getByNameMock.mockResolvedValue(
      secretFixture({ name: "app-config", data: {} }),
    );
    const res = await fastify.inject({
      method: "GET",
      url: "/p1/secrets/by-name/app-config/export",
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("");
  });

  it("should return 404 for an unknown secret name", async () => {
    getByNameMock.mockResolvedValue(null);
    const res = await fastify.inject({
      method: "GET",
      url: "/p1/secrets/by-name/unknown/export",
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Secret Not Found" });
  });

  it("should return 400 for an unknown format", async () => {
    getByNameMock.mockResolvedValue(secretFixture());
    const res = await fastify.inject({
      method: "GET",
      url: "/p1/secrets/by-name/app-config/export?format=yaml",
    });
    expect(res.statusCode).toBe(400);
  });

  it("should return 403 and skip the data layer when access is denied", async () => {
    denyAccess();
    const res = await fastify.inject({
      method: "GET",
      url: "/p1/secrets/by-name/app-config/export",
    });
    expect(res.statusCode).toBe(403);
    expect(getByNameMock).not.toHaveBeenCalled();
  });
});

describe("POST /:id/secrets", () => {
  it("should create the secret and its content hash under the write lock", async () => {
    addMock.mockResolvedValue(undefined);
    const res = await fastify.inject({
      method: "POST",
      url: "/p1/secrets",
      payload: { name: "api-key", data: { KEY: "value" } },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().secret).toMatchObject({
      projectId: "p1",
      name: "api-key",
      data: { KEY: "value" },
    });
    expect(writeLockMock).toHaveBeenCalledWith(
      "p1",
      expect.any(Function),
      undefined,
    );
    expect(addMock).toHaveBeenCalledTimes(1);
    const created = addMock.mock.calls[0][1] as Secret;
    expect(addMock.mock.calls[0][2]).toBe(computeSecretsHash([created]));
  });

  it("should return 404 when the project was deleted", async () => {
    projectGetMock.mockResolvedValue(null);
    const res = await fastify.inject({
      method: "POST",
      url: "/p1/secrets",
      payload: { name: "api-key", data: { KEY: "value" } },
    });
    expect(res.statusCode).toBe(404);
    expect(addMock).not.toHaveBeenCalled();
  });

  it("should reject an empty data key with 400", async () => {
    const res = await fastify.inject({
      method: "POST",
      url: "/p1/secrets",
      payload: { name: "file1", data: { "": "x" } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("empty key");
    expect(addMock).not.toHaveBeenCalled();
  });

  it("should reject a name longer than 200 characters with 400", async () => {
    const res = await fastify.inject({
      method: "POST",
      url: "/p1/secrets",
      payload: { name: "a".repeat(201), data: { KEY: "x" } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("200 characters");
    expect(addMock).not.toHaveBeenCalled();
  });

  it("should return 409 when the name is already taken", async () => {
    listMock.mockResolvedValue([secretFixture()]);
    const res = await fastify.inject({
      method: "POST",
      url: "/p1/secrets",
      payload: { name: "existing", data: { KEY: "x" } },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("SECRET_NAME_CONFLICT");
    expect(addMock).not.toHaveBeenCalled();
  });

  it("should map a unique-violation insert error to 409", async () => {
    addMock.mockRejectedValue(
      Object.assign(
        new Error("UNIQUE constraint failed: secrets.projectId, secrets.name"),
        { code: "SQLITE_CONSTRAINT_UNIQUE" },
      ),
    );
    const res = await fastify.inject({
      method: "POST",
      url: "/p1/secrets",
      payload: { name: "api-key", data: { KEY: "x" } },
    });
    expect(res.statusCode).toBe(409);
  });
});

describe("PUT /:id/secrets/:secretId", () => {
  it("should rename and update the data with its content hash", async () => {
    const existing = secretFixture({ id: "s1", name: "old" });
    listMock.mockResolvedValue([existing]);
    updateSucceeds();
    const res = await fastify.inject({
      method: "PUT",
      url: "/p1/secrets/s1",
      payload: { name: "new-name", data: { A: "1" }, version: 1 },
    });
    expect(res.statusCode).toBe(200);
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock.mock.calls[0][1].name).toBe("new-name");
    expect(updateMock.mock.calls[0][1].data).toEqual({ A: "1" });
    expect(updateMock.mock.calls[0][2]).toBe(1);
    expect(updateMock.mock.calls[0][3]).toBe(
      computeSecretsHash([updateMock.mock.calls[0][1]]),
    );
    expect(res.json().secret.version).toBe(2);
  });

  it("should return 404 when the project was deleted", async () => {
    projectGetMock.mockResolvedValue(null);
    const res = await fastify.inject({
      method: "PUT",
      url: "/p1/secrets/s1",
      payload: { data: { A: "1" }, version: 1 },
    });
    expect(res.statusCode).toBe(404);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("should require an integer version >= 1", async () => {
    for (const version of [undefined, 0, -1, 1.5, "1", null]) {
      const res = await fastify.inject({
        method: "PUT",
        url: "/p1/secrets/s1",
        payload: { data: { A: "1" }, version },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("version is required");
    }
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("should return 404 when the secret belongs to another project", async () => {
    listMock.mockResolvedValue([secretFixture({ projectId: "other" })]);
    const res = await fastify.inject({
      method: "PUT",
      url: "/p1/secrets/s1",
      payload: { data: { A: "1" }, version: 1 },
    });
    expect(res.statusCode).toBe(404);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("should map a stale version to 409 with the conflict code", async () => {
    listMock.mockResolvedValue([secretFixture({ id: "s1" })]);
    updateMock.mockResolvedValue("version_conflict");
    const res = await fastify.inject({
      method: "PUT",
      url: "/p1/secrets/s1",
      payload: { data: { A: "1" }, version: 1 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("SECRET_VERSION_CONFLICT");
    expect(res.json().error).toContain("modified by another user");
  });

  it("should map a missing row reported by the update to 404", async () => {
    listMock.mockResolvedValue([secretFixture({ id: "s1" })]);
    updateMock.mockResolvedValue("not_found");
    const res = await fastify.inject({
      method: "PUT",
      url: "/p1/secrets/s1",
      payload: { data: { A: "1" }, version: 1 },
    });
    expect(res.statusCode).toBe(404);
  });

  it("should return 409 with the name code when renaming onto a taken name", async () => {
    listMock.mockResolvedValue([
      secretFixture({ id: "s1", name: "old" }),
      secretFixture({ id: "s2", name: "taken" }),
    ]);
    const res = await fastify.inject({
      method: "PUT",
      url: "/p1/secrets/s1",
      payload: { name: "taken", version: 1 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("SECRET_NAME_CONFLICT");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("should map a unique violation from the update to 409", async () => {
    listMock.mockResolvedValue([secretFixture({ id: "s1", name: "old" })]);
    updateMock.mockRejectedValue(
      Object.assign(
        new Error("UNIQUE constraint failed: secrets.projectId, secrets.name"),
        { code: "SQLITE_CONSTRAINT_UNIQUE" },
      ),
    );
    const res = await fastify.inject({
      method: "PUT",
      url: "/p1/secrets/s1",
      payload: { name: "taken", version: 1 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("SECRET_NAME_CONFLICT");
  });
});

describe("PUT /:id/secrets/:secretId/keys", () => {
  it("should merge only the selected key into the current data", async () => {
    listMock.mockResolvedValue([
      secretFixture({ id: "s1", data: { A: "1", B: "2" } }),
    ]);
    updateSucceeds();
    const res = await fastify.inject({
      method: "PUT",
      url: "/p1/secrets/s1/keys",
      payload: { key: "B", value: "new", version: 1 },
    });
    expect(res.statusCode).toBe(200);
    expect(updateMock).toHaveBeenCalledTimes(1);
    // The whole map still contains the unrelated key unchanged
    expect(updateMock.mock.calls[0][1].data).toEqual({ A: "1", B: "new" });
    expect(updateMock.mock.calls[0][2]).toBe(1);
    expect(res.json().secret.data).toEqual({ A: "1", B: "new" });
    expect(res.json().secret.version).toBe(2);
    expect(writeLockMock).toHaveBeenCalledWith(
      "p1",
      expect.any(Function),
      undefined,
    );
  });

  it("should ignore a stale client version and use the fresh row version", async () => {
    listMock.mockResolvedValue([secretFixture({ id: "s1", version: 7 })]);
    updateSucceeds();
    const res = await fastify.inject({
      method: "PUT",
      url: "/p1/secrets/s1/keys",
      payload: { key: "K", value: "x", version: 1 },
    });
    expect(res.statusCode).toBe(200);
    expect(updateMock.mock.calls[0][2]).toBe(7);
  });

  it("should retry the read/merge/update when a non-cooperating writer wins", async () => {
    const stored = secretFixture({ id: "s1", data: { A: "1" }, version: 1 });
    listMock.mockResolvedValue([stored]);
    let attempts = 0;
    updateMock.mockImplementation(
      async (_context: unknown, secret: Secret, expectedVersion: number) => {
        attempts++;
        if (attempts === 1) {
          // An old replica changed another key between our read and write.
          stored.data = { A: "1", B: "2" };
          stored.version = 2;
          return "version_conflict";
        }
        secret.version = expectedVersion + 1;
        return "updated";
      },
    );

    const res = await fastify.inject({
      method: "PUT",
      url: "/p1/secrets/s1/keys",
      payload: { key: "C", value: "3", version: 1 },
    });

    expect(res.statusCode).toBe(200);
    expect(attempts).toBe(2);
    // Neither the other writer's key nor our key is lost
    expect(stored.data).toEqual({ A: "1", B: "2", C: "3" });
    expect(res.json().secret.data).toEqual({ A: "1", B: "2", C: "3" });
  });

  it("should reject a missing key, a non-scalar value or a missing version", async () => {
    const cases = [
      { value: "x", version: 1 },
      { key: "  ", value: "x", version: 1 },
      { key: "K", value: { nested: true }, version: 1 },
      { key: "K", value: ["a"], version: 1 },
      { key: "K", value: "x" },
    ];
    for (const payload of cases) {
      const res = await fastify.inject({
        method: "PUT",
        url: "/p1/secrets/s1/keys",
        payload,
      });
      expect(res.statusCode).toBe(400);
    }
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("should return 404 for an unknown secret", async () => {
    listMock.mockResolvedValue([]);
    const res = await fastify.inject({
      method: "PUT",
      url: "/p1/secrets/s1/keys",
      payload: { key: "K", value: "x", version: 1 },
    });
    expect(res.statusCode).toBe(404);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("should return 404 when the project was deleted", async () => {
    projectGetMock.mockResolvedValue(null);
    const res = await fastify.inject({
      method: "PUT",
      url: "/p1/secrets/s1/keys",
      payload: { key: "K", value: "x", version: 1 },
    });
    expect(res.statusCode).toBe(404);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("should map an exhausted retry to 409", async () => {
    listMock.mockResolvedValue([secretFixture({ id: "s1" })]);
    updateMock.mockResolvedValue("version_conflict");
    const res = await fastify.inject({
      method: "PUT",
      url: "/p1/secrets/s1/keys",
      payload: { key: "K", value: "x", version: 1 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("SECRET_VERSION_CONFLICT");
    expect(updateMock).toHaveBeenCalledTimes(3);
  });

  it("should send no-store headers", async () => {
    listMock.mockResolvedValue([secretFixture({ id: "s1" })]);
    updateSucceeds();
    const res = await fastify.inject({
      method: "PUT",
      url: "/p1/secrets/s1/keys",
      payload: { key: "K", value: "x", version: 1 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});

describe("DELETE /:id/secrets/:secretId", () => {
  it("should delete the secret and write the remaining content hash", async () => {
    listMock.mockResolvedValue([secretFixture({ id: "s1" })]);
    const res = await fastify.inject({
      method: "DELETE",
      url: "/p1/secrets/s1",
    });
    expect(res.statusCode).toBe(200);
    expect(deleteMock).toHaveBeenCalledWith(
      undefined,
      "s1",
      "p1",
      computeSecretsHash([]),
    );
    expect(writeLockMock).toHaveBeenCalledWith(
      "p1",
      expect.any(Function),
      undefined,
    );
  });

  it("should return 404 when the project was deleted", async () => {
    projectGetMock.mockResolvedValue(null);
    const res = await fastify.inject({
      method: "DELETE",
      url: "/p1/secrets/s1",
    });
    expect(res.statusCode).toBe(404);
    expect(deleteMock).not.toHaveBeenCalled();
  });
});

describe("anti-caching headers", () => {
  function expectNoStore(res: any): void {
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["pragma"]).toBe("no-cache");
    expect(res.headers["vary"]).toBe("Authorization");
  }

  it("should send no-store headers on the secret list", async () => {
    listMock.mockResolvedValue([secretFixture()]);
    const res = await fastify.inject({ method: "GET", url: "/p1/secrets" });
    expect(res.statusCode).toBe(200);
    expectNoStore(res);
  });

  it("should send no-store headers on the .env export", async () => {
    getByNameMock.mockResolvedValue(
      secretFixture({ name: "app-config", data: { KEY: "value" } }),
    );
    const res = await fastify.inject({
      method: "GET",
      url: "/p1/secrets/by-name/app-config/export",
    });
    expect(res.statusCode).toBe(200);
    expectNoStore(res);
  });

  it("should send no-store headers on the JSON export", async () => {
    getByNameMock.mockResolvedValue(
      secretFixture({ name: "app-config", data: { KEY: "value" } }),
    );
    const res = await fastify.inject({
      method: "GET",
      url: "/p1/secrets/by-name/app-config/export?format=json",
    });
    expect(res.statusCode).toBe(200);
    expectNoStore(res);
  });

  it("should send no-store headers when a created secret is echoed back", async () => {
    addMock.mockResolvedValue(undefined);
    const res = await fastify.inject({
      method: "POST",
      url: "/p1/secrets",
      payload: { name: "api-key", data: { KEY: "value" } },
    });
    expect(res.statusCode).toBe(201);
    expectNoStore(res);
  });

  it("should send no-store headers when an updated secret is echoed back", async () => {
    listMock.mockResolvedValue([secretFixture({ id: "s1" })]);
    updateSucceeds();
    const res = await fastify.inject({
      method: "PUT",
      url: "/p1/secrets/s1",
      payload: { data: { A: "1" }, version: 1 },
    });
    expect(res.statusCode).toBe(200);
    expectNoStore(res);
  });
});