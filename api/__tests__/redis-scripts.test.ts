import { redisSkipReason } from './helpers/redis-env';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ReservationRecord, confirmAtomic, getReservation, keys, redis, releaseAtomic, reserveAtomic } from '../_lib/redis';

const SHOW = 'show-a';
const MAX = 4;
const EXPIRES = 1_900_000_000_000;

let counter = 0;
function record(overrides: Partial<ReservationRecord> = {}): ReservationRecord {
  counter += 1;
  const n = String(counter).padStart(8, '0').replace(/0/g, 'A');
  return {
    id: n,
    showId: SHOW,
    name: 'Test',
    email: `user${counter}@example.ch`,
    quantity: 1,
    createdAt: '2027-01-01T00:00:00.000Z',
    status: 'pending',
    expiresAt: EXPIRES,
    token: `token${counter}`,
    ...overrides,
  };
}

function reserve(rec: ReservationRecord, capacity = 100, maxPerEmail = MAX) {
  return reserveAtomic({ capacity, maxPerEmail, record: rec });
}

const booked = (showId = SHOW) => redis<string | null>('GET', keys.booked(showId));

describe('reserveAtomic', { skip: redisSkipReason }, () => {
  beforeEach(async () => {
    await redis('FLUSHDB');
  });

  it('holds the seats and writes every key on success', async () => {
    const rec = record({ quantity: 2 });
    assert.deepEqual(await reserve(rec, 5), { status: 1, remaining: 3 });
    assert.equal(await booked(), '2');
    assert.equal(await redis('HGET', keys.perEmail(SHOW), rec.email), '2');
    assert.deepEqual(await redis('LRANGE', keys.reservations(SHOW), 0, -1), [rec.id]);
    assert.equal(await redis('GET', keys.reservation(rec.id)), JSON.stringify(rec));
    assert.equal(await redis('ZSCORE', keys.pending, rec.id), String(rec.expiresAt));
  });

  it('rejects a request above the remaining capacity and leaves no trace', async () => {
    await reserve(record({ quantity: 3 }), 5);
    const b = record({ quantity: 3 });
    assert.deepEqual(await reserve(b, 5), { status: -2, remaining: 2 });
    assert.equal(await redis('EXISTS', keys.reservation(b.id)), 0);
    assert.equal(await booked(), '3');
  });

  it('allows filling the show exactly, then refuses the next seat', async () => {
    await reserve(record({ quantity: 4 }), 5);
    assert.deepEqual(await reserve(record({ quantity: 1 }), 5), { status: 1, remaining: 0 });
    assert.deepEqual(await reserve(record({ quantity: 1 }), 5), { status: -2, remaining: 0 });
  });

  it('enforces the per-email limit with the remaining allowance', async () => {
    const email = 'same@example.ch';
    await reserve(record({ email, quantity: 3 }));
    assert.deepEqual(await reserve(record({ email, quantity: 2 })), { status: -1, remaining: 1 });
  });

  it('reports a zero allowance once the per-email maximum is reached', async () => {
    const email = 'full@example.ch';
    await reserve(record({ email, quantity: 4 }));
    assert.deepEqual(await reserve(record({ email, quantity: 1 })), { status: -1, remaining: 0 });
  });

  it('counts the per-email limit per show', async () => {
    const email = 'multi@example.ch';
    await reserve(record({ email, quantity: 4 }));
    assert.deepEqual((await reserve(record({ email, quantity: 4, showId: 'show-b' }))).status, 1);
  });

  it('checks the email limit before the capacity (precedence pin)', async () => {
    const email = 'both@example.ch';
    await reserve(record({ email, quantity: 2 }), 3);
    assert.equal((await reserve(record({ email, quantity: 3 }), 3)).status, -1);
  });

  it('pins the weakness: addresses differing only by case count separately', async () => {
    await reserve(record({ email: 'A@x.ch', quantity: 4 }));
    assert.equal((await reserve(record({ email: 'a@x.ch', quantity: 4 }))).status, 1);
    assert.equal(await booked(), '8');
  });

  it('pins the weakness: re-reserving the same record id double-counts the seats', async () => {
    const rec = record();
    await reserve(rec);
    await reserve(rec);
    assert.equal(await booked(), '2');
    assert.deepEqual(await redis('LRANGE', keys.reservations(SHOW), 0, -1), [rec.id, rec.id]);
  });

  it('gives the last seat to exactly one of two concurrent requests', async () => {
    await reserve(record({ quantity: 4 }), 10);
    await reserve(record({ quantity: 4 }), 10);
    await reserve(record({ quantity: 1 }), 10);
    const results = await Promise.all([reserve(record(), 10), reserve(record(), 10)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [-2, 1]);
    assert.equal(await booked(), '10');
  });

  it('never oversells under 20 concurrent single-seat requests', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => reserve(record(), 5)));
    assert.equal(results.filter((r) => r.status === 1).length, 5);
    assert.equal(results.filter((r) => r.status === -2).length, 15);
    assert.equal(await booked(), '5');
    assert.equal(await redis('LLEN', keys.reservations(SHOW)), 5);
  });

  it('enforces the per-email maximum under concurrency', async () => {
    const email = 'race@example.ch';
    const results = await Promise.all(Array.from({ length: 10 }, () => reserve(record({ email }))));
    assert.equal(results.filter((r) => r.status === 1).length, 4);
    assert.equal(await redis('HGET', keys.perEmail(SHOW), email), '4');
  });
});

