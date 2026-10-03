import {
  AuthGetUserSession,
  AuthSetOTel,
  UsersApiTokensDataSetOTel,
} from "@devopsplaybook.io/common-utils";
import * as jwt from "jsonwebtoken";

// The auth modules resolve Bearer credentials through the API tokens data
// module; stub the DB facade it uses so the regression can run without a
// database (the module is shared: `common-utils/db` is the same file the
// auth modules require internally).
jest.mock("@devopsplaybook.io/common-utils/db", () => ({
  DbUtilsQuerySQL: jest.fn(async () => []),
  DbUtilsExecSQL: jest.fn(async () => 0),
  DbUtilsGetDatabase: jest.fn(),
  DbUtilsGetType: jest.fn(() => "sqlite"),
  convertToPostgresPlaceholders: jest.fn((sql: string) => sql),
  DbUtilsSetOTel: jest.fn(),
  DbUtilsWithLock: jest.fn((_lock: string, callback: () => unknown) =>
    callback(),
  ),
}));

function mockTracer(): any {
  return { startSpan: () => ({ end: () => undefined }) };
}

describe("API token authentication", () => {
  beforeAll(() => {
    AuthSetOTel(mockTracer());
    UsersApiTokensDataSetOTel(mockTracer());
  });

  it("should reject a malformed bearer token without throwing", async () => {
    const session = await AuthGetUserSession({
      headers: { authorization: "Bearer not-a-jwt" },
    } as any);
    expect(session.isAuthenticated).toBe(false);
  });

  it("should reject an expired JWT without throwing", async () => {
    const expired = jwt.sign(
      { userId: "user-1", exp: Math.floor(Date.now() / 1000) - 60 },
      "test-secret",
    );
    const session = await AuthGetUserSession({
      headers: { authorization: `Bearer ${expired}` },
    } as any);
    expect(session.isAuthenticated).toBe(false);
  });
});
