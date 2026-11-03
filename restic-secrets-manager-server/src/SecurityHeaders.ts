import { createHash } from "crypto";
import { FastifyInstance } from "fastify";
import * as fs from "fs";
import * as path from "path";

/**
 * Computes the `sha256-<base64>` CSP hashes of the inline scripts of an HTML
 * document. Scripts with a `src` attribute are external and produce no
 * hash; empty script bodies are ignored.
 */
export function inlineScriptHashes(html: string): string[] {
  const hashes = new Set<string>();
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(scriptPattern)) {
    const attributes = match[1] || "";
    if (/\bsrc\s*=/i.test(attributes)) {
      continue;
    }
    const body = match[2] || "";
    if (body.length === 0) {
      continue;
    }
    const digest = createHash("sha256").update(body, "utf8").digest("base64");
    hashes.add(`sha256-${digest}`);
  }
  return [...hashes].sort();
}

/**
 * Policy for the API and the same-origin SPA. Scripts are restricted to the
 * bundle and the hash-pinned inline Nuxt bootstrap; `style-src` still allows
 * inline styles because Vue injects scoped style attributes.
 */
export function buildContentSecurityPolicy(
  scriptHashes: string[] = [],
): string {
  return [
    "default-src 'self'",
    ["script-src", "'self'", ...scriptHashes].join(" "),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; ");
}

/** Reads the inline-script hashes of the generated SPA entry, if present. */
export function readInlineScriptHashes(webRoot: string): string[] {
  try {
    const html = fs.readFileSync(path.join(webRoot, "index.html"), "utf8");
    return inlineScriptHashes(html);
  } catch {
    // No generated SPA yet (development serves it from Nuxt itself).
    return [];
  }
}

/**
 * Adds defense-in-depth HTTP headers to every response (API and static).
 * The CSP is computed once from the generated SPA entry so the inline
 * bootstrap keeps working without `unsafe-inline`.
 */
export function registerSecurityHeaders(
  fastify: FastifyInstance,
  webRoot?: string,
): void {
  const contentSecurityPolicy = buildContentSecurityPolicy(
    webRoot ? readInlineScriptHashes(webRoot) : [],
  );
  fastify.addHook("onSend", async (_request, reply, payload) => {
    reply.header("content-security-policy", contentSecurityPolicy);
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("x-frame-options", "DENY");
    return payload;
  });
}
