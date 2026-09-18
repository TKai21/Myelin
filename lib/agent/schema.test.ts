import { describe, expect, it } from "vitest";
import { parseRankedResults } from "./schema";

const validJob = {
  title: "Backend Engineer",
  company: "Acme",
  location: "Remote",
  url: "https://example.com/job/1",
  source: "adzuna",
  score: 87,
  reasoning: "Strong overlap with the candidate's listed backend experience.",
};

describe("parseRankedResults", () => {
  it("accepts a valid payload", () => {
    const result = parseRankedResults({ jobs: [validJob] });
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].score).toBe(87);
  });

  it("accepts an empty jobs array", () => {
    const result = parseRankedResults({ jobs: [] });
    expect(result.jobs).toEqual([]);
  });

  it("rejects a job missing a required field", () => {
    const { reasoning: _reasoning, ...missingReasoning } = validJob;
    expect(() =>
      parseRankedResults({ jobs: [missingReasoning] })
    ).toThrow();
  });

  it("rejects a score outside 0-100", () => {
    expect(() =>
      parseRankedResults({ jobs: [{ ...validJob, score: 150 }] })
    ).toThrow();
  });

  it("rejects an invalid source enum value", () => {
    expect(() =>
      parseRankedResults({ jobs: [{ ...validJob, source: "linkedin" }] })
    ).toThrow();
  });

  it("rejects a malformed url", () => {
    expect(() =>
      parseRankedResults({ jobs: [{ ...validJob, url: "not-a-url" }] })
    ).toThrow();
  });

  it("accepts jobs stringified as a JSON string (a known tool-call quirk)", () => {
    const result = parseRankedResults({ jobs: JSON.stringify([validJob]) });
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].score).toBe(87);
  });

  it("still rejects a jobs field that is a non-JSON string", () => {
    expect(() =>
      parseRankedResults({ jobs: "not valid json at all" })
    ).toThrow();
  });
});
