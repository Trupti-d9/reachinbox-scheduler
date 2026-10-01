import type {
  AppConfig,
  AuthConfig,
  CreateCampaignRequest,
  CreateCampaignResponse,
  EmailItem,
  EmailListType,
  EmailStats,
  Paginated,
  SearchResponse,
  SendersResponse,
  SlackStatus,
  User,
} from './types';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  config: () => request<AppConfig>('/api/config'),
  authConfig: () => request<AuthConfig>('/api/auth/config'),
  me: () => request<{ user: User }>('/api/auth/me'),
  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  devLogin: (email: string, name: string) =>
    request<{ user: User }>('/api/auth/dev-login', { method: 'POST', body: JSON.stringify({ email, name }) }),

  listEmails: (type: EmailListType, page = 1, pageSize = 50) =>
    request<Paginated<EmailItem>>(`/api/emails?type=${type}&page=${page}&pageSize=${pageSize}`),
  stats: () => request<EmailStats>('/api/emails/stats'),
  search: (q: string, type?: EmailListType) =>
    request<SearchResponse>(`/api/emails/search?q=${encodeURIComponent(q)}${type ? `&type=${type}` : ''}`),
  cancelEmail: (id: string) => request<{ id: string }>(`/api/emails/${id}`, { method: 'DELETE' }),

  createCampaign: (body: CreateCampaignRequest, idempotencyKey: string) =>
    request<CreateCampaignResponse>('/api/campaigns', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Idempotency-Key': idempotencyKey },
    }),

  senders: () => request<SendersResponse>('/api/senders'),

  slackStatus: () => request<SlackStatus>('/api/slack/status'),
  slackTest: () => request<{ ok: boolean }>('/api/slack/test', { method: 'POST' }),
  slackDisconnect: () => request<{ ok: boolean }>('/api/slack', { method: 'DELETE' }),
};

/** Full-page navigations for OAuth flows (the backend does the redirects). */
export const oauthUrls = {
  google: '/api/auth/google',
  slack: '/api/slack/connect',
};
