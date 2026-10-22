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

  it("should accept LF, CRLF and CR line endings", () => {
    expect(parseSecretImport("A=1\r\nB=2\rC=3\nD=4")).toEqual({
      rows: [
        { key: "A", value: "1" },
        { key: "B", value: "2" },
        { key: "C", value: "3" },
        { key: "D", value: "4" },
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

  it("should decode \\r and \\uXXXX escapes written by the canonical export", () => {
    expect(parseSecretImport('A="line1\\rline2"\nB="a\\u0001b"\nC="a\\u007fb"'))
      .toEqual({
        rows: [
          { key: "A", value: "line1\rline2" },
          { key: "B", value: "a\u0001b" },
          { key: "C", value: "a\u007fb" },
        ],
        warnings: [],
      });
  });

  it("should leave an unknown escape sequence untouched", () => {
    expect(parseSecretImport('A="a\\qb"')).toEqual({
      rows: [{ key: "A", value: "a\\qb" }],
      warnings: [],
    });
  });

  it("should parse every value shape emitted by the canonical server export", () => {
    const fixtures: Array<{ line: string; key: string; value: string }> = [
      { line: "PLAIN=value", key: "PLAIN", value: "value" },
      { line: 'EMPTY=""', key: "EMPTY", value: "" },
      { line: 'SPACED=" spaced "', key: "SPACED", value: " spaced " },
      { line: 'EQUAL="a=b"', key: "EQUAL", value: "a=b" },
      { line: 'HASH="a#b"', key: "HASH", value: "a#b" },
      { line: 'QUOTE="say \\"hi\\""', key: "QUOTE", value: 'say "hi"' },
      { line: 'SINGLE="it\'s"', key: "SINGLE", value: "it's" },
      { line: 'BACKSLASH="a\\\\b"', key: "BACKSLASH", value: "a\\b" },
      { line: 'TRAILING="a\\\\"', key: "TRAILING", value: "a\\" },
      { line: 'LF="a\\nb"', key: "LF", value: "a\nb" },
      { line: 'CR="a\\rb"', key: "CR", value: "a\rb" },
      { line: 'TAB="a\\tb"', key: "TAB", value: "a\tb" },
      { line: 'CTRL="a\\u0001b"', key: "CTRL", value: "a\u0001b" },
      { line: 'DEL="a\\u007fb"', key: "DEL", value: "a\u007fb" },
      { line: "UNICODE=héllo wörld", key: "UNICODE", value: "héllo wörld" },
    ];
    for (const fixture of fixtures) {
      expect(parseSecretImport(fixture.line)).toEqual({
        rows: [{ key: fixture.key, value: fixture.value }],
        warnings: [],
      });
    }
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

  it("should reject keys that are not valid environment variable names", () => {
    expect(() => parseSecretImport("1KEY=value")).toThrow(
      'Invalid .env line 1: invalid key "1KEY" (keys must match ^[A-Za-z_][A-Za-z0-9_]*$)',
    );
    expect(() => parseSecretImport("A-B=value")).toThrow(
      'Invalid .env line 1: invalid key "A-B" (keys must match ^[A-Za-z_][A-Za-z0-9_]*$)',
    );
    expect(() => parseSecretImport("A B=value")).toThrow(
      'Invalid .env line 1: invalid key "A B" (keys must match ^[A-Za-z_][A-Za-z0-9_]*$)',
    );
    expect(() => parseSecretImport("A#B=value")).toThrow(
      'Invalid .env line 1: invalid key "A#B" (keys must match ^[A-Za-z_][A-Za-z0-9_]*$)',
    );
  });

  it("should accept keys starting with an underscore or containing digits", () => {
    expect(parseSecretImport("_PRIVATE=x\nA_1=y")).toEqual({
      rows: [
        { key: "_PRIVATE", value: "x" },
        { key: "A_1", value: "y" },
      ],
      warnings: [],
    });
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

  it("should accept non-env-safe keys, which JSON can represent", () => {
    expect(parseSecretImport('{"A B": "x", "_n": "y"}')).toEqual({
      rows: [
        { key: "A B", value: "x" },
        { key: "_n", value: "y" },
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
