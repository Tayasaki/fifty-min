import { redisSkipReason } from './helpers/redis-env';
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ERR } from '../_lib/http';
import { getReservation, keys, redis } from '../_lib/redis';
import { handleReservationGet, handleReservationPost } from '../_lib/reservation-flow';
import { handleReserve } from '../_lib/reserve-flow';
import { GET as availability } from '../availability';
import { GET as adminExport } from '../reservations';
import {
  SYNTH_SHOW_ID, captureLogs, containsNone, freshToken, getRequest, keyList, makeDeps, makeLink, postJson, redisDown,
  registerTestShow, reserveRequest, validReserve, type Harness,
} from './helpers/flow';

const handles: ReturnType<typeof registerTestShow>[] = [];
const SHOW_50 = '2100-06-16-monique';
const SHOW_SMALL = '2100-06-17-monique';

before(() => {
  handles.push(registerTestShow());
  handles.push(registerTestShow({ id: SHOW_50, date: '2100-06-16T19:00', capacity: 50 }));
  handles.push(registerTestShow({ id: SHOW_SMALL, date: '2100-06-17T19:00', capacity: 40 }));
});
after(() => handles.forEach((handle) => handle.unregister()));

type Json = Record<string, unknown>;
const json = async (res: Response): Promise<Json> => (await res.json()) as Json;
const reserve = (h: Harness, body: Json): Promise<Response> => handleReserve(reserveRequest(body), h.deps);
const preview = (h: Harness, id: string, token: string): Promise<Response> =>
  handleReservationGet(getRequest('reservation', { id, token }), h.deps);
const act = (h: Harness, action: string, id: string, token: string): Promise<Response> =>
  handleReservationPost(postJson('reservation', { action, id, token }), h.deps);
const bookedOf = async (showId: string): Promise<string | null> => redis<string | null>('GET', keys.booked(showId));

function linkOf(text: string, param: 'confirmer' | 'annuler'): { id: string; token: string } {
  const line = text.split('\n').find((l) => l.startsWith('https://') && l.includes(`${param}=`));
  assert.ok(line, `no ${param} link in mail`);
  const url = new URL(line);
  return { id: url.searchParams.get(param) ?? '', token: url.searchParams.get('token') ?? '' };
}

