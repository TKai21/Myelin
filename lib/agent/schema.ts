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

export function parseRankedResults(raw: unknown): RankedResults {
  return RankedResultsSchema.parse(raw);
}
