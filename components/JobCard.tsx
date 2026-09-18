import type { RankedJob } from "@/lib/agent/schema";

function scoreStyles(score: number): string {
  if (score >= 80) {
    return "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200";
  }
  if (score >= 60) {
    return "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200";
  }
  return "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200";
}

const AVATAR_COLORS = [
  "bg-indigo-100 text-indigo-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-700",
  "bg-sky-100 text-sky-700",
  "bg-violet-100 text-violet-700",
];

function avatarStyles(company: string): string {
  const sum = [...company].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return AVATAR_COLORS[sum % AVATAR_COLORS.length];
}

const sourceLabels: Record<RankedJob["source"], string> = {
  adzuna: "Adzuna",
  remoteok: "RemoteOK",
  remotive: "Remotive",
};

export function JobCard({ job }: { job: RankedJob }) {
  return (
    <div className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md">
      <div className="flex items-start gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${avatarStyles(job.company)}`}
        >
          {job.company.charAt(0).toUpperCase() || "?"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate font-medium text-slate-900">
              {job.title}
            </h3>
            <span
              className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${scoreStyles(job.score)}`}
            >
              {job.score}
            </span>
          </div>
          <p className="mt-0.5 truncate text-sm text-slate-500">
            {job.company} · {job.location}
          </p>
        </div>
      </div>

      <p className="mt-3 line-clamp-2 flex-1 text-sm text-slate-600">
        {job.reasoning}
      </p>

      <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
        <span className="rounded-md border border-slate-200 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
          {sourceLabels[job.source]}
        </span>
        <a
          href={job.url}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex items-center gap-1 text-xs font-medium text-brand hover:underline"
        >
          View posting
          <ArrowIcon />
        </a>
      </div>
    </div>
  );
}

function ArrowIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className="h-3 w-3 transition group-hover:translate-x-0.5"
    >
      <path d="M7 17 17 7M9 7h8v8" />
    </svg>
  );
}
