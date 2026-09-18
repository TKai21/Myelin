import type { RateLimiter } from "./types";
import { InMemoryLimiter } from "./inMemoryLimiter";
import { UpstashLimiter } from "./upstashLimiter";

let instance: RateLimiter | null = null;

export function getRateLimiter(): RateLimiter {
  if (!instance) {
    instance =
      process.env.NODE_ENV === "production"
        ? new UpstashLimiter()
        : new InMemoryLimiter();
  }
  return instance;
}

export type { RateLimiter, RateLimitResult } from "./types";
