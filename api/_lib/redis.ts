import { randomBytes } from 'node:crypto';

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
  perDomain: (showId: string) => `show:${showId}:domains`,
  /** List of confirmed reservation ids for the show, in booking order */
  reservations: (showId: string) => `show:${showId}:reservations`,
  reservation: (id: string) => `reservation:${id}`,
  /** Written on cancellation; holds no personal data. A cancelled link can never claim again. */
  tombstone: (id: string) => `tombstone:${id}`,
};

export interface ReservationRecord {
  id: string;
  showId: string;
  name: string;
  email: string;
  canonicalEmail: string;
  /** Part of canonicalEmail after the last "@" */
  domain: string;
  quantity: number;
  createdAt: string;
  status: 'confirmed' | 'cancelled';
  confirmedAt: string;
  cancelledAt?: string;
  /** Secret used in the cancellation link — never expose it in exports */
  token: string;
}

/** Returns the record and its exact stored string (used for compare-and-swap). */
export async function getReservation(id: string): Promise<{ record: ReservationRecord; raw: string } | null> {
  const raw = await redis<string | null>('GET', keys.reservation(id));
  return raw ? { record: JSON.parse(raw) as ReservationRecord, raw } : null;
}

export interface ClaimState {
  booked: number;
  /** Seats already held by this canonical address */
  mine: number;
  /** Seats already held by this domain */
  theirs: number;
}

// Read-only snapshot used to refuse a request before any mail or quota is spent.
const CLAIM_STATE_SCRIPT = `
return {
  tonumber(redis.call('GET', KEYS[1]) or '0'),
  tonumber(redis.call('HGET', KEYS[2], ARGV[1]) or '0'),
  tonumber(redis.call('HGET', KEYS[3], ARGV[2]) or '0')
}
`;

export async function readClaimState(showId: string, canonicalEmail: string, domain: string): Promise<ClaimState> {
  const [booked, mine, theirs] = await redis<[number, number, number]>(
    'EVAL',
    CLAIM_STATE_SCRIPT,
    3,
    keys.booked(showId),
    keys.perEmail(showId),
    keys.perDomain(showId),
    canonicalEmail,
    domain
  );
  return { booked: Number(booked), mine: Number(mine), theirs: Number(theirs) };
}

/** One read for the preview of a signed link: the stored record (if any), its tombstone and the show counter. */
export async function readLinkState(
  id: string,
  showId: string
): Promise<{ record: ReservationRecord | null; tombstone: boolean; booked: number }> {
  const [raw, tomb, booked] = await redis<(string | null)[]>(
    'MGET',
    keys.reservation(id),
    keys.tombstone(id),
    keys.booked(showId)
  );
  return { record: raw ? (JSON.parse(raw) as ReservationRecord) : null, tombstone: tomb !== null, booked: Number(booked || 0) };
}

export interface ClaimInput {
  id: string;
  showId: string;
  name: string;
  email: string;
  canonicalEmail: string;
  quantity: number;
  capacity: number;
  maxPerEmail: number;
  /** 0 = not enforced */
  maxPerDomain: number;
  /** Epoch seconds at which every key written by the claim expires */
  expireAt: number;
}

export type ClaimResult =
  | { status: 'claimed'; record: ReservationRecord; remaining: number }
  | { status: 'already-confirmed'; record: ReservationRecord }
  /** Tombstone, cancelled record or unknown stored status */
  | { status: 'blocked' }
  | { status: 'email-limit' | 'domain-limit' | 'full'; remaining: number }
  /** expireAt is not in the future: nothing was written */
  | { status: 'closed' };

// Atomically claims seats for one reservation id. Replies [code, value]:
// 1 claimed (remaining), 2 already confirmed (stored JSON), -1 email cap, -2 full, -3 blocked, -4 domain cap.
// An EXPIREAT in the past would delete the key, which is why the caller refuses a past expireAt.
const CLAIM_SCRIPT = `
if redis.call('EXISTS', KEYS[2]) == 1 then return {-3, ''} end
local existing = redis.call('GET', KEYS[1])
if existing then
  if cjson.decode(existing).status == 'confirmed' then return {2, existing} end
  return {-3, ''}
end
local qty = tonumber(ARGV[1])
local booked = tonumber(redis.call('GET', KEYS[3]) or '0')
local mine = tonumber(redis.call('HGET', KEYS[4], ARGV[5]) or '0')
if mine + qty > tonumber(ARGV[3]) then return {-1, tonumber(ARGV[3]) - mine} end
local cap = tonumber(ARGV[4])
if cap > 0 then
  local theirs = tonumber(redis.call('HGET', KEYS[5], ARGV[6]) or '0')
  if theirs + qty > cap then return {-4, cap - theirs} end
end
if booked + qty > tonumber(ARGV[2]) then return {-2, tonumber(ARGV[2]) - booked} end
redis.call('INCRBY', KEYS[3], qty)
redis.call('HINCRBY', KEYS[4], ARGV[5], qty)
redis.call('HINCRBY', KEYS[5], ARGV[6], qty)
redis.call('RPUSH', KEYS[6], ARGV[8])
redis.call('SET', KEYS[1], ARGV[7])
for _, i in ipairs({1, 3, 4, 5, 6}) do redis.call('EXPIREAT', KEYS[i], ARGV[9]) end
return {1, tonumber(ARGV[2]) - booked - qty}
`;

