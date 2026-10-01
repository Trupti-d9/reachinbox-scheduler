import { useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { FileUp, CheckCircle2, Clock, Gauge, Timer, X } from 'lucide-react';
import { Button, Field, Input, Modal, Textarea } from '../../components/ui';
import { useCreateCampaign } from '../../hooks/useEmails';
import { parseLeadsFile } from '../../lib/parseLeads';
import type { ParsedLeads } from '../../lib/parseLeads';
import { formatDateTime, formatDuration, toLocalInputValue } from '../../lib/format';

interface ComposeModalProps {
  open: boolean;
  onClose: () => void;
  defaultHourlyLimit?: number;
  minDelayMs?: number;
}

type Errors = Partial<Record<'subject' | 'body' | 'leads' | 'startAt' | 'delay' | 'hourly', string>>;

export function ComposeModal({ open, onClose, defaultHourlyLimit = 50, minDelayMs = 0 }: ComposeModalProps) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [leads, setLeads] = useState<ParsedLeads | null>(null);
  const [parsing, setParsing] = useState(false);
  const [startAt, setStartAt] = useState(() => toLocalInputValue(new Date(Date.now() + 60_000)));
  const [delaySec, setDelaySec] = useState(String(Math.max(2, Math.ceil(minDelayMs / 1000))));
  const [hourly, setHourly] = useState(String(defaultHourlyLimit));
  const [errors, setErrors] = useState<Errors>({});
  // One key per compose session → double-clicking "Schedule" can't create two campaigns.
  const idemKey = useRef(crypto.randomUUID());
  const fileInput = useRef<HTMLInputElement>(null);
  const create = useCreateCampaign();

  const reset = () => {
    setSubject('');
    setBody('');
    setFile(null);
    setLeads(null);
    setErrors({});
    setStartAt(toLocalInputValue(new Date(Date.now() + 60_000)));
    idemKey.current = crypto.randomUUID();
  };

  const handleFile = async (f: File | undefined) => {
    if (!f) return;
    setFile(f);
    setParsing(true);
    try {
      const parsed = await parseLeadsFile(f);
      setLeads(parsed);
      setErrors((e) => ({ ...e, leads: parsed.emails.length ? undefined : 'No email addresses found in this file' }));
    } finally {
      setParsing(false);
    }
  };

  // Live preview of how long the campaign will take with these settings.
  const estimate = useMemo(() => {
    const n = leads?.emails.length ?? 0;
    const delayMs = Math.max(Number(delaySec) * 1000, minDelayMs);
    const perHour = Number(hourly);
    if (!n || !perHour) return null;
    const bySpacing = (n - 1) * delayMs;
    const byHourCap = Math.floor((n - 1) / perHour) * 3_600_000;
    return Math.max(bySpacing, byHourCap);
  }, [leads, delaySec, hourly, minDelayMs]);

  const validate = (): Errors => {
    const e: Errors = {};
    if (!subject.trim()) e.subject = 'Subject is required';
    if (!body.trim()) e.body = 'Body is required';
    if (!leads?.emails.length) e.leads = 'Upload a CSV or text file with at least one email';
    if (!startAt || Number.isNaN(new Date(startAt).getTime())) e.startAt = 'Pick a start time';
    const d = Number(delaySec);
    if (!Number.isFinite(d) || d < 0) e.delay = 'Must be 0 or more';
    const h = Number(hourly);
    if (!Number.isInteger(h) || h < 1) e.hourly = 'Must be a whole number ≥ 1';
    return e;
  };

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;
    create.mutate(
      {
        key: idemKey.current,
        body: {
          subject: subject.trim(),
          body: body.trim(),
          leads: leads!.emails,
          startAt: new Date(startAt).toISOString(),
          delayMs: Math.round(Number(delaySec) * 1000),
          hourlyLimit: Number(hourly),
        },
      },
      {
        onSuccess: () => {
          reset();
          onClose();
        },
      },
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Compose new email"
      description="Upload your leads and schedule the send. Limits are enforced per sender by the backend."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button form="compose-form" type="submit" loading={create.isPending} icon={<Clock className="size-4" />}>
            Schedule
          </Button>
        </>
      }
    >
      <form id="compose-form" onSubmit={submit} className="space-y-5" noValidate>
        <Field label="Subject" htmlFor="subject" error={errors.subject}>
          <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Quick question about your outbound" invalid={!!errors.subject} />
        </Field>

        <Field label="Body" htmlFor="body" error={errors.body}>
          <Textarea id="body" value={body} onChange={(e) => setBody(e.target.value)} placeholder={'Hi there,\n\n…'} invalid={!!errors.body} />
        </Field>

        <Field label="Leads" error={errors.leads} hint="CSV (uses an “email” column if present) or a .txt file with one address per line.">
          {file ? (
            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <CheckCircle2 className="size-5 shrink-0 text-emerald-500" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">{file.name}</p>
                  <p className="text-xs text-slate-500">
                    {parsing ? (
                      'Parsing…'
                    ) : (
                      <>
                        <span className="font-semibold text-brand-600">{leads?.emails.length ?? 0}</span> email
                        {leads?.emails.length === 1 ? '' : 's'} detected
                        {leads?.duplicates ? ` · ${leads.duplicates} duplicate${leads.duplicates === 1 ? '' : 's'} removed` : ''}
                      </>
                    )}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setFile(null);
                  setLeads(null);
                }}
                className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                aria-label="Remove file"
              >
                <X className="size-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void handleFile(e.dataTransfer.files[0]);
              }}
              className={`flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-sm transition-colors hover:border-brand-500 hover:bg-brand-50/40 ${errors.leads ? 'border-red-300' : 'border-slate-200'}`}
            >
              <FileUp className="size-6 text-brand-500" />
              <span className="font-medium text-slate-700">Click to upload or drag a file here</span>
              <span className="text-xs text-slate-500">.csv or .txt</span>
            </button>
          )}
          <input ref={fileInput} type="file" accept=".csv,.txt,text/csv,text/plain" className="hidden" onChange={(e) => void handleFile(e.target.files?.[0])} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Start time" htmlFor="startAt" error={errors.startAt}>
            <Input id="startAt" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} invalid={!!errors.startAt} />
          </Field>
          <Field label="Delay between emails" htmlFor="delay" error={errors.delay} hint={minDelayMs ? `Server minimum ${minDelayMs / 1000}s` : 'seconds'}>
            <div className="relative">
              <Timer className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input id="delay" type="number" min={0} step="0.5" value={delaySec} onChange={(e) => setDelaySec(e.target.value)} className="pl-9 pr-8" invalid={!!errors.delay} />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">s</span>
            </div>
          </Field>
          <Field label="Hourly limit" htmlFor="hourly" error={errors.hourly} hint="max emails / hour">
            <div className="relative">
              <Gauge className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input id="hourly" type="number" min={1} value={hourly} onChange={(e) => setHourly(e.target.value)} className="pl-9" invalid={!!errors.hourly} />
            </div>
          </Field>
        </div>

        {estimate !== null && leads && (
          <div className="rounded-lg bg-brand-50 px-4 py-3 text-sm text-brand-700">
            {leads.emails.length} emails starting {formatDateTime(new Date(startAt).toISOString())}, finishing in about{' '}
            <strong>{formatDuration(estimate)}</strong>.
          </div>
        )}
      </form>
    </Modal>
  );
}
