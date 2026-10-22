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

describe("Project validateNew", () => {  it("should require name, endpoint, bucket and credentials", () => {
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

  it("should reject names longer than the 100 character column", () => {
    const payload = {
      s3Endpoint: "s3.example.com",
      s3Bucket: "bucket",
      s3AccessKeyId: "key",
      s3SecretAccessKey: "secret",
      resticPassword: "password",
    };
    expect(Project.validateNew({ ...payload, name: "a".repeat(101) })).toEqual([
      "Invalid project: name must be 100 characters or less",
    ]);
    expect(Project.validateNew({ ...payload, name: "a".repeat(100) })).toEqual(
      [],
    );
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
    expect(Project.validateNew(null as any).length).toBe(1);
  });

  it("should reject a name whose slug produces an empty repository prefix", () => {
    const errors = Project.validateNew({
      name: "ÀÉÎ",
      s3Endpoint: "s3.example.com",
      s3Bucket: "bucket",
      s3AccessKeyId: "key",
      s3SecretAccessKey: "secret",
      resticPassword: "password",
    });
    expect(errors).toEqual([
      "Invalid project: repository prefix is required (the name produces an empty default prefix)",
    ]);
  });

  it("should accept a name with an empty slug when an explicit prefix is given", () => {
    expect(
      Project.validateNew({
        name: "ÀÉÎ",
        repoPrefix: "custom-prefix",
        s3Endpoint: "s3.example.com",
        s3Bucket: "bucket",
        s3AccessKeyId: "key",
        s3SecretAccessKey: "secret",
        resticPassword: "password",
      }),
    ).toEqual([]);
  });

  it("should reject an explicit prefix that normalizes to empty", () => {
    const errors = Project.validateNew({
      name: "Valid Name",
      repoPrefix: "///",
      s3Endpoint: "s3.example.com",
      s3Bucket: "bucket",
      s3AccessKeyId: "key",
      s3SecretAccessKey: "secret",
      resticPassword: "password",
    });
    expect(errors).toEqual([
      "Invalid project: repository prefix is required (the name produces an empty default prefix)",
    ]);
  });
});

describe("Project repoTarget", () => {
  function project(overrides: Partial<Project> = {}): Project {
    const created = new Project();
    created.name = "My App";
    created.s3Endpoint = "s3.example.com";
    created.s3Bucket = "bucket";
    return Object.assign(created, overrides);
  }

  it("should normalize scheme, endpoint case and trailing slashes", () => {
    const https = project({
      s3Endpoint: "  HTTPS://S3.Example.com/  ",
      s3Bucket: " Bucket ",
    });
    const plain = project({ s3Endpoint: "s3.example.com", s3Bucket: "bucket" });
    expect(https.repoTarget()).toEqual({
      s3Endpoint: "s3.example.com",
      s3Bucket: "bucket",
      repoPrefix: "my-app",
    });
    expect(https.repoTargetKey()).toBe(plain.repoTargetKey());
  });

  it("should strip surrounding slashes from the effective prefix but keep its case", () => {
    const target = project({ repoPrefix: " /Apps/MyApp/ " }).repoTarget();
    expect(target.repoPrefix).toBe("Apps/MyApp");
    expect(project({ repoPrefix: "apps/myapp" }).repoTargetKey()).not.toBe(
      project({ repoPrefix: "Apps/MyApp" }).repoTargetKey(),
    );
  });

  it("should make slug collisions of the project name identical targets", () => {
    expect(project({ name: "My App" }).repoTargetKey()).toBe(
      project({ name: "my-app" }).repoTargetKey(),
    );
    expect(project({ name: "a b" }).repoTargetKey()).toBe(
      project({ name: "a-b" }).repoTargetKey(),
    );
  });

  it("should keep different buckets or prefixes distinct", () => {
    expect(project({ s3Bucket: "bucket" }).repoTargetKey()).not.toBe(
      project({ s3Bucket: "other-bucket" }).repoTargetKey(),
    );
    expect(project({ repoPrefix: "prefix-a" }).repoTargetKey()).not.toBe(
      project({ repoPrefix: "prefix-b" }).repoTargetKey(),
    );
  });

  it("should not change the effective prefix of existing projects", () => {
    const legacy = project({ name: "My App" });
    expect(legacy.effectiveRepoPrefix()).toBe("my-app");
    expect(legacy.repositoryUrl()).toBe(
      "s3:https://s3.example.com/bucket/my-app",
    );
    expect(legacy.toTransportJson().repoPrefix).toBe("my-app");
  });
});

describe("Project lastSyncContentHash", () => {
  it("should default to an empty hash", () => {
    const project = Project.fromJson({
      name: "Test",
      s3Endpoint: "e",
      s3Bucket: "b",
    });
    expect(project?.lastSyncContentHash).toBe("");
  });

  it("should round-trip the content hash in JSON forms", () => {
    const project = Project.fromJson({
      name: "Test",
      s3Endpoint: "e",
      s3Bucket: "b",
      lastSyncContentHash: "abc123",
    }) as Project;
    expect(project.lastSyncContentHash).toBe("abc123");
    expect(project.toJson().lastSyncContentHash).toBe("abc123");
    expect(project.toTransportJson().lastSyncContentHash).toBe("abc123");
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
