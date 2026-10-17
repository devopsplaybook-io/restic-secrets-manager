import { describe, expect, it } from "vitest";
import { secretToEnvContent, secretToJsonContent } from "./secret-export";

describe("secretToEnvContent", () => {
  it("should write simple values as KEY=value lines", () => {
    expect(
      secretToEnvContent([
        { key: "A", value: "1" },
        { key: "B", value: "hello world" },
      ]),
    ).toBe("A=1\nB=hello world\n");
  });

  it("should quote and escape values with newlines, tabs, quotes or surrounding spaces", () => {
    expect(secretToEnvContent([{ key: "CERT", value: "-----BEGIN-----\nabc\n-----END-----" }]))
      .toBe('CERT="-----BEGIN-----\\nabc\\n-----END-----"\n');
    expect(secretToEnvContent([{ key: "TAB", value: "a\tb" }])).toBe('TAB="a\\tb"\n');
    expect(secretToEnvContent([{ key: "QUOTE", value: 'say "hi"' }])).toBe(
      'QUOTE="say \\"hi\\""\n',
    );
    expect(secretToEnvContent([{ key: "PADDED", value: " spaced " }])).toBe('PADDED=" spaced "\n');
    // A literal backslash needs no quoting: unescaping only applies inside
    // double quotes, so it round-trips as-is
    expect(secretToEnvContent([{ key: "BACKSLASH", value: "a\\nb" }])).toBe("BACKSLASH=a\\nb\n");
  });
});

describe("secretToJsonContent", () => {
  it("should write a pretty-printed JSON object", () => {
    expect(
      secretToJsonContent([
        { key: "A", value: "1" },
        { key: "B", value: "x\ny" },
      ]),
    ).toBe('{\n  "A": "1",\n  "B": "x\\ny"\n}\n');
  });
});
