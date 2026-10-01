import { redis } from '../lib/redis';
import { env } from '../config/env';

/**
 * Minimum delay between two sends from the same sender, safe across workers.
 *
 * Each caller atomically *reserves* the next free send slot for the sender:
 *   slot = max(now, nextFree); nextFree = slot + minDelay
 * and then waits until its slot. With concurrency C, at most C jobs wait at a
 * time, so the longest wait is roughly C × minDelay.
 */
const RESERVE_SLOT_LUA = `
local now = tonumber(ARGV[1])
local gap = tonumber(ARGV[2])
local nextFree = tonumber(redis.call('GET', KEYS[1]) or '0')
local slot = now
if nextFree > now then slot = nextFree end
redis.call('SET', KEYS[1], slot + gap, 'PX', gap + 60000)
return slot - now
`;

export async function waitForSendSlot(senderId: string, minDelayMs = env.MIN_DELAY_BETWEEN_EMAILS_MS) {
  if (minDelayMs <= 0) return 0;
  const waitMs = (await redis.eval(
    RESERVE_SLOT_LUA,
    1,
    `throttle:sender:${senderId}`,
    Date.now(),
    minDelayMs,
  )) as number;
  if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
  return waitMs;
}
