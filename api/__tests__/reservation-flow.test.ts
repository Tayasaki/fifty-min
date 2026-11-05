import { redisSkipReason } from './helpers/redis-env';
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { RESERVATIONS_OPEN_AT, retentionExpiry } from '../../src/config/shows';
import { canonicalEmail } from '../_lib/guard';
import { ERR, MSG } from '../_lib/http';
import { claimAtomic, getReservation, keys, redis, type ReservationRecord } from '../_lib/redis';
import { handleReservationGet, handleReservationPost } from '../_lib/reservation-flow';
import {
  LINK_SECRET, NOW, SYNTH_SHOW_ID, SYNTH_START, captureLogs, containsNone, getRequest, makeDeps, makeEnv, makeLink,
  postJson, redisCommandsOf, redisDown, registerTestShow, snapshot, type Harness,
} from './helpers/flow';

const shimFetch = globalThis.fetch;
const EMAIL = 'jean@example.ch';
const ERR_404 = { error: ERR.NOT_FOUND };

let showHandle: ReturnType<typeof registerTestShow>;
before(() => {
  showHandle = registerTestShow();
});
const registered = () => showHandle.show;
after(() => showHandle.unregister());

type Json = Record<string, unknown>;
const preview = (h: Harness, id: string, token: string): Promise<Response> =>
  handleReservationGet(getRequest('reservation', { id, token }), h.deps);
const act = (h: Harness, action: string, id: string, token: string): Promise<Response> =>
  handleReservationPost(postJson('reservation', { action, id, token }), h.deps);
const confirm = (h: Harness, id: string, token: string) => act(h, 'confirm', id, token);
const cancel = (h: Harness, id: string, token: string) => act(h, 'cancel', id, token);
const body = async (res: Response): Promise<Json> => (await res.json()) as Json;

function keepAlive(): () => void {
  const timer = setInterval(() => undefined, 1000);
  return () => clearInterval(timer);
}

function flip(token: string, index: number): string {
  const chars = token.split('');
  chars[index] = chars[index] === 'A' ? 'B' : 'A';
  return chars.join('');
}

const SENT_KEY = 'quota:sent:2099-06-01';
const sentCount = async (): Promise<number> => Number((await redis<string | null>('GET', SENT_KEY)) ?? 0);
const bookedCount = async (): Promise<string | null> => redis<string | null>('GET', keys.booked(SYNTH_SHOW_ID));

/** Confirms a fresh link through the handler and returns the stored record (which holds the cancel token). */
async function confirmed(h: Harness, email = EMAIL, quantity = 2): Promise<{ record: ReservationRecord; link: ReturnType<typeof makeLink> }> {
  const link = makeLink({ email, quantity });
  const res = await confirm(h, link.id, link.token);
  assert.equal(res.status, 200);
  const found = await getReservation(link.id);
  assert.ok(found);
  return { record: found.record, link };
}

let seedCounter = 0;
async function seed(email: string, quantity: number): Promise<void> {
  seedCounter += 1;
  const result = await claimAtomic(
    {
      id: `E${String(seedCounter).padStart(7, '0')}`, showId: SYNTH_SHOW_ID, name: 'Seed', email, canonicalEmail: canonicalEmail(email),
      quantity, capacity: 100, maxPerEmail: 4, maxPerDomain: 0, expireAt: retentionExpiry(showHandle.show),
    },
    { now: () => NOW }
  );
  assert.equal(result.status, 'claimed');
}

/** Names of the Redis commands issued while fn runs. */
const commandsOf = async (fn: () => Promise<unknown>): Promise<string[]> => (await redisCommandsOf(fn)).map((command) => command[0]);

