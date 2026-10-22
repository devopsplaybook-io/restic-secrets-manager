/** Extracts the user-safe error message returned by the API. */
export function extractApiErrorMessage(error: unknown, fallback: string): string {
  const data = responseData(error);
  return errorMessageFromData(data) ?? fallback;
}

/**
 * Extracts a machine-readable error code. Responses fetched with
 * `responseType: "text"` arrive as a JSON string, so both shapes are handled.
 */
export function extractApiErrorCode(error: unknown): string {
  const record = asRecord(errorData(error));
  return typeof record?.code === "string" ? record.code : "";
}

function responseData(error: unknown): unknown {
  return (error as { response?: { data?: unknown } })?.response?.data;
}

function errorData(error: unknown): unknown {
  if (typeof error === "string") {
    try {
      return JSON.parse(error);
    } catch {
      return undefined;
    }
  }
  return responseData(error);
}

function errorMessageFromData(data: unknown): string | null {
  if (typeof data === "string") {
    return errorMessageFromData(errorData(data));
  }
  const record = asRecord(data);
  return typeof record?.error === "string" ? record.error : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}
