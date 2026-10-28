import { redisSkipReason } from './helpers/redis-env';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ClaimInput, ReleaseResult, ReservationRecord, claimAtomic, getReservation, keys, redis, releaseAtomic } from '../_lib/redis';
import { canonicalEmail } from '../_lib/guard';
import { fetchCallsOf } from './helpers/fetch-count';

const SHOW = 'show-a';
const FAR_FUTURE = 4102444800;
const NOW = Date.UTC(2030, 0, 1, 12, 0, 0);
const clock = { now: () => NOW };

let counter = 0;
function input(overrides: Partial<ClaimInput> = {}): ClaimInput {
  counter += 1;
  const email = overrides.email ?? `user${counter}@example.ch`;
  return {
    id: `LC${String(counter).padStart(6, '0')}`,
    showId: SHOW,
    name: 'Test',
    email,
    canonicalEmail: canonicalEmail(email),
    quantity: 1,
    capacity: 100,
    maxPerEmail: 4,
    maxPerDomain: 0,
    expireAt: FAR_FUTURE,
    ...overrides,
  };
}

async function claimed(overrides: Partial<ClaimInput> = {}): Promise<ReservationRecord> {
  const result = await claimAtomic(input(overrides), clock);
  assert.equal(result.status, 'claimed');
  if (result.status !== 'claimed') throw new Error('claim failed');
  return result.record;
}

const release = (record: ReservationRecord, raw = JSON.stringify(record), expireAt = FAR_FUTURE): Promise<ReleaseResult> =>
  releaseAtomic(raw, record, expireAt, clock);
const booked = (showId = SHOW) => redis<string | null>('GET', keys.booked(showId));

