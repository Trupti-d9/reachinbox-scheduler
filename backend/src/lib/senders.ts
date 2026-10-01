import nodemailer, { Transporter } from 'nodemailer';
import { query } from '../db/pool';
import { env } from '../config/env';
import { createLogger } from './logger';

const log = createLogger('senders');

export interface Sender {
  id: string;
  name: string;
  email: string;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string;
  smtp_pass: string;
  active: boolean;
}

const transporters = new Map<string, Transporter>();

/** One pooled SMTP transporter per sender, reused across jobs. */
export function getTransporter(sender: Sender): Transporter {
  let t = transporters.get(sender.id);
  if (!t) {
    t = nodemailer.createTransport({
      host: sender.smtp_host,
      port: sender.smtp_port,
      secure: sender.smtp_secure,
      auth: { user: sender.smtp_user, pass: sender.smtp_pass },
      pool: true,
      maxConnections: 2,
    });
    transporters.set(sender.id, t);
  }
  return t;
}

export async function listActiveSenders(): Promise<Sender[]> {
  const { rows } = await query<Sender>('SELECT * FROM senders WHERE active ORDER BY created_at, email');
  return rows;
}

export async function getSender(id: string): Promise<Sender | null> {
  const { rows } = await query<Sender>('SELECT * FROM senders WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export async function upsertSender(s: {
  name: string;
  email: string;
  user: string;
  pass: string;
  host?: string;
  port?: number;
  secure?: boolean;
}) {
  const { rows } = await query<Sender>(
    `INSERT INTO senders (name, email, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, smtp_host = EXCLUDED.smtp_host,
       smtp_port = EXCLUDED.smtp_port, smtp_secure = EXCLUDED.smtp_secure,
       smtp_user = EXCLUDED.smtp_user, smtp_pass = EXCLUDED.smtp_pass, active = true
     RETURNING *`,
    [s.name, s.email, s.host ?? env.SMTP_HOST, s.port ?? env.SMTP_PORT, s.secure ?? env.SMTP_SECURE, s.user, s.pass],
  );
  transporters.delete(rows[0].id);
  return rows[0];
}

/** Creates a brand-new Ethereal inbox and stores it as a sender. */
export async function createEtherealSender(name?: string) {
  const acc = await nodemailer.createTestAccount();
  return upsertSender({
    name: name || `Ethereal ${acc.user.split('@')[0]}`,
    email: acc.user,
    user: acc.user,
    pass: acc.pass,
    host: acc.smtp.host,
    port: acc.smtp.port,
    secure: acc.smtp.secure,
  });
}

/**
 * Seeds senders on startup:
 *  1. from ETHEREAL_SENDERS (JSON) if provided, else
 *  2. auto-creates AUTO_CREATE_ETHEREAL_SENDERS Ethereal accounts if none exist.
 */
export async function ensureSenders() {
  if (env.ETHEREAL_SENDERS.trim()) {
    const list = JSON.parse(env.ETHEREAL_SENDERS) as Array<{
      name?: string; email: string; user?: string; pass: string; host?: string; port?: number; secure?: boolean;
    }>;
    for (const s of list) {
      await upsertSender({ name: s.name ?? s.email, email: s.email, user: s.user ?? s.email, pass: s.pass, host: s.host, port: s.port, secure: s.secure });
    }
    log.info(`loaded ${list.length} sender(s) from ETHEREAL_SENDERS`);
  }
  const existing = await listActiveSenders();
  if (existing.length === 0 && env.AUTO_CREATE_ETHEREAL_SENDERS > 0) {
    for (let i = 0; i < env.AUTO_CREATE_ETHEREAL_SENDERS; i++) {
      const s = await createEtherealSender(`Sender ${i + 1}`);
      log.info(`created Ethereal sender ${s.email} (login at https://ethereal.email with pass ${s.smtp_pass})`);
    }
  }
}

export const publicSender = (s: Sender) => ({ id: s.id, name: s.name, email: s.email, active: s.active });
