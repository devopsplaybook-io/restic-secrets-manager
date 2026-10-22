import type { Span } from "@opentelemetry/sdk-trace";
import * as path from "path";
import { DbUtilsGetDatabase, DbUtilsGetType, DbUtilsInit } from "./DbUtils";

/**
 * Initializes the database facade and enables SQLite foreign-key
 * enforcement. Migrations run before the pragma is enabled so table
 * rebuilds are not constrained by the previous schema.
 */
export async function DbInit(
  span: Span,
  config: { DATABASE_TYPE: "sqlite" | "postgres"; DATA_DIR: string },
): Promise<void> {
  await DbUtilsInit(
    span,
    config as any,
    path.join(__dirname, "../../sql", config.DATABASE_TYPE),
  );
  if (DbUtilsGetType() === "sqlite") {
    DbUtilsGetDatabase().pragma("foreign_keys = ON");
  }
}
