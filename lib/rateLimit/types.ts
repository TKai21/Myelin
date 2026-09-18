export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

export interface RateLimiter {
  check(ip: string): Promise<RateLimitResult>;
}
