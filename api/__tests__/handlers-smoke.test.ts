import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installNoNetwork } from './helpers/redis-rest-shim';
import { POST as reserve } from '../reserve';
import { GET as getReservation, POST as postReservation } from '../reservation';

const SHOW_ID = '2027-02-20-monique';

function post(path: string, body: unknown, raw = false): Request {
  return new Request(`http://localhost/api/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw ? String(body) : JSON.stringify(body),
  });
}

async function expectError(response: Response, status: number, message: string): Promise<void> {
  assert.equal(response.status, status);
  assert.ok((response.headers.get('content-type') ?? '').startsWith('application/json'));
  assert.deepEqual(await response.json(), { error: message });
}

const valid = { showId: SHOW_ID, name: 'Jean Dupont', email: 'jean@example.ch', quantity: 2 };

describe('POST /api/reserve (paths that return before Redis)', () => {
  beforeEach(() => installNoNetwork());
  afterEach(() => mock.restoreAll());

  it('rejects invalid JSON', async () => {
    await expectError(await reserve(post('reserve', '{nope', true)), 400, 'Requête invalide');
  });

  it('answers 200 ok to a filled honeypot without touching anything', async () => {
    const response = await reserve(post('reserve', { ...valid, website: 'http://spam.example' }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
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
    mock.method(Date, 'now', () => 1_900_000_000_000);
    await expectError(await reserve(post('reserve', valid)), 400, 'Les réservations pour cette date sont closes');
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
