import {
  CLIENT_ERROR,
  GENERIC_ERROR,
  NETWORK_ERROR,
  SERVER_ERROR,
  type ApiFailure,
  failureText,
  isClosed,
  isReservationId,
  parseAvailability,
  parseCancelResult,
  parseConfirmResult,
  parsePreview,
  parseReserveSuccess,
  readApiFailure,
  requestAvailability,
  requestReservation,
  requestReservationAction,
  requestReserve,
  retryMinutes,
} from '../lib/billetterieApi';
import { fakeResponse, installFetch, uninstallFetch } from './helpers/fetch';

afterEach(uninstallFetch);

const http = (status: number, extra: Partial<Extract<ApiFailure, { kind: 'http' }>> = {}): ApiFailure => ({
  kind: 'http',
  status,
  ...extra,
});

describe('failureText', () => {
  test('network failure uses the single network message', () => {
    expect(failureText({ kind: 'network' })).toBe(NETWORK_ERROR);
    expect(NETWORK_ERROR).toBe('Impossible de contacter le serveur. Merci de réessayer.');
  });

  test.each([
    ['closed', 403],
    ['captcha', 400],
    ['full', 409],
    ['not-possible', 409],
    ['cooldown', 429],
    ['budget', 429],
    ['bad-address', 400],
    ['email-failed', 503],
    ['email-slow', 503],
  ])('shows the server text for code %s', (code, status) => {
    expect(failureText(http(status, { code, message: `texte du serveur pour ${code}` }))).toBe(`texte du serveur pour ${code}`);
  });

  test.each([
    ['closed', 403, CLIENT_ERROR],
    ['captcha', 400, CLIENT_ERROR],
    ['full', 409, CLIENT_ERROR],
    ['not-possible', 409, CLIENT_ERROR],
    ['cooldown', 429, CLIENT_ERROR],
    ['budget', 429, CLIENT_ERROR],
    ['bad-address', 400, CLIENT_ERROR],
    ['email-failed', 503, SERVER_ERROR],
    ['email-slow', 503, SERVER_ERROR],
  ])('falls back by status class for code %s without a body', (code, status, expected) => {
    expect(failureText(http(status, { code }))).toBe(expected);
  });

  test('uses the 4xx fallback without a message', () => {
    expect(failureText(http(403))).toBe(CLIENT_ERROR);
  });

  test('uses the 5xx fallback without a message', () => {
    expect(failureText(http(500))).toBe(SERVER_ERROR);
    expect(failureText(http(502))).toBe(SERVER_ERROR);
  });

  test('ignores an empty or oversized message', () => {
    expect(failureText(http(400, { message: '' }))).toBe(CLIENT_ERROR);
    expect(failureText(http(500, { message: 'x'.repeat(301) }))).toBe(SERVER_ERROR);
  });

  test('keeps a message of exactly 300 characters', () => {
    const message = 'x'.repeat(300);
    expect(failureText(http(400, { message }))).toBe(message);
  });

  test('returns markup verbatim as a string', () => {
    expect(failureText(http(400, { message: '<b>x</b>' }))).toBe('<b>x</b>');
  });

  test('fallback texts are distinct and generic text exists', () => {
    expect(new Set([NETWORK_ERROR, CLIENT_ERROR, SERVER_ERROR, GENERIC_ERROR]).size).toBe(4);
  });
});

describe('isClosed', () => {
  test('is true only for an http failure with code closed', () => {
    expect(isClosed(http(403, { code: 'closed' }))).toBe(true);
    expect(isClosed(http(409, { code: 'closed' }))).toBe(true);
    expect(isClosed(http(403, { code: 'captcha' }))).toBe(false);
    expect(isClosed(http(403))).toBe(false);
    expect(isClosed({ kind: 'network' })).toBe(false);
  });
});

describe('retryMinutes', () => {
  test.each([
    [1, 1],
    [59, 1],
    [60, 1],
    [61, 2],
    [600, 10],
    [0, 1],
  ])('%p seconds gives %p minute(s)', (seconds, minutes) => {
    expect(retryMinutes(http(429, { retryAfterSeconds: seconds }))).toBe(minutes);
  });

  test('is undefined for negative, NaN, absent and network failures', () => {
    expect(retryMinutes(http(429, { retryAfterSeconds: -5 }))).toBeUndefined();
    expect(retryMinutes(http(429, { retryAfterSeconds: NaN }))).toBeUndefined();
    expect(retryMinutes(http(429))).toBeUndefined();
    expect(retryMinutes({ kind: 'network' })).toBeUndefined();
  });
});

