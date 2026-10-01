import IORedis, { RedisOptions } from 'ioredis';
import { env } from '../config/env';

/**
 * BullMQ requires `maxRetriesPerRequest: null` on connections used by workers
 * (blocking commands). We use the same options everywhere for simplicity.
 */
const options: RedisOptions = { maxRetriesPerRequest: null, enableReadyCheck: true };

export const createRedis = () => new IORedis(env.REDIS_URL, options);

/** Shared connection for app-level keys (rate-limit counters, throttle, dedupe). */
export const redis = createRedis();
