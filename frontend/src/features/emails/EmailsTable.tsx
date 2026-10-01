import { useMemo } from 'react';
import { CalendarClock, ExternalLink, Send, XCircle } from 'lucide-react';
import { Button, DataTable, EmptyState } from '../../components/ui';
import type { Column } from '../../components/ui';
import type { EmailItem, EmailListType, EmailStatus, SearchResponse } from '../../api/types';
import { formatDateTime, formatRelative } from '../../lib/format';
import { useCancelEmail } from '../../hooks/useEmails';
import { StatusBadge } from './StatusBadge';

/** Search hits from Elasticsearch use camelCase; normalise them to table rows. */
export function toRows(items: SearchResponse['items']): EmailItem[] {
  return items.map((i) =>
    'to_email' in i
      ? i
      : {
          id: i.id,
          campaign_id: '',
          to_email: i.to,
          from_email: i.from,
          subject: i.subject,
          status: i.status as EmailStatus,
          scheduled_at: i.scheduledAt,
          sent_at: i.sentAt,
          attempts: 0,
          preview_url: null,
          error: null,
        },
  );
}

interface EmailsTableProps {
  type: EmailListType;
  rows: EmailItem[];
  loading: boolean;
  searching?: boolean;
  onCompose: () => void;
}

export function EmailsTable({ type, rows, loading, searching, onCompose }: EmailsTableProps) {
  const cancel = useCancelEmail();

  const columns = useMemo<Column<EmailItem>[]>(() => {
    const cols: Column<EmailItem>[] = [
      {
        key: 'email',
        header: 'Email',
        render: (r) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-slate-800">{r.to_email}</p>
            {r.from_email && <p className="truncate text-xs text-slate-400">from {r.from_email}</p>}
          </div>
        ),
      },
      { key: 'subject', header: 'Subject', render: (r) => <p className="max-w-xs truncate text-slate-600">{r.subject}</p> },
    ];

    if (type === 'scheduled') {
      cols.push({
        key: 'time',
        header: 'Scheduled time',
        render: (r) => (
          <div>
            <p className="tabular-nums text-slate-700">{formatDateTime(r.scheduled_at)}</p>
            <p className="text-xs text-slate-400">{formatRelative(r.scheduled_at)}</p>
          </div>
        ),
      });
    } else {
      cols.push({
        key: 'time',
        header: 'Sent time',
        render: (r) => <p className="tabular-nums text-slate-700">{formatDateTime(r.sent_at)}</p>,
      });
    }

    cols.push({
      key: 'status',
      header: 'Status',
      render: (r) => (
        <div title={r.error ?? undefined}>
          <StatusBadge status={r.status} />
          {r.status === 'failed' && r.error && <p className="mt-1 max-w-[180px] truncate text-xs text-red-500">{r.error}</p>}
        </div>
      ),
    });

    cols.push({
      key: 'actions',
      header: '',
      className: 'w-24 text-right',
      render: (r) =>
        type === 'scheduled' && r.status === 'scheduled' ? (
          <Button
            size="sm"
            variant="ghost"
            icon={<XCircle className="size-3.5" />}
            loading={cancel.isPending && cancel.variables === r.id}
            onClick={() => cancel.mutate(r.id)}
          >
            Cancel
          </Button>
        ) : r.preview_url ? (
          <a
            href={r.preview_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
          >
            Preview <ExternalLink className="size-3" />
          </a>
        ) : null,
    });
    return cols;
  }, [type, cancel]);

  const empty = searching ? (
    <EmptyState icon={<CalendarClock className="size-6" />} title="No matches" description="Try a different address, subject or keyword." />
  ) : type === 'scheduled' ? (
    <EmptyState
      icon={<CalendarClock className="size-6" />}
      title="No scheduled emails"
      description="Upload a list of leads and pick a start time — they’ll show up here until they’re sent."
      action={<Button onClick={onCompose}>Compose new email</Button>}
    />
  ) : (
    <EmptyState icon={<Send className="size-6" />} title="Nothing sent yet" description="Emails appear here as soon as they are delivered (or fail)." />
  );

  return <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} loading={loading} empty={empty} />;
}
