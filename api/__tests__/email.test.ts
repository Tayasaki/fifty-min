import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VENUES, SHOWS } from '../../src/config/shows';
import { EmailError, buildCancelLink, buildConfirmLink, sendCancellation, sendConfirmRequest, sendRecap, type EmailDeps } from '../_lib/email';
import type { ReservationRecord } from '../_lib/redis';
import { captureLogs } from './helpers/flow';

const show = SHOWS[0];
const venue = VENUES.find((v) => v.id === show.venueId)!;
const LINK = 'https://melangedegenres.ch/billetterie?confirmer=ABCD1234&token=pay_load.sig-nature';
const EXPIRES = Date.UTC(2027, 1, 20, 18);
const ENV = { RESEND_API_KEY: 're_key_1', VERCEL_ENV: 'production' };

const record: ReservationRecord = {
  id: 'ABCD1234', showId: show.id, name: 'Jean Dupont', email: 'jean@example.ch', canonicalEmail: 'jean@example.ch', domain: 'example.ch',
  quantity: 2, createdAt: '2027-01-01T00:00:00.000Z', status: 'confirmed', confirmedAt: '2027-01-01T00:00:00.000Z', token: 'c'.repeat(32),
};

interface Captured {
  url: string;
  authorization: string | null;
  body: { from: string; to: string[]; reply_to: string; subject: string; text: string; html: string; attachments?: { filename: string; content: string }[] };
  hasSignal: boolean;
}

function deps(reply: (init: RequestInit | undefined) => Response | Promise<Response>, env: Record<string, string | undefined> = ENV, timeoutMs?: number): { deps: EmailDeps; sent: Captured[] } {
  const sent: Captured[] = [];
  const fetchStub: typeof fetch = async (input, init) => {
    sent.push({
      url: String(input),
      authorization: new Headers(init?.headers).get('authorization'),
      body: JSON.parse(String(init?.body)),
      hasSignal: init?.signal instanceof AbortSignal,
    });
    return reply(init);
  };
  return { deps: { fetch: fetchStub, env, timeoutMs }, sent };
}

const ok = () => Response.json({ id: 'msg_1' });
const requestParams = { name: 'Jean Dupont', email: 'jean@example.ch', quantity: 2, show, venue, link: LINK, linkExpiresAt: EXPIRES };

async function failure(promise: Promise<unknown>): Promise<EmailError> {
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof EmailError);
    return err;
  }
  assert.fail('expected an EmailError');
}

describe('sendConfirmRequest', () => {
  it('posts one authenticated request to Resend for the recipient', async () => {
    const { deps: d, sent } = deps(ok);
    await sendConfirmRequest(requestParams, d);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, 'https://api.resend.com/emails');
    assert.equal(sent[0].authorization, 'Bearer re_key_1');
    assert.deepEqual(sent[0].body.to, ['jean@example.ch']);
    assert.ok(sent[0].hasSignal);
  });

  it('pins the subject and states that places are not guaranteed, in text and html', async () => {
    const { deps: d, sent } = deps(ok);
    await sendConfirmRequest(requestParams, d);
    assert.equal(sent[0].body.subject, `Confirmez votre demande de réservation — 15 minutes, ${show.label}`);
    for (const part of [sent[0].body.text, sent[0].body.html]) assert.ok(part.includes('ne sont pas garanties'));
  });

  it('gives the deadline in Geneva time', async () => {
    const { deps: d, sent } = deps(ok);
    await sendConfirmRequest(requestParams, d);
    assert.ok(sent[0].body.text.includes('avant le samedi 20 février à 19:00'));
    assert.ok(sent[0].body.html.includes('avant le samedi 20 février à 19:00'));
  });

  it('uses the link verbatim in the text and as the button href', async () => {
    const { deps: d, sent } = deps(ok);
    await sendConfirmRequest(requestParams, d);
    assert.ok(sent[0].body.text.split('\n').includes(LINK));
    const href = /<a href="([^"]+)"/.exec(sent[0].body.html)?.[1] ?? '';
    assert.equal(href.replace(/&amp;/g, '&'), LINK);
  });

  it('escapes the name in html and leaves it raw in text', async () => {
    const { deps: d, sent } = deps(ok);
    await sendConfirmRequest({ ...requestParams, name: `<script>alert("x")</script> O'Neil & Co` }, d);
    assert.ok(!sent[0].body.html.includes('<script>'));
    assert.ok(sent[0].body.html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; O&#39;Neil &amp; Co'));
    assert.ok(sent[0].body.text.includes(`<script>alert("x")</script> O'Neil & Co`));
  });

  it('attaches no calendar file', async () => {
    const { deps: d, sent } = deps(ok);
    await sendConfirmRequest(requestParams, d);
    assert.equal(sent[0].body.attachments, undefined);
  });

  it('uses the default sender unless the environment sets one', async () => {
    const a = deps(ok);
    await sendConfirmRequest(requestParams, a.deps);
    assert.equal(a.sent[0].body.from, 'Mélange de Genres <billetterie@melangedegenres.ch>');
    const b = deps(ok, { ...ENV, RESERVATION_FROM_EMAIL: 'X <x@example.org>', RESERVATION_REPLY_TO: 'r@example.org' });
    await sendConfirmRequest(requestParams, b.deps);
    assert.equal(b.sent[0].body.from, 'X <x@example.org>');
    assert.equal(b.sent[0].body.reply_to, 'r@example.org');
  });
});

