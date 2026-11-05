import { describe, it, mock, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installNoNetwork } from './helpers/redis-rest-shim';
import { POST as reserve } from '../reserve';
import { GET as getReservation, POST as postReservation } from '../reservation';
import { MSG } from '../_lib/http';
import { SYNTH_SHOW_ID as SHOW_ID, SYNTH_START, registerTestShow } from './helpers/flow';

let showHandle: ReturnType<typeof registerTestShow>;
before(() => {
  showHandle = registerTestShow();
});
after(() => showHandle.unregister());

function post(path: string, body: unknown, raw = false): Request {
  return new Request(`http://localhost/api/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://melangedegenres.ch' },
    body: raw ? String(body) : JSON.stringify(body),
  });
}

async function expectError(response: Response, status: number, message: string, code?: string): Promise<void> {
  assert.equal(response.status, status);
  assert.ok((response.headers.get('content-type') ?? '').startsWith('application/json'));
  assert.deepEqual(await response.json(), code === undefined ? { error: message } : { error: message, code });
}

const valid = { showId: SHOW_ID, name: 'Jean Dupont', email: 'jean@example.ch', quantity: 2 };

const savedEnv = { VERCEL_ENV: process.env.VERCEL_ENV, RESERVATIONS_OPEN: process.env.RESERVATIONS_OPEN };

// Production-shaped environment, independent of the developer's shell.
function useProductionEnv(): void {
  process.env.VERCEL_ENV = 'production';
  process.env.RESERVATIONS_OPEN = 'false';
}

function restoreEnv(): void {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe('POST /api/reserve (paths that return before Redis)', () => {
  beforeEach(() => {
    useProductionEnv();
    installNoNetwork();
  });
  afterEach(() => {
    mock.restoreAll();
    restoreEnv();
  });

  it('rejects invalid JSON', async () => {
    await expectError(await reserve(post('reserve', '{nope', true)), 400, 'Requête invalide');
  });

  it('answers 200 ok to a filled honeypot without touching anything', async () => {
    const now = 1_800_000_000_000;
    mock.method(Date, 'now', () => now);
    const response = await reserve(post('reserve', { ...valid, website: 'http://spam.example' }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, linkExpiresAt: new Date(now + 48 * 3600 * 1000).toISOString() });
  });

  it('rejects an unknown show', async () => {
    await expectError(await reserve(post('reserve', { ...valid, showId: 'nope' })), 400, 'Représentation inconnue');
  });

  it('rejects a one-character name', async () => {
    await expectError(await reserve(post('reserve', { ...valid, name: 'A' })), 400, 'Merci d’indiquer votre nom');
  });

  it('rejects a malformed email', async () => {
    await expectError(await reserve(post('reserve', { ...valid, email: 'not-an-email' })), 400, 'Adresse email invalide');
  });

  it('rejects quantity 0', async () => {
    await expectError(await reserve(post('reserve', { ...valid, quantity: 0 })), 400, 'Vous pouvez réserver entre 1 et 4 places');
  });

  it('rejects quantity 5', async () => {
    await expectError(await reserve(post('reserve', { ...valid, quantity: 5 })), 400, 'Vous pouvez réserver entre 1 et 4 places');
  });

  it('closes reservations once the show has started', async () => {
    mock.method(Date, 'now', () => SYNTH_START + 3_600_000);
    await expectError(await reserve(post('reserve', valid)), 409, MSG.SHOW_STARTED, 'show-started');
  });
});

describe('POST /api/reserve around the show start', () => {
  const start = SYNTH_START;
  let calls = 0;
  beforeEach(() => {
    useProductionEnv();
    calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      throw new Error('unexpected network call');
    };
  });
  afterEach(() => {
    mock.restoreAll();
    restoreEnv();
  });

  it('closes reservations at the exact start instant', async () => {
    mock.method(Date, 'now', () => start);
    await expectError(await reserve(post('reserve', valid)), 409, MSG.SHOW_STARTED, 'show-started');
  });

  it('refuses a valid request one millisecond before the start without any Redis or email call', async () => {
    mock.method(Date, 'now', () => start - 1);
    const response = await reserve(post('reserve', valid));
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: MSG.CLOSED, code: 'closed' });
    assert.equal(calls, 0);
  });
});

describe('/api/reservation (paths that return before Redis)', () => {
  beforeEach(() => installNoNetwork());

  it('POST rejects invalid JSON', async () => {
    await expectError(await postReservation(post('reservation', '{nope', true)), 400, 'Requête invalide');
  });

  it('POST rejects an unknown action', async () => {
    await expectError(await postReservation(post('reservation', { action: 'x' })), 400, 'Action inconnue');
  });

  it('GET without id is an invalid link', async () => {
    await expectError(await getReservation(new Request('http://localhost/api/reservation')), 400, 'Lien invalide');
  });

  it('GET with a malformed id is an invalid link', async () => {
    const response = await getReservation(new Request('http://localhost/api/reservation?id=zzzzzzzz&token=abc'));
    await expectError(response, 400, 'Lien invalide');
  });

  it('POST confirm with a malformed id is an invalid link', async () => {
    await expectError(await postReservation(post('reservation', { action: 'confirm', id: 'bad', token: 't' })), 400, 'Lien invalide');
  });
});
