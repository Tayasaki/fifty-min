import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTurnstileVerifier, type TurnstileVerifier } from '../_lib/turnstile';
import { captureLogs } from './helpers/flow';

const SECRET = 'ts-secret-value';
const URL_ = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

interface Seen {
  url: string;
  method?: string;
  contentType: string | null;
  body: URLSearchParams;
  hasSignal: boolean;
}

function stub(reply: (seen: Seen) => Response | Promise<Response>): { fetch: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetchStub: typeof fetch = async (input, init) => {
    const record: Seen = {
      url: String(input),
      method: init?.method,
      contentType: new Headers(init?.headers).get('content-type'),
      body: new URLSearchParams(String(init?.body)),
      hasSignal: init?.signal instanceof AbortSignal,
    };
    seen.push(record);
    return reply(record);
  };
  return { fetch: fetchStub, seen };
}

const ok = () => Response.json({ success: true });

function verifier(reply: (seen: Seen) => Response | Promise<Response>, env: Record<string, string | undefined> = { TURNSTILE_SECRET_KEY: SECRET }, timeoutMs?: number) {
  const s = stub(reply);
  return { verify: createTurnstileVerifier({ env, fetch: s.fetch, timeoutMs }), seen: s.seen };
}

describe('createTurnstileVerifier', () => {
  it('accepts a token Cloudflare approves', async () => {
    const { verify } = verifier(ok);
    assert.deepEqual(await verify('token-1'), { ok: true });
  });

  it('posts the secret and the token as a form to siteverify with a timeout signal and nothing else', async () => {
    const { verify, seen } = verifier(ok);
    await verify('token-1');
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, URL_);
    assert.equal(seen[0].method, 'POST');
    assert.equal(seen[0].contentType, 'application/x-www-form-urlencoded');
    assert.deepEqual([...seen[0].body.keys()].sort(), ['response', 'secret']);
    assert.equal(seen[0].body.get('secret'), SECRET);
    assert.equal(seen[0].body.get('response'), 'token-1');
    assert.ok(seen[0].hasSignal);
  });

  it('refuses an empty token without any request', async () => {
    const { verify, seen } = verifier(ok);
    assert.deepEqual(await verify(''), { ok: false, reason: 'missing-token' });
    assert.equal(seen.length, 0);
  });

  it('fails closed when the secret is unset or empty, without any request', async () => {
    for (const env of [{}, { TURNSTILE_SECRET_KEY: '' }]) {
      const { verify, seen } = verifier(ok, env);
      assert.deepEqual(await verify('token-1'), { ok: false, reason: 'not-configured' });
      assert.equal(seen.length, 0);
    }
  });

  it('fails closed in every environment, including preview and development', async () => {
    for (const VERCEL_ENV of ['production', 'preview', 'development', undefined]) {
      const { verify, seen } = verifier(ok, { VERCEL_ENV });
      assert.deepEqual(await verify('token-1'), { ok: false, reason: 'not-configured' });
      assert.equal(seen.length, 0);
    }
  });

  it('rejects a token Cloudflare says is spent or invalid', async () => {
    for (const code of ['timeout-or-duplicate', 'invalid-input-response', 'missing-input-response']) {
      const { verify } = verifier(() => Response.json({ success: false, 'error-codes': [code] }));
      assert.deepEqual(await verify('token-1'), { ok: false, reason: 'rejected' }, code);
    }
  });

  it('treats an internal error, a bad secret or an empty failure as an outage', async () => {
    for (const codes of [['internal-error'], ['invalid-input-secret'], ['missing-input-secret'], [], ['timeout-or-duplicate', 'internal-error']]) {
      const { verify } = verifier(() => Response.json({ success: false, 'error-codes': codes }));
      assert.deepEqual(await verify('token-1'), { ok: false, reason: 'unavailable' }, JSON.stringify(codes));
    }
  });

  it('treats HTTP 5xx and 4xx answers as an outage', async () => {
    for (const status of [500, 503, 429, 403]) {
      const { verify } = verifier(() => new Response('{}', { status }));
      assert.deepEqual(await verify('token-1'), { ok: false, reason: 'unavailable' }, String(status));
    }
  });

  it('treats an invalid JSON body as an outage', async () => {
    const { verify } = verifier(() => new Response('<html>', { status: 200 }));
    assert.deepEqual(await verify('token-1'), { ok: false, reason: 'unavailable' });
  });

  it('treats a network failure as an outage', async () => {
    const { verify } = verifier(() => {
      throw new TypeError('fetch failed');
    });
    assert.deepEqual(await verify('token-1'), { ok: false, reason: 'unavailable' });
  });

  it('treats a hung request as an outage once the timeout passes', async () => {
    const keepAlive = setInterval(() => undefined, 1000);
    try {
      const s = createTurnstileVerifier({
        env: { TURNSTILE_SECRET_KEY: SECRET },
        timeoutMs: 20,
        fetch: (_input, init) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))),
      });
      assert.deepEqual(await s('token-1'), { ok: false, reason: 'unavailable' });
    } finally {
      clearInterval(keepAlive);
    }
  });

  it('single use: a token is accepted once and rejected the second time', async () => {
    const spent = new Set<string>();
    const { verify } = verifier((seen) => {
      const token = seen.body.get('response') ?? '';
      if (spent.has(token)) return Response.json({ success: false, 'error-codes': ['timeout-or-duplicate'] });
      spent.add(token);
      return ok();
    });
    assert.deepEqual(await verify('token-1'), { ok: true });
    assert.deepEqual(await verify('token-1'), { ok: false, reason: 'rejected' });
  });

  it('never logs the secret or the token', async () => {
    const logs = captureLogs();
    try {
      for (const reply of [ok, () => new Response('boom', { status: 500 }), () => { throw new Error('fail'); }] as (() => Response)[]) {
        const { verify } = verifier(reply);
        await verify('token-xyz');
      }
      assert.ok(!logs.lines().includes(SECRET) && !logs.lines().includes('token-xyz'));
    } finally {
      logs.restore();
    }
  });

  it('is a function of its inputs only (no shared state between verifiers)', async () => {
    const a: TurnstileVerifier = verifier(ok).verify;
    const b: TurnstileVerifier = verifier(ok, {}).verify;
    assert.deepEqual(await a('t'), { ok: true });
    assert.deepEqual(await b('t'), { ok: false, reason: 'not-configured' });
  });
});
