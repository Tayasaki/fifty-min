import { redisSkipReason } from './helpers/redis-env';
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { retentionExpiry } from '../../src/config/shows';
import { canonicalEmail } from '../_lib/guard';
import { loadLinkSecrets, verifyLink } from '../_lib/link';
import { MSG, ERR } from '../_lib/http';
import { QUOTA_MESSAGES } from '../_lib/quota';
import { claimAtomic, redis } from '../_lib/redis';
import { handleReserve } from '../_lib/reserve-flow';
import type { Deps } from '../_lib/deps';
import {
  LINK_SECRET, NOW, ORIGIN, SYNTH_SHOW_ID, SYNTH_START, captureLogs, containsNone, freshToken, keyList, makeDeps,
  makeEnv, redisCommandsOf, redisDown, registerTestShow, reserveRequest, snapshot, validReserve, type Harness,
} from './helpers/flow';

const shimFetch = globalThis.fetch;
const DAY_KEY = 'quota:sent:2099-06-01';
const LINK_TTL_MS = 48 * 3600 * 1000;

let showHandle: ReturnType<typeof registerTestShow>;
before(() => {
  showHandle = registerTestShow();
});
after(() => showHandle.unregister());

async function call(h: Harness, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return handleReserve(reserveRequest(body, headers), h.deps);
}

let seedCounter = 0;
async function seed(email: string, quantity: number): Promise<void> {
  seedCounter += 1;
  const result = await claimAtomic(
    {
      id: `F${String(seedCounter).padStart(7, '0')}`, showId: SYNTH_SHOW_ID, name: 'Seed', email,
      canonicalEmail: canonicalEmail(email), quantity, capacity: 100, maxPerEmail: 4, maxPerDomain: 0,
      expireAt: retentionExpiry(showHandle.show),
    },
    { now: () => NOW }
  );
  assert.equal(result.status, 'claimed');
}

// Keeps the event loop alive: AbortSignal.timeout timers are unref'd.
function keepAlive(): () => void {
  const timer = setInterval(() => undefined, 1000);
  return () => clearInterval(timer);
}

/** Runs without Redis: any call to fetch outside the injected deps is counted and refused. */
function noRedisSuite(title: string, fn: (ctx: { redisCalls: () => number }) => void): void {
  describe(title, () => {
    let calls = 0;
    beforeEach(() => {
      calls = 0;
      globalThis.fetch = async () => {
        calls += 1;
        throw new Error('unexpected network call');
      };
    });
    afterEach(() => {
      globalThis.fetch = shimFetch;
    });
    fn({ redisCalls: () => calls });
  });
}

