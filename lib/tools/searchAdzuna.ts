import type { Job, SearchCriteria, ToolResult } from "./types";

const ADZUNA_COUNTRY = "us";

export async function searchAdzuna(
  criteria: SearchCriteria
): Promise<ToolResult> {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) {
    return {
      source: "adzuna",
      jobs: [],
      error: "Adzuna credentials not configured",
    };
  }

  const what = criteria.remoteOnly
    ? [...criteria.keywords, "remote"].join(" ")
    : criteria.keywords.join(" ");

  const url = new URL(
    `https://api.adzuna.com/v1/api/jobs/${ADZUNA_COUNTRY}/search/1`
  );
  url.searchParams.set("app_id", appId);
  url.searchParams.set("app_key", appKey);
  url.searchParams.set("what", what);
  if (criteria.location) url.searchParams.set("where", criteria.location);
  url.searchParams.set("results_per_page", "50");

  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      return {
        source: "adzuna",
        jobs: [],
        error: `Adzuna API returned ${res.status}`,
      };
    }
    const data = await res.json();
    const jobs: Job[] = (data.results ?? []).map(
      (r: {
        title?: string;
        company?: { display_name?: string };
        location?: { display_name?: string };
        redirect_url?: string;
        description?: string;
      }) => ({
        source: "adzuna" as const,
        title: r.title ?? "Untitled",
        company: r.company?.display_name ?? "Unknown",
        location: r.location?.display_name ?? "Unknown",
        url: r.redirect_url ?? "",
        description: r.description ?? "",
      })
    );
    return { source: "adzuna", jobs };
  } catch (err) {
    return {
      source: "adzuna",
      jobs: [],
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
