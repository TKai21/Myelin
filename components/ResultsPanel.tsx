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
  const [formCollapsed, setFormCollapsed] = useState(false);
  const [hasSearchedOnce, setHasSearchedOnce] = useState(false);
  const [lastCriteria, setLastCriteria] = useState<SearchCriteria | null>(
    null
  );

  async function handleSubmit(resume: string, criteria: SearchCriteria) {
    setRunning(true);
    setProgress([]);
    setJobs(null);
    setError(null);
    setFormCollapsed(true);
    setHasSearchedOnce(true);
    setLastCriteria(criteria);

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

  const latestMessage = progress[progress.length - 1];

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className={formCollapsed ? "hidden" : "mx-auto max-w-2xl"}>
        <SearchForm disabled={running} onSubmit={handleSubmit} />
      </div>

      {formCollapsed && lastCriteria && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
          <span className="text-slate-600">
            Searching for{" "}
            <strong className="text-slate-900">
              {lastCriteria.keywords.length > 0
                ? lastCriteria.keywords.join(", ")
                : "any role"}
            </strong>
            {lastCriteria.location && (
              <>
                {" "}
                in{" "}
                <strong className="text-slate-900">
                  {lastCriteria.location}
                </strong>
              </>
            )}
          </span>
          <button
            type="button"
            onClick={() => setFormCollapsed(false)}
            className="font-medium text-brand hover:underline"
          >
            Edit
          </button>
        </div>
      )}

      {!hasSearchedOnce && (
        <div className="mx-auto mt-8 flex max-w-2xl flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white/50 p-10 text-center">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-brand-soft text-brand">
            <SearchIcon />
          </div>
          <p className="text-sm font-medium text-slate-700">
            Your ranked matches will appear here
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Fill in the form above and run a search to get started.
          </p>
        </div>
      )}

      {hasSearchedOnce && (running || latestMessage) && (
        <div className="mb-6 flex items-center gap-2.5 text-sm text-slate-600">
          <span
            className={`h-2 w-2 rounded-full bg-brand ${running ? "animate-pulse-dot" : ""}`}
          />
          {running ? (latestMessage ?? "Starting search...") : "Agent finished"}
        </div>
      )}

      {error && (
        <div className="mb-6 flex items-start gap-2.5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
          {error}
        </div>
      )}

      {hasSearchedOnce && jobs && jobs.length > 0 && (
        <p className="mb-3 text-sm font-medium text-slate-700">
          {jobs.length} match{jobs.length === 1 ? "" : "es"} found
        </p>
      )}

      {hasSearchedOnce && jobs && jobs.length === 0 && (
        <p className="text-sm text-slate-500">
          No matching jobs found. Try broadening your search.
        </p>
      )}

      {hasSearchedOnce && (running || (jobs && jobs.length > 0)) && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {running &&
            !jobs &&
            Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
          {jobs?.map((job, i) => (
            <JobCard key={`${job.url}-${i}`} job={job} />
          ))}
        </div>
      )}
    </main>
  );
}

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 shrink-0 rounded-full bg-slate-200" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-3/4 rounded bg-slate-200" />
          <div className="h-3 w-1/2 rounded bg-slate-200" />
        </div>
      </div>
      <div className="mt-3 space-y-2">
        <div className="h-3 w-full rounded bg-slate-200" />
        <div className="h-3 w-5/6 rounded bg-slate-200" />
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