describe('readApiFailure', () => {
  test('reads status, code, message, retry and remaining from a JSON body', async () => {
    const res = fakeResponse(429, { error: 'Patientez', code: 'cooldown', retryAfterSeconds: 540, remaining: 3 });
    expect(await readApiFailure(res)).toEqual({
      kind: 'http',
      status: 429,
      code: 'cooldown',
      message: 'Patientez',
      retryAfterSeconds: 540,
      remaining: 3,
    });
  });

  test('keeps only the status for an HTML body', async () => {
    expect(await readApiFailure(fakeResponse(502, '<html>Bad gateway</html>'))).toEqual({ kind: 'http', status: 502 });
  });

  test('keeps only the status for an empty body', async () => {
    expect(await readApiFailure(fakeResponse(500))).toEqual({ kind: 'http', status: 500 });
  });

  test('keeps only the status for an array or scalar body', async () => {
    expect(await readApiFailure(fakeResponse(400, [{ error: 'x', code: 'full' }]))).toEqual({ kind: 'http', status: 400 });
    expect(await readApiFailure(fakeResponse(400, '"texte"'))).toEqual({ kind: 'http', status: 400 });
    expect(await readApiFailure(fakeResponse(400, 'null'))).toEqual({ kind: 'http', status: 400 });
  });

  test('gives no code and no message for an oversized body', async () => {
    const res = fakeResponse(400, { error: 'x', code: 'full', padding: 'y'.repeat(10_000) });
    expect(await readApiFailure(res)).toEqual({ kind: 'http', status: 400 });
  });

  test('drops fields of the wrong type or shape', async () => {
    const res = fakeResponse(400, { error: 42, code: { a: 1 }, retryAfterSeconds: '60', remaining: -1 });
    expect(await readApiFailure(res)).toEqual({ kind: 'http', status: 400 });
  });

  test('drops a code that is not a lowercase slug', async () => {
    const res = fakeResponse(400, { error: 'x', code: '<img src=x>' });
    expect(await readApiFailure(res)).toEqual({ kind: 'http', status: 400, message: 'x' });
  });

  test('does not throw when the body cannot be read', async () => {
    const res = { ok: false, status: 500, text: async () => { throw new Error('boom'); } } as unknown as Response;
    expect(await readApiFailure(res)).toEqual({ kind: 'http', status: 500 });
  });
});

describe('parseAvailability', () => {
  test('parses the map and the open flag', () => {
    expect(parseAvailability({ availability: { a: 3, b: 0 }, open: true })).toEqual({ availability: { a: 3, b: 0 }, open: true });
  });

  test('open is null when missing or not a boolean', () => {
    expect(parseAvailability({ availability: { a: 3 } })?.open).toBeNull();
    expect(parseAvailability({ availability: { a: 3 }, open: 'yes' })?.open).toBeNull();
  });

  test('drops unknown and NaN entries', () => {
    expect(parseAvailability({ availability: { a: 3, b: 'x', c: null, d: -1, e: 2.5 }, open: false })).toEqual({
      availability: { a: 3 },
      open: false,
    });
  });

  test('rejects a payload without an availability object', () => {
    expect(parseAvailability(null)).toBeNull();
    expect(parseAvailability([])).toBeNull();
    expect(parseAvailability({ open: true })).toBeNull();
    expect(parseAvailability({ availability: [1] })).toBeNull();
  });
});

