import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ERR, error, json } from '../_lib/http';

describe('http helpers', () => {
  it('error defaults to 400 with an { error } body', async () => {
    const response = error('x');
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'x' });
  });

  it('error accepts a custom status', () => {
    assert.equal(error('x', 503).status, 503);
  });

  it('json sets the JSON content type', async () => {
    const response = json({ ok: true }, { status: 201 });
    assert.equal(response.status, 201);
    assert.ok((response.headers.get('content-type') ?? '').startsWith('application/json'));
    assert.deepEqual(await response.json(), { ok: true });
  });

  it('ERR strings match the literals the handlers used before', () => {
    assert.deepEqual(
      { ...ERR },
      {
        INVALID_REQUEST: 'Requête invalide',
        UNKNOWN_SHOW: 'Représentation inconnue',
        UNKNOWN_ACTION: 'Action inconnue',
        INVALID_LINK: 'Lien invalide',
        UNAVAILABLE: 'Service indisponible, merci de réessayer plus tard',
        NOT_FOUND:
          'Cette réservation est introuvable : elle a peut-être été annulée, ou le délai de confirmation est dépassé. Vous pouvez refaire une réservation sur la billetterie.',
      }
    );
  });

  it('ERR.NOT_FOUND is a single line of text', () => {
    assert.ok(!ERR.NOT_FOUND.includes('\n'));
  });
});
