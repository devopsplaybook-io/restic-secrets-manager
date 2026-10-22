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
  }

  public async reload(): Promise<void> {
    await super.reload((message: string) => logger.info(message));
  }
}
