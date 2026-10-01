CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_id   TEXT UNIQUE,
  email       TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL DEFAULT '',
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sending mailboxes (Ethereal SMTP accounts). Rate limits are enforced per sender.
CREATE TABLE IF NOT EXISTS senders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  smtp_host   TEXT NOT NULL,
  smtp_port   INT  NOT NULL,
  smtp_secure BOOLEAN NOT NULL DEFAULT false,
  smtp_user   TEXT NOT NULL,
  smtp_pass   TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaigns (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject          TEXT NOT NULL,
  body             TEXT NOT NULL,
  start_at         TIMESTAMPTZ NOT NULL,
  delay_ms         INT NOT NULL,
  hourly_limit     INT NOT NULL,
  total            INT NOT NULL,
  idempotency_key  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);

DO $$ BEGIN
  CREATE TYPE email_status AS ENUM ('scheduled', 'processing', 'sent', 'failed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- One row per recipient. The row id is also the BullMQ jobId, which makes
-- enqueueing idempotent: adding the same job twice is a no-op.
CREATE TABLE IF NOT EXISTS emails (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_id       UUID NOT NULL REFERENCES senders(id),
  to_email        TEXT NOT NULL,
  subject         TEXT NOT NULL,
  body            TEXT NOT NULL,
  scheduled_at    TIMESTAMPTZ NOT NULL,
  status          email_status NOT NULL DEFAULT 'scheduled',
  attempts        INT NOT NULL DEFAULT 0,
  processing_at   TIMESTAMPTZ,
  sent_at         TIMESTAMPTZ,
  message_id      TEXT,
  preview_url     TEXT,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, to_email)
);

CREATE INDEX IF NOT EXISTS emails_user_status_sched_idx ON emails (user_id, status, scheduled_at);
CREATE INDEX IF NOT EXISTS emails_user_sent_idx ON emails (user_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS emails_status_sched_idx ON emails (status, scheduled_at);

-- Per-user Slack connection, created by the OAuth flow.
CREATE TABLE IF NOT EXISTS slack_connections (
  user_id       UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  team_id       TEXT NOT NULL,
  team_name     TEXT,
  channel_id    TEXT,
  channel_name  TEXT,
  webhook_url   TEXT,
  access_token  TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
