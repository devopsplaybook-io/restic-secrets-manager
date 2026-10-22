import * as path from "path";
import { DbInit } from "./DbInit";

jest.mock("./DbUtils", () => ({
  DbUtilsInit: jest.fn(),
  DbUtilsGetType: jest.fn(),
  DbUtilsGetDatabase: jest.fn(),
}));

import {
  DbUtilsGetDatabase,
  DbUtilsGetType,
  DbUtilsInit,
} from "./DbUtils";

const initMock = DbUtilsInit as jest.Mock;
const getTypeMock = DbUtilsGetType as jest.Mock;
const getDatabaseMock = DbUtilsGetDatabase as jest.Mock;

const pragmaMock = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  initMock.mockResolvedValue(undefined);
  getTypeMock.mockReturnValue("sqlite");
  getDatabaseMock.mockReturnValue({ pragma: pragmaMock });
});

describe("DbInit", () => {
  it("should run the migrations of the configured dialect", async () => {
    const config = { DATABASE_TYPE: "sqlite" as const, DATA_DIR: "/data" };

    await DbInit(undefined as any, config);

    expect(initMock).toHaveBeenCalledWith(
      undefined,
      config,
      path.join(__dirname, "../../sql", "sqlite"),
    );
  });

  it("should use the postgres migration directory for postgres", async () => {
    await DbInit(undefined as any, {
      DATABASE_TYPE: "postgres",
      DATA_DIR: "/data",
    } as any);

    expect(initMock).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ DATABASE_TYPE: "postgres" }),
      path.join(__dirname, "../../sql", "postgres"),
    );
  });

  it("should enable SQLite foreign key enforcement after the migrations", async () => {
    await DbInit(undefined as any, {
      DATABASE_TYPE: "sqlite",
      DATA_DIR: "/data",
    } as any);

    expect(pragmaMock).toHaveBeenCalledWith("foreign_keys = ON");
    expect(initMock.mock.invocationCallOrder[0]).toBeLessThan(
      pragmaMock.mock.invocationCallOrder[0],
    );
  });

  it("should not touch pragmas on postgres", async () => {
    getTypeMock.mockReturnValue("postgres");

    await DbInit(undefined as any, {
      DATABASE_TYPE: "postgres",
      DATA_DIR: "/data",
    } as any);

    expect(pragmaMock).not.toHaveBeenCalled();
  });

  it("should propagate initialization failures without enabling the pragma", async () => {
    initMock.mockRejectedValue(new Error("migration failed"));

    await expect(
      DbInit(undefined as any, {
        DATABASE_TYPE: "sqlite",
        DATA_DIR: "/data",
      } as any),
    ).rejects.toThrow("migration failed");
    expect(pragmaMock).not.toHaveBeenCalled();
  });
});
