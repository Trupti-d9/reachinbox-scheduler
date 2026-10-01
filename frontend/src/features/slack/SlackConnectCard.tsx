import { Button } from '../../components/ui';
import { useSlack } from '../../hooks/useSlack';
import { oauthUrls } from '../../api/client';

export function SlackIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path fill="#E01E5A" d="M5 15a2 2 0 1 1-2-2h2v2Zm1 0a2 2 0 1 1 4 0v5a2 2 0 1 1-4 0v-5Z" />
      <path fill="#36C5F0" d="M9 5a2 2 0 1 1 2-2v2H9Zm0 1a2 2 0 1 1 0 4H4a2 2 0 1 1 0-4h5Z" />
      <path fill="#2EB67D" d="M19 9a2 2 0 1 1 2 2h-2V9Zm-1 0a2 2 0 1 1-4 0V4a2 2 0 1 1 4 0v5Z" />
      <path fill="#ECB22E" d="M15 19a2 2 0 1 1-2 2v-2h2Zm0-1a2 2 0 1 1 0-4h5a2 2 0 1 1 0 4h-5Z" />
    </svg>
  );
}

/** Connect / status / disconnect card for Slack rate-limit alerts. */
export function SlackConnectCard() {
  const { status, disconnect, test } = useSlack();
  const s = status.data;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-lg bg-slate-50 ring-1 ring-slate-200">
          <SlackIcon className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-800">Slack alerts</p>
          <p className="truncate text-xs text-slate-500">
            {status.isLoading
              ? 'Checking…'
              : s?.connected
                ? `${s.team ?? 'Workspace'}${s.channel ? ` · ${s.channel}` : ''}`
                : 'Get notified when a sender hits its hourly limit'}
          </p>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        {s?.connected ? (
          <>
            <Button size="sm" variant="secondary" className="flex-1" loading={test.isPending} onClick={() => test.mutate()}>
              Send test
            </Button>
            <Button size="sm" variant="danger" loading={disconnect.isPending} onClick={() => disconnect.mutate()}>
              Disconnect
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            className="w-full"
            disabled={status.isLoading || (s && !s.configured)}
            title={s && !s.configured ? 'Slack OAuth is not configured on the server' : undefined}
            icon={<SlackIcon className="size-3.5" />}
            onClick={() => (window.location.href = oauthUrls.slack)}
          >
            Connect Slack
          </Button>
        )}
      </div>
    </div>
  );
}