describe('parseReserveSuccess', () => {
  test('parses an ISO deadline into epoch milliseconds', () => {
    expect(parseReserveSuccess({ ok: true, linkExpiresAt: '2027-02-18T19:00:00.000Z' })).toEqual({
      linkExpiresAt: Date.parse('2027-02-18T19:00:00.000Z'),
    });
  });

  test('keeps the success with a null deadline when it cannot be parsed', () => {
    expect(parseReserveSuccess({ ok: true, linkExpiresAt: 'demain' })).toEqual({ linkExpiresAt: null });
    expect(parseReserveSuccess({ ok: true })).toEqual({ linkExpiresAt: null });
    expect(parseReserveSuccess({ ok: true, linkExpiresAt: 12 })).toEqual({ linkExpiresAt: null });
  });

  test('ignores unknown fields and the legacy reservation fields', () => {
    const parsed = parseReserveSuccess({ ok: true, linkExpiresAt: '2027-02-18T19:00:00Z', reservationId: 'A', expiresAt: 5 });
    expect(parsed).toEqual({ linkExpiresAt: Date.parse('2027-02-18T19:00:00Z') });
  });

  test('rejects anything that is not ok:true', () => {
    expect(parseReserveSuccess(null)).toBeNull();
    expect(parseReserveSuccess('ok')).toBeNull();
    expect(parseReserveSuccess({ ok: false })).toBeNull();
    expect(parseReserveSuccess({ linkExpiresAt: '2027-02-18T19:00:00Z' })).toBeNull();
  });
});

describe('parsePreview', () => {
  const confirm = { id: 'A1B2C3D4', showId: 'show-1', name: 'Jean', quantity: 2, status: 'claimable', availability: 12, open: true };
  const cancel = { id: 'A1B2C3D4', showId: 'show-1', name: 'Jean', quantity: 2, status: 'confirmed', closed: false };

  test.each(['claimable', 'full', 'confirmed', 'closed'])('accepts the confirm status %s', (status) => {
    expect(parsePreview({ ...confirm, status })).toEqual({ ...confirm, status, kind: 'confirm' });
  });

  test.each(['confirmed', 'cancelled'])('accepts the cancel status %s', (status) => {
    expect(parsePreview({ ...cancel, status })).toEqual({ ...cancel, status, kind: 'cancel' });
  });

  test('rejects a pending status and unknown statuses', () => {
    expect(parsePreview({ ...confirm, status: 'pending' })).toBeNull();
    expect(parsePreview({ ...cancel, status: 'pending' })).toBeNull();
    expect(parsePreview({ ...confirm, status: 'whatever' })).toBeNull();
  });

  test('ignores unknown fields such as expiresAt and the cancel token', () => {
    const parsed = parsePreview({ ...confirm, expiresAt: 5, cancelToken: 'secret' });
    expect(parsed).toEqual({ ...confirm, kind: 'confirm' });
  });

  test('rejects wrong types and malformed ids', () => {
    expect(parsePreview({ ...confirm, quantity: '2' })).toBeNull();
    expect(parsePreview({ ...confirm, quantity: 0 })).toBeNull();
    expect(parsePreview({ ...confirm, availability: 'x' })).toBeNull();
    expect(parsePreview({ ...confirm, open: 'true' })).toBeNull();
    expect(parsePreview({ ...confirm, name: 3 })).toBeNull();
    expect(parsePreview({ ...confirm, id: 'a1b2c3d4' })).toBeNull();
    expect(parsePreview({ ...confirm, id: 'A1B2C3D4X' })).toBeNull();
    expect(parsePreview({ ...cancel, closed: 'no' })).toBeNull();
  });

  test('rejects payloads that are neither shape', () => {
    expect(parsePreview(null)).toBeNull();
    expect(parsePreview([])).toBeNull();
    expect(parsePreview({ id: 'A1B2C3D4', showId: 's', name: 'J', quantity: 1, status: 'claimable' })).toBeNull();
  });
});