describe('confirmAtomic', { skip: redisSkipReason }, () => {
  beforeEach(async () => {
    await redis('FLUSHDB');
  });

  it('swaps the stored record and leaves the pending set and counters', async () => {
    const rec = record({ quantity: 2 });
    await reserve(rec);
    const raw = JSON.stringify(rec);
    const confirmed: ReservationRecord = { ...rec, status: 'confirmed', confirmedAt: '2027-01-02T00:00:00.000Z' };
    assert.equal(await confirmAtomic(raw, confirmed), true);
    assert.equal(await redis('GET', keys.reservation(rec.id)), JSON.stringify(confirmed));
    assert.equal(await redis('ZSCORE', keys.pending, rec.id), null);
    assert.equal(await booked(), '2');
    assert.equal(await redis('HGET', keys.perEmail(SHOW), rec.email), '2');
  });

  it('refuses when the stored value changed (compare-and-swap)', async () => {
    const rec = record();
    await reserve(rec);
    const confirmed: ReservationRecord = { ...rec, status: 'confirmed' };
    assert.equal(await confirmAtomic('{"stale":true}', confirmed), false);
    assert.equal(await redis('GET', keys.reservation(rec.id)), JSON.stringify(rec));
    assert.equal(await redis('ZSCORE', keys.pending, rec.id), String(rec.expiresAt));
  });

  it('returns false for a missing reservation (pin)', async () => {
    const rec = record();
    assert.equal(await confirmAtomic(JSON.stringify(rec), { ...rec, status: 'confirmed' }), false);
  });
});

describe('releaseAtomic', { skip: redisSkipReason }, () => {
  beforeEach(async () => {
    await redis('FLUSHDB');
  });

  it('deletes the record and frees the seats', async () => {
    const rec = record({ quantity: 3 });
    await reserve(rec);
    assert.equal(await releaseAtomic(JSON.stringify(rec), rec), true);
    assert.equal(await redis('EXISTS', keys.reservation(rec.id)), 0);
    assert.equal(await booked(), '0');
    assert.equal(await redis('HGET', keys.perEmail(SHOW), rec.email), '0');
    assert.deepEqual(await redis('LRANGE', keys.reservations(SHOW), 0, -1), []);
    assert.equal(await redis('ZSCORE', keys.pending, rec.id), null);
  });

  it('refuses when the stored value changed and keeps the counters', async () => {
    const rec = record({ quantity: 2 });
    await reserve(rec);
    assert.equal(await releaseAtomic('{"stale":true}', rec), false);
    assert.equal(await booked(), '2');
    assert.equal(await redis('EXISTS', keys.reservation(rec.id)), 1);
  });

  it('does not decrement twice when released twice', async () => {
    const keep = record({ quantity: 1 });
    const rec = record({ quantity: 2 });
    await reserve(keep);
    await reserve(rec);
    const raw = JSON.stringify(rec);
    assert.equal(await releaseAtomic(raw, rec), true);
    assert.equal(await releaseAtomic(raw, rec), false);
    assert.equal(await booked(), '1');
  });

  it('frees the seats of a confirmed reservation (cancel path)', async () => {
    const rec = record({ quantity: 2 });
    await reserve(rec);
    const confirmed: ReservationRecord = { ...rec, status: 'confirmed' };
    await confirmAtomic(JSON.stringify(rec), confirmed);
    assert.equal(await releaseAtomic(JSON.stringify(confirmed), confirmed), true);
    assert.equal(await booked(), '0');
  });
});

describe('getReservation', { skip: redisSkipReason }, () => {
  beforeEach(async () => {
    await redis('FLUSHDB');
  });

  it('returns the parsed record and the exact stored string', async () => {
    const rec = record();
    await reserve(rec);
    const found = await getReservation(rec.id);
    assert.equal(found?.raw, JSON.stringify(rec));
    assert.deepEqual(found?.record, rec);
  });

  it('returns null for an unknown id', async () => {
    assert.equal(await getReservation('ZZZZZZZZ'), null);
  });
});
