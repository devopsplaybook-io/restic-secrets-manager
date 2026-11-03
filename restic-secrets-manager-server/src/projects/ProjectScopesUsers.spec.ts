import * as nodeFs from "fs";
import * as os from "os";
import * as path from "path";
import Fastify, { FastifyInstance } from "fastify";
import {
  AuthInit,
  AuthSetAuditHandler,
  User,
  UsersDataGet,
  UsersDataGetByName,
  UsersRoutes,
} from "@devopsplaybook.io/common-utils";
import type { StandardLogger, StandardTracer } from "@devopsplaybook.io/otel-utils";
import { DbUtilsGetDatabase, DbUtilsSetOTel } from "../utils-std-ts/DbUtils";
import { DbInit } from "../utils-std-ts/DbInit";
import { AuthWiringSetOTel } from "../users/AuthWiring";
import { ProjectScopesAdd, ProjectScopesRefresh } from "./ProjectScopes";

// The "other replica" project set is controlled by this mock
jest.mock("./ProjectsData", () => ({
  ProjectsDataList: jest.fn(),
}));

import { ProjectsDataList } from "./ProjectsData";

const projectsListMock = ProjectsDataList as jest.Mock;

const mockTracer = {
  startSpan: jest.fn(() => ({
    end: jest.fn(),
    addEvent: jest.fn(),
    setAttributes: jest.fn(),
    setStatus: jest.fn(),
  })),
} as unknown as StandardTracer;

const mockModuleLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};
const mockStandardLogger = {
  createModuleLogger: jest.fn(() => mockModuleLogger),
} as unknown as StandardLogger;

let baseDir: string;
let dataDir: string;
let app: FastifyInstance;
let adminToken: string;
let aliceId: string;
let originalScopes: string[];

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

function closeCurrentDb(): void {
  const db = DbUtilsGetDatabase() as unknown as
    | { close: () => void }
    | undefined;
  try {
    db?.close();
  } catch {
    // already closed
  }
}

beforeEach(async () => {
  jest.clearAllMocks();
  AuthSetAuditHandler(undefined);
  baseDir = nodeFs.mkdtempSync(path.join(os.tmpdir(), "project-scopes-users-"));
  dataDir = path.join(baseDir, "data");

  DbUtilsSetOTel(mockTracer, mockStandardLogger);
  AuthWiringSetOTel(mockTracer);
  await DbInit(undefined as never, {
    DATABASE_TYPE: "sqlite",
    DATA_DIR: dataDir,
  });
  await AuthInit(
    undefined as never,
    {
      JWT_KEY: "test-key",
      JWT_VALIDITY_DURATION: 3600,
      DATABASE_TYPE: "sqlite",
      AUTH_RATE_LIMIT_LOGIN_MAX: 1000,
      AUTH_RATE_LIMIT_REFRESH_MAX: 1000,
      AUTH_RATE_LIMIT_WINDOW_SECONDS: 60,
    } as never,
    [],
  );

  app = Fastify();
  await app.register(new UsersRoutes().getRoutes, { prefix: "/api/users" });
  await app.ready();

  originalScopes = [...User.ALL_SCOPES];

  // Bootstrap the first admin (always admin), then a regular user to grant
  // project access to
  const created = await app.inject({
    method: "POST",
    url: "/api/users/",
    payload: { name: "root", password: "root-pass" },
  });
  expect(created.statusCode).toBe(201);
  const login = await app.inject({
    method: "POST",
    url: "/api/users/session",
    payload: { name: "root", password: "root-pass" },
  });
  expect(login.statusCode).toBe(201);
  adminToken = login.json().token as string;

  const alice = await app.inject({
    method: "POST",
    url: "/api/users/",
    payload: { name: "alice", password: "alice-pass" },
    headers: auth(adminToken),
  });
  expect(alice.statusCode).toBe(201);
  aliceId = (await UsersDataGetByName(undefined, "alice"))?.id as string;
});

afterEach(async () => {
  User.ALL_SCOPES = originalScopes;
  await app.close();
  closeCurrentDb();
  nodeFs.rmSync(baseDir, { recursive: true, force: true });
});

describe("project scopes across replicas", () => {
  it("should keep a project created on another replica after the refresh", async () => {
    // This replica still has the startup list: the new projects are unknown
    User.ALL_SCOPES = ["project:old"];
    // The database (shared with the other replica) holds the new projects
    projectsListMock.mockResolvedValue([{ id: "p1" }, { id: "p2" }]);

    await expect(ProjectScopesRefresh()).resolves.toBe(true);

    // A user update filtered by common-utils must retain both grants
    const res = await app.inject({
      method: "PUT",
      url: `/api/users/${aliceId}`,
      payload: { scopes: ["project:p1", "project:p2"] },
      headers: auth(adminToken),
    });

    expect(res.statusCode).toBe(201);
    const alice = await UsersDataGet(undefined, aliceId);
    expect(alice?.scopes).toEqual(["project:p1", "project:p2"]);
  });

  it("should keep a project created by the same process", async () => {
    User.ALL_SCOPES = ["project:p1"];
    projectsListMock.mockResolvedValue([{ id: "p1" }, { id: "p3" }]);

    // What the create route does, then the refresh it schedules
    ProjectScopesAdd("p3");
    await expect(ProjectScopesRefresh()).resolves.toBe(true);

    const res = await app.inject({
      method: "PUT",
      url: `/api/users/${aliceId}`,
      payload: { scopes: ["project:p1", "project:p3"] },
      headers: auth(adminToken),
    });

    expect(res.statusCode).toBe(201);
    const alice = await UsersDataGet(undefined, aliceId);
    expect(alice?.scopes).toEqual(["project:p1", "project:p3"]);
  });
});
