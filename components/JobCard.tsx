import type { RankedJob } from "@/lib/agent/schema";

export function JobCard({ job }: { job: RankedJob }) {
  return (
    <a
      href={job.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-medium text-slate-900">{job.title}</h3>
          <p className="text-sm text-slate-600">
            {job.company} - {job.location}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white">
          {job.score}
        </span>
      </div>
      <p className="mt-2 text-sm text-slate-700">{job.reasoning}</p>
      <p className="mt-2 text-xs uppercase tracking-wide text-slate-400">
        {job.source}
      </p>
    </a>
  );
}
