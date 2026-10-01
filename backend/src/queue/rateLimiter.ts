import { redis } from '../lib/redis';
import { env } from '../config/env';

/**
 * Hourly rate limiting, shared by every worker process via Redis.
 *
 * We keep fixed-window counters keyed by (scope, window):
 *   rl:sender:{senderId}:{window}      — limit MAX_EMAILS_PER_HOUR_PER_SENDER (env)
 *   rl:campaign:{campaignId}:{window}  — limit = the "hourly limit" set in Compose
 *
 * The check-and-increment is a single Lua script, so it is atomic even with many
 * workers on many machines — two jobs can never both take the last slot.
 */
const RESERVE_LUA = `
local s = tonumber(redis.call('GET', KEYS[1]) or '0')
local c = tonumber(redis.call('GET', KEYS[2]) or '0')
if s >= tonumber(ARGV[1]) then return 1 end
if c >= tonumber(ARGV[2]) then return 2 end
redis.call('INCR', KEYS[1]); redis.call('PEXPIRE', KEYS[1], ARGV[3])
redis.call('INCR', KEYS[2]); redis.call('PEXPIRE', KEYS[2], ARGV[3])
return 0
`;

export type ReserveResult =
  | { ok: true; window: number }
  | { ok: false; window: number; scope: 'sender' | 'campaign'; retryAt: number };

export const windowOf = (ts: number) => Math.floor(ts / env.RATE_LIMIT_WINDOW_MS);
export const windowStart = (w: number) => w * env.RATE_LIMIT_WINDOW_MS;

const senderKey = (senderId: string, w: number) => `rl:sender:${senderId}:${w}`;
const campaignKey = (campaignId: string, w: number) => `rl:campaign:${campaignId}:${w}`;

export async function reserveSendSlot(params: {
  senderId: string;
  campaignId: string;
  campaignLimit: number;
  now?: number;
}): Promise<ReserveResult> {
  const now = params.now ?? Date.now();
  const w = windowOf(now);
  const ttl = env.RATE_LIMIT_WINDOW_MS * 2;
  const res = (await redis.eval(
    RESERVE_LUA,
    2,
    senderKey(params.senderId, w),
    campaignKey(params.campaignId, w),
    env.MAX_EMAILS_PER_HOUR_PER_SENDER,
    params.campaignLimit,
    ttl,
  )) as number;

  if (res === 0) return { ok: true, window: w };

  // Limit hit: push into the next window. Each overflowing job takes the next
  // sequence number for that window, so jobs keep the order in which they
  // overflowed (≈ their original schedule order) and are spread out by the
  // minimum delay instead of stampeding at the top of the hour.
  const scope = res === 1 ? 'sender' : 'campaign';
  const scopeId = scope === 'sender' ? params.senderId : params.campaignId;
  const seqKey = `rl:overflow:${scope}:${scopeId}:${w + 1}`;
  const seq = await redis.incr(seqKey);
  await redis.pexpire(seqKey, ttl);
  const spacing = Math.max(env.MIN_DELAY_BETWEEN_EMAILS_MS, 1000);
  const retryAt = windowStart(w + 1) + (seq - 1) * spacing;
  return { ok: false, window: w, scope, retryAt };
}

/** Give a reserved slot back (used when the SMTP send itself fails). */
export async function releaseSendSlot(senderId: string, campaignId: string, w: number) {
  await redis
    .multi()
    .decr(senderKey(senderId, w))
    .decr(campaignKey(campaignId, w))
    .exec();
}

/** Read-only usage numbers for the dashboard. */
export async function getSenderUsage(senderIds: string[]) {
  if (!senderIds.length) return {};
  const w = windowOf(Date.now());
  const vals = await redis.mget(senderIds.map((id) => senderKey(id, w)));
  return Object.fromEntries(senderIds.map((id, i) => [id, Number(vals[i] ?? 0)]));
}

/**
 * Returns true only for the first caller in a window, so we notify Slack once
 * per (user, sender, window) instead of once per rate-limited job.
 */
export async function shouldNotifyRateLimit(userId: string, scopeKey: string, w: number) {
  const key = `rl:notified:${userId}:${scopeKey}:${w}`;
  const set = await redis.set(key, '1', 'PX', env.RATE_LIMIT_WINDOW_MS * 2, 'NX');
  return set === 'OK';
}