describe('releaseAtomic', { skip: redisSkipReason }, () => {
  beforeEach(async () => {
    await redis('FLUSHDB');
  });

  it('R1 cancels the record, frees every counter, writes the tombstone and re-applies the expiry', async () => {
    const rec = await claimed({ quantity: 3, email: 'r1@corp.example' });
    assert.equal(await release(rec), 'released');
    const stored = JSON.parse(await redis<string>('GET', keys.reservation(rec.id)));
    assert.deepEqual(stored, { ...rec, status: 'cancelled', cancelledAt: new Date(NOW).toISOString() });
    assert.equal(stored.token, rec.token);
    assert.equal(await booked(), '0');
    assert.equal(await redis('HGET', keys.perEmail(SHOW), rec.canonicalEmail), '0');
    assert.equal(await redis('HGET', keys.perDomain(SHOW), 'corp.example'), '0');
    assert.deepEqual(await redis('LRANGE', keys.reservations(SHOW), 0, -1), []);
    assert.equal(await redis('EXISTS', keys.tombstone(rec.id)), 1);
    assert.equal(await redis('EXPIRETIME', keys.reservation(rec.id)), FAR_FUTURE);
    assert.equal(await redis('EXPIRETIME', keys.tombstone(rec.id)), FAR_FUTURE);
  });

  it('R2 refuses a stale raw value on a confirmed record', async () => {
    const rec = await claimed({ quantity: 2 });
    assert.equal(await release(rec, '{"stale":true}'), 'not-found');
    assert.equal(await booked(), '2');
    assert.equal(await redis('EXISTS', keys.tombstone(rec.id)), 0);
  });

  it('R3 answers not-found for a missing record and writes no tombstone', async () => {
    const rec = await claimed();
    await redis('DEL', keys.reservation(rec.id));
    assert.equal(await release(rec), 'not-found');
    assert.equal(await redis('EXISTS', keys.tombstone(rec.id)), 0);
  });

  it('R4 a second release is already-cancelled and decrements once', async () => {
    const keep1 = await claimed();
    const keep2 = await claimed();
    const rec = await claimed({ quantity: 2 });
    const raw = JSON.stringify(rec);
    assert.equal(await release(rec, raw), 'released');
    assert.equal(await release(rec, raw), 'already-cancelled');
    const cancelled = (await getReservation(rec.id))!;
    assert.equal(await release(cancelled.record, cancelled.raw), 'already-cancelled');
    assert.equal(await booked(), '2');
    assert.equal(await redis('HGET', keys.perEmail(SHOW), keep1.canonicalEmail), '1');
    assert.equal(await redis('HGET', keys.perEmail(SHOW), keep2.canonicalEmail), '1');
  });

  it('R5 five concurrent releases cancel exactly once', async () => {
    await claimed();
    const rec = await claimed({ quantity: 2 });
    const results = await Promise.all(Array.from({ length: 5 }, () => release(rec)));
    assert.equal(results.filter((r) => r === 'released').length, 1);
    assert.equal(results.filter((r) => r === 'already-cancelled').length, 4);
    assert.equal(await booked(), '1');
  });

  it('R6 keeps counters and list order right when the middle reservation is cancelled', async () => {
    const first = await claimed({ quantity: 1 });
    const middle = await claimed({ quantity: 2 });
    const third = await claimed({ quantity: 3 });
    assert.equal(await release(middle), 'released');
    assert.equal(await booked(), '4');
    assert.equal(await redis('HGET', keys.perEmail(SHOW), middle.canonicalEmail), '0');
    assert.equal(await redis('HGET', keys.perEmail(SHOW), third.canonicalEmail), '3');
    assert.deepEqual(await redis('LRANGE', keys.reservations(SHOW), 0, -1), [first.id, third.id]);
  });

  it('R7 releasing everything in a shuffled order ends at zero and never goes negative', async () => {
    const records: ReservationRecord[] = [];
    for (const quantity of [1, 2, 3, 4, 2, 1]) records.push(await claimed({ quantity }));
    for (const index of [3, 0, 5, 1, 4, 2]) {
      assert.equal(await release(records[index]), 'released');
      assert.ok(Number(await booked()) >= 0);
    }
    assert.equal(await booked(), '0');
    for (const rec of records) assert.equal(await redis('HGET', keys.perEmail(SHOW), rec.canonicalEmail), '0');
  });

  it('R8 a cancel in one show leaves the other show untouched', async () => {
    const a = await claimed({ quantity: 2 });
    await claimed({ quantity: 3, showId: 'show-b' });
    await release(a);
    assert.equal(await booked('show-b'), '3');
    assert.equal(await redis('LLEN', keys.reservations('show-b')), 1);
  });

  it('R9 freed seats, email allowance and domain allowance can be claimed again', async () => {
    const email = 'r9@corp.example';
    const rec = await claimed({ email, quantity: 4, capacity: 4, maxPerDomain: 4 });
    const blocked = await claimAtomic(input({ email, quantity: 1, capacity: 4, maxPerDomain: 4 }), clock);
    assert.equal(blocked.status, 'email-limit');
    await release(rec);
    const again = await claimAtomic(input({ email, quantity: 4, capacity: 4, maxPerDomain: 4 }), clock);
    assert.equal(again.status, 'claimed');
  });

  it('R10 a claim with a cancelled id is blocked and changes nothing', async () => {
    const i = input({ quantity: 2 });
    const first = await claimAtomic(i, clock);
    assert.equal(first.status, 'claimed');
    if (first.status !== 'claimed') return;
    await release(first.record);
    assert.deepEqual(await claimAtomic(i, clock), { status: 'blocked' });
    assert.equal(await booked(), '0');
  });

  it('R11 the tombstone alone blocks a claim', async () => {
    const i = input();
    const first = await claimAtomic(i, clock);
    if (first.status !== 'claimed') return assert.fail('claim failed');
    await release(first.record);
    await redis('DEL', keys.reservation(i.id));
    assert.deepEqual(await claimAtomic(i, clock), { status: 'blocked' });
  });

  it('R12 the cancelled record alone blocks a claim', async () => {
    const i = input();
    const first = await claimAtomic(i, clock);
    if (first.status !== 'claimed') return assert.fail('claim failed');
    await release(first.record);
    await redis('DEL', keys.tombstone(i.id));
    assert.deepEqual(await claimAtomic(i, clock), { status: 'blocked' });
  });

  it('R13 a record with an unknown status blocks a claim and is not overwritten', async () => {
    const i = input();
    const legacy = JSON.stringify({ id: i.id, status: 'pending' });
    await redis('SET', keys.reservation(i.id), legacy);
    assert.deepEqual(await claimAtomic(i, clock), { status: 'blocked' });
    assert.equal(await redis('GET', keys.reservation(i.id)), legacy);
    assert.equal(await booked(), null);
  });

  it('R14 every key written by a claim expires at expireAt, and no tombstone exists yet', async () => {
    const rec = await claimed({ quantity: 2 });
    for (const key of [keys.reservation(rec.id), keys.booked(SHOW), keys.perEmail(SHOW), keys.perDomain(SHOW), keys.reservations(SHOW)]) {
      assert.equal(await redis('EXPIRETIME', key), FAR_FUTURE, key);
    }
    assert.equal(await redis('EXISTS', keys.tombstone(rec.id)), 0);
  });

  it('R15 released, already-cancelled and not-found each cost one request', async () => {
    const rec = await claimed();
    const raw = JSON.stringify(rec);
    assert.equal(await fetchCallsOf(() => release(rec, raw)), 1);
    assert.equal(await fetchCallsOf(() => release(rec, raw)), 1);
    const ghost = { ...rec, id: 'GHOST001' };
    assert.equal(await fetchCallsOf(() => release(ghost)), 1);
    assert.equal(await release(ghost), 'not-found');
  });

  it('R16 keeps every counter consistent over 300 random claims and releases', async () => {
    let seed = 20271027;
    const random = (n: number) => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return Math.floor((seed / 4294967296) * n);
    };
    const shows = ['inv-1', 'inv-2', 'inv-3'];
    const domains = ['gmail.com', 'corp.example', 'school.example'];
    const live: ReservationRecord[] = [];
    for (let step = 0; step < 300; step++) {
      if (live.length > 0 && random(3) === 0) {
        const [rec] = live.splice(random(live.length), 1);
        assert.equal(await release(rec), 'released');
      } else {
        const email = `p${random(12)}@${domains[random(domains.length)]}`;
        const result = await claimAtomic(
          input({ showId: shows[random(shows.length)], email, quantity: 1 + random(3), capacity: 15, maxPerDomain: 8 }),
          clock
        );
        if (result.status === 'claimed') live.push(result.record);
      }
    }
    for (const showId of shows) {
      const mine = live.filter((r) => r.showId === showId);
      const total = mine.reduce((sum, r) => sum + r.quantity, 0);
      const sumHash = async (key: string) =>
        Object.values(await redis<string[]>('HGETALL', key).then(pairs => Object.fromEntries(chunk(pairs)))).reduce((s, v) => s + Number(v), 0);
      assert.equal(Number((await booked(showId)) ?? 0), total, `${showId} booked`);
      assert.equal(await sumHash(keys.perEmail(showId)), total, `${showId} emails`);
      assert.equal(await sumHash(keys.perDomain(showId)), total, `${showId} domains`);
      const ids = await redis<string[]>('LRANGE', keys.reservations(showId), 0, -1);
      assert.deepEqual([...ids].sort(), mine.map((r) => r.id).sort());
      const stored = await Promise.all(ids.map((id) => getReservation(id)));
      assert.equal(stored.reduce((s, f) => s + (f?.record.quantity ?? 0), 0), total);
      const hashValues = [...(await redis<string[]>('HVALS', keys.perEmail(showId))), ...(await redis<string[]>('HVALS', keys.perDomain(showId)))];
      for (const value of hashValues) assert.ok(Number(value) >= 0);
    }
  });
});

function chunk(pairs: string[]): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (let i = 0; i < pairs.length; i += 2) out.push([pairs[i], pairs[i + 1]]);
  return out;
}
