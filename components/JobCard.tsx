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

const sourceLabels: Record<RankedJob["source"], string> = {
  adzuna: "Adzuna",
  remoteok: "RemoteOK",
  remotive: "Remotive",
};

export function JobCard({ job }: { job: RankedJob }) {
  return (
    <a
      href={job.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="truncate font-medium text-slate-900 group-hover:text-brand">
            {job.title}
          </h3>
          <p className="mt-0.5 truncate text-sm text-slate-500">
            {job.company} · {job.location}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${scoreStyles(job.score)}`}
        >
          {job.score}
        </span>
      </div>
      <p className="mt-2.5 line-clamp-2 text-sm text-slate-600">
        {job.reasoning}
      </p>
      <div className="mt-3 flex items-center justify-between">
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
          {sourceLabels[job.source]}
        </span>
        <span className="flex items-center gap-1 text-xs font-medium text-slate-400 group-hover:text-brand">
          View posting
          <ArrowIcon />
        </span>
      </div>
    </a>
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
