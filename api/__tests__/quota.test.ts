import { redisSkipReason } from './helpers/redis-env';
import { describe, it, beforeEach, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { QUOTA_MESSAGES, checkSendQuota } from '../_lib/quota';
import { ERR } from '../_lib/http';
import { canonicalEmail } from '../_lib/guard';
import { redis } from '../_lib/redis';
import { fetchCallsOf } from './helpers/fetch-count';

const T0 = Date.UTC(2030, 5, 15, 10, 0, 0);
const DAY_KEY = 'quota:sent:2030-06-15';
const NEXT_MIDNIGHT = Date.UTC(2030, 5, 16) / 1000;
const at = (ms: number) => ({ now: () => ms });

describe('checkSendQuota', { skip: redisSkipReason }, () => {
  beforeEach(async () => {
    await redis('FLUSHDB');
  });
  afterEach(() => mock.restoreAll());

  it('Q1 accepts the first request, sets a cooldown and a day counter that expires at midnight UTC', async () => {
    assert.deepEqual(await checkSendQuota('request', 'a@x.ch', at(T0)), { ok: true, used: 1 });
    const ttl = await redis<number>('TTL', 'quota:cooldown:a@x.ch');
    assert.ok(ttl >= 599 && ttl <= 600, String(ttl));
    assert.equal(await redis('EXPIRETIME', DAY_KEY), NEXT_MIDNIGHT);
  });

  it('Q2 refuses the same address during the cooldown without counting it', async () => {
    await checkSendQuota('request', 'a@x.ch', at(T0));
    const result = await checkSendQuota('request', 'a@x.ch', at(T0));
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, 'cooldown');
    assert.equal(result.message, QUOTA_MESSAGES.cooldown);
    assert.ok(result.retryAfterSeconds !== undefined && result.retryAfterSeconds >= 1 && result.retryAfterSeconds <= 600);
    assert.equal(await redis('GET', DAY_KEY), '1');
  });

  it('Q3 aliases of one mailbox share the cooldown', async () => {
    await checkSendQuota('request', canonicalEmail('a.b+x@gmail.com'), at(T0));
    const result = await checkSendQuota('request', canonicalEmail('ab@googlemail.com'), at(T0));
    assert.equal(result.ok, false);
  });

  it('Q4 different addresses are independent', async () => {
    assert.equal((await checkSendQuota('request', 'a@x.ch', at(T0))).ok, true);
    assert.equal((await checkSendQuota('request', 'b@x.ch', at(T0))).ok, true);
  });

  it('Q5 creates only quota keys, none naming a show', async () => {
    await checkSendQuota('request', 'a@x.ch', at(T0));
    const found = (await redis<[string, string[]]>('SCAN', 0, 'COUNT', 1000))[1].filter((k) => k !== '__fifty_min_test_db__').sort();
    assert.deepEqual(found, ['quota:cooldown:a@x.ch', DAY_KEY]);
  });

  it('Q6 refuses once the budget is reached and leaves no cooldown for the refused address', async () => {
    const deps = { ...at(T0), requestBudget: 3 };
    for (const n of [1, 2, 3]) assert.equal((await checkSendQuota('request', `u${n}@x.ch`, deps)).ok, true);
    const refused = await checkSendQuota('request', 'u4@x.ch', deps);
    assert.deepEqual([refused.ok, !refused.ok && refused.reason, !refused.ok && refused.message], [false, 'budget', QUOTA_MESSAGES.budget]);
    assert.equal(await redis('EXISTS', 'quota:cooldown:u4@x.ch'), 0);
    assert.equal(await redis('GET', DAY_KEY), '3');
  });

  it('Q7 recap and cancellation mails pass beyond the budget, count, and set no cooldown', async () => {
    const deps = { ...at(T0), requestBudget: 1 };
    await checkSendQuota('request', 'a@x.ch', deps);
    assert.deepEqual(await checkSendQuota('recap', 'b@x.ch', deps), { ok: true, used: 2 });
    assert.deepEqual(await checkSendQuota('cancellation', 'c@x.ch', deps), { ok: true, used: 3 });
    assert.equal(await redis('EXISTS', 'quota:cooldown:b@x.ch'), 0);
    assert.equal(await redis('EXISTS', 'quota:cooldown:c@x.ch'), 0);
  });

  it('Q8 counted recaps push the total to the budget so the next request is refused', async () => {
    const deps = { ...at(T0), requestBudget: 2 };
    await checkSendQuota('recap', 'a@x.ch', deps);
    await checkSendQuota('recap', 'b@x.ch', deps);
    const result = await checkSendQuota('request', 'c@x.ch', deps);
    assert.equal(!result.ok && result.reason, 'budget');
  });

  it('Q9 starts a fresh budget on the next UTC day while the old key expires at that midnight', async () => {
    const deps = { requestBudget: 1 };
    const late = Date.UTC(2030, 5, 15, 23, 59, 59, 0);
    assert.equal((await checkSendQuota('request', 'a@x.ch', { ...deps, ...at(late) })).ok, true);
    assert.equal((await checkSendQuota('request', 'b@x.ch', { ...deps, ...at(late) })).ok, false);
    const midnight = Date.UTC(2030, 5, 16, 0, 0, 0, 0);
    assert.deepEqual(await checkSendQuota('request', 'b@x.ch', { ...deps, ...at(midnight) }), { ok: true, used: 1 });
    assert.equal(await redis('EXPIRETIME', DAY_KEY), NEXT_MIDNIGHT);
    assert.equal(await redis('GET', 'quota:sent:2030-06-16'), '1');
  });

  it('Q10 23:59:59.999 belongs to the old day and 00:00:00.000 to the new one', async () => {
    await checkSendQuota('recap', 'a@x.ch', at(Date.UTC(2030, 5, 15, 23, 59, 59, 999)));
    await checkSendQuota('recap', 'a@x.ch', at(Date.UTC(2030, 5, 16, 0, 0, 0, 0)));
    assert.equal(await redis('GET', DAY_KEY), '1');
    assert.equal(await redis('GET', 'quota:sent:2030-06-16'), '1');
  });

  it('Q11 ten concurrent requests for one address let exactly one through', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => checkSendQuota('request', 'a@x.ch', at(T0))));
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(results.filter((r) => !r.ok && r.reason === 'cooldown').length, 9);
    assert.equal(await redis('GET', DAY_KEY), '1');
  });

  it('Q12 twenty concurrent distinct addresses never exceed a budget of five', async () => {
    const deps = { ...at(T0), requestBudget: 5 };
    const results = await Promise.all(Array.from({ length: 20 }, (_, n) => checkSendQuota('request', `u${n}@x.ch`, deps)));
    assert.equal(results.filter((r) => r.ok).length, 5);
    assert.equal(results.filter((r) => !r.ok && r.reason === 'budget').length, 15);
    assert.equal(await redis('GET', DAY_KEY), '5');
  });

  it('Q13 fails closed and keeps the address out of the logs when Redis answers 500', async () => {
    const logged: unknown[][] = [];
    mock.method(console, 'error', (...args: unknown[]) => {
      logged.push(args);
    });
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'boom' }), { status: 500 });
    try {
      const result = await checkSendQuota('request', 'secret.person@x.ch', at(T0));
      assert.deepEqual(result, { ok: false, reason: 'unavailable', message: ERR.UNAVAILABLE });
    } finally {
      globalThis.fetch = original;
    }
    assert.equal(logged.length, 1);
    assert.ok(!JSON.stringify(logged).includes('secret.person'));
  });

  it('Q14 refuses an empty or address-less key as invalid without any request', async () => {
    for (const bad of ['', 'noat', '@x.ch', 'a@']) {
      let result: Awaited<ReturnType<typeof checkSendQuota>> | undefined;
      const calls = await fetchCallsOf(async () => {
        result = await checkSendQuota('request', bad, at(T0));
      });
      assert.equal(calls, 0);
      assert.deepEqual(result, { ok: false, reason: 'invalid', message: 'Adresse email invalide' });
    }
  });

  it('Q15 pins the French messages', () => {
    assert.equal(QUOTA_MESSAGES.cooldown, 'Un email vous a déjà été envoyé. Patientez quelques minutes avant de refaire une demande et vérifiez vos courriers indésirables.');
    assert.equal(QUOTA_MESSAGES.budget, 'Le service d’envoi d’emails est saturé pour aujourd’hui. Merci de réessayer demain.');
    assert.equal(QUOTA_MESSAGES.invalid, 'Adresse email invalide');
  });

  it('Q16 every outcome costs exactly one request', async () => {
    const deps = { ...at(T0), requestBudget: 1 };
    assert.equal(await fetchCallsOf(() => checkSendQuota('request', 'a@x.ch', deps)), 1);
    assert.equal(await fetchCallsOf(() => checkSendQuota('request', 'a@x.ch', deps)), 1);
    assert.equal(await fetchCallsOf(() => checkSendQuota('request', 'b@x.ch', deps)), 1);
    assert.equal(await fetchCallsOf(() => checkSendQuota('recap', 'c@x.ch', deps)), 1);
  });

  it('Q17 defaults to a 600 s cooldown and a budget of 60', async () => {
    await checkSendQuota('request', 'a@x.ch', at(T0));
    assert.ok((await redis<number>('TTL', 'quota:cooldown:a@x.ch')) >= 599);
    for (let n = 0; n < 59; n++) assert.equal((await checkSendQuota('request', `u${n}@x.ch`, at(T0))).ok, true);
    const result = await checkSendQuota('request', 'last@x.ch', at(T0));
    assert.equal(!result.ok && result.reason, 'budget');
  });

  it('Q18 sets the day expiry on the first count only', async () => {
    await checkSendQuota('recap', 'a@x.ch', at(T0));
    const first = await redis('EXPIRETIME', DAY_KEY);
    await checkSendQuota('recap', 'b@x.ch', at(T0 + 3000));
    await checkSendQuota('recap', 'c@x.ch', at(T0 + 6000));
    assert.equal(first, NEXT_MIDNIGHT);
    assert.equal(await redis('EXPIRETIME', DAY_KEY), NEXT_MIDNIGHT);
  });

  it('Q19 uses no hidden wall clock when a clock is injected', async () => {
    mock.method(Date, 'now', () => {
      throw new Error('Date.now must not be called');
    });
    assert.equal((await checkSendQuota('request', 'a@x.ch', at(T0))).ok, true);
  });
});
