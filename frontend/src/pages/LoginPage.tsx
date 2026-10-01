import { useState } from 'react';
import type { FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, Gauge, ShieldCheck } from 'lucide-react';
import { api, oauthUrls } from '../api/client';
import { Button, Input } from '../components/ui';
import { Logo } from '../components/layout/AppHeader';
import { useAuth } from '../hooks/useAuth';

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="size-5" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

const ERRORS: Record<string, string> = {
  google_login_failed: 'Google sign-in failed. Please try again.',
  access_denied: 'You cancelled the Google sign-in.',
};

export function LoginPage() {
  const [params] = useSearchParams();
  const error = params.get('error');
  const config = useQuery({ queryKey: ['auth-config'], queryFn: api.authConfig });

  return (
    <div className="flex min-h-full">
      <div className="flex flex-1 flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <Logo />
          <h1 className="mt-10 text-2xl font-semibold tracking-tight text-slate-900">Sign in to your workspace</h1>
          <p className="mt-2 text-sm text-slate-500">Schedule cold emails at scale, with per-sender limits and live delivery status.</p>

          {error && (
            <div className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100">
              {ERRORS[error] ?? 'Sign-in failed. Please try again.'}
            </div>
          )}

          <Button
            size="lg"
            variant="secondary"
            className="mt-8 w-full"
            icon={<GoogleIcon />}
            disabled={config.data && !config.data.googleConfigured}
            onClick={() => (window.location.href = oauthUrls.google)}
          >
            Continue with Google
          </Button>
          {config.data && !config.data.googleConfigured && (
            <p className="mt-2 text-center text-xs text-amber-600">Set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET on the backend.</p>
          )}

          {config.data?.devLogin && <DevLogin />}
        </div>
      </div>

      <div className="relative hidden flex-1 overflow-hidden bg-gradient-to-br from-brand-600 via-indigo-700 to-slate-900 lg:flex lg:items-center lg:justify-center">
        <div className="absolute -right-24 -top-24 size-96 rounded-full bg-white/10 blur-3xl" />
        <div className="relative max-w-md space-y-5 px-10 text-white">
          {[
            { icon: <CalendarClock className="size-5" />, t: 'Scheduled with BullMQ', d: 'Delayed jobs in Redis — no cron, survives restarts.' },
            { icon: <Gauge className="size-5" />, t: 'Rate limits that hold', d: 'Per-sender hourly caps and send spacing, shared across workers.' },
            { icon: <ShieldCheck className="size-5" />, t: 'Never sent twice', d: 'Idempotent jobs and atomic claims on every email.' },
          ].map((f) => (
            <div key={f.t} className="flex gap-4 rounded-2xl bg-white/10 p-5 ring-1 ring-white/15 backdrop-blur">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/15">{f.icon}</div>
              <div>
                <p className="font-semibold">{f.t}</p>
                <p className="mt-0.5 text-sm text-white/75">{f.d}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Only rendered when the backend has ALLOW_DEV_LOGIN=true (local testing). */
function DevLogin() {
  const { refresh } = useAuth();
  const [email, setEmail] = useState('dev@example.com');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.devLogin(email, email.split('@')[0]);
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="mt-8 rounded-xl border border-dashed border-amber-300 bg-amber-50/60 p-4">
      <p className="text-xs font-medium text-amber-800">Local dev login (disabled in production)</p>
      <div className="mt-2 flex gap-2">
        <Input value={email} onChange={(e) => setEmail(e.target.value)} className="h-9" />
        <Button size="sm" type="submit" loading={busy} className="h-9">
          Enter
        </Button>
      </div>
    </form>
  );
}
