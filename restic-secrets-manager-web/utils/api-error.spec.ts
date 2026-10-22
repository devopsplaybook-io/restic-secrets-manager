import { describe, expect, it } from "vitest";
import { extractApiErrorCode, extractApiErrorMessage } from "./api-error";

describe("extractApiErrorMessage", () => {
  it("should return the API error message", () => {
    expect(
      extractApiErrorMessage(
        { response: { data: { error: "Secret Not Found" } } },
        "fallback",
      ),
    ).toBe("Secret Not Found");
  });

  it("should decode a JSON string body (responseType text)", () => {
    expect(
      extractApiErrorMessage(
        {
          response: {
            data: JSON.stringify({
              error: "Cannot export as .env: invalid key(s) \"A B\"",
            }),
          },
        },
        "fallback",
      ),
    ).toBe('Cannot export as .env: invalid key(s) "A B"');
  });

  it("should fall back when the error carries no message", () => {
    expect(extractApiErrorMessage(new Error("network"), "fallback")).toBe(
      "fallback",
    );
    expect(extractApiErrorMessage({ response: { data: "<html>" } }, "fallback")).toBe(
      "fallback",
    );
  });
});

describe("extractApiErrorCode", () => {
  it("should return the machine-readable code", () => {
    expect(
      extractApiErrorCode({
        response: { data: { code: "SECRET_VERSION_CONFLICT" } },
      }),
    ).toBe("SECRET_VERSION_CONFLICT");
  });

  it("should return an empty code when absent", () => {
    expect(extractApiErrorCode({ response: { data: { error: "x" } } })).toBe("");
    expect(extractApiErrorCode(undefined)).toBe("");
  });
});
