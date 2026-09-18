import { afterEach, describe, expect, it, vi } from "vitest";
import { searchAdzuna } from "./searchAdzuna";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("searchAdzuna", () => {
  it("normalizes a successful response", async () => {
    process.env.ADZUNA_APP_ID = "id";
    process.env.ADZUNA_APP_KEY = "key";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            {
              title: "Backend Engineer",
              company: { display_name: "Acme" },
              location: { display_name: "Remote" },
              redirect_url: "https://adzuna.example/job/1",
              description: "Build things.",
            },
          ],
        }),
      })
    );

    const result = await searchAdzuna({
      keywords: ["backend"],
      location: "",
      remoteOnly: false,
    });

    expect(result.error).toBeUndefined();
    expect(result.jobs).toEqual([
      {
        source: "adzuna",
        title: "Backend Engineer",
        company: "Acme",
        location: "Remote",
        url: "https://adzuna.example/job/1",
        description: "Build things.",
      },
    ]);
  });

  it("returns an error instead of throwing when credentials are missing", async () => {
    delete process.env.ADZUNA_APP_ID;
    delete process.env.ADZUNA_APP_KEY;

    const result = await searchAdzuna({
      keywords: ["backend"],
      location: "",
      remoteOnly: false,
    });

    expect(result.jobs).toEqual([]);
    expect(result.error).toBeDefined();
  });

  it("returns an error instead of throwing on a non-ok response", async () => {
    process.env.ADZUNA_APP_ID = "id";
    process.env.ADZUNA_APP_KEY = "key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500 })
    );

    const result = await searchAdzuna({
      keywords: ["backend"],
      location: "",
      remoteOnly: false,
    });

    expect(result.jobs).toEqual([]);
    expect(result.error).toContain("500");
  });

  it("returns an error instead of throwing when fetch rejects", async () => {
    process.env.ADZUNA_APP_ID = "id";
    process.env.ADZUNA_APP_KEY = "key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down"))
    );

    const result = await searchAdzuna({
      keywords: ["backend"],
      location: "",
      remoteOnly: false,
    });

    expect(result.jobs).toEqual([]);
    expect(result.error).toBe("network down");
  });
});
