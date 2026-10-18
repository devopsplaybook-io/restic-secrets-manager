import { secretDataToEnvContent, secretDataToJsonContent } from "./SecretEnv";

describe("secretDataToEnvContent", () => {
  it("should serialize plain values as KEY=value lines", () => {
    expect(
      secretDataToEnvContent({ KEY: "value", OTHER: "value2" }),
    ).toBe("KEY=value\nOTHER=value2\n");
  });

  it("should quote and escape multiline values", () => {
    expect(secretDataToEnvContent({ CERT: "line1\nline2" })).toBe(
      'CERT="line1\\nline2"\n',
    );
  });

  it("should quote and escape tabs", () => {
    expect(secretDataToEnvContent({ KEY: "a\tb" })).toBe('KEY="a\\tb"\n');
  });

  it("should quote and escape double quotes", () => {
    expect(secretDataToEnvContent({ KEY: 'say "hi"' })).toBe(
      'KEY="say \\"hi\\""\n',
    );
  });

  it("should escape backslashes inside quoted values", () => {
    expect(secretDataToEnvContent({ KEY: "a\\b\nc" })).toBe(
      'KEY="a\\\\b\\nc"\n',
    );
  });

  it("should quote values with leading or trailing spaces", () => {
    expect(secretDataToEnvContent({ KEY: " spaced " })).toBe(
      'KEY=" spaced "\n',
    );
  });

  it("should not quote simple values", () => {
    expect(secretDataToEnvContent({ TOKEN: "abc123" })).toBe("TOKEN=abc123\n");
  });

  it("should produce an empty file for empty data", () => {
    expect(secretDataToEnvContent({})).toBe("\n");
  });
});

describe("secretDataToJsonContent", () => {
  it("should pretty-print the data with a trailing newline", () => {
    expect(secretDataToJsonContent({ KEY: "value" })).toBe(
      '{\n  "KEY": "value"\n}\n',
    );
  });

  it("should preserve the insertion order of the keys", () => {
    const content = secretDataToJsonContent({ B: "2", A: "1" });
    expect(JSON.parse(content)).toEqual({ B: "2", A: "1" });
    expect(content.indexOf('"B"')).toBeLessThan(content.indexOf('"A"'));
  });
});
