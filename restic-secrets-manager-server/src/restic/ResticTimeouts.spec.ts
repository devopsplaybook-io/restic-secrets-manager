import { Config } from "../Config";
import {
  DEFAULT_RESTIC_TIMEOUTS,
  resticTimeoutsFromConfig,
} from "./ResticTimeouts";

function makeConfig(overrides: Record<string, unknown>): Config {
  return overrides as unknown as Config;
}

describe("resticTimeoutsFromConfig", () => {
  it("should use the defaults for every operation", () => {
    expect(resticTimeoutsFromConfig(makeConfig({}))).toEqual(
      DEFAULT_RESTIC_TIMEOUTS,
    );
  });

  it("should read the configured values", () => {
    expect(
      resticTimeoutsFromConfig(
        makeConfig({
          RESTIC_TIMEOUT_SNAPSHOTS_MS: 1_000,
          RESTIC_TIMEOUT_RESTORE_MS: 2_000,
          RESTIC_TIMEOUT_BACKUP_MS: 3_000,
          RESTIC_TIMEOUT_INIT_MS: 4_000,
          RESTIC_TIMEOUT_CONNECTION_TEST_MS: 5_000,
          RESTIC_KILL_GRACE_MS: 6_000,
        }),
      ),
    ).toEqual({
      snapshotsMs: 1_000,
      restoreMs: 2_000,
      backupMs: 3_000,
      initMs: 4_000,
      connectionTestMs: 5_000,
      killGraceMs: 6_000,
    });
  });

  it("should fall back to the defaults for invalid values", () => {
    const timeouts = resticTimeoutsFromConfig(
      makeConfig({
        RESTIC_TIMEOUT_SNAPSHOTS_MS: 0,
        RESTIC_TIMEOUT_RESTORE_MS: -1,
        RESTIC_TIMEOUT_BACKUP_MS: Number.NaN,
        RESTIC_TIMEOUT_INIT_MS: "60000",
        RESTIC_TIMEOUT_CONNECTION_TEST_MS: undefined,
        RESTIC_KILL_GRACE_MS: null,
      }),
    );
    expect(timeouts).toEqual(DEFAULT_RESTIC_TIMEOUTS);
  });
});
