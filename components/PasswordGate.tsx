"use client";

import { useState } from "react";
import { Spinner } from "./Spinner";

export function PasswordGate({ onUnlock }: { onUnlock: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setSubmitting(false);
    if (res.ok) {
      onUnlock();
    } else {
      setError("Incorrect password");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-50 to-indigo-50/40 px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/50"
      >
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand">
            <LockIcon />
          </div>
          <h1 className="text-lg font-semibold text-slate-900">
            Job Search Agent
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Enter the password to continue
          </p>
        </div>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 transition focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand-soft"
          autoFocus
        />
        {error && (
          <p className="mt-2.5 flex items-center gap-1.5 text-sm text-red-600">
            <span className="h-1.5 w-1.5 rounded-full bg-red-600" />
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-3.5 py-2.5 text-sm font-medium text-brand-foreground transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting && <Spinner />}
          {submitting ? "Checking..." : "Enter"}
        </button>
      </form>
    </div>
  );
}

function LockIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      className="h-5 w-5"
    >
      <rect x="4" y="10" width="16" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 1 1 8 0v3" />
    </svg>
  );
}
