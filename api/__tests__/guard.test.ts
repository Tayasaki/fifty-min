import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalEmail,
  checkContentType,
  checkMethod,
  checkOrigin,
  emailDomain,
  isHoneypotFilled,
  isReservationsOpen,
  readJsonBody,
  validateName,
  validateReserveFields,
} from '../_lib/guard';
import { getShow, showStart } from '../../src/config/shows';

const SHOW_ID = '2027-02-20-monique';
const START = showStart(getShow(SHOW_ID)!).getTime();
const ORIGINS = ['https://melangedegenres.ch'] as const;

function req(init: RequestInit & { headers?: Record<string, string> } = {}): Request {
  return new Request('http://localhost/api/reserve', { method: 'POST', ...init });
}

function streamRequest(bytes: Uint8Array): Request {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.subarray(0, Math.ceil(bytes.length / 2)));
      controller.enqueue(bytes.subarray(Math.ceil(bytes.length / 2)));
      controller.close();
    },
  });
  return new Request('http://localhost/api/reserve', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
}

function jsonOfSize(size: number): string {
  const overhead = JSON.stringify({ a: '' }).length;
  return JSON.stringify({ a: 'x'.repeat(size - overhead) });
}

describe('checkMethod', () => {
  it('rejects a method other than the allowed one with 405', () => {
    const result = checkMethod(new Request('http://localhost/', { method: 'GET' }), 'POST');
    assert.deepEqual(result.ok, false);
    assert.equal(!result.ok && result.status, 405);
  });
  it('accepts the allowed method', () => {
    assert.deepEqual(checkMethod(req(), 'POST'), { ok: true });
  });
});

describe('checkContentType', () => {
  const cases: Array<[string, Record<string, string>, boolean]> = [
    ['application/json', { 'content-type': 'application/json' }, true],
    ['application/json with charset', { 'content-type': 'application/json; charset=utf-8' }, true],
    ['text/plain', { 'content-type': 'text/plain' }, false],
    ['missing header', {}, false],
  ];
  for (const [label, headers, ok] of cases) {
    it(`${ok ? 'accepts' : 'rejects with 415'} ${label}`, () => {
      const result = checkContentType(new Request('http://localhost/', { method: 'POST', body: '{}', headers }));
      assert.equal(result.ok, ok);
      if (!result.ok) assert.equal(result.status, 415);
    });
  }
});

describe('checkOrigin', () => {
  const cases: Array<[string, string | undefined, boolean]> = [
    ['exact listed origin', 'https://melangedegenres.ch', true],
    ['absent origin', undefined, false],
    ['null origin', 'null', false],
    ['unlisted origin', 'https://evil.example', false],
    ['prefix spoof', 'https://melangedegenres.ch.evil.example', false],
  ];
  for (const [label, origin, ok] of cases) {
    it(`${ok ? 'accepts' : 'rejects with 403'} ${label}`, () => {
      const headers: Record<string, string> = origin === undefined ? {} : { origin };
      const result = checkOrigin(req({ headers }), ORIGINS);
      assert.equal(result.ok, ok);
      if (!result.ok) assert.equal(result.status, 403);
    });
  }
});

describe('readJsonBody', () => {
  it('accepts a body of exactly 4096 bytes', async () => {
    const result = await readJsonBody(req({ body: jsonOfSize(4096) }));
    assert.equal(result.ok, true);
  });
  it('rejects 4097 bytes with 413 on a stream without Content-Length', async () => {
    const result = await readJsonBody(streamRequest(new TextEncoder().encode(jsonOfSize(4097))));
    assert.equal(!result.ok && result.status, 413);
  });
  it('accepts 4096 bytes on a stream without Content-Length', async () => {
    const result = await readJsonBody(streamRequest(new TextEncoder().encode(jsonOfSize(4096))));
    assert.equal(result.ok, true);
  });
  it('rejects 413 from the Content-Length header alone', async () => {
    const result = await readJsonBody(req({ body: '{}', headers: { 'content-length': '4097' } }));
    assert.equal(!result.ok && result.status, 413);
  });
  it('honours a custom limit', async () => {
    const result = await readJsonBody(req({ body: jsonOfSize(100) }), 50);
    assert.equal(!result.ok && result.status, 413);
  });
  for (const [label, body] of [['invalid JSON', '{nope'], ['an array', '[1]'], ['null', 'null'], ['a string', '"x"'], ['empty', '']] as const) {
    it(`rejects ${label} with 400`, async () => {
      const result = await readJsonBody(req({ body }));
      assert.equal(!result.ok && result.status, 400);
    });
  }
  it('returns the parsed object', async () => {
    const result = await readJsonBody(req({ body: '{"a":1}' }));
    assert.deepEqual(result.ok && result.body, { a: 1 });
  });
});

