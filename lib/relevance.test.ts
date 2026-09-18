import { describe, expect, it } from "vitest";
import { tokenize, scoreJob, topByRelevance } from "./relevance";
import type { Job } from "./tools/types";

const job = (overrides: Partial<Job>): Job => ({
  source: "adzuna",
  title: "Untitled",
  company: "Acme",
  location: "Remote",
  url: "https://example.com",
  description: "",
  ...overrides,
});

describe("tokenize", () => {
  it("lowercases and splits on non-alphanumeric boundaries", () => {
    expect(tokenize("Senior Backend-Engineer!")).toEqual([
      "senior",
      "backend",
      "engineer",
    ]);
  });
});

describe("scoreJob", () => {
  it("matches multi-word keyword phrases despite word order and insertions", () => {
    const senior = job({ title: "Senior Backend Engineer" });
    const unrelated = job({ title: "Marketing Manager" });

    expect(scoreJob(senior, ["backend engineer"])).toBeGreaterThan(
      scoreJob(unrelated, ["backend engineer"])
    );
  });

  it("weights title matches higher than description matches", () => {
    const titleMatch = job({ title: "Backend Engineer", description: "" });
    const descMatch = job({
      title: "Marketing Manager",
      description: "backend engineer",
    });

    expect(scoreJob(titleMatch, ["backend engineer"])).toBeGreaterThan(
      scoreJob(descMatch, ["backend engineer"])
    );
  });
});

describe("topByRelevance", () => {
  it("returns at most `limit` jobs, most relevant first", () => {
    const jobs = [
      job({ title: "Marketing Manager" }),
      job({ title: "Senior Backend Engineer" }),
      job({ title: "Backend Engineer II" }),
    ];

    const result = topByRelevance(jobs, ["backend engineer"], 2);

    expect(result).toHaveLength(2);
    expect(result.map((j) => j.title)).toEqual([
      "Senior Backend Engineer",
      "Backend Engineer II",
    ]);
  });
});
