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
  reservations: (showId: string) => `show:${showId}:reservations`,
  reservation: (id: string) => `reservation:${id}`,
};

export interface ReservationRecord {
  id: string;
  showId: string;
  name: string;
  email: string;
  quantity: number;
  createdAt: string;
  /** Secret used in the cancellation link — never expose it in exports */
  cancelToken: string;
}

// Atomically checks capacity and the per-email limit, then records the reservation.
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
redis.call('RPUSH', KEYS[3], ARGV[5])
redis.call('SET', KEYS[4], ARGV[5])
return {1, capacity - booked - qty}
`;

export async function reserveAtomic(params: {
  quantity: number;
  capacity: number;
  maxPerEmail: number;
  record: ReservationRecord;
}): Promise<{ status: number; remaining: number }> {
  const { quantity, capacity, maxPerEmail, record } = params;
  const [status, remaining] = await redis<[number, number]>(
    'EVAL',
    RESERVE_SCRIPT,
    4,
    keys.booked(record.showId),
    keys.perEmail(record.showId),
    keys.reservations(record.showId),
    keys.reservation(record.id),
    quantity,
    capacity,
    maxPerEmail,
    record.email,
    JSON.stringify(record)
  );
  return { status, remaining };
}

export async function getReservation(id: string): Promise<ReservationRecord | null> {
  const raw = await redis<string | null>('GET', keys.reservation(id));
  return raw ? (JSON.parse(raw) as ReservationRecord) : null;
}

// Atomically releases the seats of a reservation. The stored string is the exact
// list entry, so LREM removes it from the export list.
// Returns 1 = cancelled, 0 = not found / already cancelled.
const CANCEL_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
redis.call('DEL', KEYS[1])
redis.call('LREM', KEYS[4], 1, raw)
redis.call('DECRBY', KEYS[2], tonumber(ARGV[1]))
redis.call('HINCRBY', KEYS[3], ARGV[2], -tonumber(ARGV[1]))
return 1
`;

export async function cancelAtomic(record: ReservationRecord): Promise<boolean> {
  const result = await redis<number>(
    'EVAL',
    CANCEL_SCRIPT,
    4,
    keys.reservation(record.id),
    keys.booked(record.showId),
    keys.perEmail(record.showId),
    keys.reservations(record.showId),
    record.quantity,
    record.email
  );
  return result === 1;
}
