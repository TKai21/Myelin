"use client";

import { useState } from "react";
import type { SearchCriteria } from "@/lib/tools/types";

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

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">
          Resume
        </label>
        <textarea
          value={resume}
          onChange={(e) => setResume(e.target.value)}
          required
          rows={10}
          placeholder="Paste your resume text here"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">
          Keywords (comma-separated)
        </label>
        <input
          type="text"
          value={keywordsInput}
          onChange={(e) => setKeywordsInput(e.target.value)}
          placeholder="backend, typescript, agent"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">
          Location
        </label>
        <input
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="San Francisco (optional)"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={remoteOnly}
          onChange={(e) => setRemoteOnly(e.target.checked)}
        />
        Remote only
      </label>
      <button
        type="submit"
        disabled={disabled}
        className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {disabled ? "Searching..." : "Search"}
      </button>
    </form>
  );
}
