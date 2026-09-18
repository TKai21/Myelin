export interface Job {
  source: "adzuna" | "remoteok" | "remotive";
  title: string;
  company: string;
  location: string;
  url: string;
  description: string;
}

export interface SearchCriteria {
  keywords: string[];
  location: string;
  remoteOnly: boolean;
}

export interface ToolResult {
  source: Job["source"];
  jobs: Job[];
  error?: string;
}
