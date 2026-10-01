export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
}

export type EmailStatus = 'scheduled' | 'processing' | 'sent' | 'failed' | 'cancelled';
export type EmailListType = 'scheduled' | 'sent';

export interface EmailItem {
  id: string;
  campaign_id: string;
  to_email: string;
  from_email: string;
  subject: string;
  status: EmailStatus;
  scheduled_at: string;
  sent_at: string | null;
  attempts: number;
  preview_url: string | null;
  error: string | null;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface EmailStats {
  scheduled: number;
  sent: number;
  failed: number;
  cancelled: number;
}

/** Search results come from Elasticsearch (camelCase docs) or Postgres (rows). */
export interface SearchResponse {
  engine: 'elasticsearch' | 'postgres';
  items: Array<
    | EmailItem
    | {
        id: string;
        to: string;
        from: string;
        subject: string;
        status: EmailStatus;
        scheduledAt: string;
        sentAt: string | null;
      }
  >;
}

export interface CreateCampaignRequest {
  subject: string;
  body: string;
  leads: string[];
  startAt: string;
  delayMs: number;
  hourlyLimit: number;
}

export interface CreateCampaignResponse {
  scheduled: number;
  invalid: number;
  duplicates: number;
  replay: boolean;
  firstSendAt: string;
  lastSendAt: string;
}

export interface SlackStatus {
  configured: boolean;
  connected: boolean;
  team: string | null;
  channel: string | null;
}

export interface SenderInfo {
  id: string;
  name: string;
  email: string;
  sentThisHour: number;
}

export interface SendersResponse {
  limitPerHour: number;
  minDelayMs: number;
  items: SenderInfo[];
}

export interface AuthConfig {
  googleConfigured: boolean;
  devLogin: boolean;
}

export interface AppConfig {
  workerConcurrency: number;
  minDelayBetweenEmailsMs: number;
  maxEmailsPerHourPerSender: number;
}
