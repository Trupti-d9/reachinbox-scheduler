import clsx from 'clsx';

export interface TabItem<T extends string> {
  value: T;
  label: string;
  count?: number;
  icon?: React.ReactNode;
}

export function Tabs<T extends string>({ items, value, onChange }: {
  items: TabItem<T>[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div role="tablist" className="inline-flex rounded-xl bg-slate-100 p-1">
      {items.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.value)}
            className={clsx(
              'inline-flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-medium transition-all',
              active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
            )}
          >
            {t.icon}
            {t.label}
            {t.count !== undefined && (
              <span
                className={clsx(
                  'rounded-full px-2 py-px text-xs tabular-nums',
                  active ? 'bg-brand-50 text-brand-700' : 'bg-slate-200 text-slate-600',
                )}
              >
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
