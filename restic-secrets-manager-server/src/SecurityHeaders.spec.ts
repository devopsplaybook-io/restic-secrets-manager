import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import Fastify, { FastifyInstance } from "fastify";
import {
  buildContentSecurityPolicy,
  inlineScriptHashes,
  registerSecurityHeaders,
} from "./SecurityHeaders";

describe("buildContentSecurityPolicy", () => {
  it("includes the restrictive defaults", () => {
    const csp = buildContentSecurityPolicy();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("connect-src 'self'");
  });

  it("pins the supplied inline-script hashes on script-src", () => {
    const csp = buildContentSecurityPolicy(["sha256-abc", "sha256-def"]);
    expect(csp).toContain("script-src 'self' sha256-abc sha256-def");
    // Scripts never rely on unsafe-inline
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
  });
});

describe("inlineScriptHashes", () => {
  it("hashes inline scripts and ignores external or empty ones", () => {
    const inline = "window.__NUXT__={config:{}};";
    const html = [
      "<html><head>",
      `<script>${inline}</script>`,
      '<script type="module" src="/_nuxt/entry.js"></script>',
      "<script></script>",
      "</head></html>",
    ].join("");

    const expected = createHash("sha256")
      .update(inline, "utf8")
      .digest("base64");
    expect(inlineScriptHashes(html)).toEqual([`sha256-${expected}`]);
  });

  it("returns one hash per distinct inline script", () => {
    const html = "<script>a()</script><script>b()</script><script>a()</script>";
    expect(inlineScriptHashes(html)).toHaveLength(2);
  });
});

describe("registerSecurityHeaders", () => {
  let app: FastifyInstance;
  let webRoot: string;
  const inline = "window.__NUXT__={};";

  beforeAll(async () => {
    webRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rsm-headers-"));
    fs.writeFileSync(
      path.join(webRoot, "index.html"),
      `<html><body><script>${inline}</script></body></html>`,
    );

    app = Fastify();
    registerSecurityHeaders(app, webRoot);
    app.get("/api/status", async () => ({ started: true }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(webRoot, { recursive: true, force: true });
  });

  it("sets the defense-in-depth headers on API responses", async () => {
    const res = await app.inject({ method: "GET", url: "/api/status" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
  });

  it("keeps the generated inline bootstrap allowed by its hash", async () => {
    const res = await app.inject({ method: "GET", url: "/api/status" });
    const expected = createHash("sha256")
      .update(inline, "utf8")
      .digest("base64");
    expect(res.headers["content-security-policy"]).toContain(
      `sha256-${expected}`,
    );
  });

  it("works without a generated SPA entry (development layout)", async () => {
    const devApp = Fastify();
    registerSecurityHeaders(devApp, "/nonexistent-web-root");
    devApp.get("/api/status", async () => ({ started: true }));
    await devApp.ready();
    const res = await devApp.inject({ method: "GET", url: "/api/status" });
    await devApp.close();
    expect(res.headers["content-security-policy"]).toContain(
      "script-src 'self';",
    );
  });
});
