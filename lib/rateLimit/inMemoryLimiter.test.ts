import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryLimiter } from "./inMemoryLimiter";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("InMemoryLimiter", () => {
  it("allows up to the limit, then blocks", async () => {
    const limiter = new InMemoryLimiter();

    for (let i = 0; i < 5; i++) {
      const result = await limiter.check("1.2.3.4");
      expect(result.allowed).toBe(true);
    }

    const blocked = await limiter.check("1.2.3.4");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("tracks separate IPs independently", async () => {
    const limiter = new InMemoryLimiter();
    for (let i = 0; i < 5; i++) await limiter.check("1.1.1.1");

    const other = await limiter.check("2.2.2.2");
    expect(other.allowed).toBe(true);
  });

  it("allows requests again after the window elapses", async () => {
    const limiter = new InMemoryLimiter();
    for (let i = 0; i < 5; i++) await limiter.check("1.2.3.4");
    expect((await limiter.check("1.2.3.4")).allowed).toBe(false);

    vi.advanceTimersByTime(61_000);

    expect((await limiter.check("1.2.3.4")).allowed).toBe(true);
  });
});
