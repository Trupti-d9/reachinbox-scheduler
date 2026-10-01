import 'dotenv/config';
import { z } from 'zod';

/**
 * All configuration is read from environment variables and validated once at
 * startup. Nothing related to throughput or limits is hard-coded anywhere else.
 */
const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : ['1', 'true', 'yes'].includes(v.toLowerCase())));

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(4000),
  FRONTEND_URL: z.string().default('http://localhost:5173'),
  BACKEND_URL: z.string().default('http://localhost:4000'),

  DATABASE_URL: z.string().default('postgres://postgres:postgres@localhost:5432/reachinbox'),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Elasticsearch
  ELASTICSEARCH_URL: z.string().default('http://localhost:9200'),
  ELASTICSEARCH_INDEX: z.string().default('emails'),
  ELASTICSEARCH_ENABLED: bool(true),

  // Auth
  JWT_SECRET: z.string().min(16).default('change-me-please-this-is-not-secret'),
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  /** Local testing only (Postman / scripts). Never enabled in production. */
  ALLOW_DEV_LOGIN: bool(false),

  // Slack OAuth
  SLACK_CLIENT_ID: z.string().default(''),
  SLACK_CLIENT_SECRET: z.string().default(''),
  SLACK_REDIRECT_URI: z.string().default(''),

  // Senders (Ethereal). JSON array: [{"name":"..","email":"..","user":"..","pass":".."}]
  ETHEREAL_SENDERS: z.string().default(''),
  /** If no senders exist, create this many Ethereal test accounts automatically. */
  AUTO_CREATE_ETHEREAL_SENDERS: z.coerce.number().int().min(0).default(2),
  SMTP_HOST: z.string().default('smtp.ethereal.email'),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: bool(false),

  // Throughput / rate limiting
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(5),
  MIN_DELAY_BETWEEN_EMAILS_MS: z.coerce.number().int().min(0).default(2000),
  MAX_EMAILS_PER_HOUR_PER_SENDER: z.coerce.number().int().min(1).default(50),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(3_600_000),
  JOB_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(3),
  JOB_BACKOFF_MS: z.coerce.number().int().min(0).default(10_000),
  /** A row stuck in "processing" longer than this is considered abandoned by a crashed worker. */
  STALE_PROCESSING_MS: z.coerce.number().int().min(1000).default(120_000),

  /** Run the BullMQ worker inside the API process (handy for local dev). */
  RUN_WORKER_IN_API: bool(false),

  // Bull Board basic auth (optional)
  BULL_BOARD_USER: z.string().default(''),
  BULL_BOARD_PASS: z.string().default(''),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration', parsed.error.issues);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
