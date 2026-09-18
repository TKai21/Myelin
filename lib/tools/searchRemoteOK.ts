import type { Job, SearchCriteria, ToolResult } from "./types";

export async function searchRemoteOK(
  _criteria: SearchCriteria
): Promise<ToolResult> {
  try {
    const res = await fetch("https://remoteok.com/api", {
      headers: { "User-Agent": "job-search-agent-demo" },
    });
    if (!res.ok) {
      return {
        source: "remoteok",
        jobs: [],
        error: `RemoteOK API returned ${res.status}`,
      };
    }
    const data = await res.json();
    // The first element of the response is a legal-notice object, not a listing.
    const listings = Array.isArray(data) ? data.slice(1) : [];
    const jobs: Job[] = listings.map(
      (r: {
        position?: string;
        company?: string;
        location?: string;
        url?: string;
        description?: string;
      }) => ({
        source: "remoteok" as const,
        title: r.position ?? "Untitled",
        company: r.company ?? "Unknown",
        location: r.location || "Remote",
        url: r.url ?? "",
        description: r.description ?? "",
      })
    );
    return { source: "remoteok", jobs };
  } catch (err) {
    return {
      source: "remoteok",
      jobs: [],
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