describe('isHoneypotFilled', () => {
  const cases: Array<[string, Record<string, unknown>, boolean]> = [
    ['filled', { website: 'x' }, true],
    ['absent', {}, false],
    ['empty string', { website: '' }, false],
    ['zero', { website: 0 }, false],
  ];
  for (const [label, body, expected] of cases) {
    it(`is ${expected} when website is ${label}`, () => assert.equal(isHoneypotFilled(body), expected));
  }
});

describe('isReservationsOpen', () => {
  const cases: Array<[string | undefined, boolean]> = [
    ['true', true], [' TRUE ', true], [undefined, false], ['', false], ['1', false], ['false', false], ['yes', false],
  ];
  for (const [value, expected] of cases) {
    it(`is ${expected} for ${JSON.stringify(value)}`, () => {
      assert.equal(isReservationsOpen({ RESERVATIONS_OPEN: value }), expected);
    });
  }
});

describe('validateName', () => {
  const rejected: Array<[string, unknown]> = [
    ['empty', ''],
    ['one char after trim', ' a '],
    ['101 chars', 'a'.repeat(101)],
    ['LF header injection', 'Jean\nBcc: x@y.z'],
    ['CR', 'A\rB'],
    ['line separator', 'Bo\u2028b'],
    ['paragraph separator', 'Bo\u2029b'],
    ['NUL', 'Bo\u0000b'],
    ['URL scheme', 'https://spam.example'],
    ['www prefix', 'www.spam.ch'],
    ['domain with common TLD', 'buy at spam.com'],
    ['at sign', 'a@b.ch'],
    ['not a string', 42],
  ];
  for (const [label, raw] of rejected) {
    it(`rejects ${label}`, () => assert.equal(validateName(raw).ok, false));
  }
  const accepted: Array<[string, string, string]> = [
    ['accents', 'Élodie', 'Élodie'],
    ['apostrophe and hyphen', 'Jean-Pierre O’Neil', 'Jean-Pierre O’Neil'],
    ['ascii apostrophe', "D'Arcy", "D'Arcy"],
    ['initials with dots', 'J.-P. Martin', 'J.-P. Martin'],
    ['exactly 2 chars', 'Al', 'Al'],
    ['exactly 100 chars', 'a'.repeat(100), 'a'.repeat(100)],
    ['trimmed', '  Marie  ', 'Marie'],
    ['100 code points (astral)', '😀'.repeat(100), '😀'.repeat(100)],
    ['NFC normalised', 'Éloi'.normalize('NFD'), 'Éloi'],
  ];
  for (const [label, raw, value] of accepted) {
    it(`accepts ${label}`, () => assert.deepEqual(validateName(raw), { ok: true, value }));
  }
  it('rejects 101 code points even when UTF-16 length differs', () => {
    assert.equal(validateName('😀'.repeat(101)).ok, false);
  });
});

describe('canonicalEmail / emailDomain', () => {
  const cases: Array<[string, string]> = [
    ['A.B+x@Gmail.com', 'ab@gmail.com'],
    ['ab@googlemail.com', 'ab@gmail.com'],
    ['a.b+x@example.ch', 'a.b@example.ch'],
    ['+x@example.ch', ''],
    ['  Jean@Example.CH  ', 'jean@example.ch'],
    ['no-at-sign', ''],
  ];
  for (const [input, expected] of cases) {
    it(`maps ${JSON.stringify(input)} to ${JSON.stringify(expected)}`, () => assert.equal(canonicalEmail(input), expected));
  }
  it('extracts the lowercase domain', () => {
    assert.equal(emailDomain('Jean@Example.CH'), 'example.ch');
  });
});

