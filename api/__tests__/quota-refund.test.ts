import { redisSkipReason } from './helpers/redis-env';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { checkSendQuota, refundSendQuota } from '../_lib/quota';
import { redis } from '../_lib/redis';
import { captureLogs } from './helpers/flow';
import { countFetch } from './helpers/fetch-count';

const T = Date.UTC(2031, 2, 10, 12, 0, 0);
const clock = { now: () => T };
const ADDRESS = 'jean@example.ch';
const DAY = 'quota:sent:2031-03-10';
const COOLDOWN = `quota:cooldown:${ADDRESS}`;

describe('refundSendQuota', { skip: redisSkipReason }, () => {
  beforeEach(async () => {
    await redis('FLUSHDB');
  });

  it('removes the cooldown and decrements the day counter after a request', async () => {
    assert.equal((await checkSendQuota('request', ADDRESS, clock)).ok, true);
    assert.equal(await refundSendQuota(ADDRESS, clock), true);
    assert.equal(await redis('EXISTS', COOLDOWN), 0);
    assert.equal(await redis('GET', DAY), '0');
  });

  it('never goes below the value reached by the first refund', async () => {
    await checkSendQuota('request', ADDRESS, clock);
    await refundSendQuota(ADDRESS, clock);
    await refundSendQuota(ADDRESS, clock);
    await refundSendQuota(ADDRESS, clock);
    assert.equal(await redis('GET', DAY), '0');
  });

  it('creates no key when the day counter is absent', async () => {
    assert.equal(await refundSendQuota(ADDRESS, clock), true);
    assert.equal(await redis('EXISTS', DAY), 0);
    assert.equal(await redis('EXISTS', COOLDOWN), 0);
  });

  it('leaves the cooldown of another address untouched', async () => {
    await checkSendQuota('request', ADDRESS, clock);
    await checkSendQuota('request', 'autre@example.ch', clock);
    await refundSendQuota(ADDRESS, clock);
    assert.equal(await redis('EXISTS', 'quota:cooldown:autre@example.ch'), 1);
    assert.equal(await redis('GET', DAY), '1');
  });

  it('refunds the day that was charged when the refund happens after UTC midnight', async () => {
    const before = Date.UTC(2031, 2, 10, 23, 59, 59, 900);
    await checkSendQuota('request', ADDRESS, { now: () => before });
    await refundSendQuota(ADDRESS, { now: () => before });
    assert.equal(await redis('GET', DAY), '0');
    assert.equal(await redis('EXISTS', 'quota:sent:2031-03-11'), 0);
  });

  it('lets the same address request again right after a refund', async () => {
    assert.equal((await checkSendQuota('request', ADDRESS, clock)).ok, true);
    const blocked = await checkSendQuota('request', ADDRESS, clock);
    assert.equal(blocked.ok, false);
    await refundSendQuota(ADDRESS, clock);
    const again = await checkSendQuota('request', ADDRESS, clock);
    assert.deepEqual(again, { ok: true, used: 1 });
  });

  it('returns false and logs no address when Redis fails', async () => {
    const logs = captureLogs();
    const real = globalThis.fetch;
    globalThis.fetch = async () => Response.json({ error: 'upstream failure' }, { status: 500 });
    try {
      assert.equal(await refundSendQuota(ADDRESS, clock), false);
      assert.ok(!logs.lines().includes('jean'));
      assert.match(logs.lines(), /send quota refund error/);
    } finally {
      globalThis.fetch = real;
      logs.restore();
    }
  });

  it('refuses an address-less key without any request', async () => {
    const counter = countFetch();
    try {
      assert.equal(await refundSendQuota('', clock), false);
      assert.equal(await refundSendQuota('nope', clock), false);
      assert.equal(counter.calls(), 0);
    } finally {
      counter.restore();
    }
  });

  it('uses exactly one HTTP call', async () => {
    const counter = countFetch();
    try {
      await refundSendQuota(ADDRESS, clock);
      assert.equal(counter.calls(), 1);
    } finally {
      counter.restore();
    }
  });
});