describe('parseConfirmResult and parseCancelResult', () => {
  test('parse a confirm result with each emailSent value', () => {
    const base = { ok: true, status: 'confirmed', id: 'A1B2C3D4', alreadyConfirmed: false };
    expect(parseConfirmResult({ ...base, emailSent: true })).toEqual({ id: 'A1B2C3D4', alreadyConfirmed: false, emailSent: true });
    expect(parseConfirmResult({ ...base, emailSent: false })?.emailSent).toBe(false);
    expect(parseConfirmResult({ ...base, alreadyConfirmed: true, emailSent: null })).toEqual({
      id: 'A1B2C3D4',
      alreadyConfirmed: true,
      emailSent: null,
    });
  });

  test('reject malformed confirm results', () => {
    const base = { ok: true, status: 'confirmed', id: 'A1B2C3D4', alreadyConfirmed: false, emailSent: true };
    expect(parseConfirmResult({ ...base, emailSent: 'yes' })).toBeNull();
    expect(parseConfirmResult({ ...base, emailSent: undefined })).toBeNull();
    expect(parseConfirmResult({ ...base, alreadyConfirmed: 1 })).toBeNull();
    expect(parseConfirmResult({ ...base, status: 'cancelled' })).toBeNull();
    expect(parseConfirmResult({ ...base, ok: false })).toBeNull();
    expect(parseConfirmResult({ ...base, id: 'xyz' })).toBeNull();
    expect(parseConfirmResult(null)).toBeNull();
  });

  test('parse a cancel result and ignore unknown fields', () => {
    const base = { ok: true, status: 'cancelled', id: 'A1B2C3D4', alreadyCancelled: false, emailSent: false, extra: 1 };
    expect(parseCancelResult(base)).toEqual({ id: 'A1B2C3D4', alreadyCancelled: false, emailSent: false });
    expect(parseCancelResult({ ...base, alreadyCancelled: true, emailSent: null })?.alreadyCancelled).toBe(true);
  });

  test('reject malformed cancel results', () => {
    const base = { ok: true, status: 'cancelled', id: 'A1B2C3D4', alreadyCancelled: false, emailSent: true };
    expect(parseCancelResult({ ...base, status: 'confirmed' })).toBeNull();
    expect(parseCancelResult({ ...base, alreadyCancelled: 'no' })).toBeNull();
    expect(parseCancelResult({ ...base, emailSent: 0 })).toBeNull();
    expect(parseCancelResult([])).toBeNull();
  });
});

describe('isReservationId', () => {
  test('accepts exactly 8 upper-case hex digits', () => {
    expect(isReservationId('A1B2C3D4')).toBe(true);
    expect(isReservationId('a1b2c3d4')).toBe(false);
    expect(isReservationId('A1B2C3D')).toBe(false);
    expect(isReservationId('A1B2C3D45')).toBe(false);
    expect(isReservationId('A1B2C3DG')).toBe(false);
    expect(isReservationId('A1B2C3D4\n')).toBe(false);
    expect(isReservationId('')).toBe(false);
  });
});

describe('requests', () => {
  test('requestAvailability GETs /api/availability and returns the parsed JSON', async () => {
    const fetchMock = installFetch(() => fakeResponse(200, { availability: { a: 1 }, open: true }));
    const result = await requestAvailability();
    expect(result).toEqual({ ok: true, data: { availability: { a: 1 }, open: true } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toEqual(['/api/availability']);
  });

  test('requestReserve POSTs the exact JSON body to /api/reserve with no extra options', async () => {
    const fetchMock = installFetch(() => fakeResponse(200, { ok: true }));
    const body = { showId: 's', name: 'Jean', email: 'j@x.ch', quantity: 2, turnstileToken: 'tok', website: '' };
    await requestReserve(body);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/reserve');
    expect(Object.keys(init ?? {}).sort()).toEqual(['body', 'headers', 'method']);
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init?.body))).toEqual(body);
  });

  test('requestReservation GETs with an encoded query and never sends a body', async () => {
    const fetchMock = installFetch(() => fakeResponse(200, {}));
    await requestReservation('A1B2C3D4', 'a.b&c=d');
    expect(fetchMock.mock.calls[0]).toEqual(['/api/reservation?id=A1B2C3D4&token=a.b%26c%3Dd']);
  });

  test('requestReservationAction POSTs {action, id, token}', async () => {
    const fetchMock = installFetch(() => fakeResponse(200, {}));
    await requestReservationAction('cancel', 'A1B2C3D4', 'tok');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/reservation');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ action: 'cancel', id: 'A1B2C3D4', token: 'tok' });
  });

  test('an error status becomes a failure carrying code and text', async () => {
    installFetch(() => fakeResponse(409, { error: 'Complet', code: 'full', remaining: 1 }));
    const result = await requestReserve({ showId: 's', name: 'J', email: 'j@x.ch', quantity: 1, turnstileToken: 't', website: '' });
    expect(result).toEqual({ ok: false, failure: { kind: 'http', status: 409, code: 'full', message: 'Complet', remaining: 1 } });
  });

  test('a rejected fetch becomes a network failure', async () => {
    installFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await requestAvailability()).toEqual({ ok: false, failure: { kind: 'network' } });
  });

  test('a 200 with an unreadable body yields null data, never a throw', async () => {
    installFetch(() => fakeResponse(200, '<html>'));
    expect(await requestAvailability()).toEqual({ ok: true, data: null });
  });
});
