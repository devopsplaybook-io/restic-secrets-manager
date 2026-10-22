import {
  ENV_KEY_PATTERN,
  isEnvSafeKey,
  secretDataToEnvContent,
  secretDataToJsonContent,
  SecretEnvError,
} from "./SecretEnv";

describe("isEnvSafeKey", () => {
  it("should accept portable environment variable names", () => {
    expect(isEnvSafeKey("KEY")).toBe(true);
    expect(isEnvSafeKey("_PRIVATE")).toBe(true);
    expect(isEnvSafeKey("A1_B2")).toBe(true);
    expect(ENV_KEY_PATTERN.source).toBe("^[A-Za-z_][A-Za-z0-9_]*$");
  });

  it("should reject names the .env format cannot carry unambiguously", () => {
    expect(isEnvSafeKey("1KEY")).toBe(false);
    expect(isEnvSafeKey("A-B")).toBe(false);
    expect(isEnvSafeKey("A B")).toBe(false);
    expect(isEnvSafeKey("A=B")).toBe(false);
    expect(isEnvSafeKey("A#B")).toBe(false);
    expect(isEnvSafeKey("")).toBe(false);
    expect(isEnvSafeKey("A\nB")).toBe(false);
  });
});

describe("secretDataToEnvContent", () => {
  it("should serialize plain values as KEY=value lines", () => {
    expect(secretDataToEnvContent({ KEY: "value", OTHER: "value2" })).toBe(
      "KEY=value\nOTHER=value2\n",
    );
  });

  it("should produce an empty file for empty data", () => {
    expect(secretDataToEnvContent({})).toBe("");
  });

  it("should quote an empty value", () => {
    expect(secretDataToEnvContent({ KEY: "" })).toBe('KEY=""\n');
  });

  it("should quote leading/trailing and internal spaces", () => {
    expect(secretDataToEnvContent({ KEY: " spaced " })).toBe(
      'KEY=" spaced "\n',
    );
    expect(secretDataToEnvContent({ KEY: "hello world" })).toBe(
      'KEY="hello world"\n',
    );
  });

  it("should quote '=', '#', quotes and backslashes", () => {
    expect(secretDataToEnvContent({ KEY: "a=b" })).toBe('KEY="a=b"\n');
    expect(secretDataToEnvContent({ KEY: "a#b" })).toBe('KEY="a#b"\n');
    expect(secretDataToEnvContent({ KEY: 'say "hi"' })).toBe(
      'KEY="say \\"hi\\""\n',
    );
    expect(secretDataToEnvContent({ KEY: "it's" })).toBe("KEY=\"it's\"\n");
    expect(secretDataToEnvContent({ KEY: "a\\b" })).toBe('KEY="a\\\\b"\n');
    expect(secretDataToEnvContent({ KEY: "trailing\\" })).toBe(
      'KEY="trailing\\\\"\n',
    );
  });

  it("should escape LF, CR, tab and other control characters inside quotes", () => {
    expect(secretDataToEnvContent({ CERT: "line1\nline2" })).toBe(
      'CERT="line1\\nline2"\n',
    );
    expect(secretDataToEnvContent({ KEY: "a\rb" })).toBe('KEY="a\\rb"\n');
    expect(secretDataToEnvContent({ KEY: "a\tb" })).toBe('KEY="a\\tb"\n');
    expect(secretDataToEnvContent({ KEY: "a\u0001b" })).toBe(
      'KEY="a\\u0001b"\n',
    );
    expect(secretDataToEnvContent({ KEY: "a\u007fb" })).toBe(
      'KEY="a\\u007fb"\n',
    );
  });

  it("should leave Unicode and other printable characters unchanged", () => {
    expect(secretDataToEnvContent({ KEY: "héllo世界" })).toBe(
      "KEY=héllo世界\n",
    );
    expect(secretDataToEnvContent({ KEY: "héllo 世界" })).toBe(
      'KEY="héllo 世界"\n',
    );
  });

  it("should reject every non-env-safe key with a clear error", () => {
    const data = { "1KEY": "a", "A-B": "b", "A B": "c", "A=B": "d", "A#B": "e", "": "f" };
    let thrown: unknown;
    try {
      secretDataToEnvContent(data);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(SecretEnvError);
    const error = thrown as SecretEnvError;
    expect(error.invalidKeys).toEqual([
      "1KEY",
      "A-B",
      "A B",
      "A=B",
      "A#B",
      "",
    ]);
    expect(error.message).toContain('invalid key(s) "1KEY", "A-B", "A B", "A=B", "A#B", ""');
    expect(error.message).toContain("^[A-Za-z_][A-Za-z0-9_]*$");
    expect(error.message).toContain("Use the JSON export instead");
  });

  it("should quote control characters that would break the error message", () => {
    let thrown: unknown;
    try {
      secretDataToEnvContent({ "A\nB": "x" });
    } catch (e) {
      thrown = e;
    }
    expect((thrown as SecretEnvError).message).toContain('"A\\nB"');
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
