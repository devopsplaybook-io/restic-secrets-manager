/**
 * Anti-caching headers for every response that carries secret material:
 * prevents browsers, proxies and caches from storing plaintext secrets.
 */
export function setSecretResponseHeaders(res: any): void {
  res.header("cache-control", "no-store");
  res.header("pragma", "no-cache");
  res.header("vary", "Authorization");
}
