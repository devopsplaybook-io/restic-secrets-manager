import { ConfigBase } from "@devopsplaybook.io/common-utils";
import * as fse from "fs-extra";
import path from "path";
import { OTelLogger } from "./OTelContext";

const logger = OTelLogger().createModuleLogger("config");

/**
 * Application release version: the version of the root `package.json`, which
 * is also the version used for the Docker image tag. In development
 * `__dirname` is `restic-secrets-manager-server/src`; in the container it is
 * `/opt/app/restic-secrets-manager/dist`, next to the root manifest copied by
 * the Dockerfile. Manifests of other packages (the server manifest) are
 * skipped so both layouts report the same version.
 */
export function ResolveAppVersion(baseDir: string = __dirname): string {
  for (const candidate of [
    path.resolve(baseDir, "../package.json"),
    path.resolve(baseDir, "../../package.json"),
  ]) {
    try {
      const pkg = fse.readJsonSync(candidate);
      if (pkg && pkg.name === "restic-secrets-manager" && pkg.version) {
        return pkg.version;
      }
      // eslint-disable-next-line no-unused-vars
    } catch (_e) {
      // try the next candidate
    }
  }
  return "0.0.0";
}

export class Config extends ConfigBase {
  // Sessions last 1 hour and are never renewed
  public JWT_VALIDITY_DURATION = 3600;

  // Sessions are invalidated on role/scope/password changes and user
  // deletion (requires the users.tokenVersion migration, shipped with the
  // application schema)
  public JWT_REVOCATION_ENABLED = true;

  // Set to true behind a trusted reverse proxy so rate limiting and audit
  // logs see the real client IP
  public TRUST_PROXY = false;

  // Directory used for temporary restic working folders
  public TMP_DIR = process.env.TMP_DIR || "/tmp";

  // Sync notifications to the ecosystem notifications server (optional,
  // disabled while endpoint or token is empty)
  public NOTIFICATIONS_API_ENDPOINT = "";
  public NOTIFICATIONS_API_TOKEN = "";

  // Every restic invocation is bounded in time (milliseconds). The kill
  // grace is the delay between SIGTERM and SIGKILL when a process must be
  // stopped (timeout or client disconnect).
  public RESTIC_TIMEOUT_SNAPSHOTS_MS = 30_000;
  public RESTIC_TIMEOUT_RESTORE_MS = 300_000;
  public RESTIC_TIMEOUT_BACKUP_MS = 600_000;
  public RESTIC_TIMEOUT_INIT_MS = 60_000;
  public RESTIC_TIMEOUT_CONNECTION_TEST_MS = 30_000;
  public RESTIC_KILL_GRACE_MS = 5_000;

  constructor() {
    super("restic-secrets-manager-server");

    // One documented application version in development and in the container
    this.VERSION = ResolveAppVersion();

    // Register project-specific fields so reload() processes them
    this.addConfigField({ field: "TMP_DIR" });
    this.addConfigField({ field: "TRUST_PROXY" });
    this.addConfigField({ field: "NOTIFICATIONS_API_ENDPOINT" });
    this.addConfigField({ field: "NOTIFICATIONS_API_TOKEN", sensitive: true });
    this.addConfigField({ field: "RESTIC_TIMEOUT_SNAPSHOTS_MS" });
    this.addConfigField({ field: "RESTIC_TIMEOUT_RESTORE_MS" });
    this.addConfigField({ field: "RESTIC_TIMEOUT_BACKUP_MS" });
    this.addConfigField({ field: "RESTIC_TIMEOUT_INIT_MS" });
    this.addConfigField({ field: "RESTIC_TIMEOUT_CONNECTION_TEST_MS" });
    this.addConfigField({ field: "RESTIC_KILL_GRACE_MS" });
  }

  public async reload(): Promise<void> {
    await super.reload((message: string) => logger.info(message));
  }
}
