import { afterEach, describe, expect, it, vi } from "vitest";
import { searchRemoteOK } from "./searchRemoteOK";

const criteria = { keywords: [], location: "", remoteOnly: true };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("searchRemoteOK", () => {
  it("normalizes a successful response, skipping the legal-notice first element", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          { legal: "notice" },
          {
            position: "Backend Engineer",
            company: "Acme",
            location: "",
            url: "https://remoteok.com/job/1",
            description: "Build things.",
          },
        ],
      })
    );

    const result = await searchRemoteOK(criteria);

    expect(result.error).toBeUndefined();
    expect(result.jobs).toEqual([
      {
        source: "remoteok",
        title: "Backend Engineer",
        company: "Acme",
        location: "Remote",
        url: "https://remoteok.com/job/1",
        description: "Build things.",
      },
    ]);
  });

  it("returns an error instead of throwing on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503 })
    );

    const result = await searchRemoteOK(criteria);

    expect(result.jobs).toEqual([]);
    expect(result.error).toContain("503");
  });

  it("returns an error instead of throwing when fetch rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down"))
    );

    const result = await searchRemoteOK(criteria);

    expect(result.jobs).toEqual([]);
    expect(result.error).toBe("network down");
  });
});
