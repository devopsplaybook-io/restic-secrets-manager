import { describe, expect, it } from "vitest";
import { secretToJsonContent } from "./secret-export";

describe("secretToJsonContent", () => {
  it("should write a pretty-printed JSON object", () => {
    expect(
      secretToJsonContent([
        { key: "A", value: "1" },
        { key: "B", value: "x\ny" },
      ]),
    ).toBe('{\n  "A": "1",\n  "B": "x\\ny"\n}\n');
  });

  it("should keep non-env-safe keys and control characters lossless", () => {
    const content = secretToJsonContent([
      { key: "A B", value: "line1\r\nline2" },
      { key: "N", value: "a\u0001b" },
    ]);
    expect(JSON.parse(content)).toEqual({
      "A B": "line1\r\nline2",
      N: "a\u0001b",
    });
  });
});
