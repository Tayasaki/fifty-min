import { redisSkipReason } from './helpers/redis-env';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ClaimInput, ClaimResult, claimAtomic, getReservation, keys, redis, releaseAtomic } from '../_lib/redis';
import { canonicalEmail } from '../_lib/guard';
import { fetchCallsOf } from './helpers/fetch-count';

const SHOW = 'show-a';
const FAR_FUTURE = 4102444800; // 2100-01-01 UTC
const NOW = Date.UTC(2030, 0, 1, 12, 0, 0);
const ISO = new Date(NOW).toISOString();
const clock = { now: () => NOW };

let counter = 0;
function input(overrides: Partial<ClaimInput> = {}): ClaimInput {
  counter += 1;
  const email = overrides.email ?? `user${counter}@example.ch`;
  return {
    id: String(counter).padStart(8, '0').replace(/0/g, 'A'),
    showId: SHOW,
    name: 'Test é',
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

function claim(overrides: Partial<ClaimInput> = {}, token?: () => string): Promise<ClaimResult> {
  return claimAtomic(input(overrides), { ...clock, ...(token ? { token } : {}) });
}

const booked = (showId = SHOW) => redis<string | null>('GET', keys.booked(showId));
const statuses = (results: ClaimResult[]) => results.map((r) => r.status);
const count = (results: ClaimResult[], status: string) => results.filter((r) => r.status === status).length;

describe('claimAtomic', { skip: redisSkipReason }, () => {
  beforeEach(async () => {
    await redis('FLUSHDB');
  });

  it('C1 claims the seats, stores a confirmed record and every counter', async () => {
    const i = input({ quantity: 2, email: 'Jean@Example.ch', name: 'Zoé Ñandú' });
    const result = await claimAtomic(i, clock);
    assert.equal(result.status, 'claimed');
    if (result.status !== 'claimed') return;
    assert.equal(result.remaining, 98);
    assert.equal(result.record.status, 'confirmed');
    assert.equal(result.record.confirmedAt, ISO);
    assert.equal(result.record.createdAt, ISO);
    assert.match(result.record.token, /^[0-9a-f]{32}$/);
    assert.equal(result.record.canonicalEmail, 'jean@example.ch');
    assert.equal(result.record.domain, 'example.ch');
    assert.equal(await booked(), '2');
    assert.equal(await redis('HGET', keys.perEmail(SHOW), 'jean@example.ch'), '2');
    assert.equal(await redis('HGET', keys.perDomain(SHOW), 'example.ch'), '2');
    assert.deepEqual(await redis('LRANGE', keys.reservations(SHOW), 0, -1), [i.id]);
    const stored = await redis<string>('GET', keys.reservation(i.id));
    assert.equal(stored, JSON.stringify(result.record));
    assert.deepEqual(JSON.parse(stored), result.record);
  });

  it('C2 refuses a request above the remaining capacity and leaves no trace', async () => {
    await claim({ quantity: 3, capacity: 5 });
    const i = input({ quantity: 3, capacity: 5 });
    assert.deepEqual(await claimAtomic(i, clock), { status: 'full', remaining: 2 });
    assert.equal(await redis('EXISTS', keys.reservation(i.id)), 0);
    assert.equal(await booked(), '3');
    assert.equal(await redis('LLEN', keys.reservations(SHOW)), 1);
  });

  it('C3 allows filling the show exactly, then refuses the next seat', async () => {
    await claim({ quantity: 4, capacity: 5 });
    const last = await claim({ quantity: 1, capacity: 5 });
    assert.equal(last.status, 'claimed');
    assert.deepEqual(await claim({ quantity: 1, capacity: 5 }), { status: 'full', remaining: 0 });
  });

  it('C4 enforces the per-email limit with the remaining allowance', async () => {
    const email = 'same@example.ch';
    await claim({ email, quantity: 3 });
    assert.deepEqual(await claim({ email, quantity: 2 }), { status: 'email-limit', remaining: 1 });
  });

  it('C5 reports a zero allowance once the per-email maximum is reached', async () => {
    const email = 'full@example.ch';
    await claim({ email, quantity: 4 });
    assert.deepEqual(await claim({ email, quantity: 1 }), { status: 'email-limit', remaining: 0 });
  });

  it('C6 counts the per-email limit per show', async () => {
    const email = 'multi@example.ch';
    await claim({ email, quantity: 4 });
    assert.equal((await claim({ email, quantity: 4, showId: 'show-b' })).status, 'claimed');
  });

  it('C7 aliases of one mailbox share a single counter, tag-only addresses do not', async () => {
    assert.equal((await claim({ email: 'A.B+x@Gmail.com', quantity: 2 })).status, 'claimed');
    assert.equal((await claim({ email: 'ab@googlemail.com', quantity: 2 })).status, 'claimed');
    assert.deepEqual(await claim({ email: 'a.b+y@gmail.com', quantity: 1 }), { status: 'email-limit', remaining: 0 });
    assert.equal((await claim({ email: '+a@x.com', quantity: 4 })).status, 'claimed');
    assert.equal((await claim({ email: '+b@x.com', quantity: 4 })).status, 'claimed');
    assert.equal(await redis('HGET', keys.perEmail(SHOW), '+a@x.com'), '4');
    assert.equal(await redis('HGET', keys.perEmail(SHOW), '+b@x.com'), '4');
  });

  it('C7 throws before any request for an empty or address-less canonical key', async () => {
    for (const bad of ['', 'noat', '@x.com', 'a@']) {
      let thrown: unknown;
      const calls = await fetchCallsOf(async () => {
        await claimAtomic(input({ email: 'secret.person@example.ch', canonicalEmail: bad }), clock).catch((e) => {
          thrown = e;
        });
      });
      assert.equal(calls, 0);
      assert.ok(thrown instanceof Error);
      assert.ok(!thrown.message.includes('secret.person'));
    }
  });

  it('C7 throws for a bad quantity or a non-integer expireAt before any request', async () => {
    const calls = await fetchCallsOf(async () => {
      await assert.rejects(claimAtomic(input({ quantity: 0 }), clock));
      await assert.rejects(claimAtomic(input({ quantity: 1.5 }), clock));
      await assert.rejects(claimAtomic(input({ expireAt: 4102444800.5 }), clock));
    });
    assert.equal(calls, 0);
  });

  it('C8 the email cap beats the domain cap', async () => {
    const email = 'a@corp.example';
    await claim({ email, quantity: 4, maxPerDomain: 4, capacity: 4 });
    assert.equal((await claim({ email, quantity: 1, maxPerDomain: 4, capacity: 4 })).status, 'email-limit');
  });

  it('C8 the domain cap beats the capacity', async () => {
    await claim({ email: 'a@corp.example', quantity: 3, maxPerDomain: 3, capacity: 3 });
    assert.equal((await claim({ email: 'b@corp.example', quantity: 1, maxPerDomain: 3, capacity: 3 })).status, 'domain-limit');
  });

  it('C8 capacity applies when no cap is reached', async () => {
    await claim({ quantity: 2, capacity: 2 });
    assert.equal((await claim({ quantity: 1, capacity: 2 })).status, 'full');
  });

  it('C9 stops a non-major domain at its seat cap and reports the remaining allowance', async () => {
    for (const n of [1, 2, 3]) assert.equal((await claim({ email: `u${n}@corp.example`, quantity: 4, maxPerDomain: 12 })).status, 'claimed');
    assert.deepEqual(await claim({ email: 'u4@corp.example', quantity: 1, maxPerDomain: 12 }), { status: 'domain-limit', remaining: 0 });
  });

  it('C9 does not cap a domain when maxPerDomain is 0', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, (_, n) => claim({ email: `u${n}@gmail.com`, maxPerDomain: 0 })));
    assert.equal(count(results, 'claimed'), 20);
  });

  it('C10 counts the domain cap per show', async () => {
    await claim({ email: 'a@corp.example', quantity: 4, maxPerDomain: 4 });
    assert.equal((await claim({ email: 'b@corp.example', quantity: 4, maxPerDomain: 4, showId: 'show-b' })).status, 'claimed');
  });

  it('C11 counts domain seats even when the cap is not enforced', async () => {
    await claim({ email: 'a@gmail.com', quantity: 2, maxPerDomain: 0 });
    await claim({ email: 'b@gmail.com', quantity: 3, maxPerDomain: 0 });
    assert.equal(await redis('HGET', keys.perDomain(SHOW), 'gmail.com'), '5');
  });

  it('C12 a second claim of an existing id returns the same record and changes nothing', async () => {
    const i = input({ quantity: 2 });
    const first = await claimAtomic(i, { ...clock, token: () => 'aa'.repeat(16) });
    const second = await claimAtomic(i, { now: () => NOW + 5000, token: () => 'bb'.repeat(16) });
    assert.equal(first.status, 'claimed');
    assert.equal(second.status, 'already-confirmed');
    if (first.status !== 'claimed' || second.status !== 'already-confirmed') return;
    assert.deepEqual(second.record, first.record);
    assert.equal(second.record.token, 'aa'.repeat(16));
    assert.equal(await booked(), '2');
    assert.equal(await redis('HGET', keys.perEmail(SHOW), i.canonicalEmail), '2');
    assert.equal(await redis('HGET', keys.perDomain(SHOW), 'example.ch'), '2');
    assert.equal(await redis('LLEN', keys.reservations(SHOW)), 1);
  });

  it('C13 five concurrent claims of one id claim exactly once', async () => {
    const i = input({ quantity: 2 });
    const results = await Promise.all(Array.from({ length: 5 }, () => claimAtomic(i, clock)));
    assert.equal(count(results, 'claimed'), 1);
    assert.equal(count(results, 'already-confirmed'), 4);
    assert.equal(await booked(), '2');
  });

  it('C14 an existing id still answers already-confirmed on a full show', async () => {
    const i = input({ quantity: 2, capacity: 2 });
    await claimAtomic(i, clock);
    assert.equal((await claimAtomic(i, clock)).status, 'already-confirmed');
    assert.equal((await claim({ capacity: 2 })).status, 'full');
  });

  it('C15 gives the last seat to exactly one of two concurrent claims', async () => {
    await claim({ quantity: 4, capacity: 10 });
    await claim({ quantity: 4, capacity: 10 });
    await claim({ quantity: 1, capacity: 10 });
    const results = await Promise.all([claim({ capacity: 10 }), claim({ capacity: 10 })]);
    assert.deepEqual(statuses(results).sort(), ['claimed', 'full']);
    assert.equal(await booked(), '10');
  });

  it('C16 never oversells under 20 concurrent single-seat claims', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => claim({ capacity: 5 })));
    assert.equal(count(results, 'claimed'), 5);
    assert.equal(count(results, 'full'), 15);
    assert.equal(await booked(), '5');
    assert.equal(await redis('LLEN', keys.reservations(SHOW)), 5);
  });

  it('C17 enforces the per-email maximum under concurrency', async () => {
    const email = 'race@example.ch';
    const results = await Promise.all(Array.from({ length: 10 }, () => claim({ email })));
    assert.equal(count(results, 'claimed'), 4);
    assert.equal(await redis('HGET', keys.perEmail(SHOW), email), '4');
  });

  it('C18 enforces the domain seat cap under concurrency', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, (_, n) => claim({ email: `u${n}@corp.example`, maxPerDomain: 12 })));
    assert.equal(count(results, 'claimed'), 12);
    assert.equal(count(results, 'domain-limit'), 8);
    assert.equal(await redis('HGET', keys.perDomain(SHOW), 'corp.example'), '12');
  });

  it('C19 answers closed without any request when expireAt is not in the future', async () => {
    const nowSeconds = NOW / 1000;
    for (const expireAt of [nowSeconds, nowSeconds - 1, 1_000_000_000]) {
      const i = input({ expireAt });
      const calls = await fetchCallsOf(async () => {
        assert.deepEqual(await claimAtomic(i, clock), { status: 'closed' });
      });
      assert.equal(calls, 0);
      assert.equal(await redis('EXISTS', keys.reservation(i.id)), 0);
    }
    assert.equal(await booked(), null);
  });

  it('C19 claims when expireAt is one second after now', async () => {
    assert.equal((await claim({ expireAt: NOW / 1000 + 1 })).status, 'claimed');
  });

  it('C20 uses the injected token generator and a 32-hex default', async () => {
    const a = await claim({}, () => 'a'.repeat(32));
    const b = await claim({}, () => 'b'.repeat(32));
    const c = await claim();
    assert.ok(a.status === 'claimed' && b.status === 'claimed' && c.status === 'claimed');
    if (a.status !== 'claimed' || b.status !== 'claimed' || c.status !== 'claimed') return;
    assert.notEqual(a.record.token, b.record.token);
    assert.match(c.record.token, /^[0-9a-f]{32}$/);
  });
});

