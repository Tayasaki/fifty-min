import { redisSkipReason } from './helpers/redis-env';
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { SHOWS } from '../../src/config/shows';
import { ERR } from '../_lib/http';
import { keys, redis } from '../_lib/redis';
import { GET } from '../availability';
import { SYNTH_SHOW_ID, captureLogs, redisDown, registerTestShow, snapshot } from './helpers/flow';
import { countFetch } from './helpers/fetch-count';

let showHandle: ReturnType<typeof registerTestShow>;
let savedOpen: string | undefined;
before(() => {
  showHandle = registerTestShow();
  savedOpen = process.env.RESERVATIONS_OPEN;
});
after(() => {
  showHandle.unregister();
  if (savedOpen === undefined) delete process.env.RESERVATIONS_OPEN;
  else process.env.RESERVATIONS_OPEN = savedOpen;
});

const call = (): Promise<Response> => GET();
const availabilityOf = async (res: Response): Promise<Record<string, number>> =>
  ((await res.json()) as { availability: Record<string, number> }).availability;

describe('GET /api/availability', { skip: redisSkipReason }, () => {
  beforeEach(async () => {
    process.env.RESERVATIONS_OPEN = 'true';
    await redis('FLUSHDB');
  });

  it('answers capacity minus booked for every show', async () => {
    await redis('SET', keys.booked(SYNTH_SHOW_ID), '37');
    const availability = await availabilityOf(await call());
    assert.equal(availability[SYNTH_SHOW_ID], 63);
    const untouched = SHOWS.find((show) => show.id !== SYNTH_SHOW_ID);
    assert.ok(untouched);
    assert.equal(availability[untouched.id], untouched.capacity);
  });

  it('clamps at zero when the counter exceeds the capacity', async () => {
    await redis('SET', keys.booked(SYNTH_SHOW_ID), '250');
    assert.equal((await availabilityOf(await call()))[SYNTH_SHOW_ID], 0);
  });

  it('survives a corrupt counter', async () => {
    await redis('SET', keys.booked(SYNTH_SHOW_ID), 'not-a-number');
    const value = (await availabilityOf(await call()))[SYNTH_SHOW_ID];
    assert.ok(Number.isFinite(value) && value >= 0);
  });

  it('echoes open from RESERVATIONS_OPEN', async () => {
    for (const [value, expected] of [['true', true], ['false', false], [undefined, false]] as const) {
      if (value === undefined) delete process.env.RESERVATIONS_OPEN;
      else process.env.RESERVATIONS_OPEN = value;
      assert.equal(((await (await call()).json()) as { open: boolean }).open, expected, String(value));
    }
  });

  it('is cacheable at the CDN for ten seconds', async () => {
    const res = await call();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'public, s-maxage=10, stale-while-revalidate=30');
  });

  it('uses exactly one HTTP call and writes nothing', async () => {
    await redis('SET', keys.booked(SYNTH_SHOW_ID), '5');
    const before = await snapshot();
    const counter = countFetch();
    try {
      await call();
      assert.equal(counter.calls(), 1);
    } finally {
      counter.restore();
    }
    assert.equal(await snapshot(), before);
  });
});

describe('GET /api/availability when Redis is down', () => {
  let down: ReturnType<typeof redisDown>;
  beforeEach(() => {
    down = redisDown();
  });
  afterEach(() => down.restore());

  it('answers 503 uncached with a generic body', async () => {
    const logs = captureLogs();
    try {
      const res = await call();
      assert.equal(res.status, 503);
      assert.equal(res.headers.get('cache-control'), 'no-store');
      const text = await res.text();
      assert.equal(text, JSON.stringify({ error: ERR.UNAVAILABLE }));
      assert.ok(!text.includes('Redis'));
      assert.match(logs.lines(), /availability error/);
    } finally {
      logs.restore();
    }
  });
});
