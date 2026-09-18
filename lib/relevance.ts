import type { Job } from "./tools/types";

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function scoreJob(job: Job, keywords: string[]): number {
  const titleTokens = tokenize(job.title);
  const descTokens = tokenize(job.description);
  const kwTokens = keywords.flatMap(tokenize);

  let titleScore = 0;
  let descScore = 0;
  for (const kw of kwTokens) {
    titleScore += titleTokens.filter((t) => t === kw).length;
    descScore += descTokens.filter((t) => t === kw).length;
  }

  // Title hits weighted higher than description hits; log1p dampens
  // the length bias of long descriptions accumulating keyword hits
  // just by being verbose.
  return titleScore * 3 + Math.log1p(descScore);
}

export function topByRelevance(
  jobs: Job[],
  keywords: string[],
  limit: number
): Job[] {
  return [...jobs]
    .sort((a, b) => scoreJob(b, keywords) - scoreJob(a, keywords))
    .slice(0, limit);
}