describe('claimAtomic single round trip', { skip: redisSkipReason }, () => {
  beforeEach(async () => {
    await redis('FLUSHDB');
  });

  const measure = async (i: ClaimInput) => {
    let result: ClaimResult | undefined;
    const calls = await fetchCallsOf(async () => {
      result = await claimAtomic(i, clock);
    });
    return { calls, result };
  };

  it('C21 claimed, already-confirmed, full, email-limit, domain-limit and blocked each cost one request', async () => {
    const a = input({ email: 'a@corp.example', quantity: 4, capacity: 6, maxPerDomain: 5 });
    let m = await measure(a);
    assert.deepEqual([m.calls, m.result?.status], [1, 'claimed']);
    m = await measure(a);
    assert.deepEqual([m.calls, m.result?.status], [1, 'already-confirmed']);
    m = await measure(input({ email: 'b@corp.example', quantity: 3, capacity: 6, maxPerDomain: 0 }));
    assert.deepEqual([m.calls, m.result?.status], [1, 'full']);
    m = await measure(input({ email: 'a@corp.example', quantity: 1, capacity: 6, maxPerDomain: 5 }));
    assert.deepEqual([m.calls, m.result?.status], [1, 'email-limit']);
    m = await measure(input({ email: 'c@corp.example', quantity: 2, capacity: 6, maxPerDomain: 5 }));
    assert.deepEqual([m.calls, m.result?.status], [1, 'domain-limit']);
    await redis('SET', keys.tombstone('BLOCKED1'), '1');
    m = await measure(input({ id: 'BLOCKED1' }));
    assert.deepEqual([m.calls, m.result?.status], [1, 'blocked']);
  });
});

describe('getReservation', { skip: redisSkipReason }, () => {
  beforeEach(async () => {
    await redis('FLUSHDB');
  });

  it('returns the parsed record and the exact stored string', async () => {
    const result = await claim();
    assert.equal(result.status, 'claimed');
    if (result.status !== 'claimed') return;
    const found = await getReservation(result.record.id);
    assert.equal(found?.raw, JSON.stringify(result.record));
    assert.deepEqual(found?.record, result.record);
  });

  it('returns the cancelled record after a release', async () => {
    const result = await claim();
    if (result.status !== 'claimed') return assert.fail('claim failed');
    await releaseAtomic(JSON.stringify(result.record), result.record, FAR_FUTURE, clock);
    const found = await getReservation(result.record.id);
    assert.equal(found?.record.status, 'cancelled');
  });

  it('returns null for an unknown id', async () => {
    assert.equal(await getReservation('ZZZZZZZZ'), null);
  });
});
