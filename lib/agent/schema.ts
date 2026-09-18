import { z } from "zod";

export const RankedJobSchema = z.object({
  title: z.string(),
  company: z.string(),
  location: z.string(),
  url: z.string().url(),
  source: z.enum(["adzuna", "remoteok", "remotive"]),
  score: z.number().min(0).max(100),
  reasoning: z.string(),
});

export const RankedResultsSchema = z.object({
  jobs: z.array(RankedJobSchema),
});

export type RankedJob = z.infer<typeof RankedJobSchema>;
export type RankedResults = z.infer<typeof RankedResultsSchema>;

// Some tool-call responses stringify the `jobs` array instead of returning
// it as a native JSON array - a known quirk with large/nested tool-call
// arguments. Unwrap that case before validating.
function normalizeJobsField(raw: unknown): unknown {
  if (
    typeof raw === "object" &&
    raw !== null &&
    "jobs" in raw &&
    typeof (raw as { jobs: unknown }).jobs === "string"
  ) {
    try {
      return { ...raw, jobs: JSON.parse((raw as { jobs: string }).jobs) };
    } catch {
      return raw;
    }
  }
  return raw;
}

export function parseRankedResults(raw: unknown): RankedResults {
  return RankedResultsSchema.parse(normalizeJobsField(raw));
}