describe('claim-on-confirm flow end to end', { skip: redisSkipReason }, () => {
  let h: Harness;
  beforeEach(async () => {
    await redis('FLUSHDB');
    h = makeDeps();
  });

  it('E1 runs reserve, preview, confirm, cancel and the replay of the old link', async () => {
    const logs = captureLogs();
    try {
      assert.equal((await reserve(h, validReserve())).status, 200);
      assert.equal(h.outbox.length, 1);
      const confirmLink = linkOf(h.outbox[0].text, 'confirmer');
      assert.deepEqual(await keyList(), ['quota:cooldown:jean@example.ch', 'quota:sent:2099-06-01']);

      assert.equal((await json(await preview(h, confirmLink.id, confirmLink.token))).status, 'claimable');
      const confirmed = await json(await act(h, 'confirm', confirmLink.id, confirmLink.token));
      assert.deepEqual(confirmed, { ok: true, status: 'confirmed', id: confirmLink.id, alreadyConfirmed: false, emailSent: true });
      assert.equal(h.outbox.length, 2);
      assert.ok(h.outbox[1].subject.startsWith('Réservation confirmée'));

      const cancelLink = linkOf(h.outbox[1].text, 'annuler');
      assert.equal((await json(await preview(h, cancelLink.id, cancelLink.token))).status, 'confirmed');
      const cancelled = await json(await act(h, 'cancel', cancelLink.id, cancelLink.token));
      assert.deepEqual(cancelled, { ok: true, status: 'cancelled', id: cancelLink.id, alreadyCancelled: false, emailSent: true });
      assert.ok(h.outbox[2].subject.startsWith('Annulation'));

      const replay = await act(h, 'confirm', confirmLink.id, confirmLink.token);
      assert.equal(replay.status, 404);
      assert.deepEqual(await replay.json(), { error: ERR.NOT_FOUND });
      assert.equal(await bookedOf(SYNTH_SHOW_ID), '0');
      assert.equal(await redis('EXISTS', keys.tombstone(confirmLink.id)), 1);
      assert.equal((await getReservation(confirmLink.id))?.record.status, 'cancelled');
      assert.deepEqual(h.outbox.map((m) => m.to[0]), ['jean@example.ch', 'jean@example.ch', 'jean@example.ch']);
      assert.ok(containsNone(logs.lines(), ['jean', 'Dupont']));
    } finally {
      logs.restore();
    }
  });

  it('E2 never oversells: 30 concurrent confirms of 4 seats on a 100-seat show give 25 claims and 5 full', async () => {
    const links = Array.from({ length: 30 }, (_, i) => makeLink({ email: `user${i}@gmail.com`, quantity: 4 }));
    const results = await Promise.all(links.map((link) => act(h, 'confirm', link.id, link.token)));
    const statuses = results.map((r) => r.status);
    assert.equal(statuses.filter((s) => s === 200).length, 25);
    assert.equal(statuses.filter((s) => s === 409).length, 5);
    assert.equal(await bookedOf(SYNTH_SHOW_ID), '100');
    const perEmail = await redis<string[]>('HVALS', keys.perEmail(SYNTH_SHOW_ID));
    assert.equal(perEmail.reduce((sum, v) => sum + Number(v), 0), 100);
    assert.equal(await redis('LLEN', keys.reservations(SYNTH_SHOW_ID)), 25);
    assert.equal(h.outbox.length, 25);
  });

  it('E3 never oversells a 50-seat show with quantity 3: 16 claims, 48 seats', async () => {
    const links = Array.from({ length: 30 }, (_, i) => makeLink({ email: `user${i}@gmail.com`, quantity: 3, showId: SHOW_50 }));
    const results = await Promise.all(links.map((link) => act(h, 'confirm', link.id, link.token)));
    assert.equal(results.filter((r) => r.status === 200).length, 16);
    assert.equal(await bookedOf(SHOW_50), '48');
    assert.equal(h.outbox.length, 16);
  });

  it('E4 lets one of 30 concurrent confirms of the same link claim and the other 29 replay', async () => {
    const link = makeLink({ quantity: 3 });
    const bodies = await Promise.all(Array.from({ length: 30 }, async () => json(await act(h, 'confirm', link.id, link.token))));
    assert.equal(bodies.filter((b) => b.alreadyConfirmed === false).length, 1);
    assert.equal(bodies.filter((b) => b.alreadyConfirmed === true).length, 29);
    assert.equal(await bookedOf(SYNTH_SHOW_ID), '3');
    assert.equal(h.outbox.length, 1);
  });

  it('E5 answers a double-clicked reserve with one mail and one cooldown', async () => {
    const [a, b] = await Promise.all([reserve(h, validReserve()), reserve(h, validReserve())]);
    assert.deepEqual([a.status, b.status].sort(), [200, 429]);
    assert.equal(h.outbox.length, 1);
    const refused = (a.status === 429 ? a : b);
    assert.equal((await json(refused)).code, 'cooldown');
  });

  it('E6 throttles the same address across two shows and writes no seat', async () => {
    assert.equal((await reserve(h, validReserve())).status, 200);
    const second = await reserve(h, validReserve({ showId: SHOW_50 }));
    assert.equal(second.status, 429);
    assert.equal(h.outbox.length, 1);
    const written = (await keyList()).filter((key) => key.startsWith('show:') || key.startsWith('reservation:'));
    assert.deepEqual(written, []);
  });

  it('E8 keeps every counter consistent over 200 random operations', async () => {
    let seed = 20260101;
    const next = (n: number): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % n;
    };
    const users = Array.from({ length: 30 }, (_, i) => ({
      email: `rand${i}@gmail.com`,
      quantity: 1 + (i % 4),
      link: makeLink({ email: `rand${i}@gmail.com`, quantity: 1 + (i % 4), showId: SHOW_SMALL }),
      cancelToken: '',
    }));
    let recaps = 0;
    let cancellations = 0;
    for (let op = 0; op < 200; op += 1) {
      const user = users[next(users.length)];
      const kind = next(10);
      if (kind < 2) {
        await reserve(h, validReserve({ email: user.email, showId: SHOW_SMALL, quantity: user.quantity }));
      } else if (kind < 7) {
        const res = await act(h, 'confirm', user.link.id, user.link.token);
        if (res.status === 200 && (await json(res)).alreadyConfirmed === false) {
          recaps += 1;
          user.cancelToken = (await getReservation(user.link.id))?.record.token ?? '';
        }
      } else {
        const token = user.cancelToken || 'f'.repeat(32);
        const res = await act(h, 'cancel', user.link.id, token);
        if (res.status === 200 && (await json(res)).alreadyCancelled === false) cancellations += 1;
      }
      const booked = Number((await bookedOf(SHOW_SMALL)) ?? 0);
      assert.ok(booked >= 0 && booked <= 40, `booked ${booked} after op ${op}`);
    }
    const ids = await redis<string[]>('LRANGE', keys.reservations(SHOW_SMALL), 0, -1);
    const records = await Promise.all(ids.map(async (id) => (await getReservation(id))!.record));
    const confirmedSum = records.filter((r) => r.status === 'confirmed').reduce((sum, r) => sum + r.quantity, 0);
    const booked = Number((await bookedOf(SHOW_SMALL)) ?? 0);
    const perEmail = (await redis<string[]>('HVALS', keys.perEmail(SHOW_SMALL))).reduce((sum, v) => sum + Number(v), 0);
    const perDomain = (await redis<string[]>('HVALS', keys.perDomain(SHOW_SMALL))).reduce((sum, v) => sum + Number(v), 0);
    assert.equal(booked, confirmedSum);
    assert.equal(perEmail, booked);
    assert.equal(perDomain, booked);
    assert.equal(records.length, records.filter((r) => r.status === 'confirmed').length);
    assert.equal(h.outbox.filter((m) => m.subject.startsWith('Réservation confirmée')).length, recaps);
    assert.equal(h.outbox.filter((m) => m.subject.startsWith('Annulation')).length, cancellations);
  });
});

