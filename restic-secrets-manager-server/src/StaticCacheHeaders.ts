import fastifyStatic, { FastifyStaticOptions } from "@fastify/static";
import { FastifyInstance } from "fastify";
import * as path from "path";

// The SPA entry files must always be revalidated: they reference the
// content-hashed assets of a specific build. Serving them as immutable makes
// browsers keep running a previous build (referencing deleted chunks) after
// every upgrade.
const SPA_ENTRY_FILES = new Set(["index.html", "sw.js", "manifest.webmanifest"]);

const DEFAULT_CACHE_CONTROL = "public, max-age=86400, immutable";

export function staticCacheControlFor(filePath: string): string {
  return SPA_ENTRY_FILES.has(path.basename(filePath))
    ? "no-cache"
    : DEFAULT_CACHE_CONTROL;
}

export async function registerStaticFiles(
  fastify: FastifyInstance,
  webRoot: string,
): Promise<void> {
  const options: FastifyStaticOptions = {
    root: webRoot,
    prefix: "/",
    maxAge: "1d",
    etag: true,
    lastModified: true,
    immutable: true,
    cacheControl: true,
    setHeaders: (reply, filePath) => {
      reply.header("cache-control", staticCacheControlFor(filePath));
    },
  };
  await fastify.register(fastifyStatic, options);
}
