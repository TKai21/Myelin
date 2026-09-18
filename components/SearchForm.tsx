"use client";

import { useState } from "react";
import type { SearchCriteria } from "@/lib/tools/types";
import { Spinner } from "./Spinner";

export function SearchForm({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (resume: string, criteria: SearchCriteria) => void;
}) {
  const [resume, setResume] = useState("");
  const [keywordsInput, setKeywordsInput] = useState("");
  const [location, setLocation] = useState("");
  const [remoteOnly, setRemoteOnly] = useState(true);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const keywords = keywordsInput
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    onSubmit(resume, { keywords, location, remoteOnly });
  }

  const inputClasses =
    "w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 transition focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand-soft";

  return (
    <form
      onSubmit={handleSubmit}
      className="h-fit rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <h2 className="text-base font-semibold text-slate-900">
        Search criteria
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Paste your resume and tell the agent what to look for.
      </p>

      <div className="mt-5 space-y-5">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Resume
          </label>
          <textarea
            value={resume}
            onChange={(e) => setResume(e.target.value)}
            required
            rows={10}
            placeholder="Paste your resume text here..."
            className={`${inputClasses} resize-none font-mono text-[13px] leading-relaxed`}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Keywords
          </label>
          <input
            type="text"
            value={keywordsInput}
            onChange={(e) => setKeywordsInput(e.target.value)}
            placeholder="backend, typescript, agent"
            className={inputClasses}
          />
          <p className="mt-1 text-xs text-slate-400">Comma-separated</p>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Location
          </label>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="San Francisco (optional)"
            className={inputClasses}
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={remoteOnly}
            onChange={(e) => setRemoteOnly(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 accent-brand focus:ring-2 focus:ring-brand-soft"
          />
          Remote only
        </label>
      </div>

      <button
        type="submit"
        disabled={disabled}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-3.5 py-2.5 text-sm font-medium text-brand-foreground transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {disabled && <Spinner />}
        {disabled ? "Searching..." : "Search"}
      </button>
    </form>
  );
}