describe('send classification', () => {
  const cases: [string, number, string, EmailError['kind']][] = [
    ['422 validation_error', 422, JSON.stringify({ name: 'validation_error', message: 'Invalid to' }), 'bad-address'],
    ['400 validation_error', 400, JSON.stringify({ name: 'validation_error' }), 'bad-address'],
    ['422 invalid_to_address', 422, JSON.stringify({ name: 'invalid_to_address' }), 'bad-address'],
    ['422 with another name', 422, JSON.stringify({ name: 'invalid_from_address' }), 'provider'],
    ['422 with an unparsable body', 422, '<html>', 'provider'],
    ['403 validation_error (unverified domain)', 403, JSON.stringify({ name: 'validation_error' }), 'provider'],
    ['401 missing_api_key', 401, JSON.stringify({ name: 'missing_api_key' }), 'provider'],
    ['403', 403, '{}', 'provider'],
    ['429', 429, JSON.stringify({ name: 'rate_limit_exceeded' }), 'provider'],
    ['500', 500, '{}', 'provider'],
    ['503', 503, '', 'provider'],
  ];
  for (const [title, status, body, kind] of cases) {
    it(`classifies ${title} as ${kind}`, async () => {
      const { deps: d } = deps(() => new Response(body, { status }));
      const err = await failure(sendConfirmRequest(requestParams, d));
      assert.equal(err.kind, kind);
      assert.equal(err.status, status);
      assert.equal(err.message, `Resend HTTP ${status}`);
    });
  }

  it('classifies a network error as provider', async () => {
    const { deps: d } = deps(() => {
      throw new TypeError('fetch failed');
    });
    assert.equal((await failure(sendConfirmRequest(requestParams, d))).kind, 'provider');
  });

  it('classifies a hung request as timeout once timeoutMs passes', async () => {
    const keepAlive = setInterval(() => undefined, 1000);
    try {
      const { deps: d } = deps((init) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))), ENV, 20);
      assert.equal((await failure(sendConfirmRequest(requestParams, d))).kind, 'timeout');
    } finally {
      clearInterval(keepAlive);
    }
  });

  it('classifies a missing key as not-configured without any request', async () => {
    for (const RESEND_API_KEY of [undefined, '']) {
      const { deps: d, sent } = deps(ok, { RESEND_API_KEY });
      assert.equal((await failure(sendConfirmRequest(requestParams, d))).kind, 'not-configured');
      assert.equal(sent.length, 0);
    }
  });

  it('never puts the recipient in the error message or the logs, even when Resend echoes it', async () => {
    const logs = captureLogs();
    try {
      const { deps: d } = deps(() => new Response(JSON.stringify({ name: 'validation_error', message: 'Invalid to: jean@example.ch' }), { status: 422 }));
      const err = await failure(sendConfirmRequest(requestParams, d));
      assert.ok(!err.message.includes('jean'));
      assert.ok(!JSON.stringify(err).includes('jean'));
      assert.ok(!logs.lines().includes('jean'));
    } finally {
      logs.restore();
    }
  });
});

