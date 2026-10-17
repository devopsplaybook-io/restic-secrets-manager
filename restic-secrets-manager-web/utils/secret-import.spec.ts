import { describe, expect, it } from "vitest";
import { parseSecretImport } from "./secret-import";

describe("parseSecretImport (.env)", () => {
  it("should parse simple KEY=value lines", () => {
    expect(parseSecretImport("A=1\nB=hello")).toEqual({
      rows: [
        { key: "A", value: "1" },
        { key: "B", value: "hello" },
      ],
      warnings: [],
    });
  });

  it("should skip blank and comment lines and trim values", () => {
    expect(
      parseSecretImport("# comment\n\n  KEY =  value with spaces  \n"),
    ).toEqual({
      rows: [{ key: "KEY", value: "value with spaces" }],
      warnings: [],
    });
  });

  it("should support the optional export prefix", () => {
    expect(parseSecretImport("export TOKEN=abc")).toEqual({
      rows: [{ key: "TOKEN", value: "abc" }],
      warnings: [],
    });
  });

  it("should strip surrounding quotes; single quotes stay literal, double quotes unescape", () => {
    expect(parseSecretImport("A='line1\\nline2'\nB=\"line1\\nline2\"\nC=\"a\\tb\\\"c\\\\d\""))
      .toEqual({
        rows: [
          { key: "A", value: "line1\\nline2" },
          { key: "B", value: "line1\nline2" },
          { key: "C", value: "a\tb\"c\\d" },
        ],
        warnings: [],
      });
  });

  it("should keep an escaped backslash from turning into an escape prefix", () => {
    expect(parseSecretImport('B="a\\\\nb"')).toEqual({
      rows: [{ key: "B", value: "a\\nb" }],
      warnings: [],
    });
  });

  it("should keep the last duplicate key and warn", () => {
    expect(parseSecretImport("A=1\nA=2")).toEqual({
      rows: [{ key: "A", value: "2" }],
      warnings: ["Duplicate key 'A': the last value wins"],
    });
  });

  it("should reject a line without = with its line number", () => {
    expect(() => parseSecretImport("A=1\nINVALID\n")).toThrow(
      "Invalid .env line 2: expected KEY=value",
    );
  });

  it("should reject a line with an empty key", () => {
    expect(() => parseSecretImport("=value")).toThrow(
      "Invalid .env line 1: the key is empty",
    );
  });

  it("should reject input without any KEY=value line", () => {
    expect(() => parseSecretImport("# only comments\n\n")).toThrow(
      "Nothing to import: no KEY=value line found",
    );
  });
});

describe("parseSecretImport (JSON)", () => {
  it("should parse a flat object and coerce scalar values", () => {
    expect(parseSecretImport('{"A": "x", "B": 2, "C": true}')).toEqual({
      rows: [
        { key: "A", value: "x" },
        { key: "B", value: "2" },
        { key: "C", value: "true" },
      ],
      warnings: [],
    });
  });

  it("should reject arrays and nested values", () => {
    expect(() => parseSecretImport('{"A": [1]}')).toThrow(
      "Invalid JSON import: value for key 'A' must be a scalar",
    );
    expect(() => parseSecretImport('{"A": {"nested": true}}')).toThrow(
      "Invalid JSON import: value for key 'A' must be a scalar",
    );
    expect(() => parseSecretImport("[1, 2]")).toThrow(
      "Invalid JSON import: a flat JSON object is expected",
    );
  });

  it("should reject malformed JSON", () => {
    expect(() => parseSecretImport("{not json}")).toThrow(
      "Invalid JSON: the pasted content is not valid JSON",
    );
  });
});

describe("parseSecretImport (input validation)", () => {
  it("should reject empty input", () => {
    expect(() => parseSecretImport("   \n  ")).toThrow(
      "Nothing to import: paste .env or JSON content first",
    );
  });
});
