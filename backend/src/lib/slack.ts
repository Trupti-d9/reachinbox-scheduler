import { query } from '../db/pool';
import { env } from '../config/env';
import { createLogger } from './logger';

const log = createLogger('slack');

export interface SlackConnection {
  user_id: string;
  team_id: string;
  team_name: string | null;
  channel_id: string | null;
  channel_name: string | null;
  webhook_url: string | null;
  access_token: string;
}

export const slackConfigured = () => !!(env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET);

export function slackRedirectUri() {
  return env.SLACK_REDIRECT_URI || `${env.BACKEND_URL}/api/slack/callback`;
}

export function buildSlackAuthorizeUrl(state: string) {
  const url = new URL('https://slack.com/oauth/v2/authorize');
  url.searchParams.set('client_id', env.SLACK_CLIENT_ID);
  // incoming-webhook lets the user pick the channel during install.
  url.searchParams.set('scope', 'incoming-webhook,chat:write');
  url.searchParams.set('redirect_uri', slackRedirectUri());
  url.searchParams.set('state', state);
  return url.toString();
}

/** Exchanges the OAuth code for a bot token + incoming webhook, and stores it. */
export async function completeSlackOAuth(userId: string, code: string) {
  const body = new URLSearchParams({
    client_id: env.SLACK_CLIENT_ID,
    client_secret: env.SLACK_CLIENT_SECRET,
    code,
    redirect_uri: slackRedirectUri(),
  });
  const res = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = (await res.json()) as {
    ok: boolean;
    error?: string;
    access_token: string;
    team: { id: string; name: string };
    incoming_webhook?: { channel: string; channel_id: string; url: string };
  };
  if (!data.ok) throw new Error(`Slack OAuth failed: ${data.error}`);

  await query(
    `INSERT INTO slack_connections (user_id, team_id, team_name, channel_id, channel_name, webhook_url, access_token)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (user_id) DO UPDATE SET team_id = EXCLUDED.team_id, team_name = EXCLUDED.team_name,
       channel_id = EXCLUDED.channel_id, channel_name = EXCLUDED.channel_name,
       webhook_url = EXCLUDED.webhook_url, access_token = EXCLUDED.access_token, created_at = now()`,
    [
      userId,
      data.team.id,
      data.team.name,
      data.incoming_webhook?.channel_id ?? null,
      data.incoming_webhook?.channel ?? null,
      data.incoming_webhook?.url ?? null,
      data.access_token,
    ],
  );
}

export async function getSlackConnection(userId: string) {
  const { rows } = await query<SlackConnection>('SELECT * FROM slack_connections WHERE user_id = $1', [userId]);
  return rows[0] ?? null;
}

export async function disconnectSlack(userId: string) {
  const conn = await getSlackConnection(userId);
  if (!conn) return;
  // Best effort: revoke the token on Slack's side too.
  fetch('https://slack.com/api/auth.revoke', {
    method: 'POST',
    headers: { Authorization: `Bearer ${conn.access_token}` },
  }).catch(() => undefined);
  await query('DELETE FROM slack_connections WHERE user_id = $1', [userId]);
}

/**
 * Sends a message to the user's connected Slack channel.
 * The connection is read from the DB at call time, so connecting/disconnecting
 * takes effect immediately — no restart or redeploy. Returns false (never throws)
 * when the user hasn't connected Slack.
 */
export async function notifySlack(userId: string, text: string, blocks?: unknown[]): Promise<boolean> {
  try {
    const conn = await getSlackConnection(userId);
    if (!conn) return false;

    let ok = false;
    if (conn.webhook_url) {
      const res = await fetch(conn.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, blocks }),
      });
      ok = res.ok;
    } else if (conn.channel_id) {
      const res = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${conn.access_token}` },
        body: JSON.stringify({ channel: conn.channel_id, text, blocks }),
      });
      ok = ((await res.json()) as { ok: boolean }).ok;
    }
    if (!ok) log.warn('Slack message was not accepted', { userId });
    return ok;
  } catch (err) {
    log.warn('Slack notify failed', { userId, err: String(err) });
    return false;
  }
}
