import type { RateLimiter, RateLimitResult } from "./types";

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 5;

// Dev-only fallback: Vercel serverless functions give no single-instance
// guarantee, so this in-memory counter's state is not shared across
// instances actually serving production traffic. See UpstashLimiter for
// the production implementation.
export class InMemoryLimiter implements RateLimiter {
  private hits = new Map<string, number[]>();

  async check(ip: string): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = now - WINDOW_MS;
    const existing = (this.hits.get(ip) ?? []).filter((t) => t > windowStart);

    if (existing.length >= MAX_REQUESTS) {
      const retryAfterSeconds = Math.ceil(
        (existing[0] + WINDOW_MS - now) / 1000
      );
      return { allowed: false, retryAfterSeconds };
    }

    existing.push(now);
    this.hits.set(ip, existing);
    return { allowed: true };
  }
}
