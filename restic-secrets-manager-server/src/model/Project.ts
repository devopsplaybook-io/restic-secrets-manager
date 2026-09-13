import { v4 as uuidv4 } from "uuid";

function isNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export class Project {
  public static fromJson(json: Record<string, unknown>): Project | null {
    if (!json) {
      return null;
    }
    const project = new Project();
    if (json.id) {
      project.id = json.id as string;
    }
    project.name = json.name as string;
    project.description = (json.description as string) || "";
    project.s3Endpoint = json.s3Endpoint as string;
    project.s3Bucket = json.s3Bucket as string;
    project.repoPrefix = (json.repoPrefix as string) || "";
    project.s3Region = (json.s3Region as string) || "";
    project.s3BucketLookup = (json.s3BucketLookup as string) || "dns";
    project.s3AccessKeyId = json.s3AccessKeyId as string;
    project.s3SecretAccessKey = json.s3SecretAccessKey as string;
    project.resticPassword = json.resticPassword as string;
    project.lastSyncSnapshotId = (json.lastSyncSnapshotId as string) || "";
    project.lastSyncSnapshotTime = (json.lastSyncSnapshotTime as string) || "";
    // Request bodies carry no dateCreated: keep the constructor-generated
    // timestamp so inserts never receive an undefined value
    if (json.dateCreated) {
      project.dateCreated = json.dateCreated as string;
    }
    return project;
  }

  public id: string;
  public name!: string;
  public description = "";
  public s3Endpoint!: string;
  public s3Bucket!: string;
  public repoPrefix = "";
  public s3Region = "";
  public s3BucketLookup = "dns";
  public s3AccessKeyId!: string;
  public s3SecretAccessKey!: string;
  public resticPassword!: string;
  public lastSyncSnapshotId = "";
  public lastSyncSnapshotTime = "";
  public dateCreated: string;

  constructor() {
    this.id = uuidv4();
    this.dateCreated = new Date().toISOString();
  }

  /**
   * Validates the fields required to create a project; returns the list
   * of validation errors (empty when the payload is valid).
   */
  public static validateNew(json: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (!json || typeof json !== "object") {
      return ["Invalid project: a JSON body is expected"];
    }
    if (!isNonEmptyString(json.name)) {
      errors.push("Invalid project: name is required");
    }
    if (!isNonEmptyString(json.s3Endpoint)) {
      errors.push("Invalid project: s3Endpoint is required");
    }
    if (!isNonEmptyString(json.s3Bucket)) {
      errors.push("Invalid project: s3Bucket is required");
    }
    if (!isNonEmptyString(json.s3AccessKeyId)) {
      errors.push("Invalid project: s3AccessKeyId is required");
    }
    if (!isNonEmptyString(json.s3SecretAccessKey)) {
      errors.push("Invalid project: s3SecretAccessKey is required");
    }
    if (!isNonEmptyString(json.resticPassword)) {
      errors.push("Invalid project: resticPassword is required");
    }
    return errors;
  }

  /**
   * Repository prefix used when none is provided: the project name slugified
   * (lowercase, alphanumeric characters and dashes only).
   */
  public effectiveRepoPrefix(): string {
    if (this.repoPrefix && this.repoPrefix.trim().length > 0) {
      return this.repoPrefix.trim();
    }
    return Project.slugify(this.name);
  }

  /** Restic repository URL for the S3-compatible backend. */
  public repositoryUrl(): string {
    return `s3:https://${this.s3Endpoint}/${this.s3Bucket}/${this.effectiveRepoPrefix()}`;
  }

  public static slugify(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  public toJson(): Record<string, unknown> {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      s3Endpoint: this.s3Endpoint,
      s3Bucket: this.s3Bucket,
      repoPrefix: this.effectiveRepoPrefix(),
      s3Region: this.s3Region,
      s3BucketLookup: this.s3BucketLookup,
      s3AccessKeyId: this.s3AccessKeyId,
      s3SecretAccessKey: this.s3SecretAccessKey,
      resticPassword: this.resticPassword,
      lastSyncSnapshotId: this.lastSyncSnapshotId,
      lastSyncSnapshotTime: this.lastSyncSnapshotTime,
      dateCreated: this.dateCreated,
    };
  }

  /** Transport JSON: sensitive repository settings are never exposed. */
  public toTransportJson(): Record<string, unknown> {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      s3Endpoint: this.s3Endpoint,
      s3Bucket: this.s3Bucket,
      repoPrefix: this.effectiveRepoPrefix(),
      s3Region: this.s3Region,
      s3BucketLookup: this.s3BucketLookup,
      repositoryUrl: this.repositoryUrl(),
      lastSyncSnapshotId: this.lastSyncSnapshotId,
      lastSyncSnapshotTime: this.lastSyncSnapshotTime,
      dateCreated: this.dateCreated,
    };
  }
}
