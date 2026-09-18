export function Header() {
  return (
    <header className="border-b border-slate-200 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-sm font-semibold text-brand-foreground">
          J
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-900">
            Job Search Agent
          </p>
          <p className="text-xs text-slate-500">Claude-powered job matching</p>
        </div>
      </div>
    </header>
  );
}
