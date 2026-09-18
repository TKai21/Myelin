import { describe, expect, it, vi } from "vitest";

const limitMock = vi.fn();

vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: class {
    limit = limitMock;
    static slidingWindow = vi.fn(() => "sliding-window-config");
  },
}));

vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: vi.fn(() => ({})) },
}));

import { UpstashLimiter } from "./upstashLimiter";

describe("UpstashLimiter", () => {
  it("allows when both the per-IP and global limiters succeed", async () => {
    limitMock.mockResolvedValue({ success: true, reset: Date.now() + 1000 });

    const limiter = new UpstashLimiter({} as never);
    const result = await limiter.check("1.2.3.4");

    expect(result.allowed).toBe(true);
    expect(limitMock).toHaveBeenCalledTimes(2);
  });

  it("blocks when the per-IP limiter fails", async () => {
    limitMock
      .mockResolvedValueOnce({ success: false, reset: Date.now() + 5000 })
      .mockResolvedValueOnce({ success: true, reset: Date.now() + 1000 });

    const limiter = new UpstashLimiter({} as never);
    const result = await limiter.check("1.2.3.4");

    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("blocks when the global limiter fails even if per-IP succeeds", async () => {
    limitMock
      .mockResolvedValueOnce({ success: true, reset: Date.now() + 1000 })
      .mockResolvedValueOnce({ success: false, reset: Date.now() + 5000 });

    const limiter = new UpstashLimiter({} as never);
    const result = await limiter.check("1.2.3.4");

    expect(result.allowed).toBe(false);
  });
});
