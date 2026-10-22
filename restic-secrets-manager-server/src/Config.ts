import { ConfigBase } from "@devopsplaybook.io/common-utils";
import * as fse from "fs-extra";
import path from "path";
import { OTelLogger } from "./OTelContext";

const logger = OTelLogger().createModuleLogger("config");

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

    // Override VERSION with restic-secrets-manager-server's own package.json
    try {
      const pkg = fse.readJsonSync(path.resolve(__dirname, "../package.json"));
      if (pkg && pkg.version) {
        this.VERSION = pkg.version;
      }
      // eslint-disable-next-line no-unused-vars
    } catch (_e) {
      // fallback to default
    }

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
