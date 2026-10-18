/**
 * Fixed-window request counter per client key. State lives in this process (one
 * Workers isolate or one Node server), so it limits bursts from a single client but is
 * not a global quota across isolates; a platform rate limiter can replace it later.
 */
export class RateLimiter {
  private readonly windows = new Map<
    string,
    { start: number; count: number }
  >();

  constructor(
    readonly limit: number,
    readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Counts one request; returns the seconds to wait when the key is over its limit. */
  hit(key: string): { ok: true } | { ok: false; retryAfterSeconds: number } {
    const t = this.now();
    if (this.windows.size > 10_000) {
      for (const [k, w] of this.windows) {
        if (t - w.start >= this.windowMs) this.windows.delete(k);
      }
    }
    const w = this.windows.get(key);
    if (!w || t - w.start >= this.windowMs) {
      this.windows.set(key, { start: t, count: 1 });
      return { ok: true };
    }
    if (w.count >= this.limit) {
      return {
        ok: false,
        retryAfterSeconds: Math.ceil((w.start + this.windowMs - t) / 1000),
      };
    }
    w.count++;
    return { ok: true };
  }
}

/**
 * The caller's IP. Cloudflare sets cf-connecting-ip and overwrites any client-supplied
 * value; x-forwarded-for is only a fallback for local development behind no proxy.
 */
export function clientIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}
