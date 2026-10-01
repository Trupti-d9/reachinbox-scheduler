import { Badge } from '../../components/ui';
import type { EmailStatus } from '../../api/types';

const MAP: Record<EmailStatus, { tone: 'blue' | 'green' | 'red' | 'amber' | 'slate'; label: string }> = {
  scheduled: { tone: 'blue', label: 'Scheduled' },
  processing: { tone: 'amber', label: 'Sending' },
  sent: { tone: 'green', label: 'Sent' },
  failed: { tone: 'red', label: 'Failed' },
  cancelled: { tone: 'slate', label: 'Cancelled' },
};

export function StatusBadge({ status }: { status: EmailStatus }) {
  const s = MAP[status] ?? MAP.scheduled;
  return (
    <Badge tone={s.tone} dot>
      {s.label}
    </Badge>
  );
}
