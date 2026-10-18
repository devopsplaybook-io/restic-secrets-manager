import { Config } from "./Config";

describe("Config", () => {
  it("should keep sessions valid for 1 hour", () => {
    const config = new Config();
    expect(config.JWT_VALIDITY_DURATION).toBe(3600);
  });

  it("should default TMP_DIR to /tmp", () => {
    const config = new Config();
    expect(config.TMP_DIR).toBe("/tmp");
  });

  it("should default the notifications integration to disabled", () => {
    const config = new Config();
    expect(config.NOTIFICATIONS_API_ENDPOINT).toBe("");
    expect(config.NOTIFICATIONS_API_TOKEN).toBe("");
  });
});