noRedisSuite('POST /api/reserve authz and abuse (nothing reaches Redis or Resend)', ({ redisCalls }) => {
  let h: Harness;
  beforeEach(() => {
    h = makeDeps();
  });
  const untouched = (): void => {
    assert.equal(redisCalls(), 0);
    assert.equal(h.resend.calls, 0);
  };

  it('refuses a foreign Origin with 403', async () => {
    const res = await call(h, validReserve(), { origin: 'https://evil.example' });
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: 'Origine non autorisée' });
    untouched();
    assert.equal(h.turnstile.calls, 0);
  });

  it('refuses a request without Origin', async () => {
    const request = new Request('http://localhost/api/reserve', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(validReserve()),
    });
    const res = await handleReserve(request, h.deps);
    assert.equal(res.status, 403);
    untouched();
  });

  it('refuses the "null" Origin of sandboxed pages', async () => {
    assert.equal((await call(h, validReserve(), { origin: 'null' })).status, 403);
    untouched();
  });

  it('accepts the preview origin when the deployment is a preview', async () => {
    const preview = makeDeps({ env: makeEnv({ VERCEL_ENV: 'preview', VERCEL_URL: 'preview-abc.vercel.app' }) });
    const res = await call(preview, validReserve({ turnstileToken: 'bad' }), { origin: 'https://preview-abc.vercel.app' });
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { code: string }).code, 'captcha');
  });

  it('refuses the production origin from a preview deployment', async () => {
    const preview = makeDeps({ env: makeEnv({ VERCEL_ENV: 'preview', VERCEL_URL: 'preview-abc.vercel.app' }) });
    assert.equal((await call(preview, validReserve(), { origin: ORIGIN })).status, 403);
  });

  it('refuses a GET with 405', async () => {
    const request = new Request('http://localhost/api/reserve', { method: 'GET', headers: { origin: ORIGIN } });
    assert.equal((await handleReserve(request, h.deps)).status, 405);
    untouched();
  });

  it('refuses text/plain with 415', async () => {
    const request = new Request('http://localhost/api/reserve', {
      method: 'POST', headers: { 'content-type': 'text/plain', origin: ORIGIN }, body: JSON.stringify(validReserve()),
    });
    assert.equal((await handleReserve(request, h.deps)).status, 415);
    untouched();
  });

  it('refuses a 4097-byte body with 413', async () => {
    const res = await call(h, validReserve({ name: 'a'.repeat(4097) }));
    assert.equal(res.status, 413);
    untouched();
  });

  it('refuses null, array and invalid JSON bodies with 400', async () => {
    for (const raw of ['null', '[]', '{nope']) {
      const res = await handleReserve(reserveRequest(raw, {}, true), h.deps);
      assert.equal(res.status, 400, raw);
      assert.deepEqual(await res.json(), { error: ERR.INVALID_REQUEST });
    }
    untouched();
  });

  it('answers a filled honeypot like a success without verifier, quota or mail', async () => {
    const res = await call(h, validReserve({ website: 'http://spam.example' }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, linkExpiresAt: new Date(NOW + LINK_TTL_MS).toISOString() });
    assert.equal(h.turnstile.calls, 0);
    untouched();
  });

  it('refuses when the gate is unset, "1" or "false" and keeps the exact 403 body', async () => {
    for (const value of [undefined, '1', 'false', '']) {
      const closed = makeDeps({ env: makeEnv({ RESERVATIONS_OPEN: value }) });
      const res = await call(closed, validReserve());
      assert.equal(res.status, 403, String(value));
      assert.deepEqual(await res.json(), { error: MSG.CLOSED, code: 'closed' });
      assert.equal(closed.turnstile.calls, 0);
    }
    assert.equal(redisCalls(), 0);
  });

  it('treats " TRUE " as open (reaches the captcha step)', async () => {
    const open = makeDeps({ env: makeEnv({ RESERVATIONS_OPEN: ' TRUE ' }) });
    const res = await call(open, validReserve({ turnstileToken: 'bad' }));
    assert.equal(res.status, 400);
    assert.equal(open.turnstile.calls, 1);
  });

  it('refuses a missing or rejected captcha with 400 captcha', async () => {
    for (const token of [undefined, '', 'bad']) {
      const res = await call(h, validReserve({ turnstileToken: token }));
      assert.equal(res.status, 400, String(token));
      assert.deepEqual(await res.json(), { error: MSG.CAPTCHA, code: 'captcha' });
    }
    untouched();
  });

  it('answers 503 when the verifier is unavailable', async () => {
    const res = await call(h, validReserve({ turnstileToken: 'down' }));
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: ERR.UNAVAILABLE });
    untouched();
  });

  it('fails closed when the verifier is not configured', async () => {
    h.deps.verifyTurnstile = async () => ({ ok: false, reason: 'not-configured' });
    const res = await call(h, validReserve());
    assert.equal(res.status, 503);
    untouched();
  });

  it('answers 503 before any quota when LINK_SECRET is too short', async () => {
    const weak = makeDeps({ env: makeEnv({ LINK_SECRET: 'short' }) });
    const res = await call(weak, validReserve());
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: ERR.UNAVAILABLE });
    assert.equal(redisCalls(), 0);
    assert.equal(weak.resend.calls, 0);
  });

  it('answers 503 before any quota when RESEND_API_KEY is empty', async () => {
    const weak = makeDeps({ env: makeEnv({ RESEND_API_KEY: '' }) });
    assert.equal((await call(weak, validReserve())).status, 503);
    assert.equal(redisCalls(), 0);
  });

  it('keeps the existing field validation texts', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ showId: 'nope' }, ERR.UNKNOWN_SHOW],
      [{ name: 'A' }, 'Merci d’indiquer votre nom'],
      [{ name: 'Jean⁠Dupont' }, 'Merci d’indiquer votre nom'],
      [{ email: 'not-an-email' }, 'Adresse email invalide'],
      [{ quantity: 0 }, 'Vous pouvez réserver entre 1 et 4 places'],
      [{ quantity: 5 }, 'Vous pouvez réserver entre 1 et 4 places'],
      [{ quantity: '2' }, 'Vous pouvez réserver entre 1 et 4 places'],
      [{ quantity: 1.5 }, 'Vous pouvez réserver entre 1 et 4 places'],
      [{ turnstileToken: 'x'.repeat(2049) }, ERR.INVALID_REQUEST],
    ];
    for (const [override, message] of cases) {
      const res = await call(h, validReserve(override));
      assert.equal(res.status, 400, JSON.stringify(override));
      assert.deepEqual(await res.json(), { error: message });
    }
    untouched();
  });

  it('validates the show start before the gate on reserve (show-started even while the gate is closed)', async () => {
    const closed = makeDeps({ env: makeEnv({ RESERVATIONS_OPEN: undefined }) });
    closed.clock.now = SYNTH_START;
    const res = await call(closed, validReserve());
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: MSG.SHOW_STARTED, code: 'show-started' });
  });

  it('closes requests at the exact start instant', async () => {
    h.clock.now = SYNTH_START;
    const res = await call(h, validReserve());
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: MSG.SHOW_STARTED, code: 'show-started' });
    untouched();
  });

  it('answers 503 with no leak when Redis is down at the availability read', async () => {
    const down = redisDown();
    const logs = captureLogs();
    try {
      const res = await call(h, validReserve());
      assert.equal(res.status, 503);
      const body = JSON.stringify(await res.json());
      assert.equal(body, JSON.stringify({ error: ERR.UNAVAILABLE }));
      assert.ok(containsNone(body + logs.lines(), ['jean', 'Dupont', 'KV_', 'Redis', 'ok-']));
      assert.equal(h.resend.calls, 0);
    } finally {
      logs.restore();
      down.restore();
    }
  });

  it('answers 503 with no leak when Redis fails at the quota step', async () => {
    let n = 0;
    globalThis.fetch = async () => {
      n += 1;
      return n === 1 ? Response.json({ result: [0, 0, 0] }) : Response.json({ error: 'upstream failure' }, { status: 500 });
    };
    const logs = captureLogs();
    try {
      const res = await call(h, validReserve());
      assert.equal(res.status, 503);
      const body = JSON.stringify(await res.json());
      assert.ok(containsNone(body + logs.lines(), ['jean', 'Dupont', 'KV_', 'Redis']));
      assert.equal(h.resend.calls, 0);
    } finally {
      logs.restore();
    }
  });
});