export async function claimAtomic(
  input: ClaimInput,
  deps: { now?: () => number; token?: () => string } = {}
): Promise<ClaimResult> {
  const now = deps.now ?? Date.now;
  const at = input.canonicalEmail.lastIndexOf('@');
  if (at < 1 || at === input.canonicalEmail.length - 1) throw new Error('claimAtomic: invalid canonical email');
  if (!Number.isInteger(input.quantity) || input.quantity < 1) throw new Error('claimAtomic: invalid quantity');
  if (!Number.isInteger(input.expireAt)) throw new Error('claimAtomic: invalid expireAt');
  if (input.expireAt <= now() / 1000) return { status: 'closed' };

  const timestamp = new Date(now()).toISOString();
  const record: ReservationRecord = {
    id: input.id,
    showId: input.showId,
    name: input.name,
    email: input.email,
    canonicalEmail: input.canonicalEmail,
    domain: input.canonicalEmail.slice(at + 1),
    quantity: input.quantity,
    createdAt: timestamp,
    status: 'confirmed',
    confirmedAt: timestamp,
    token: deps.token ? deps.token() : randomBytes(16).toString('hex'),
  };

  const [code, value] = await redis<[number, number | string]>(
    'EVAL',
    CLAIM_SCRIPT,
    6,
    keys.reservation(input.id),
    keys.tombstone(input.id),
    keys.booked(input.showId),
    keys.perEmail(input.showId),
    keys.perDomain(input.showId),
    keys.reservations(input.showId),
    input.quantity,
    input.capacity,
    input.maxPerEmail,
    input.maxPerDomain,
    input.canonicalEmail,
    record.domain,
    JSON.stringify(record),
    input.id,
    input.expireAt
  );
  switch (code) {
    case 1:
      return { status: 'claimed', record, remaining: Number(value) };
    case 2:
      return { status: 'already-confirmed', record: JSON.parse(String(value)) as ReservationRecord };
    case -1:
      return { status: 'email-limit', remaining: Number(value) };
    case -2:
      return { status: 'full', remaining: Number(value) };
    case -4:
      return { status: 'domain-limit', remaining: Number(value) };
    default:
      return { status: 'blocked' };
  }
}

export type ReleaseResult = 'released' | 'already-cancelled' | 'not-found';

// Cancels a confirmed reservation if it has not changed since it was read: keeps the record as
// "cancelled", writes the tombstone, frees the seats. A plain SET clears a TTL, so EXPIREAT is re-applied.
// Replies 1 released, 2 already cancelled, 0 not found / changed.
const RELEASE_SCRIPT = `
local cur = redis.call('GET', KEYS[1])
if not cur then return 0 end
if cjson.decode(cur).status == 'cancelled' then return 2 end
if cur ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2]);  redis.call('EXPIREAT', KEYS[1], ARGV[7])
redis.call('SET', KEYS[2], '1');      redis.call('EXPIREAT', KEYS[2], ARGV[7])
redis.call('DECRBY', KEYS[3], tonumber(ARGV[3]))
redis.call('HINCRBY', KEYS[4], ARGV[4], -tonumber(ARGV[3]))
redis.call('HINCRBY', KEYS[5], ARGV[5], -tonumber(ARGV[3]))
redis.call('LREM', KEYS[6], 0, ARGV[6])
return 1
`;

export async function releaseAtomic(
  raw: string,
  record: ReservationRecord,
  expireAt: number,
  deps: { now?: () => number } = {}
): Promise<ReleaseResult> {
  if (!Number.isInteger(expireAt)) throw new Error('releaseAtomic: invalid expireAt');
  const now = deps.now ?? Date.now;
  const cancelled: ReservationRecord = { ...record, status: 'cancelled', cancelledAt: new Date(now()).toISOString() };
  const result = await redis<number>(
    'EVAL',
    RELEASE_SCRIPT,
    6,
    keys.reservation(record.id),
    keys.tombstone(record.id),
    keys.booked(record.showId),
    keys.perEmail(record.showId),
    keys.perDomain(record.showId),
    keys.reservations(record.showId),
    raw,
    JSON.stringify(cancelled),
    record.quantity,
    record.canonicalEmail,
    record.domain,
    record.id,
    expireAt
  );
  return result === 1 ? 'released' : result === 2 ? 'already-cancelled' : 'not-found';
}