describe('/api/reservation authz (nothing reaches Redis or Resend)', () => {
  let h: Harness;
  let redisCalls = 0;
  beforeEach(() => {
    h = makeDeps();
    redisCalls = 0;
    globalThis.fetch = async () => {
      redisCalls += 1;
      throw new Error('unexpected network call');
    };
  });
  afterEach(() => {
    globalThis.fetch = shimFetch;
  });
  const untouched = (): void => {
    assert.equal(redisCalls, 0);
    assert.equal(h.resend.calls, 0);
  };
  const CANCEL_TOKEN = 'a'.repeat(32);

  it('X1 refuses a cancel token for the confirm action', async () => {
    const link = makeLink();
    const res = await confirm(h, link.id, CANCEL_TOKEN);
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: ERR.INVALID_LINK });
    untouched();
  });

  it('X2 refuses a signed link for the cancel action', async () => {
    const link = makeLink();
    const res = await cancel(h, link.id, link.token);
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: ERR.INVALID_LINK });
    untouched();
  });

  it('X3 refuses tokens of neither shape', async () => {
    for (const token of ['abc', 'has space.sig', 'A'.repeat(32), 'a'.repeat(31), 'a'.repeat(33), '.', 'a.b.c', 'é.é']) {
      for (const action of ['confirm', 'cancel']) {
        assert.equal((await act(h, action, 'ABCDEF01', token)).status, 400, `${action} ${token}`);
      }
      assert.equal((await preview(h, 'ABCDEF01', token)).status, 400, `GET ${token}`);
    }
    untouched();
  });

  it('X4 refuses an empty or missing token', async () => {
    assert.equal((await confirm(h, 'ABCDEF01', '')).status, 400);
    assert.equal((await handleReservationGet(getRequest('reservation', { id: 'ABCDEF01' }), h.deps)).status, 400);
    untouched();
  });

  it('X5 refuses lower-case, short and long ids', async () => {
    const link = makeLink();
    for (const id of ['abcdef01', 'ABCDEF0', 'ABCDEF012', '', 'ZZZZZZZZ']) {
      assert.equal((await confirm(h, id, link.token)).status, 400, id);
      assert.equal((await cancel(h, id, CANCEL_TOKEN)).status, 400, id);
    }
    untouched();
  });

  const forgeries: [string, (token: string) => string][] = [
    ['A1 one character flipped in the payload', (t) => flip(t, 10)],
    ['A2 one character flipped in the signature', (t) => flip(t, t.length - 3)],
    [
      'A3 payload swapped for another email and quantity with the old signature',
      (t) => `${makeLink({ email: 'victim@example.ch', quantity: 4 }).token.split('.')[0]}.${t.split('.')[1]}`,
    ],
    ['A4 signed with another secret', () => makeLink({}, { secret: 'another-secret-of-more-than-32-characters' }).token],
    [
      'A5 unknown key id',
      () => makeLink({}, { kidSecrets: { LINK_SECRET, LINK_SECRET_KID: '9' } }).token,
    ],
  ];
  for (const [title, forge] of forgeries) {
    it(`${title} answers a neutral 404 on GET and confirm`, async () => {
      const real = makeLink();
      const forged = forge(real.token);
      for (const res of [await preview(h, real.id, forged), await confirm(h, real.id, forged)]) {
        assert.equal(res.status, 404);
        assert.deepEqual(await res.json(), ERR_404);
      }
      untouched();
    });
  }

  for (const [label, run] of [['preview', preview], ['confirm', confirm]] as const) {
    it(`A6 refuses a correct signature presented with the id of another link on ${label}`, async () => {
      const real = makeLink();
      const other = makeLink({ email: 'other@example.ch' });
      assert.notEqual(real.id, other.id);
      const res = await run(h, other.id, real.token);
      assert.equal(res.status, 404);
      assert.deepEqual(await res.json(), ERR_404);
      untouched();
    });
  }

  it('A7 refuses a link at the exact expiry second', async () => {
    const link = makeLink({}, { ttlSeconds: 60 });
    h.clock.now = NOW + 60_000;
    assert.equal((await confirm(h, link.id, link.token)).status, 404);
    assert.equal((await preview(h, link.id, link.token)).status, 404);
    untouched();
  });

  it('A8 answers 503 when LINK_SECRET is unset', async () => {
    const link = makeLink();
    const unset = makeDeps({ env: makeEnv({ LINK_SECRET: undefined }) });
    for (const res of [await preview(unset, link.id, link.token), await confirm(unset, link.id, link.token)]) {
      assert.equal(res.status, 503);
      assert.deepEqual(await res.json(), { error: ERR.UNAVAILABLE });
    }
    untouched();
  });

  it('refuses a body of null, an array or a string with 400', async () => {
    for (const raw of ['null', '[]', '"x"', '{nope']) {
      const res = await handleReservationPost(postJson('reservation', raw, {}, true), h.deps);
      assert.equal(res.status, 400, raw);
      assert.deepEqual(await res.json(), { error: ERR.INVALID_REQUEST });
    }
    untouched();
  });

  it('refuses a 4097-byte body with 413 and text/plain with 415', async () => {
    const link = makeLink();
    const big = await handleReservationPost(postJson('reservation', { action: 'confirm', id: link.id, token: 'x'.repeat(4097) }), h.deps);
    assert.equal(big.status, 413);
    const plain = new Request('http://localhost/api/reservation', {
      method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ action: 'confirm', id: link.id, token: link.token }),
    });
    assert.equal((await handleReservationPost(plain, h.deps)).status, 415);
    untouched();
  });

  it('refuses an unknown action', async () => {
    const link = makeLink();
    const res = await act(h, 'delete', link.id, link.token);
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: ERR.UNKNOWN_ACTION });
    untouched();
  });

  it('F3 refuses to confirm while the gate is closed', async () => {
    const closed = makeDeps({ env: makeEnv({ RESERVATIONS_OPEN: 'false' }) });
    const link = makeLink();
    const res = await confirm(closed, link.id, link.token);
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: MSG.CLOSED, code: 'closed' });
    untouched();
  });

  it('F4b lets the gate win over the show start on confirm (403 closed, not show-started)', async () => {
    const closed = makeDeps({ env: makeEnv({ RESERVATIONS_OPEN: 'false' }) });
    const link = makeLink({}, { ttlSeconds: 400 * 86400 });
    closed.clock.now = SYNTH_START;
    const res = await confirm(closed, link.id, link.token);
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: MSG.CLOSED, code: 'closed' });
    untouched();
  });

  it('F4c maps a claim that finds the retention window over to show-started', async () => {
    const link = makeLink({}, { ttlSeconds: 400 * 86400 });
    // The pre-check reads the clock before the show start; only claimAtomic sees a clock past the retention expiry.
    const beyond = retentionExpiry(registered()) * 1000 + 1000;
    h.deps.now = () => (new Error().stack ?? '').includes('claimAtomic') ? beyond : h.clock.now;
    const res = await confirm(h, link.id, link.token);
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: MSG.SHOW_STARTED, code: 'show-started' });
  });

  it('F4 refuses to confirm at the exact start instant before any Redis call', async () => {
    const link = makeLink({}, { ttlSeconds: 400 * 86400 });
    h.clock.now = SYNTH_START;
    const res = await confirm(h, link.id, link.token);
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: MSG.SHOW_STARTED, code: 'show-started' });
    untouched();
  });

  it('F9 answers a generic 503 without a leak when Redis is down, on every operation', async () => {
    globalThis.fetch = shimFetch;
    const down = redisDown();
    const logs = captureLogs();
    try {
      const link = makeLink();
      const cancelToken = 'b'.repeat(32);
      const responses = [
        await preview(h, link.id, link.token),
        await confirm(h, link.id, link.token),
        await preview(h, 'ABCDEF01', cancelToken),
        await cancel(h, 'ABCDEF01', cancelToken),
      ];
      for (const res of responses) {
        assert.equal(res.status, 503);
        assert.equal(JSON.stringify(await res.json()), JSON.stringify({ error: ERR.UNAVAILABLE }));
      }
      assert.ok(containsNone(logs.lines(), ['jean', 'Dupont', 'KV_', link.token]));
      assert.equal(h.resend.calls, 0);
    } finally {
      logs.restore();
      down.restore();
    }
  });
});