describe('validateReserveFields', () => {
  const base = { showId: SHOW_ID, name: 'Jean Dupont', email: 'Jean.Dupont@Example.ch ', quantity: 2 };
  const before = () => START - 1;

  function longEmail(total: number): string {
    const domain = (labelLast: number) => `${'a'.repeat(63)}.${'a'.repeat(63)}.${'a'.repeat(labelLast)}.com`;
    const local = 'l'.repeat(64);
    const email = `${local}@${domain(57)}`;
    return email.length === 254 && total === 254 ? email : `${local}@${domain(57 + total - 254)}`;
  }

  it('returns normalised fields', () => {
    const result = validateReserveFields({ ...base, turnstileToken: ' tok ' }, before);
    assert.deepEqual(result, {
      ok: true,
      value: {
        showId: SHOW_ID,
        name: 'Jean Dupont',
        email: 'jean.dupont@example.ch',
        quantity: 2,
        canonicalEmail: 'jean.dupont@example.ch',
        turnstileToken: 'tok',
      },
    });
  });

  it('allows an empty turnstile token', () => {
    const result = validateReserveFields(base, before);
    assert.equal(result.ok && result.value.turnstileToken, '');
  });

  it('rejects an oversized turnstile token', () => {
    assert.equal(validateReserveFields({ ...base, turnstileToken: 'x'.repeat(2049) }, before).ok, false);
  });

  for (const q of [0, 5, 1.5, '2', NaN, null, undefined, -1]) {
    it(`rejects quantity ${String(q)}`, () => {
      const result = validateReserveFields({ ...base, quantity: q }, before);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.message, 'Vous pouvez réserver entre 1 et 4 places');
    });
  }

  for (const q of [1, 4]) {
    it(`accepts quantity ${q}`, () => assert.equal(validateReserveFields({ ...base, quantity: q }, before).ok, true));
  }

  it('rejects an unknown show', () => {
    const result = validateReserveFields({ ...base, showId: 'nope' }, before);
    assert.deepEqual(result, { ok: false, status: 400, message: 'Représentation inconnue' });
  });

  it('closes at the show start and accepts 1 ms before', () => {
    const closed = validateReserveFields(base, () => START);
    assert.deepEqual(closed, { ok: false, status: 400, message: 'Les réservations pour cette date sont closes' });
    assert.equal(validateReserveFields(base, () => START - 1).ok, true);
  });

  it('rejects a bad name with the existing message', () => {
    const result = validateReserveFields({ ...base, name: 'A' }, before);
    assert.deepEqual(result, { ok: false, status: 400, message: 'Merci d’indiquer votre nom' });
  });

  const badEmails = ['', 'plain', 'a@b', 'a@b.c', 'a..b@example.ch', 'a b@example.ch', 'é@example.ch', 'a@exämple.ch', '@example.ch', 'a@.ch'];
  for (const email of badEmails) {
    it(`rejects email ${JSON.stringify(email)}`, () => {
      const result = validateReserveFields({ ...base, email }, before);
      assert.deepEqual(result, { ok: false, status: 400, message: 'Adresse email invalide' });
    });
  }

  it('accepts a 254-character email and rejects 255', () => {
    const ok = longEmail(254);
    assert.equal(ok.length, 254);
    assert.equal(validateReserveFields({ ...base, email: ok }, before).ok, true);
    const tooLong = longEmail(255);
    assert.equal(tooLong.length, 255);
    assert.equal(validateReserveFields({ ...base, email: tooLong }, before).ok, false);
  });

  it('rejects a local part longer than 64 characters', () => {
    assert.equal(validateReserveFields({ ...base, email: `${'l'.repeat(65)}@example.ch` }, before).ok, false);
  });
});
