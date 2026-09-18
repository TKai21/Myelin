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
            setJobs([...event.data.jobs].sort((a, b) => b.score - a.score));
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

  const hasStarted =
    running || progress.length > 0 || jobs !== null || error !== null;

  return (
    <div className="mx-auto grid max-w-5xl gap-6 px-6 py-10 md:grid-cols-[380px_1fr]">
      <SearchForm disabled={running} onSubmit={handleSubmit} />

      <div className="min-w-0">
        {!hasStarted && (
          <div className="flex h-full min-h-[320px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/50 p-10 text-center">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-brand-soft text-brand">
              <SearchIcon />
            </div>
            <p className="text-sm font-medium text-slate-700">
              Your ranked matches will appear here
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Fill in the form and run a search to get started.
            </p>
          </div>
        )}

        {(running || progress.length > 0) && (
          <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full bg-brand ${running ? "animate-pulse-dot" : ""}`}
              />
              <p className="text-sm font-medium text-slate-700">
                {running ? "Agent is working..." : "Agent finished"}
              </p>
            </div>
            <ul className="mt-3 space-y-1.5 border-l-2 border-slate-100 pl-3.5">
              {progress.map((message, i) => (
                <li key={i} className="text-xs text-slate-500">
                  {message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <div className="mb-5 flex items-start gap-2.5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
            {error}
          </div>
        )}

        {jobs && jobs.length > 0 && (
          <p className="mb-3 text-sm font-medium text-slate-700">
            {jobs.length} match{jobs.length === 1 ? "" : "es"} found
          </p>
        )}

        {jobs && jobs.length === 0 && (
          <p className="text-sm text-slate-500">
            No matching jobs found. Try broadening your search.
          </p>
        )}

        <div className="space-y-3">
          {jobs?.map((job, i) => (
            <JobCard key={`${job.url}-${i}`} job={job} />
          ))}
        </div>
      </div>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      className="h-5 w-5"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}
