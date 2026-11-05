import { redisSkipReason } from './helpers/redis-env';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalEmail } from '../_lib/guard';
import { claimAtomic, keys, readBooked, readLinkState, redis, releaseAtomic, type ClaimInput } from '../_lib/redis';
import { countFetch } from './helpers/fetch-count';
import { keyList, snapshot } from './helpers/flow';

const SHOW = 'reads-2100-show';
const FAR = 4_102_444_800;
const clock = { now: () => Date.UTC(2031, 0, 1) };

function input(email: string, quantity: number, id: string): ClaimInput {
  return { id, showId: SHOW, name: 'T', email, canonicalEmail: canonicalEmail(email), quantity, capacity: 100, maxPerEmail: 4, maxPerDomain: 0, expireAt: FAR };
}

describe('readBooked and readLinkState', { skip: redisSkipReason }, () => {
  beforeEach(async () => {
    await redis('FLUSHDB');
  });

  it('readBooked is zero on an empty database', async () => {
    assert.equal(await readBooked(SHOW), 0);
  });

  it('readBooked reports the show counter after claims', async () => {
    await claimAtomic(input('a@x.ch', 3, 'AAAAAAA1'), clock);
    await claimAtomic(input('b@x.ch', 2, 'AAAAAAA2'), clock);
    assert.equal(await readBooked(SHOW), 5);
    assert.equal(await readBooked('another-show'), 0);
  });

  it('readBooked reflects a release', async () => {
    const claim = await claimAtomic(input('a@x.ch', 3, 'AAAAAAA3'), clock);
    assert.equal(claim.status, 'claimed');
    if (claim.status !== 'claimed') return;
    await releaseAtomic(JSON.stringify(claim.record), claim.record, FAR, clock);
    assert.equal(await readBooked(SHOW), 0);
  });

  it('readBooked treats a non-numeric counter as zero', async () => {
    await redis('SET', keys.booked(SHOW), 'garbage');
    assert.equal(await readBooked(SHOW), 0);
  });

  it('readLinkState finds a claimed record and the booked counter', async () => {
    await claimAtomic(input('a@x.ch', 3, 'AAAAAAA4'), clock);
    const state = await readLinkState('AAAAAAA4', SHOW);
    assert.equal(state.record?.id, 'AAAAAAA4');
    assert.equal(state.record?.status, 'confirmed');
    assert.equal(state.tombstone, false);
    assert.equal(state.booked, 3);
  });

  it('readLinkState reports a cancelled record with its tombstone', async () => {
    const claim = await claimAtomic(input('a@x.ch', 3, 'AAAAAAA5'), clock);
    if (claim.status !== 'claimed') return assert.fail('claim');
    await releaseAtomic(JSON.stringify(claim.record), claim.record, FAR, clock);
    const state = await readLinkState('AAAAAAA5', SHOW);
    assert.equal(state.record?.status, 'cancelled');
    assert.equal(state.tombstone, true);
    assert.equal(state.booked, 0);
  });

  it('readLinkState is empty for an unknown id', async () => {
    assert.deepEqual(await readLinkState('NOPE0000', SHOW), { record: null, tombstone: false, booked: 0 });
  });

  it('neither helper writes', async () => {
    await claimAtomic(input('a@x.ch', 3, 'AAAAAAA6'), clock);
    const before = await snapshot();
    const keysBefore = await keyList();
    await readBooked(SHOW);
    await readLinkState('AAAAAAA6', SHOW);
    await readLinkState('NOPE0000', SHOW);
    assert.equal(await snapshot(), before);
    assert.deepEqual(await keyList(), keysBefore);
  });

  it('each helper uses exactly one HTTP call', async () => {
    const counter = countFetch();
    try {
      await readBooked(SHOW);
      assert.equal(counter.calls(), 1);
      await readLinkState('AAAAAAA6', SHOW);
      assert.equal(counter.calls(), 2);
    } finally {
      counter.restore();
    }
  });
});