describe('sendRecap and sendCancellation', () => {
  const cancelLink = buildCancelLink(ENV, record);

  it('sendRecap attaches the calendar file and carries the cancel link', async () => {
    const { deps: d, sent } = deps(ok);
    await sendRecap({ record, show, venue, cancelLink }, d);
    assert.equal(sent[0].body.subject, `Réservation confirmée — 15 minutes, ${show.label}`);
    assert.deepEqual(sent[0].body.attachments?.map((a) => a.filename), ['15-minutes.ics']);
    assert.ok(sent[0].body.text.includes(cancelLink));
    assert.ok(sent[0].body.html.includes(`href="${cancelLink}"`));
    assert.ok(sent[0].body.text.includes('Réservation n° ABCD1234'));
  });

  it('sendCancellation sends no attachment and links to the billetterie', async () => {
    const { deps: d, sent } = deps(ok);
    await sendCancellation({ record, show, venue }, d);
    assert.equal(sent[0].body.subject, `Annulation de votre réservation — 15 minutes, ${show.label}`);
    assert.equal(sent[0].body.attachments, undefined);
    assert.ok(sent[0].body.text.includes('https://melangedegenres.ch/billetterie'));
  });

  it('every link of a preview deployment starts with the preview host', async () => {
    const env = { ...ENV, VERCEL_ENV: 'preview', VERCEL_URL: 'preview-abc.vercel.app' };
    const a = deps(ok, env);
    await sendRecap({ record, show, venue, cancelLink: buildCancelLink(env, record) }, a.deps);
    const b = deps(ok, env);
    await sendCancellation({ record, show, venue }, b.deps);
    for (const text of [a.sent[0].body.text + a.sent[0].body.html, b.sent[0].body.text + b.sent[0].body.html]) {
      const hosts = [...text.matchAll(/https:\/\/(?!calendar\.google\.com)[a-z0-9.-]+/g)].map((m) => m[0]);
      assert.ok(hosts.length > 0);
      assert.ok(hosts.every((host) => host === 'https://preview-abc.vercel.app'), hosts.join(','));
    }
  });

  it('production without PUBLIC_SITE_URL uses melangedegenres.ch and PUBLIC_SITE_URL wins when set', () => {
    assert.equal(buildCancelLink({ VERCEL_ENV: 'production' }, record), `https://melangedegenres.ch/billetterie?annuler=ABCD1234&token=${'c'.repeat(32)}`);
    assert.equal(buildConfirmLink({ VERCEL_ENV: 'production', PUBLIC_SITE_URL: 'https://example.org/' }, 'ID', 'a.b'), 'https://example.org/billetterie?confirmer=ID&token=a.b');
  });

  it('escapes names in the recap html and not in its text', async () => {
    const { deps: d, sent } = deps(ok);
    await sendRecap({ record: { ...record, name: '<b>"x"</b>' }, show, venue, cancelLink }, d);
    assert.ok(!sent[0].body.html.includes('<b>"x"</b>'));
    assert.ok(sent[0].body.text.includes('<b>"x"</b>'));
  });

  it('classifies recap failures the same way', async () => {
    const { deps: d } = deps(() => new Response('{}', { status: 500 }));
    assert.equal((await failure(sendRecap({ record, show, venue, cancelLink }, d))).kind, 'provider');
    assert.equal((await failure(sendCancellation({ record, show, venue }, d))).kind, 'provider');
  });
});