describe('/api/reservation with Redis', { skip: redisSkipReason }, () => {
  let h: Harness;
  beforeEach(async () => {
    await redis('FLUSHDB');
    h = makeDeps();
  });

  it('A7 accepts a link one second before expiry', async () => {
    const link = makeLink({}, { ttlSeconds: 60 });
    h.clock.now = NOW + 59_000;
    assert.equal((await preview(h, link.id, link.token)).status, 200);
  });

  describe('preview', () => {
    it('V1 shows a fresh link as claimable with the remaining seats and the open flag', async () => {
      await seed('x@gmail.com', 4);
      const link = makeLink();
      const res = await preview(h, link.id, link.token);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), {
        id: link.id, showId: SYNTH_SHOW_ID, name: 'Jean Dupont', quantity: 2, status: 'claimable', availability: 96, open: true,
      });
    });

    it('V2 shows full when the quantity no longer fits', async () => {
      for (let i = 0; i < 24; i += 1) await seed(`b${i}@gmail.com`, 4);
      await seed('c@gmail.com', 3);
      const link = makeLink({ quantity: 2 });
      const res = await body(await preview(h, link.id, link.token));
      assert.equal(res.status, 'full');
      assert.equal(res.availability, 1);
    });

    it('V3 shows confirmed after the confirmation', async () => {
      const { link } = await confirmed(h);
      assert.equal((await body(await preview(h, link.id, link.token))).status, 'confirmed');
    });

    it('V4 answers 404 for the signed link of a cancelled reservation', async () => {
      const { record, link } = await confirmed(h);
      assert.equal((await cancel(h, record.id, record.token)).status, 200);
      const res = await preview(h, link.id, link.token);
      assert.equal(res.status, 404);
      assert.deepEqual(await res.json(), ERR_404);
    });

    it('V5 shows the cancel link of a cancelled record as cancelled', async () => {
      const { record } = await confirmed(h);
      await cancel(h, record.id, record.token);
      const res = await preview(h, record.id, record.token);
      assert.equal(res.status, 200);
      assert.equal((await body(res)).status, 'cancelled');
    });

    it('V6 shows closed once the show has started', async () => {
      const link = makeLink({}, { ttlSeconds: 400 * 86400 });
      h.clock.now = SYNTH_START;
      assert.equal((await body(await preview(h, link.id, link.token))).status, 'closed');
    });

    it('shows the cancel view of a confirmed record without exposing secrets', async () => {
      const { record } = await confirmed(h);
      const res = await preview(h, record.id, record.token);
      const text = await res.text();
      assert.deepEqual(JSON.parse(text), {
        id: record.id, showId: SYNTH_SHOW_ID, name: 'Jean Dupont', quantity: 2, status: 'confirmed', closed: false,
      });
      assert.ok(containsNone(text, [record.token, EMAIL, record.canonicalEmail]));
    });

    it('echoes open=false and still serves the preview while the gate is closed', async () => {
      const closed = makeDeps({ env: makeEnv({ RESERVATIONS_OPEN: 'false' }) });
      const link = makeLink();
      const res = await body(await preview(closed, link.id, link.token));
      assert.equal(res.open, false);
      assert.equal(res.status, 'claimable');
    });

    it('reports open from the opening date when the gate is unset', async () => {
      const at = RESERVATIONS_OPEN_AT.getTime();
      const link = makeLink();
      const before = makeDeps({ now: at - 1, env: makeEnv({ RESERVATIONS_OPEN: undefined }) });
      assert.equal((await body(await preview(before, link.id, link.token))).open, false);
      const after = makeDeps({ now: at, env: makeEnv({ RESERVATIONS_OPEN: undefined }) });
      assert.equal((await body(await preview(after, link.id, link.token))).open, true);
    });

    it('never writes: the keys are unchanged and only MGET or GET is issued', async () => {
      const { record, link } = await confirmed(h);
      const before = await snapshot();
      const commands = await commandsOf(async () => {
        await preview(h, link.id, link.token);
        await preview(h, record.id, record.token);
        await preview(h, 'ABCDEF01', 'c'.repeat(32));
      });
      assert.equal(await snapshot(), before);
      assert.deepEqual([...new Set(commands)].sort(), ['GET', 'MGET']);
    });

    it('uses one Redis call for a signed link and one for a cancel link', async () => {
      const { record, link } = await confirmed(h);
      assert.equal((await commandsOf(() => preview(h, link.id, link.token))).length, 1);
      assert.equal((await commandsOf(() => preview(h, record.id, record.token))).length, 1);
    });

    it('answers 404 for an unknown cancel token and for a record of a show that no longer exists', async () => {
      const { record } = await confirmed(h);
      assert.equal((await preview(h, 'ABCDEF01', 'd'.repeat(32))).status, 404);
      showHandle.unregister();
      try {
        assert.equal((await preview(h, record.id, record.token)).status, 404);
      } finally {
        showHandle = registerTestShow();
      }
    });
  });

  describe('confirm', () => {
    it('claims the seats, mails the recap with the cancel link and never returns a token', async () => {
      const link = makeLink({ quantity: 3 });
      const res = await confirm(h, link.id, link.token);
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.deepEqual(JSON.parse(text), { ok: true, status: 'confirmed', id: link.id, alreadyConfirmed: false, emailSent: true });
      assert.equal(await bookedCount(), '3');
      assert.equal(h.outbox.length, 1);
      const found = await getReservation(link.id);
      assert.ok(found);
      assert.ok(containsNone(text, [found.record.token, link.token]));
    });

    it('F8 puts the cancel link of the stored record in the recap, on the right host, never the signed token', async () => {
      const preview1 = makeDeps({ env: makeEnv({ VERCEL_ENV: 'preview', VERCEL_URL: 'preview-abc.vercel.app' }) });
      const link = makeLink();
      await confirm(preview1, link.id, link.token);
      const found = await getReservation(link.id);
      assert.ok(found);
      const mail = preview1.outbox[0];
      const cancelLine = mail.text.split('\n').find((line) => line.includes('annuler='));
      assert.equal(cancelLine, `https://preview-abc.vercel.app/billetterie?annuler=${link.id}&token=${found.record.token}`);
      assert.ok(containsNone(mail.text + mail.html, [link.token]));
      assert.deepEqual(mail.attachments?.map((a) => a.filename), ['15-minutes.ics']);
    });

    it('P1 answers alreadyConfirmed without a second mail on a replay', async () => {
      const link = makeLink();
      await confirm(h, link.id, link.token);
      const again = await body(await confirm(h, link.id, link.token));
      assert.deepEqual(again, { ok: true, status: 'confirmed', id: link.id, alreadyConfirmed: true, emailSent: null });
      assert.equal(h.outbox.length, 1);
      assert.equal(await bookedCount(), '2');
    });

    it('P2 lets exactly one of five concurrent confirms claim', async () => {
      const link = makeLink();
      const results = await Promise.all(Array.from({ length: 5 }, () => confirm(h, link.id, link.token)));
      const bodies = await Promise.all(results.map(body));
      assert.ok(results.every((r) => r.status === 200));
      assert.equal(bodies.filter((b) => b.alreadyConfirmed === false).length, 1);
      assert.equal(bodies.filter((b) => b.alreadyConfirmed === true).length, 4);
      assert.equal(h.outbox.length, 1);
      assert.equal(await bookedCount(), '2');
    });

    it('P3 answers 404 to a confirm replay after the cancellation and keeps the counters', async () => {
      const { record, link } = await confirmed(h);
      await cancel(h, record.id, record.token);
      const before = await snapshot();
      const res = await confirm(h, link.id, link.token);
      assert.equal(res.status, 404);
      assert.deepEqual(await res.json(), ERR_404);
      assert.equal(await snapshot(), before);
      assert.equal(await bookedCount(), '0');
    });

    it('F1 answers 409 full with the remaining seats', async () => {
      for (let i = 0; i < 25; i += 1) await seed(`b${i}@gmail.com`, 4);
      const before = await snapshot();
      const link = makeLink();
      const res = await confirm(h, link.id, link.token);
      assert.equal(res.status, 409);
      assert.deepEqual(await res.json(), { error: MSG.FULL, code: 'full', remaining: 0 });
      assert.equal(await snapshot(), before);
      assert.equal(h.resend.calls, 0);
    });

    it('F2 answers the same neutral 409 for the email cap and the domain cap', async () => {
      await seed(EMAIL, 3);
      const emailLink = makeLink({ quantity: 2 });
      const emailCap = await confirm(h, emailLink.id, emailLink.token);
      assert.equal(emailCap.status, 409);
      const emailText = await emailCap.text();
      assert.deepEqual(JSON.parse(emailText), { error: MSG.NOT_POSSIBLE, code: 'not-possible' });

      await redis('FLUSHDB');
      for (const who of ['p', 'q', 'r']) await seed(`${who}@corp.example`, 4);
      const domainLink = makeLink({ email: 'thirteenth@corp.example', quantity: 1 });
      const domainCap = await confirm(h, domainLink.id, domainLink.token);
      assert.equal(domainCap.status, 409);
      assert.equal(await domainCap.text(), emailText);
      assert.equal(h.resend.calls, 0);
    });

    it('F5 keeps the seats and says emailSent false when the recap mail fails, without logging PII', async () => {
      h.resend.behavior = { status: 500, body: '{"message":"jean@example.ch"}' };
      const logs = captureLogs();
      try {
        const link = makeLink();
        const res = await body(await confirm(h, link.id, link.token));
        assert.deepEqual(res, { ok: true, status: 'confirmed', id: link.id, alreadyConfirmed: false, emailSent: false });
        assert.ok(containsNone(logs.lines(), ['jean', 'Dupont']));
        assert.match(logs.lines(), /recap email error provider 500/);
      } finally {
        logs.restore();
      }
      assert.equal(await bookedCount(), '2');
    });

    it('F6 says emailSent false when the recap mail times out', async () => {
      const slow = makeDeps({ emailTimeoutMs: 30 });
      slow.resend.behavior = 'hang';
      const stop = keepAlive();
      try {
        const link = makeLink();
        assert.equal((await body(await confirm(slow, link.id, link.token))).emailSent, false);
      } finally {
        stop();
      }
      assert.equal(await bookedCount(), '2');
    });

    it('F7 still sends the recap when the send quota is unavailable', async () => {
      const real = globalThis.fetch;
      let quotaCalls = 0;
      globalThis.fetch = async (input, init) => {
        if (String(init?.body).includes('quota:sent')) {
          quotaCalls += 1;
          return Response.json({ error: 'upstream failure' }, { status: 500 });
        }
        return real(input, init);
      };
      try {
        const link = makeLink();
        const res = await body(await confirm(h, link.id, link.token));
        assert.equal(res.emailSent, true);
        assert.equal(h.outbox.length, 1);
        assert.equal(quotaCalls, 1);
      } finally {
        globalThis.fetch = real;
      }
    });

    it('counts the recap mail once in the daily send counter', async () => {
      assert.equal(await sentCount(), 0);
      const link = makeLink();
      assert.equal((await body(await confirm(h, link.id, link.token))).emailSent, true);
      assert.equal(await sentCount(), 1);
    });

    it('counts the recap mail even when it fails to leave', async () => {
      h.resend.behavior = { status: 500, body: '{}' };
      const link = makeLink();
      assert.equal((await body(await confirm(h, link.id, link.token))).emailSent, false);
      assert.equal(await sentCount(), 1);
    });

    it('does not count anything for a confirm replay', async () => {
      const link = makeLink();
      await confirm(h, link.id, link.token);
      const replay = await body(await confirm(h, link.id, link.token));
      assert.equal(replay.alreadyConfirmed, true);
      assert.equal(await sentCount(), 1);
      assert.equal(h.outbox.length, 1);
    });

    it('answers 503 with a generic body when the claim fails', async () => {
      const link = makeLink();
      const real = globalThis.fetch;
      globalThis.fetch = async (input, init) => {
        if (String(init?.body).includes('INCRBY')) return Response.json({ error: 'upstream failure' }, { status: 500 });
        return real(input, init);
      };
      try {
        const res = await confirm(h, link.id, link.token);
        assert.equal(res.status, 503);
        assert.deepEqual(await res.json(), { error: ERR.UNAVAILABLE });
      } finally {
        globalThis.fetch = real;
      }
      assert.equal(h.resend.calls, 0);
    });
  });

  describe('cancel', () => {
    it('cancels, frees the seats and mails the cancellation', async () => {
      const { record } = await confirmed(h);
      const res = await body(await cancel(h, record.id, record.token));
      assert.deepEqual(res, { ok: true, status: 'cancelled', id: record.id, alreadyCancelled: false, emailSent: true });
      assert.equal(await bookedCount(), '0');
      assert.equal(h.outbox.length, 2);
      assert.ok(h.outbox[1].subject.startsWith('Annulation'));
    });

    it('counts the cancellation mail once in the daily send counter, and not on a replay', async () => {
      const { record } = await confirmed(h);
      assert.equal(await sentCount(), 1);
      assert.equal((await body(await cancel(h, record.id, record.token))).emailSent, true);
      assert.equal(await sentCount(), 2);
      assert.equal((await body(await cancel(h, record.id, record.token))).alreadyCancelled, true);
      assert.equal(await sentCount(), 2);
    });

    it('P4 answers alreadyCancelled without a second mail and decrements once', async () => {
      await seed('other@gmail.com', 1);
      const { record } = await confirmed(h);
      await cancel(h, record.id, record.token);
      const again = await body(await cancel(h, record.id, record.token));
      assert.deepEqual(again, { ok: true, status: 'cancelled', id: record.id, alreadyCancelled: true, emailSent: null });
      assert.equal(h.outbox.length, 2);
      assert.equal(await bookedCount(), '1');
    });

    it('P5 lets exactly one of five concurrent cancels send the mail', async () => {
      const { record } = await confirmed(h);
      const results = await Promise.all(Array.from({ length: 5 }, () => cancel(h, record.id, record.token)));
      assert.ok(results.every((r) => r.status === 200));
      assert.equal(h.outbox.length, 2);
      assert.equal(await bookedCount(), '0');
    });

    it('C1 refuses the cancel token of one reservation with the id of another and changes nothing', async () => {
      const a = await confirmed(h, 'a@example.ch');
      const b = await confirmed(h, 'b@example.ch');
      const before = await snapshot();
      const res = await cancel(h, b.record.id, a.record.token);
      assert.equal(res.status, 404);
      assert.deepEqual(await res.json(), ERR_404);
      assert.equal((await preview(h, b.record.id, a.record.token)).status, 404);
      assert.equal(await snapshot(), before);
    });

    it('C2 refuses a token that differs by one character, at the start or at the end', async () => {
      const { record } = await confirmed(h);
      const first = (record.token[0] === 'a' ? 'b' : 'a') + record.token.slice(1);
      const last = record.token.slice(0, -1) + (record.token.endsWith('a') ? 'b' : 'a');
      const middle = record.token.slice(0, 8) + 'f'.repeat(24);
      for (const token of [first, last, middle]) {
        assert.equal((await cancel(h, record.id, token)).status, 404, token);
        assert.equal((await preview(h, record.id, token)).status, 404, token);
      }
      assert.equal(await bookedCount(), '2');
    });

    it('C3 answers 404 for an unknown id with a well-formed token', async () => {
      const res = await cancel(h, 'ABCDEF01', 'e'.repeat(32));
      assert.equal(res.status, 404);
      assert.deepEqual(await res.json(), ERR_404);
    });

    it('F4 refuses to cancel at the exact start instant and writes nothing', async () => {
      const { record } = await confirmed(h);
      const before = await snapshot();
      h.clock.now = SYNTH_START;
      const res = await cancel(h, record.id, record.token);
      assert.equal(res.status, 409);
      assert.deepEqual(await res.json(), { error: MSG.SHOW_STARTED, code: 'show-started' });
      assert.equal(await snapshot(), before);
    });

    it('still cancels while the reservation gate is closed', async () => {
      const { record } = await confirmed(h);
      const closed = makeDeps({ env: makeEnv({ RESERVATIONS_OPEN: 'false' }) });
      assert.equal((await cancel(closed, record.id, record.token)).status, 200);
    });

    it('keeps the cancellation when the mail fails and says emailSent false', async () => {
      const { record } = await confirmed(h);
      h.resend.behavior = { status: 500, body: '{}' };
      const res = await body(await cancel(h, record.id, record.token));
      assert.equal(res.status, 'cancelled');
      assert.equal(res.emailSent, false);
      assert.equal(await bookedCount(), '0');
    });
  });
});
