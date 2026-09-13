import { Secret } from "./Secret";

describe("Secret parseFileContent", () => {
  it("should parse a flat map of scalar values", () => {
    const data = Secret.parseFileContent(
      JSON.stringify({ KEY1: "value1", KEY2: "value2" }),
    );
    expect(data).toEqual({ KEY1: "value1", KEY2: "value2" });
  });

  it("should coerce numbers and booleans to strings", () => {
    const data = Secret.parseFileContent(
      JSON.stringify({ COUNT: 42, ENABLED: true }),
    );
    expect(data).toEqual({ COUNT: "42", ENABLED: "true" });
  });

  it("should reject nested objects", () => {
    expect(() =>
      Secret.parseFileContent(JSON.stringify({ KEY: { nested: true } })),
    ).toThrow("must be a scalar");
  });

  it("should reject arrays", () => {
    expect(() => Secret.parseFileContent("[1, 2]")).toThrow(
      "a JSON object is expected",
    );
  });

  it("should reject scalar json documents", () => {
    expect(() => Secret.parseFileContent('"text"')).toThrow();
    expect(() => Secret.parseFileContent("42")).toThrow();
    expect(() => Secret.parseFileContent("null")).toThrow();
  });

  it("should reject invalid json", () => {
    expect(() => Secret.parseFileContent("not json")).toThrow();
  });

  it("should reject empty keys", () => {
    expect(() => Secret.parseFileContent('{"": "value"}')).toThrow(
      "empty key",
    );
  });

  it("should accept an empty object", () => {
    expect(Secret.parseFileContent("{}")).toEqual({});
  });
});

describe("Secret isValidName", () => {
  it("should accept filesystem-safe names", () => {
    expect(Secret.isValidName("api-keys")).toBe(true);
    expect(Secret.isValidName("Db.Credentials_2")).toBe(true);
    expect(Secret.isValidName("a")).toBe(true);
  });

  it("should reject unsafe names", () => {
    expect(Secret.isValidName(".hidden")).toBe(false);
    expect(Secret.isValidName("-leading")).toBe(false);
    expect(Secret.isValidName("with space")).toBe(false);
    expect(Secret.isValidName("with/slash")).toBe(false);
    expect(Secret.isValidName("")).toBe(false);
  });
});

describe("Secret validate", () => {
  it("should require a name", () => {
    expect(Secret.validate("", { KEY: "value" })).toEqual([
      "Invalid secret: name is required",
    ]);
  });

  it("should reject unsafe names", () => {
    const errors = Secret.validate("with space", { KEY: "value" });
    expect(errors[0]).toContain("Invalid secret: name must");
  });

  it("should require object data", () => {
    expect(Secret.validate("name", null)).toEqual([
      "Invalid secret: data must be a JSON object",
    ]);
    expect(Secret.validate("name", [1])).toEqual([
      "Invalid secret: data must be a JSON object",
    ]);
  });

  it("should reject non scalar values", () => {
    const errors = Secret.validate("name", { OK: "yes", BAD: { a: 1 } });
    expect(errors).toEqual([
      "Invalid secret: value for key 'BAD' must be a scalar",
    ]);
  });

  it("should accept a valid secret", () => {
    expect(Secret.validate("name", { KEY: "value" })).toEqual([]);
  });
});

describe("Secret normalizeData", () => {
  it("should coerce scalars and drop non scalars", () => {
    expect(
      Secret.normalizeData({ A: "x", B: 1, C: true, D: { no: 1 } }),
    ).toEqual({ A: "x", B: "1", C: "true" });
  });
});
