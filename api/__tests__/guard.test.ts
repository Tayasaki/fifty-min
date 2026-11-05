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
import { RESERVATIONS_OPEN_AT, SHOWS, getShow, getVenue, showStart } from '../../src/config/shows';
import { ERR, MSG } from '../_lib/http';

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
  const AT = RESERVATIONS_OPEN_AT.getTime();
  // [RESERVATIONS_OPEN, now, expected]: unset or empty lets the opening date decide; any other value overrides it.
  const cases: Array<[string | undefined, number, boolean]> = [
    [undefined, AT - 1, false], [undefined, AT, true], [undefined, AT + 86_400_000, true],
    ['', AT - 1, false], ['', AT, true], ['  ', AT - 1, false], ['  ', AT, true],
    ['true', AT - 86_400_000, true], [' TRUE ', AT - 1, true], ['true', AT + 1, true],
    ['false', AT - 1, false], ['false', AT + 86_400_000, false], [' FALSE ', AT + 1, false],
    ['1', AT + 86_400_000, false], ['yes', AT + 86_400_000, false], ['ture', AT + 86_400_000, false],
  ];
  for (const [value, now, expected] of cases) {
    const when = now < AT ? 'before' : 'after';
    it(`is ${expected} for ${JSON.stringify(value)} ${when} the opening date`, () => {
      assert.equal(isReservationsOpen({ RESERVATIONS_OPEN: value }, now), expected);
    });
  }
});

describe('isReservationsOpen with the early-opening build flag', () => {
  const AT = RESERVATIONS_OPEN_AT.getTime();

  it('opens before the date when REACT_APP_SHOW_TICKETING is true and RESERVATIONS_OPEN is unset', () => {
    assert.equal(isReservationsOpen({ REACT_APP_SHOW_TICKETING: 'true' }, AT - 86_400_000), true);
  });

  it('is not opened by other values of the build flag', () => {
    for (const flag of ['false', 'TRUE', '1', '']) {
      assert.equal(isReservationsOpen({ REACT_APP_SHOW_TICKETING: flag }, AT - 1), false, flag);
    }
  });

  it('lets RESERVATIONS_OPEN=false win over the build flag', () => {
    assert.equal(isReservationsOpen({ REACT_APP_SHOW_TICKETING: 'true', RESERVATIONS_OPEN: 'false' }, AT - 1), false);
    assert.equal(isReservationsOpen({ REACT_APP_SHOW_TICKETING: 'true', RESERVATIONS_OPEN: 'false' }, AT + 86_400_000), false);
  });
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
  const invisible = [0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0xfeff];
  for (const code of invisible) {
    const hex = code.toString(16).toUpperCase();
    it(`rejects U+${hex} inside a name`, () => assert.equal(validateName(`Je${String.fromCharCode(code)}an`).ok, false));
  }
  it('rejects a leading U+200B that trim() does not remove', () => {
    assert.equal(validateName('\u200BJean').ok, false);
  });
  for (const code of [0x200a, 0x2010, 0x202f, 0x206a]) {
    it(`accepts the neighbour U+${code.toString(16).toUpperCase()}`, () => {
      assert.equal(validateName(`Je${String.fromCharCode(code)}an`).ok, true);
    });
  }
  it('trims a leading and trailing U+FEFF and accepts the clean name', () => {
    assert.deepEqual(validateName('\uFEFFJean\uFEFF'), { ok: true, value: 'Jean' });
  });
  it('rejects 101 code points even when UTF-16 length differs', () => {
    assert.equal(validateName('😀'.repeat(101)).ok, false);
  });
});

describe('canonicalEmail / emailDomain', () => {
  const cases: Array<[string, string]> = [
    ['A.B+x@Gmail.com', 'ab@gmail.com'],
    ['ab@googlemail.com', 'ab@gmail.com'],
    ['a.b+x@example.ch', 'a.b@example.ch'],
    ['+x@example.ch', '+x@example.ch'],
    ['  Jean@Example.CH  ', 'jean@example.ch'],
    ['no-at-sign', ''],
  ];
  for (const [input, expected] of cases) {
    it(`maps ${JSON.stringify(input)} to ${JSON.stringify(expected)}`, () => assert.equal(canonicalEmail(input), expected));
  }
  it('keeps a tag-only local part so the key is never empty', () => {
    assert.equal(canonicalEmail('+a@x.com'), '+a@x.com');
    assert.equal(canonicalEmail('+a+b@x.com'), '+a+b@x.com');
    assert.equal(canonicalEmail('+a@gmail.com'), '+a@gmail.com');
    assert.notEqual(canonicalEmail('+a@x.com'), canonicalEmail('+b@x.com'));
  });
  it('returns an empty string without a local part or domain', () => {
    assert.equal(canonicalEmail('@x.com'), '');
    assert.equal(canonicalEmail('a@'), '');
  });
  it('extracts the lowercase domain', () => {
    assert.equal(emailDomain('Jean@Example.CH'), 'example.ch');
  });
});

describe('validateReserveFields (tag-only email)', () => {
  it('accepts +a@x.com with a non-empty canonical email', () => {
    const result = validateReserveFields({ showId: SHOW_ID, name: 'Jean Dupont', email: '+a@x.com', quantity: 1 }, () => START - 1);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value.canonicalEmail, '+a@x.com');
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
        show: getShow(SHOW_ID),
        venue: getVenue('monique'),
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
    assert.deepEqual(closed, { ok: false, status: 409, code: 'show-started', message: MSG.SHOW_STARTED });
    assert.equal(validateReserveFields(base, () => START - 1).ok, true);
  });

  it('resolves the show and its venue once', () => {
    const result = validateReserveFields(base, before);
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.value.show, getShow(SHOW_ID));
      assert.equal(result.value.venue, getVenue(result.value.show.venueId));
    }
  });

  it('rejects a show whose venue is unknown like an unknown show', () => {
    const orphan = { ...getShow(SHOW_ID)!, id: '2100-01-01-orphan', venueId: 'nowhere', date: '2100-01-01T19:00' };
    SHOWS.push(orphan);
    try {
      const result = validateReserveFields({ ...base, showId: orphan.id }, before);
      assert.deepEqual(result, { ok: false, status: 400, message: ERR.UNKNOWN_SHOW });
    } finally {
      SHOWS.splice(SHOWS.indexOf(orphan), 1);
    }
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

describe('validateName invisible characters (U+2060-2064, U+061C, U+00AD, U+180E)', () => {
  const inside: [string, string][] = [
    ['2060', '\u2060'], ['2061', '\u2061'], ['2062', '\u2062'], ['2063', '\u2063'], ['2064', '\u2064'],
    ['061C', '\u061C'], ['00AD', '\u00AD'], ['180E', '\u180E'],
  ];
  for (const [label, char] of inside) {
    it(`rejects U+${label} inside a name`, () => {
      assert.equal(validateName(`Jean${char}Dupont`).ok, false);
    });
  }

  for (const [label, char] of [['2060', '\u2060'], ['061C', '\u061C'], ['00AD', '\u00AD'], ['180E', '\u180E']]) {
    it(`rejects a leading U+${label} that trim() does not remove`, () => {
      assert.equal(validateName(`${char}Jean Dupont`).ok, false);
    });
  }

  for (const [label, char] of [['205F', '\u205F'], ['00AC', '\u00AC'], ['00AE', '\u00AE'], ['061B', '\u061B']]) {
    it(`accepts the neighbour U+${label}`, () => {
      assert.equal(validateName(`Jean${char}Dupont`).ok, true);
    });
  }
});
