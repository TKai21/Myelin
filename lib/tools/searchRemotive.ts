import type { Job, SearchCriteria, ToolResult } from "./types";

export async function searchRemotive(
  criteria: SearchCriteria
): Promise<ToolResult> {
  const url = new URL("https://remotive.com/api/remote-jobs");
  if (criteria.keywords.length > 0) {
    url.searchParams.set("search", criteria.keywords.join(" "));
  }

  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      return {
        source: "remotive",
        jobs: [],
        error: `Remotive API returned ${res.status}`,
      };
    }
    const data = await res.json();
    const jobs: Job[] = (data.jobs ?? []).map(
      (r: {
        title?: string;
        company_name?: string;
        candidate_required_location?: string;
        url?: string;
        description?: string;
      }) => ({
        source: "remotive" as const,
        title: r.title ?? "Untitled",
        company: r.company_name ?? "Unknown",
        location: r.candidate_required_location || "Remote",
        url: r.url ?? "",
        description: r.description ?? "",
      })
    );
    return { source: "remotive", jobs };
  } catch (err) {
    return {
      source: "remotive",
      jobs: [],
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
