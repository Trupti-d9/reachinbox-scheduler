import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, CheckCircle2, ExternalLink, Plus, Search, Send } from 'lucide-react';
import { api } from '../api/client';
import type { EmailListType } from '../api/types';
import { AppHeader } from '../components/layout/AppHeader';
import { Button, Spinner, Tabs } from '../components/ui';
import { ComposeModal } from '../features/compose/ComposeModal';
import { EmailsTable, toRows } from '../features/emails/EmailsTable';
import { SendersCard } from '../features/senders/SendersCard';
import { SlackConnectCard } from '../features/slack/SlackConnectCard';
import { useEmailSearch, useEmails, useStats } from '../hooks/useEmails';
import { useDebounced } from '../hooks/useDebounced';

const PAGE_SIZE = 50;

export function DashboardPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') === 'sent' ? 'sent' : 'scheduled') as EmailListType;
  const [page, setPage] = useState(1);
  const [composeOpen, setComposeOpen] = useState(false);
  const [q, setQ] = useState('');
  const debouncedQ = useDebounced(q.trim(), 300);

  const stats = useStats();
  const list = useEmails(tab, page);
  const search = useEmailSearch(debouncedQ, tab);
  const config = useQuery({ queryKey: ['config'], queryFn: api.config, staleTime: Infinity });

  // Toast the result of the Slack OAuth redirect, then clean the URL.
  useEffect(() => {
    const slack = params.get('slack');
    if (!slack) return;
    if (slack === 'connected') toast.success('Slack connected');
    else toast.error('Could not connect Slack');
    params.delete('slack');
    setParams(params, { replace: true });
  }, [params, setParams]);

  const switchTab = (t: EmailListType) => {
    setPage(1);
    setParams({ tab: t }, { replace: true });
  };

  const searching = debouncedQ.length > 0;
  const rows = searching ? toRows(search.data?.items ?? []) : (list.data?.items ?? []);
  const loading = searching ? search.isLoading : list.isLoading;
  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / PAGE_SIZE)) : 1;

  return (
    <div className="min-h-full">
      <AppHeader />
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row">
        <main className="min-w-0 flex-1 space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Emails</h1>
              <p className="mt-1 text-sm text-slate-500">Everything you’ve scheduled, and what has already gone out.</p>
            </div>
            <Button size="lg" icon={<Plus className="size-4" />} onClick={() => setComposeOpen(true)}>
              Compose New Email
            </Button>
          </div>

          <div className="grid grid-cols-3 gap-3 sm:gap-4">
            <StatCard label="Scheduled" value={stats.data?.scheduled} icon={<CalendarClock className="size-4" />} tone="text-brand-600 bg-brand-50" />
            <StatCard label="Sent" value={stats.data?.sent} icon={<CheckCircle2 className="size-4" />} tone="text-emerald-600 bg-emerald-50" />
            <StatCard label="Failed" value={stats.data?.failed} icon={<AlertTriangle className="size-4" />} tone="text-red-600 bg-red-50" />
          </div>

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
              <Tabs
                value={tab}
                onChange={switchTab}
                items={[
                  { value: 'scheduled', label: 'Scheduled Emails', icon: <CalendarClock className="size-4" />, count: stats.data?.scheduled },
                  { value: 'sent', label: 'Sent Emails', icon: <Send className="size-4" />, count: stats.data ? stats.data.sent + stats.data.failed : undefined },
                ]}
              />
              <div className="relative w-full sm:w-72">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search email, subject, body…"
                  className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-9 text-sm focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                />
                {searching && search.isFetching && <Spinner className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />}
              </div>
            </div>

            {list.isError && !searching ? (
              <div className="px-5 py-10 text-center text-sm text-red-600">
                Couldn’t load emails. <button className="underline" onClick={() => list.refetch()}>Retry</button>
              </div>
            ) : (
              <EmailsTable type={tab} rows={rows} loading={loading} searching={searching} onCompose={() => setComposeOpen(true)} />
            )}

            <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
              <span>
                {searching
                  ? `${rows.length} result${rows.length === 1 ? '' : 's'} · via ${search.data?.engine === 'elasticsearch' ? 'Elasticsearch' : 'Postgres'}`
                  : list.data
                    ? `${list.data.total} total`
                    : ''}
              </span>
              {!searching && totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    Previous
                  </Button>
                  <span className="tabular-nums">
                    {page} / {totalPages}
                  </span>
                  <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                    Next
                  </Button>
                </div>
              )}
            </div>
          </section>
        </main>

        <aside className="w-full shrink-0 space-y-4 lg:w-72">
          <SlackConnectCard />
          <SendersCard />
          <a
            href="/admin/queues"
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-800 transition-colors hover:border-brand-500"
          >
            Live queue dashboard <ExternalLink className="size-4 text-slate-400" />
          </a>
        </aside>
      </div>

      <ComposeModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        defaultHourlyLimit={config.data?.maxEmailsPerHourPerSender}
        minDelayMs={config.data?.minDelayBetweenEmailsMs}
      />
    </div>
  );
}

function StatCard({ label, value, icon, tone }: { label: string; value?: number; icon: React.ReactNode; tone: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <span className={`flex size-7 items-center justify-center rounded-lg ${tone}`}>{icon}</span>
        {label}
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">
        {value ?? <span className="inline-block h-7 w-10 animate-pulse rounded bg-slate-100 align-middle" />}
      </p>
    </div>
  );
}
