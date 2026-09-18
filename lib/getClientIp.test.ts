import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { getClientIp } from "./getClientIp";

describe("getClientIp", () => {
  it("returns the first IP from x-forwarded-for", () => {
    const req = new NextRequest("https://example.com", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    expect(getClientIp(req)).toBe("1.2.3.4");
  });

  it("returns 'unknown' when the header is absent", () => {
    const req = new NextRequest("https://example.com");
    expect(getClientIp(req)).toBe("unknown");
  });
});
