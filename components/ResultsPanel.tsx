"use client";

import { useState } from "react";
import { SearchForm } from "./SearchForm";
import { JobCard } from "./JobCard";
import type { SearchCriteria } from "@/lib/tools/types";
import type { AgentEvent } from "@/lib/agent/loop";
import type { RankedJob } from "@/lib/agent/schema";

export function ResultsPanel() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  const [jobs, setJobs] = useState<RankedJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(resume: string, criteria: SearchCriteria) {
    setRunning(true);
    setProgress([]);
    setJobs(null);
    setError(null);

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume, ...criteria }),
      });

      if (!res.ok || !res.body) {
        setError("Search request failed");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          if (!chunk.startsWith("data: ")) continue;
          const event: AgentEvent = JSON.parse(chunk.slice("data: ".length));
          if (event.type === "progress") {
            setProgress((prev) => [...prev, event.message]);
          } else if (event.type === "result") {
            setJobs(
              [...event.data.jobs].sort((a, b) => b.score - a.score)
            );
          } else if (event.type === "error") {
            setError(event.message);
          }
        }
      }
    } catch {
      setError("Search request failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-4xl gap-8 p-8 md:grid-cols-2">
      <SearchForm disabled={running} onSubmit={handleSubmit} />
      <div className="space-y-3">
        {progress.map((message, i) => (
          <p key={i} className="text-xs text-slate-500">
            {message}
          </p>
        ))}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {jobs?.map((job, i) => (
          <JobCard key={`${job.url}-${i}`} job={job} />
        ))}
      </div>
    </div>
  );
}
