import * as nodeFs from "fs";
import * as os from "os";
import * as path from "path";
import Fastify, { FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
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

const mockModuleLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};
const mockStandardLogger = {
  createModuleLogger: jest.fn(() => mockModuleLogger),
} as unknown as StandardLogger;

const LOGIN_CODES = "/api/users/login-codes";

let baseDir: string;
let dataDir: string;
let app: FastifyInstance;
let adminToken: string;
let adminId: string;

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

async function createCode(): Promise<{ code: string; requestToken: string }> {
  const res = await app.inject({
    method: "POST",
    url: `${LOGIN_CODES}/`,
  });
  expect(res.statusCode).toBe(201);
  const body = res.json();
  expect(body.code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{8}$/);
  expect(typeof body.requestToken).toBe("string");
  expect(res.headers["cache-control"]).toBe("no-store");
  return { code: body.code as string, requestToken: body.requestToken as string };
}

beforeEach(async () => {
  jest.clearAllMocks();
  AuthSetAuditHandler(undefined);
  baseDir = nodeFs.mkdtempSync(path.join(os.tmpdir(), "login-codes-"));
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
      JWT_SESSION_MAX_DURATION: 7776000,
      DATABASE_TYPE: "sqlite",
      API_TOKENS_MAX_PER_USER: 10,
      AUTH_RATE_LIMIT_LOGIN_MAX: 1000,
      AUTH_RATE_LIMIT_REFRESH_MAX: 1000,
      AUTH_RATE_LIMIT_WINDOW_SECONDS: 60,
      LOGIN_CODE_ENABLED: true,
      LOGIN_CODE_APPROVE_REQUIRE_PASSWORD: true,
      LOGIN_CODE_RATE_LIMIT_CREATE_MAX: 0,
      LOGIN_CODE_RATE_LIMIT_POLL_MAX: 0,
      LOGIN_CODE_RATE_LIMIT_APPROVE_MAX: 0,
    } as never,
    [],
  );

  app = Fastify();
  await app.register(new UsersRoutes().getRoutes, { prefix: "/api/users" });
  await app.ready();

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
  adminId = (jwt.decode(adminToken) as jwt.JwtPayload).userId as string;
});

afterEach(async () => {
  await app.close();
  closeCurrentDb();
  nodeFs.rmSync(baseDir, { recursive: true, force: true });
});

describe("login with a code (enabled, password step-up)", () => {
  it("should report the capabilities with the password step-up", async () => {
    const res = await app.inject({
      method: "GET",
      url: `${LOGIN_CODES}/capabilities`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      enabled: true,
      available: true,
      codeLength: 8,
      rotationSeconds: 30,
      graceSeconds: 60,
      ttlSeconds: 300,
      pollIntervalMs: 2000,
      approveRequiresPassword: true,
    });
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers.pragma).toBe("no-cache");
    expect(res.headers.vary).toBe("Authorization");
  });

  it("should create an 8 character single-use code", async () => {
    const { code, requestToken } = await createCode();
    expect(code).toHaveLength(8);
    expect(requestToken.length).toBeGreaterThan(20);
  });

  it("should preview the requesting device for the authenticated approver", async () => {
    const { code } = await createCode();
    const res = await app.inject({
      method: "POST",
      url: `${LOGIN_CODES}/preview`,
      payload: { code },
      headers: auth(adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().userName).toBe("root");
    expect(typeof res.json().deviceLabel).toBe("string");
  });

  it("should require the password and reject a wrong one before approving", async () => {
    const { code } = await createCode();

    const missing = await app.inject({
      method: "POST",
      url: `${LOGIN_CODES}/approve`,
      payload: { code },
      headers: auth(adminToken),
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().code).toBe("PASSWORD_REQUIRED");

    const wrong = await app.inject({
      method: "POST",
      url: `${LOGIN_CODES}/approve`,
      payload: { code, password: "wrong" },
      headers: auth(adminToken),
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().code).toBe("INVALID_CODE");

    const correct = await app.inject({
      method: "POST",
      url: `${LOGIN_CODES}/approve`,
      payload: { code, password: "root-pass" },
      headers: auth(adminToken),
    });
    expect(correct.statusCode).toBe(200);
    expect(correct.json().approved).toBe(true);
  });

  it("should redeem an approved code once and issue the approver's session", async () => {
    const { code, requestToken } = await createCode();

    const approved = await app.inject({
      method: "POST",
      url: `${LOGIN_CODES}/approve`,
      payload: { code, password: "root-pass" },
      headers: auth(adminToken),
    });
    expect(approved.statusCode).toBe(200);

    const poll = await app.inject({
      method: "POST",
      url: `${LOGIN_CODES}/poll`,
      payload: { requestToken },
    });
    expect(poll.statusCode).toBe(200);
    const body = poll.json();
    expect(body.status).toBe("approved");
    const claims = jwt.verify(body.token, "test-key") as jwt.JwtPayload;
    expect(claims.userId).toBe(adminId);
    expect(claims.userName).toBe("root");
    expect(typeof claims.sessionStartedAt).toBe("number");
    expect((claims.exp as number) - (claims.iat as number)).toBeLessThanOrEqual(
      3600,
    );

    const again = await app.inject({
      method: "POST",
      url: `${LOGIN_CODES}/poll`,
      payload: { requestToken },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe("ALREADY_USED");
  });

  it("should reject API tokens and unauthenticated approvals", async () => {
    const tokenRes = await app.inject({
      method: "POST",
      url: "/api/users/tokens",
      payload: { name: "automation" },
      headers: auth(adminToken),
    });
    expect(tokenRes.statusCode).toBe(201);
    const apiToken = tokenRes.json().token as string;

    const apiCode = await createCode();
    for (const route of ["preview", "approve"]) {
      const res = await app.inject({
        method: "POST",
        url: `${LOGIN_CODES}/${route}`,
        payload: { code: apiCode.code, password: "root-pass" },
        headers: auth(apiToken),
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe("FORBIDDEN");
    }

    const anonCode = await createCode();
    const unauthenticated = await app.inject({
      method: "POST",
      url: `${LOGIN_CODES}/approve`,
      payload: { code: anonCode.code, password: "root-pass" },
    });
    expect(unauthenticated.statusCode).toBe(401);
    expect(unauthenticated.json().code).toBe("UNAUTHENTICATED");
  });
});
