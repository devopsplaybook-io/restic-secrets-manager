import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import Fastify, { FastifyInstance } from "fastify";
import { registerStaticFiles, staticCacheControlFor } from "./StaticCacheHeaders";

describe("staticCacheControlFor", () => {
  it("always revalidates the SPA entry files", () => {
    expect(staticCacheControlFor("/app/web/index.html")).toBe("no-cache");
    expect(staticCacheControlFor("/app/web/sw.js")).toBe("no-cache");
    expect(staticCacheControlFor("/app/web/manifest.webmanifest")).toBe(
      "no-cache",
    );
  });

  it("long-term caches the hashed and static assets", () => {
    expect(staticCacheControlFor("/app/web/_nuxt/entry.a1b2c3.js")).toBe(
      "public, max-age=86400, immutable",
    );
    expect(staticCacheControlFor("/app/web/_nuxt/entry.a1b2c3.css")).toBe(
      "public, max-age=86400, immutable",
    );
    expect(staticCacheControlFor("/app/web/favicon.ico")).toBe(
      "public, max-age=86400, immutable",
    );
  });
});

describe("registerStaticFiles", () => {
  let app: FastifyInstance;
  let webRoot: string;

  beforeAll(async () => {
    webRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rsm-web-"));
    fs.writeFileSync(path.join(webRoot, "index.html"), "<html></html>");
    fs.writeFileSync(
      path.join(webRoot, "sw.js"),
      "self.addEventListener('fetch', () => {});",
    );
    fs.mkdirSync(path.join(webRoot, "_nuxt"));
    fs.writeFileSync(path.join(webRoot, "_nuxt", "entry.a1b2c3.js"), "");

    app = Fastify();
    await registerStaticFiles(app, webRoot);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(webRoot, { recursive: true, force: true });
  });

  it("serves the SPA entry without immutable caching", async () => {
    const res = await app.inject({ method: "GET", url: "/index.html" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-cache");

    const sw = await app.inject({ method: "GET", url: "/sw.js" });
    expect(sw.headers["cache-control"]).toBe("no-cache");
  });

  it("serves hashed assets as immutable", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/_nuxt/entry.a1b2c3.js",
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe(
      "public, max-age=86400, immutable",
    );
  });
});
