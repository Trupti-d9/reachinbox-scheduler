import { useSenders } from '../../hooks/useEmails';

/** Per-sender usage in the current hour window (read from the Redis counters). */
export function SendersCard() {
  const { data, isLoading } = useSenders();

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-semibold text-slate-800">Senders</p>
        {data && <p className="text-xs text-slate-400">{data.limitPerHour}/h each</p>}
      </div>
      <div className="mt-3 space-y-3">
        {isLoading &&
          Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-8 animate-pulse rounded bg-slate-100" />)}
        {data?.items.map((s) => {
          const pct = Math.min(100, (s.sentThisHour / data.limitPerHour) * 100);
          return (
            <div key={s.id}>
              <div className="flex justify-between gap-2 text-xs">
                <span className="truncate text-slate-600" title={s.email}>
                  {s.email}
                </span>
                <span className="shrink-0 tabular-nums text-slate-500">
                  {s.sentThisHour}/{data.limitPerHour}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-red-500' : pct > 80 ? 'bg-amber-500' : 'bg-brand-500'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
        {data && data.items.length === 0 && <p className="text-xs text-slate-500">No senders configured.</p>}
      </div>
    </div>
  );
}
