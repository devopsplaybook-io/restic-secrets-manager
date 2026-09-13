import { v4 as uuidv4 } from "uuid";

/** A secret is a named flat map of key/value string entries (one JSON file). */
export type SecretData = Record<string, string>;

export class Secret {
  public static fromJson(json: Record<string, unknown>): Secret | null {
    if (!json) {
      return null;
    }
    const secret = new Secret();
    if (json.id) {
      secret.id = json.id as string;
    }
    secret.projectId = json.projectId as string;
    secret.name = json.name as string;
    let data: SecretData = {};
    if (json.data) {
      try {
        data =
          typeof json.data === "string"
            ? (JSON.parse(json.data) as SecretData)
            : (json.data as SecretData);
      } catch {
        data = {};
      }
    }
    secret.data = data;
    secret.dateCreated = json.dateCreated as string;
    secret.dateUpdated = json.dateUpdated as string;
    return secret;
  }

  /**
   * Parse the raw content of a pulled JSON secret file into a flat
   * key/value map. Values must be scalars (string, number, boolean) and
   * are converted to strings; nested objects/arrays are rejected.
   */
  public static parseFileContent(raw: string): SecretData {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed: any = JSON.parse(raw);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      throw new Error("Invalid secret file: a JSON object is expected");
    }
    const data: SecretData = {};
    for (const key of Object.keys(parsed)) {
      if (!key) {
        throw new Error("Invalid secret file: empty key");
      }
      const value = parsed[key];
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        data[key] = String(value);
      } else {
        throw new Error(
          `Invalid secret file: value for key '${key}' must be a scalar`,
        );
      }
    }
    return data;
  }

  /**
   * Validates a secret name and its data map; returns the list of
   * validation errors (empty when the payload is valid).
   */
  public static validate(name: string, data: unknown): string[] {
    const errors: string[] = [];
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      errors.push("Invalid secret: name is required");
    } else if (!Secret.isValidName(name)) {
      errors.push(
        "Invalid secret: name must start with a letter or digit and only contain letters, digits, '.', '_' or '-'",
      );
    }
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      errors.push("Invalid secret: data must be a JSON object");
      return errors;
    }
    for (const key of Object.keys(data as Record<string, unknown>)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const value = (data as any)[key];
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        continue;
      }
      errors.push(`Invalid secret: value for key '${key}' must be a scalar`);
    }
    return errors;
  }

  /** Coerces scalar values to strings (the storage format of secret data). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public static normalizeData(data: any): SecretData {
    const result: SecretData = {};
    for (const key of Object.keys(data)) {
      const value = data[key];
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        result[key] = String(value);
      }
    }
    return result;
  }

  /** Secret names are used as JSON file names; keep them filesystem-safe. */
  public static isValidName(name: string): boolean {
    return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name);
  }

  public id: string;
  public projectId!: string;
  public name!: string;
  public data: SecretData = {};
  public dateCreated: string;
  public dateUpdated: string;

  constructor() {
    this.id = uuidv4();
    const now = new Date().toISOString();
    this.dateCreated = now;
    this.dateUpdated = now;
  }

  public toJson(): Record<string, unknown> {
    return {
      id: this.id,
      projectId: this.projectId,
      name: this.name,
      data: this.data,
      dateCreated: this.dateCreated,
      dateUpdated: this.dateUpdated,
    };
  }

  public toTransportJson(): Record<string, unknown> {
    return {
      id: this.id,
      projectId: this.projectId,
      name: this.name,
      data: this.data,
      dateCreated: this.dateCreated,
      dateUpdated: this.dateUpdated,
    };
  }
}
