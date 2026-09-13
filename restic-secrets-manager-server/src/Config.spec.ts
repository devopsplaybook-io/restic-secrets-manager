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
});
