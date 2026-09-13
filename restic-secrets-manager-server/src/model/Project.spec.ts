import { Project } from "./Project";

describe("Project slugify", () => {
  it("should lowercase and dash non-alphanumeric characters", () => {
    expect(Project.slugify("My Project!")).toBe("my-project");
    expect(Project.slugify("  Spaces   Inside  ")).toBe("spaces-inside");
    expect(Project.slugify("ÀÉÎ")).toBe(""); // non a-z characters collapse
  });

  it("should keep digits and dashes", () => {
    expect(Project.slugify("prod-2 Backup")).toBe("prod-2-backup");
  });
});

describe("Project effectiveRepoPrefix", () => {
  it("should use the provided repo prefix", () => {
    const project = new Project();
    project.name = "My Project";
    project.repoPrefix = "custom/prefix";
    expect(project.effectiveRepoPrefix()).toBe("custom/prefix");
  });

  it("should fall back to the slugified name", () => {
    const project = new Project();
    project.name = "My Project";
    expect(project.effectiveRepoPrefix()).toBe("my-project");
  });
});

describe("Project repositoryUrl", () => {
  it("should build the s3 repository URL", () => {
    const project = new Project();
    project.name = "Test";
    project.s3Endpoint = "s3.example.com";
    project.s3Bucket = "bucket";
    project.repoPrefix = "prefix";
    expect(project.repositoryUrl()).toBe(
      "s3:https://s3.example.com/bucket/prefix",
    );
  });
});

describe("Project validateNew", () => {
  it("should require name, endpoint, bucket and credentials", () => {
    const errors = Project.validateNew({});
    expect(errors).toEqual([
      "Invalid project: name is required",
      "Invalid project: s3Endpoint is required",
      "Invalid project: s3Bucket is required",
      "Invalid project: s3AccessKeyId is required",
      "Invalid project: s3SecretAccessKey is required",
      "Invalid project: resticPassword is required",
    ]);
  });

  it("should accept a complete payload", () => {
    const errors = Project.validateNew({
      name: "Test",
      s3Endpoint: "s3.example.com",
      s3Bucket: "bucket",
      s3AccessKeyId: "key",
      s3SecretAccessKey: "secret",
      resticPassword: "password",
    });
    expect(errors).toEqual([]);
  });

  it("should reject non-object payloads", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(Project.validateNew(null as any).length).toBe(1);
  });
});

describe("Project toTransportJson", () => {
  it("should never expose sensitive repository settings", () => {
    const project = Project.fromJson({
      name: "Test",
      s3Endpoint: "s3.example.com",
      s3Bucket: "bucket",
      s3AccessKeyId: "key",
      s3SecretAccessKey: "secret",
      resticPassword: "password",
    }) as Project;
    const transport = project.toTransportJson();
    expect(transport.s3AccessKeyId).toBeUndefined();
    expect(transport.s3SecretAccessKey).toBeUndefined();
    expect(transport.resticPassword).toBeUndefined();
    expect(transport.repositoryUrl).toBe(
      "s3:https://s3.example.com/bucket/test",
    );
    expect(transport.name).toBe("Test");
  });
});

describe("Project fromJson", () => {
  it("should default optional fields", () => {
    const project = Project.fromJson({
      name: "Test",
      s3Endpoint: "e",
      s3Bucket: "b",
    });
    expect(project?.description).toBe("");
    expect(project?.repoPrefix).toBe("");
    expect(project?.s3Region).toBe("");
    expect(project?.s3BucketLookup).toBe("dns");
    expect(project?.lastSyncSnapshotId).toBe("");
  });

  it("should return null for missing json", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(Project.fromJson(null as any)).toBeNull();
  });

  it("should keep the generated dateCreated when the body has none", () => {
    const project = Project.fromJson({
      name: "Test",
      s3Endpoint: "e",
      s3Bucket: "b",
    }) as Project;
    expect(project.dateCreated).toBeTruthy();
    expect(new Date(project.dateCreated).getTime()).not.toBeNaN();
  });

  it("should preserve a provided dateCreated (db rows)", () => {
    const project = Project.fromJson({
      name: "Test",
      s3Endpoint: "e",
      s3Bucket: "b",
      dateCreated: "2026-01-02T03:04:05.000Z",
    }) as Project;
    expect(project.dateCreated).toBe("2026-01-02T03:04:05.000Z");
  });
});
