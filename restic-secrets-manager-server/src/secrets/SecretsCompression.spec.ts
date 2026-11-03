import fastifyCompress from "@fastify/compress";
import Fastify, { FastifyInstance } from "fastify";
import { Project } from "../model/Project";
import { Secret } from "../model/Secret";
import { SecretsRoutes } from "./SecretsRoutes";

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
import { SecretsDataListForProject } from "./SecretsData";

const ensureMock = ProjectAccessEnsure as jest.Mock;
const projectGetMock = ProjectsDataGet as jest.Mock;
const listMock = SecretsDataListForProject as jest.Mock;

function projectFixture(): Project {
  const project = new Project();
  project.id = "p1";
  project.name = "Project 1";
  return project;
}

/** A secrets list large enough to exceed the compression threshold. */
function largeSecrets(): Secret[] {
  const value = "x".repeat(4_000);
  return Array.from({ length: 5 }, (_, index) => {
    const secret = new Secret();
    secret.projectId = "p1";
    secret.name = `secret-${index}`;
    secret.data = { KEY: value };
    return secret;
  });
}

let fastify: FastifyInstance;

beforeEach(async () => {
  jest.clearAllMocks();
  ensureMock.mockResolvedValue({
    id: "user-1",
    name: "alice",
    role: "admin",
    scopes: [],
  });
  projectGetMock.mockResolvedValue(projectFixture());
  listMock.mockResolvedValue(largeSecrets());

  fastify = Fastify();
  await fastify.register(fastifyCompress, {
    global: true,
    threshold: 1024,
    encodings: ["gzip", "deflate"],
  });
  await new SecretsRoutes().getRoutes(fastify);
  // Control route: non-secret responses stay compressed by the global plugin.
  fastify.get("/api/control", async () => ({
    items: Array.from({ length: 50 }, () => ({ value: "x".repeat(200) })),
  }));
  await fastify.ready();
});

afterEach(async () => {
  await fastify.close();
});

describe("secret response compression", () => {
  it("does not compress the secret list", async () => {
    const res = await fastify.inject({
      method: "GET",
      url: "/p1/secrets",
      headers: { "accept-encoding": "gzip" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-encoding"]).toBeUndefined();
    expect(res.rawPayload.length).toBeGreaterThan(1024);
  });

  it("does not compress the by-name export", async () => {
    const secret = largeSecrets()[0];
    const { SecretsDataGetByName } = jest.requireMock("./SecretsData");
    (SecretsDataGetByName as jest.Mock).mockResolvedValue(secret);

    const env = await fastify.inject({
      method: "GET",
      url: "/p1/secrets/by-name/secret-0/export",
      headers: { "accept-encoding": "gzip" },
    });
    expect(env.statusCode).toBe(200);
    expect(env.headers["content-encoding"]).toBeUndefined();

    const json = await fastify.inject({
      method: "GET",
      url: "/p1/secrets/by-name/secret-0/export?format=json",
      headers: { "accept-encoding": "gzip" },
    });
    expect(json.statusCode).toBe(200);
    expect(json.headers["content-encoding"]).toBeUndefined();
  });

  it("still compresses non-secret responses", async () => {
    const res = await fastify.inject({
      method: "GET",
      url: "/api/control",
      headers: { "accept-encoding": "gzip" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-encoding"]).toBe("gzip");
  });
});
