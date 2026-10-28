import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { LinkSecretError, LinkSecrets, loadLinkSecrets, signLink, verifyLink } from '../_lib/link';

const SECRET_A = 'test-fixture-secret-A-0123456789abcdef';
const SECRET_B = 'test-fixture-secret-B-0123456789abcdef';
const A = { kid: '1', secret: SECRET_A };
const B = { kid: '2', secret: SECRET_B };
const secrets: LinkSecrets = { current: A };
const NOW = 1_800_000_000_000;
const now = () => NOW;
const input = { showId: '2027-02-20-monique', name: 'Éloïse Müller', email: 'eloise@example.ch', quantity: 3 };

const b64 = (buf: Buffer | string) => Buffer.from(buf).toString('base64url');

function split(token: string): { payload: Record<string, unknown>; encoded: string; sig: string } {
  const [encoded, sig] = token.split('.');
  return { payload: JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')), encoded, sig };
}

function forge(payload: Record<string, unknown>, secret: string, prefix = 'confirm:v1\n'): string {
  const encoded = b64(JSON.stringify(payload));
  return `${encoded}.${b64(createHmac('sha256', secret).update(prefix + encoded).digest())}`;
}

function signed(overrides: Partial<typeof input> = {}, opts: { nonce?: string } = {}): string {
  return signLink({ ...input, ...overrides }, { secrets, now, ...opts }).token;
}

describe('signLink / verifyLink round trip', () => {
  it('returns identical payload fields, including a non-ASCII name', () => {
    const result = verifyLink(signed(), { secrets, now });
    assert.ok(result.ok);
    assert.equal(result.payload.showId, input.showId);
    assert.equal(result.payload.name, input.name);
    assert.equal(result.payload.email, input.email);
    assert.equal(result.payload.quantity, input.quantity);
    assert.equal(result.payload.kid, '1');
    assert.equal(result.payload.v, 1);
    assert.equal(result.payload.purpose, 'confirm:v1');
  });

  it('derives an 8-char uppercase hex id, stable across verifications', () => {
    const { token, id } = signLink(input, { secrets, now });
    assert.match(id, /^[A-F0-9]{8}$/);
    const first = verifyLink(token, { secrets, now });
    const second = verifyLink(token, { secrets, now });
    assert.ok(first.ok && second.ok);
    assert.equal(first.id, id);
    assert.equal(second.id, id);
  });

  it('gives different ids to tokens with different nonces', () => {
    const a = signLink(input, { secrets, now, nonce: 'n1' });
    const b = signLink(input, { secrets, now, nonce: 'n2' });
    assert.notEqual(a.id, b.id);
  });

  it('generates a random nonce by default', () => {
    assert.notEqual(signed(), signed());
  });

  it('defaults to a 48 h lifetime', () => {
    const { exp } = signLink(input, { secrets, now });
    assert.equal(exp, NOW / 1000 + 48 * 3600);
  });
});

describe('tamper matrix', () => {
  const edits: Array<[string, unknown]> = [
    ['showId', '2027-02-21-monique'],
    ['name', 'Mallory'],
    ['email', 'mallory@example.ch'],
    ['quantity', 4],
    ['exp', 1_900_000_000],
    ['nonce', 'other'],
    ['v', 2],
    ['purpose', 'cancel:v1'],
  ];
  for (const [field, value] of edits) {
    it(`rejects an edited ${field} that was not re-signed`, () => {
      const { payload, sig } = split(signed());
      const token = `${b64(JSON.stringify({ ...payload, [field]: value }))}.${sig}`;
      const result = verifyLink(token, { secrets, now });
      assert.deepEqual(result, { ok: false, reason: 'bad-signature' });
    });
  }

  it('rejects an edited kid (unknown kid)', () => {
    const { payload, sig } = split(signed());
    const token = `${b64(JSON.stringify({ ...payload, kid: '9' }))}.${sig}`;
    assert.deepEqual(verifyLink(token, { secrets, now }), { ok: false, reason: 'unknown-kid' });
  });

  it('rejects an edited kid pointing to a known key', () => {
    const { payload, sig } = split(signed());
    const token = `${b64(JSON.stringify({ ...payload, kid: '2' }))}.${sig}`;
    const both: LinkSecrets = { current: A, previous: B };
    assert.deepEqual(verifyLink(token, { secrets: both, now }), { ok: false, reason: 'bad-signature' });
  });

  it('rejects a flipped signature character', () => {
    const { encoded, sig } = split(signed());
    const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
    assert.deepEqual(verifyLink(`${encoded}.${flipped}`, { secrets, now }), { ok: false, reason: 'bad-signature' });
  });

  it('rejects a truncated signature', () => {
    const { encoded, sig } = split(signed());
    assert.deepEqual(verifyLink(`${encoded}.${sig.slice(0, -4)}`, { secrets, now }), { ok: false, reason: 'bad-signature' });
  });

  const malformed: Array<[string, (t: string) => string]> = [
    ['an empty token', () => ''],
    ['an empty signature', (t) => `${t.split('.')[0]}.`],
    ['no dot', (t) => t.replace('.', '')],
    ['two dots', (t) => `${t}.x`],
    ['non base64url characters', (t) => `${t.split('.')[0]}.@@@@`],
  ];
  for (const [label, mutate] of malformed) {
    it(`rejects ${label}`, () => {
      const result = verifyLink(mutate(signed()), { secrets, now });
      assert.ok(!result.ok && (result.reason === 'malformed' || result.reason === 'bad-signature'));
    });
  }

  it('rejects a token of 2049 characters before parsing', () => {
    assert.deepEqual(verifyLink('a'.repeat(2049), { secrets, now }), { ok: false, reason: 'malformed' });
  });

  it('rejects a correctly signed payload with the wrong field types', () => {
    const { payload } = split(signed());
    const token = forge({ ...payload, quantity: '3' }, SECRET_A);
    assert.deepEqual(verifyLink(token, { secrets, now }), { ok: false, reason: 'malformed' });
  });
});

describe('domain separation', () => {
  it('rejects a MAC computed with a different purpose prefix', () => {
    const { payload } = split(signed());
    assert.deepEqual(verifyLink(forge(payload, SECRET_A, 'cancel:v1\n'), { secrets, now }), { ok: false, reason: 'bad-signature' });
  });

  it('rejects a MAC computed without the prefix', () => {
    const { payload } = split(signed());
    assert.deepEqual(verifyLink(forge(payload, SECRET_A, ''), { secrets, now }), { ok: false, reason: 'bad-signature' });
  });

  it('reports wrong-purpose for a correctly signed cancel payload', () => {
    const { payload } = split(signed());
    assert.deepEqual(verifyLink(forge({ ...payload, purpose: 'cancel:v1' }, SECRET_A), { secrets, now }), {
      ok: false,
      reason: 'wrong-purpose',
    });
  });
});

describe('expiry', () => {
  const { token, exp } = signLink(input, { secrets, now });
  it('is valid one second before exp', () => {
    assert.ok(verifyLink(token, { secrets, now: () => (exp - 1) * 1000 }).ok);
  });
  it('is expired at exp', () => {
    assert.deepEqual(verifyLink(token, { secrets, now: () => exp * 1000 }), { ok: false, reason: 'expired' });
  });
  it('is expired after exp', () => {
    assert.deepEqual(verifyLink(token, { secrets, now: () => (exp + 1) * 1000 }), { ok: false, reason: 'expired' });
  });
});

describe('key rotation', () => {
  const tokenA = signLink(input, { secrets: { current: A }, now }).token;

  it('verifies an old token through the previous key', () => {
    assert.ok(verifyLink(tokenA, { secrets: { current: B, previous: A }, now }).ok);
  });
  it('reports unknown-kid once the previous key is dropped', () => {
    assert.deepEqual(verifyLink(tokenA, { secrets: { current: B }, now }), { ok: false, reason: 'unknown-kid' });
  });
  it('does not verify a token signed with B under A alone', () => {
    const tokenB = signLink(input, { secrets: { current: B }, now }).token;
    assert.deepEqual(verifyLink(tokenB, { secrets: { current: A }, now }), { ok: false, reason: 'unknown-kid' });
  });
  it('rejects a token carrying A kid but signed with B secret', () => {
    const { payload } = split(tokenA);
    assert.deepEqual(verifyLink(forge(payload, SECRET_B), { secrets, now }), { ok: false, reason: 'bad-signature' });
  });
});

describe('fail closed', () => {
  it('verifyLink without secrets reports no-secret', () => {
    assert.deepEqual(verifyLink(signed(), { secrets: null, now }), { ok: false, reason: 'no-secret' });
  });
  it('signLink without secrets throws LinkSecretError', () => {
    assert.throws(() => signLink(input, { secrets: null, now }), LinkSecretError);
  });
  it('verifyLink never throws on garbage', () => {
    for (const junk of ['.', '..', 'a.b', '{}', '\u0000', 'é.é']) {
      assert.doesNotThrow(() => verifyLink(junk, { secrets, now }));
    }
  });
});

describe('loadLinkSecrets', () => {
  it('returns null when nothing is configured', () => assert.equal(loadLinkSecrets({}), null));
  it('returns null for an empty secret', () => assert.equal(loadLinkSecrets({ LINK_SECRET: '' }), null));
  it('returns null for a 31-character secret', () => assert.equal(loadLinkSecrets({ LINK_SECRET: 'x'.repeat(31) }), null));
  it('accepts a 32-character secret with default kid 1', () => {
    assert.deepEqual(loadLinkSecrets({ LINK_SECRET: 'x'.repeat(32) }), { current: { kid: '1', secret: 'x'.repeat(32) } });
  });
  it('reads kid and previous secret', () => {
    const result = loadLinkSecrets({
      LINK_SECRET: SECRET_B,
      LINK_SECRET_KID: '2',
      LINK_SECRET_PREVIOUS: SECRET_A,
    });
    assert.deepEqual(result, { current: B, previous: { kid: '0', secret: SECRET_A } });
  });
  it('ignores a too-short previous secret', () => {
    const result = loadLinkSecrets({ LINK_SECRET: SECRET_A, LINK_SECRET_PREVIOUS: 'short' });
    assert.deepEqual(result, { current: A });
  });
});