describe('POST /api/reserve with Redis', { skip: redisSkipReason }, () => {
  let h: Harness;
  beforeEach(async () => {
    await redis('FLUSHDB');
    h = makeDeps();
  });

  const noMail = async (before: string): Promise<void> => {
    assert.equal(h.resend.calls, 0);
    assert.equal(await snapshot(), before);
  };

  it('refuses a full show with the public wording, no cooldown and no mail', async () => {
    for (let i = 0; i < 25; i += 1) await seed(`b${i}@gmail.com`, 4);
    const before = await snapshot();
    const res = await call(h, validReserve());
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: MSG.FULL, code: 'full', remaining: 0 });
    await noMail(before);
  });

  it('says how many seats are left when the quantity no longer fits', async () => {
    for (let i = 0; i < 24; i += 1) await seed(`b${i}@gmail.com`, 4);
    await seed('c@gmail.com', 3);
    const before = await snapshot();
    const res = await call(h, validReserve({ quantity: 2 }));
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: MSG.fewLeft(1), code: 'full', remaining: 1 });
    await noMail(before);
  });

  it('mails an address that already holds seats up to its cap, through a +tag alias', async () => {
    await seed('jean@example.ch', 3);
    const res = await call(h, validReserve({ email: 'jean+theatre@example.ch', quantity: 2 }));
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys((await res.json()) as object).sort(), ['linkExpiresAt', 'ok']);
    assert.equal(h.resend.calls, 1);
    assert.equal(await redis('EXISTS', 'quota:cooldown:jean@example.ch'), 1);
  });

  it('mails an address that already holds seats up to its cap, through a googlemail alias', async () => {
    await seed('a.b@gmail.com', 3);
    const res = await call(h, validReserve({ email: 'ab+x@googlemail.com', quantity: 2 }));
    assert.equal(res.status, 200);
    assert.equal(h.resend.calls, 1);
    assert.equal(await redis('EXISTS', 'quota:cooldown:ab@gmail.com'), 1);
  });

  it('mails an address whose domain already holds its cap of seats', async () => {
    for (const who of ['p', 'q', 'r']) await seed(`${who}@corp.example`, 4);
    const res = await call(h, validReserve({ email: 'new@corp.example', quantity: 1 }));
    assert.equal(res.status, 200);
    assert.equal(h.resend.calls, 1);
    assert.equal(await redis('EXISTS', 'quota:cooldown:new@corp.example'), 1);
  });

  it('answers identically whether the address holds 0, 3 or 4 seats', async () => {
    const answers: { status: number; body: Record<string, unknown> }[] = [];
    for (const held of [0, 3, 4]) {
      await redis('FLUSHDB');
      if (held > 0) await seed('jean@example.ch', held);
      const harness = makeDeps();
      const res = await call(harness, validReserve({ quantity: 4 }));
      const body = (await res.json()) as Record<string, unknown>;
      answers.push({ status: res.status, body });
      assert.equal(harness.resend.calls, 1, `${held} seats held`);
    }
    assert.deepEqual(answers[1], answers[0]);
    assert.deepEqual(answers[2], answers[0]);
    assert.equal(answers[0].status, 200);
  });

  it('reads the show counter once and charges the quota once on the success path', async () => {
    const commands = await redisCommandsOf(() => call(h, validReserve()));
    assert.deepEqual(commands.map((command) => command[0]), ['GET', 'EVAL']);
    assert.deepEqual(commands[0], ['GET', `show:${SYNTH_SHOW_ID}:booked`]);
    assert.ok(commands[1].includes('quota:cooldown:jean@example.ch'));
  });

  it('answers 429 cooldown with Retry-After for a second request, even through another +tag alias', async () => {
    assert.equal((await call(h, validReserve())).status, 200);
    const res = await call(h, validReserve({ email: 'jean+bis@example.ch' }));
    assert.equal(res.status, 429);
    const body = (await res.json()) as { code: string; error: string; retryAfterSeconds: number };
    assert.equal(body.code, 'cooldown');
    assert.equal(body.error, QUOTA_MESSAGES.cooldown);
    assert.ok(body.retryAfterSeconds >= 1 && body.retryAfterSeconds <= 600);
    assert.equal(res.headers.get('retry-after'), String(body.retryAfterSeconds));
    assert.equal(h.resend.calls, 1);
  });

  it('answers 429 budget without calling Resend once the daily budget is spent', async () => {
    await redis('SET', DAY_KEY, '60');
    const res = await call(h, validReserve());
    assert.equal(res.status, 429);
    assert.deepEqual(await res.json(), { error: QUOTA_MESSAGES.budget, code: 'budget' });
    assert.equal(h.resend.calls, 0);
  });

  it('sends one signed link and holds no seat', async () => {
    const res = await call(h, validReserve());
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ['linkExpiresAt', 'ok']);
    assert.equal(body.linkExpiresAt, new Date(NOW + LINK_TTL_MS).toISOString());
    assert.equal(h.outbox.length, 1);
    const mail = h.outbox[0];
    assert.deepEqual(mail.to, ['jean@example.ch']);
    assert.equal(mail.authorization, 'Bearer re_test_key');
    const link = mail.text.split('\n').find((line) => line.startsWith('https://'));
    assert.ok(link);
    const url = new URL(link);
    assert.equal(url.origin, 'https://melangedegenres.ch');
    assert.equal(url.pathname, '/billetterie');
    const verified = verifyLink(url.searchParams.get('token') ?? '', { secrets: loadLinkSecrets({ LINK_SECRET }), now: () => NOW });
    assert.ok(verified.ok);
    assert.deepEqual(
      { showId: verified.payload.showId, name: verified.payload.name, email: verified.payload.email, quantity: verified.payload.quantity },
      { showId: SYNTH_SHOW_ID, name: 'Jean Dupont', email: 'jean@example.ch', quantity: 2 }
    );
    assert.equal(url.searchParams.get('confirmer'), verified.id);
    assert.deepEqual(await keyList(), [DAY_KEY, 'quota:cooldown:jean@example.ch'].sort());
  });

  it('states in the mail that places are not guaranteed and gives the deadline', async () => {
    await call(h, validReserve());
    const { text, html, subject } = h.outbox[0];
    assert.ok(subject.startsWith('Confirmez votre demande de réservation'));
    for (const part of [text, html]) assert.ok(part.includes('ne sont pas garanties'));
    assert.ok(text.includes('avant le '));
  });

  it('puts none of the text of the name in the unsolicited mail', async () => {
    const hostile = 'Évil <script> evil.de/x +41 79 000 00 00';
    const res = await call(h, validReserve({ name: hostile }));
    assert.equal(res.status, 200);
    assert.equal(h.outbox.length, 1);
    const { subject, text, html } = h.outbox[0];
    assert.ok(text.startsWith('Bonjour,\n'));
    for (const fragment of ['Évil', 'script', 'evil.de', '+41', '79 000']) {
      for (const part of [subject, text, html]) assert.ok(!part.includes(fragment), fragment);
    }
  });

  it('accepts a valid address that starts with a plus sign', async () => {
    const res = await call(h, validReserve({ email: '+a@example.ch' }));
    assert.equal(res.status, 200);
    assert.ok((await keyList()).includes('quota:cooldown:+a@example.ch'));
  });

  it('rejects a captcha token used twice and sends only one mail', async () => {
    const token = freshToken();
    assert.equal((await call(h, validReserve({ turnstileToken: token }))).status, 200);
    const again = await call(h, validReserve({ turnstileToken: token, email: 'other@example.ch' }));
    assert.equal(again.status, 400);
    assert.equal(h.resend.calls, 1);
  });

  it('refunds and answers 400 bad-address when Resend rejects the recipient', async () => {
    h.resend.behavior = { status: 422, body: JSON.stringify({ name: 'validation_error', message: 'Invalid to: jean@example.ch' }) };
    const logs = captureLogs();
    try {
      const res = await call(h, validReserve());
      assert.equal(res.status, 400);
      assert.deepEqual(await res.json(), { error: MSG.BAD_ADDRESS, code: 'bad-address' });
      assert.ok(containsNone(logs.lines(), ['jean', 'Dupont', 'Invalid to']));
    } finally {
      logs.restore();
    }
    assert.equal(await redis('EXISTS', 'quota:cooldown:jean@example.ch'), 0);
    assert.equal(Number((await redis<string | null>('GET', DAY_KEY)) ?? 0), 0);
  });

  it('refunds on a provider failure and lets the user retry at once', async () => {
    h.resend.behavior = { status: 500, body: '{"name":"application_error","message":"boom jean@example.ch"}' };
    const logs = captureLogs();
    try {
      const res = await call(h, validReserve());
      assert.equal(res.status, 503);
      assert.deepEqual(await res.json(), { error: MSG.EMAIL_FAILED, code: 'email-failed' });
      assert.ok(containsNone(logs.lines(), ['jean', 'Dupont', 'boom']));
    } finally {
      logs.restore();
    }
    assert.equal(await redis('EXISTS', 'quota:cooldown:jean@example.ch'), 0);
    h.resend.behavior = 'ok';
    assert.equal((await call(h, validReserve())).status, 200);
  });

  it('refunds when Resend itself is rate limiting', async () => {
    h.resend.behavior = { status: 429, body: '{"name":"rate_limit_exceeded"}' };
    assert.equal((await call(h, validReserve())).status, 503);
    assert.equal(await redis('EXISTS', 'quota:cooldown:jean@example.ch'), 0);
  });

  it('keeps the cooldown and the counter when Resend hangs (outcome unknown)', async () => {
    const slow = makeDeps({ emailTimeoutMs: 30 });
    slow.resend.behavior = 'hang';
    const stop = keepAlive();
    try {
      const res = await call(slow, validReserve());
      assert.equal(res.status, 503);
      assert.deepEqual(await res.json(), { error: MSG.EMAIL_SLOW, code: 'email-slow' });
    } finally {
      stop();
    }
    assert.equal(await redis('EXISTS', 'quota:cooldown:jean@example.ch'), 1);
    assert.equal(await redis('GET', DAY_KEY), '1');
  });

  it('still answers the mail error when the refund itself fails, and keeps the state the failed refund implies', async () => {
    h.resend.behavior = { status: 500, body: '{"message":"jean@example.ch"}' };
    const real = globalThis.fetch;
    let refundAttempts = 0;
    globalThis.fetch = async (input, init) => {
      if (String(init?.body).includes('DECR')) {
        refundAttempts += 1;
        return Response.json({ error: 'upstream failure' }, { status: 500 });
      }
      return real(input, init);
    };
    const logs = captureLogs();
    try {
      const res = await call(h, validReserve());
      assert.equal(res.status, 503);
      const text = await res.text();
      assert.deepEqual(JSON.parse(text), { error: MSG.EMAIL_FAILED, code: 'email-failed' });
      assert.equal(refundAttempts, 1);
      assert.match(logs.lines(), /send quota refund error/);
      assert.ok(containsNone(text + logs.lines(), ['jean', 'Dupont']));
    } finally {
      logs.restore();
      globalThis.fetch = real;
    }
    assert.equal(await redis('EXISTS', 'quota:cooldown:jean@example.ch'), 1);
    assert.equal(await redis('GET', DAY_KEY), '1');
  });

  it('refunds against the day of the check even if the clock crosses midnight', async () => {
    h.clock.now = Date.UTC(2099, 5, 1, 23, 59, 59, 900);
    h.resend.behavior = { status: 500, body: '{}' };
    const advance = h.deps.fetch;
    h.deps.fetch = async (input, init) => {
      h.clock.now += 200;
      return advance(input, init);
    };
    assert.equal((await call(h, validReserve())).status, 503);
    assert.equal(Number((await redis<string | null>('GET', DAY_KEY)) ?? 0), 0);
    assert.equal(await redis('EXISTS', 'quota:sent:2099-06-02'), 0);
  });

  it('never logs an address, a name, a token or a provider body across a whole flow', async () => {
    const logs = captureLogs();
    try {
      assert.equal((await call(h, validReserve())).status, 200);
      h.resend.behavior = { status: 500, body: '{"message":"jean@example.ch"}' };
      await call(h, validReserve({ email: 'second@example.ch' }));
      await call(h, validReserve({ email: 'third@example.ch', turnstileToken: 'down' }));
      assert.ok(containsNone(logs.lines(), ['@example.ch', 'Dupont', 'ok-', 'eyJ']));
    } finally {
      logs.restore();
    }
  });
});