describe('every endpoint when Redis is down', () => {
  it('E7 answers a generic 503, calls neither Resend nor leaks PII', async () => {
    const h = makeDeps();
    const previousAdmin = process.env.ADMIN_TOKEN;
    process.env.ADMIN_TOKEN = 'admin-token-value-0123456789-abcdef';
    const down = redisDown();
    const logs = captureLogs();
    try {
      const link = makeLink();
      const cancelToken = 'a'.repeat(32);
      const responses = await Promise.all([
        reserve(h, validReserve({ turnstileToken: freshToken() })),
        preview(h, link.id, link.token),
        preview(h, 'ABCDEF01', cancelToken),
        act(h, 'confirm', link.id, link.token),
        act(h, 'cancel', 'ABCDEF01', cancelToken),
        availability(),
        adminExport(new Request('http://localhost/api/reservations', { headers: { authorization: 'Bearer admin-token-value-0123456789-abcdef' } })),
      ]);
      for (const res of responses) {
        assert.equal(res.status, 503);
        assert.equal(JSON.stringify(await res.json()), JSON.stringify({ error: ERR.UNAVAILABLE }));
      }
      assert.equal(h.resend.calls, 0);
      assert.ok(containsNone(logs.lines(), ['jean', 'Dupont', 'admin-token-value-0123456789-abcdef', link.token, 'KV_']));
    } finally {
      logs.restore();
      down.restore();
      if (previousAdmin === undefined) delete process.env.ADMIN_TOKEN;
      else process.env.ADMIN_TOKEN = previousAdmin;
    }
  });
});
