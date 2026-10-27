// Minimal Upstash Redis REST client (no dependency).
// Env vars are injected by the Upstash integration on the Vercel Marketplace.

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export async function redis<T = unknown>(...command: (string | number)[]): Promise<T> {
  if (!url || !token) throw new Error('Redis is not configured');
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command.map(String)),
  });
  const data = (await res.json()) as { result?: T; error?: string };
  if (!res.ok || data.error) throw new Error(data.error || `Redis HTTP ${res.status}`);
  return data.result as T;
}

export const keys = {
  booked: (showId: string) => `show:${showId}:booked`,
  perEmail: (showId: string) => `show:${showId}:emails`,
  /** List of reservation ids for the show, in booking order */
  reservations: (showId: string) => `show:${showId}:reservations`,
  reservation: (id: string) => `reservation:${id}`,
  /** Sorted set of unconfirmed reservation ids, scored by expiry timestamp (ms) */
  pending: 'reservations:pending',
};

export interface ReservationRecord {
  id: string;
  showId: string;
  name: string;
  email: string;
  quantity: number;
  createdAt: string;
  status: 'pending' | 'confirmed';
  /** Unconfirmed reservations are released after this timestamp (ms) */
  expiresAt: number;
  confirmedAt?: string;
  /** Secret used in the confirmation / cancellation links — never expose it in exports */
  token: string;
}

// Atomically checks capacity and the per-email limit, then holds the seats.
// Returns [status, remaining]: 1 = ok, -1 = email limit reached, -2 = not enough seats.
const RESERVE_SCRIPT = `
local qty = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local maxPerEmail = tonumber(ARGV[3])
local booked = tonumber(redis.call('GET', KEYS[1]) or '0')
local mine = tonumber(redis.call('HGET', KEYS[2], ARGV[4]) or '0')
if mine + qty > maxPerEmail then return {-1, maxPerEmail - mine} end
if booked + qty > capacity then return {-2, capacity - booked} end
redis.call('INCRBY', KEYS[1], qty)
redis.call('HINCRBY', KEYS[2], ARGV[4], qty)
redis.call('RPUSH', KEYS[3], ARGV[6])
redis.call('SET', KEYS[4], ARGV[5])
redis.call('ZADD', KEYS[5], ARGV[7], ARGV[6])
return {1, capacity - booked - qty}
`;

export async function reserveAtomic(params: {
  capacity: number;
  maxPerEmail: number;
  record: ReservationRecord;
}): Promise<{ status: number; remaining: number }> {
  const { capacity, maxPerEmail, record } = params;
  const [status, remaining] = await redis<[number, number]>(
    'EVAL',
    RESERVE_SCRIPT,
    5,
    keys.booked(record.showId),
    keys.perEmail(record.showId),
    keys.reservations(record.showId),
    keys.reservation(record.id),
    keys.pending,
    record.quantity,
    capacity,
    maxPerEmail,
    record.email,
    JSON.stringify(record),
    record.id,
    record.expiresAt
  );
  return { status, remaining };
}

/** Returns the record and its exact stored string (used for compare-and-swap). */
export async function getReservation(id: string): Promise<{ record: ReservationRecord; raw: string } | null> {
  const raw = await redis<string | null>('GET', keys.reservation(id));
  return raw ? { record: JSON.parse(raw) as ReservationRecord, raw } : null;
}

// Marks a pending reservation as confirmed, if it has not changed since it was read.
const CONFIRM_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
redis.call('ZREM', KEYS[2], ARGV[3])
return 1
`;

export async function confirmAtomic(raw: string, confirmed: ReservationRecord): Promise<boolean> {
  const result = await redis<number>(
    'EVAL',
    CONFIRM_SCRIPT,
    2,
    keys.reservation(confirmed.id),
    keys.pending,
    raw,
    JSON.stringify(confirmed),
    confirmed.id
  );
  return result === 1;
}

// Deletes a reservation and frees its seats (cancellation or expiry),
// if it has not changed since it was read. Returns 1 = released, 0 = already gone / changed.
const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('DEL', KEYS[1])
redis.call('LREM', KEYS[4], 0, ARGV[4])
redis.call('ZREM', KEYS[5], ARGV[4])
redis.call('DECRBY', KEYS[2], tonumber(ARGV[2]))
redis.call('HINCRBY', KEYS[3], ARGV[3], -tonumber(ARGV[2]))
return 1
`;

export async function releaseAtomic(raw: string, record: ReservationRecord): Promise<boolean> {
  const result = await redis<number>(
    'EVAL',
    RELEASE_SCRIPT,
    5,
    keys.reservation(record.id),
    keys.booked(record.showId),
    keys.perEmail(record.showId),
    keys.reservations(record.showId),
    keys.pending,
    raw,
    record.quantity,
    record.email,
    record.id
  );
  return result === 1;
}

/** Frees the seats of unconfirmed reservations whose confirmation delay has passed. */
export async function releaseExpired(): Promise<void> {
  const ids = await redis<string[]>('ZRANGEBYSCORE', keys.pending, '-inf', Date.now());
  for (const id of ids) {
    const found = await getReservation(id);
    if (!found) {
      await redis('ZREM', keys.pending, id);
    } else if (found.record.status === 'pending') {
      await releaseAtomic(found.raw, found.record);
    }
  }
}
