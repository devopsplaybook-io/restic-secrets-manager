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
    expect(() => Secret.parseFileContent('{"": "value"}')).toThrow("empty key");
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

describe("Secret validateName", () => {
  it("should accept valid names", () => {
    expect(Secret.validateName("api-keys")).toEqual([]);
    expect(Secret.validateName("Db.Credentials_2")).toEqual([]);
  });

  it("should require a name", () => {
    expect(Secret.validateName("")).toEqual([
      "Invalid secret: name is required",
    ]);
    expect(Secret.validateName(undefined as unknown as string)).toEqual([
      "Invalid secret: name is required",
    ]);
    expect(Secret.validateName("   ")).toEqual([
      "Invalid secret: name is required",
    ]);
  });

  it("should reject unsafe names", () => {
    const errors = Secret.validateName("with space");
    expect(errors).toEqual([
      "Invalid secret: name must start with a letter or digit and only contain letters, digits, '.', '_' or '-'",
    ]);
  });

  it("should reject names longer than the 200 character column", () => {
    expect(Secret.validateName("a".repeat(201))).toEqual([
      "Invalid secret: name must be 200 characters or less",
    ]);
    expect(Secret.validateName("a".repeat(200))).toEqual([]);
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

  it("should reject an empty key (rejected by pull import)", () => {
    expect(Secret.validate("name", { "": "value" })).toEqual([
      "Invalid secret: empty key is not allowed",
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

describe("Secret fromJson", () => {
  it("should keep the generated dates when the body has none", () => {
    const secret = Secret.fromJson({
      projectId: "p1",
      name: "name",
      data: { KEY: "value" },
    }) as Secret;
    expect(secret.dateCreated).toBeTruthy();
    expect(secret.dateUpdated).toBeTruthy();
    expect(new Date(secret.dateCreated).getTime()).not.toBeNaN();
  });

  it("should preserve provided dates (db rows)", () => {
    const secret = Secret.fromJson({
      projectId: "p1",
      name: "name",
      dateCreated: "2026-01-02T03:04:05.000Z",
      dateUpdated: "2026-01-03T03:04:05.000Z",
    }) as Secret;
    expect(secret.dateCreated).toBe("2026-01-02T03:04:05.000Z");
    expect(secret.dateUpdated).toBe("2026-01-03T03:04:05.000Z");
  });
});
