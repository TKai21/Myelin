import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import type { RateLimiter, RateLimitResult } from "./types";

export class UpstashLimiter implements RateLimiter {
  private perIp: Ratelimit;
  private global: Ratelimit;

  constructor(redis: Redis = Redis.fromEnv()) {
    this.perIp = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(5, "1 m"),
      prefix: "ratelimit:ip",
    });
    this.global = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(100, "1 h"),
      prefix: "ratelimit:global",
    });
  }

  async check(ip: string): Promise<RateLimitResult> {
    const [ipResult, globalResult] = await Promise.all([
      this.perIp.limit(ip),
      this.global.limit("global"),
    ]);

    if (!ipResult.success) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil((ipResult.reset - Date.now()) / 1000),
      };
    }
    if (!globalResult.success) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(
          (globalResult.reset - Date.now()) / 1000
        ),
      };
    }
    return { allowed: true };
  }
}
