import * as nodeFs from "fs";
import * as os from "os";
import * as path from "path";
import Fastify, { FastifyInstance } from "fastify";
import {
  AuthInit,
  AuthSetAuditHandler,
  UsersRoutes,
} from "@devopsplaybook.io/common-utils";
import type { StandardLogger, StandardTracer } from "@devopsplaybook.io/otel-utils";
import { DbUtilsGetDatabase, DbUtilsSetOTel } from "../utils-std-ts/DbUtils";
import { DbInit } from "../utils-std-ts/DbInit";
import { AuthWiringSetOTel } from "./AuthWiring";

const mockTracer = {
  startSpan: jest.fn(() => ({
    end: jest.fn(),
    addEvent: jest.fn(),
    setAttributes: jest.fn(),
    setStatus: jest.fn(),
  })),
} as unknown as StandardTracer;

const mockStandardLogger = {
  createModuleLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  })),
} as unknown as StandardLogger;

let baseDir: string;
let app: FastifyInstance;

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
  baseDir = nodeFs.mkdtempSync(path.join(os.tmpdir(), "login-codes-off-"));
  const dataDir = path.join(baseDir, "data");

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
      LOGIN_CODE_ENABLED: false,
    } as never,
    [],
  );

  app = Fastify();
  await app.register(new UsersRoutes().getRoutes, { prefix: "/api/users" });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  closeCurrentDb();
  nodeFs.rmSync(baseDir, { recursive: true, force: true });
});

describe("login with a code (disabled)", () => {
  it("should not mount any login-code route", async () => {
    const capabilities = await app.inject({
      method: "GET",
      url: "/api/users/login-codes/capabilities",
    });
    expect(capabilities.statusCode).toBe(404);

    const create = await app.inject({
      method: "POST",
      url: "/api/users/login-codes/",
    });
    expect(create.statusCode).toBe(404);
  });
});
