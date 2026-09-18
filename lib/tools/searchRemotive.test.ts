import { afterEach, describe, expect, it, vi } from "vitest";
import { searchRemotive } from "./searchRemotive";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("searchRemotive", () => {
  it("normalizes a successful response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        jobs: [
          {
            title: "Backend Engineer",
            company_name: "Acme",
            candidate_required_location: "Worldwide",
            url: "https://remotive.com/job/1",
            description: "Build things.",
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchRemotive({
      keywords: ["backend"],
      location: "",
      remoteOnly: true,
    });

    expect(result.error).toBeUndefined();
    expect(result.jobs).toEqual([
      {
        source: "remotive",
        title: "Backend Engineer",
        company: "Acme",
        location: "Worldwide",
        url: "https://remotive.com/job/1",
        description: "Build things.",
      },
    ]);
    const calledUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(calledUrl.searchParams.get("search")).toBe("backend");
  });

  it("returns an error instead of throwing on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 502 })
    );

    const result = await searchRemotive({
      keywords: [],
      location: "",
      remoteOnly: true,
    });

    expect(result.jobs).toEqual([]);
    expect(result.error).toContain("502");
  });

  it("returns an error instead of throwing when fetch rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down"))
    );

    const result = await searchRemotive({
      keywords: [],
      location: "",
      remoteOnly: true,
    });

    expect(result.jobs).toEqual([]);
    expect(result.error).toBe("network down");
  });
});
