import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ERR, MSG, error, safeEqual } from '../_lib/http';

describe('http helpers', () => {
  it('error defaults to 400 with an { error } body', async () => {
    const response = error('x');
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'x' });
  });

  it('error accepts a custom status', () => {
    assert.equal(error('x', 503).status, 503);
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

  it('error adds code and retryAfterSeconds only when given, with Retry-After', async () => {
    const plain = error('x', 429);
    assert.deepEqual(await plain.json(), { error: 'x' });
    assert.equal(plain.headers.get('retry-after'), null);

    const rich = error('x', 429, { code: 'cooldown', retryAfterSeconds: 42 });
    assert.deepEqual(await rich.json(), { error: 'x', code: 'cooldown', retryAfterSeconds: 42 });
    assert.equal(rich.headers.get('retry-after'), '42');
  });

  it('error has no code key when none is given and is never cached', async () => {
    const response = error('x');
    assert.ok(!('code' in ((await response.json()) as object)));
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });

  it('error carries extra fields such as remaining', async () => {
    assert.deepEqual(await error('x', 409, { code: 'full', remaining: 3 }).json(), { error: 'x', code: 'full', remaining: 3 });
  });

  it('safeEqual compares equal, different, different-length and empty strings without throwing', () => {
    assert.equal(safeEqual('abc', 'abc'), true);
    assert.equal(safeEqual('abc', 'abd'), false);
    assert.equal(safeEqual('abc', 'abcd'), false);
    assert.equal(safeEqual('', ''), true);
    assert.equal(safeEqual('', 'a'), false);
    assert.equal(safeEqual('é'.repeat(100), 'é'.repeat(99)), false);
  });

  it('MSG pins the final French strings', () => {
    assert.deepEqual(
      { ...MSG, fewLeft: MSG.fewLeft(1), fewLeft2: MSG.fewLeft(3) },
      {
        CLOSED: 'Les réservations ne sont pas ouvertes pour le moment.',
        CAPTCHA: 'La vérification anti-robot a échoué. Merci de réessayer.',
        FULL: 'Cette représentation est complète.',
        fewLeft: 'Il ne reste que 1 place pour cette représentation.',
        fewLeft2: 'Il ne reste que 3 places pour cette représentation.',
        NOT_POSSIBLE: 'Cette demande ne peut pas être acceptée. Vérifiez le nombre de places demandé ou contactez l’association.',
        BAD_ADDRESS: 'Cette adresse email semble invalide ou ne peut pas recevoir de messages.',
        EMAIL_FAILED: 'L’email n’a pas pu être envoyé. Vous pouvez réessayer immédiatement.',
        EMAIL_SLOW:
          'L’envoi de l’email prend plus de temps que prévu. Vérifiez votre boîte de réception et vos courriers indésirables avant de réessayer dans quelques minutes.',
        SHOW_STARTED: 'Cette représentation a déjà commencé.',
        FORBIDDEN: 'Accès refusé',
      }
    );
  });
});
