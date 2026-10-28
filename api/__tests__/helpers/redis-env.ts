// Import this first in every Redis test file: api/_lib/redis.ts reads its env at module load.
import { SHIM_TOKEN, SHIM_URL, installRedisShim } from './redis-rest-shim';

process.env.KV_REST_API_URL = SHIM_URL;
process.env.KV_REST_API_TOKEN = SHIM_TOKEN;

export const redisSkipReason: string | false = process.env.REDIS_TEST_SKIP_REASON || false;

if (!redisSkipReason) installRedisShim(process.env.REDIS_TEST_URL || 'redis://127.0.0.1:6390');
