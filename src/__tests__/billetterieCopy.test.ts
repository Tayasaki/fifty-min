import {
  CLOSED_COPY,
  CONTACT_EMAIL,
  FULL_COPY,
  INVALID_LINK_COPY,
  PRIVACY_NOTICE,
  UNAVAILABLE_COPY,
  contactMailto,
  fullText,
  recapFailedText,
  successText,
} from '../config/billetterieCopy';
import { RECORD_RETENTION_DAYS } from '../config/shows';

describe('contactMailto', () => {
  test('returns the bare address without a subject', () => {
    expect(contactMailto()).toBe('mailto:infomelangesdegenres@gmail.com');
    expect(contactMailto('')).toBe('mailto:infomelangesdegenres@gmail.com');
  });

  test('encodes the subject and keeps the address constant', () => {
    expect(contactMailto('Réservation A1B2C3D4')).toBe(
      'mailto:infomelangesdegenres@gmail.com?subject=R%C3%A9servation%20A1B2C3D4'
    );
  });

  test('encodes &, # and newline so the subject cannot add headers', () => {
    const href = contactMailto('a&b#c\nbcc=x@y.z');
    expect(href.startsWith(`mailto:${CONTACT_EMAIL}?subject=`)).toBe(true);
    const query = href.slice(href.indexOf('?') + 1);
    expect(query).not.toMatch(/[&#\n]/);
    expect(query).toContain('%26');
    expect(query).toContain('%23');
    expect(query).toContain('%0A');
  });

  test('an address inside the subject cannot replace the recipient', () => {
    expect(contactMailto('x@evil.example').startsWith(`mailto:${CONTACT_EMAIL}?subject=`)).toBe(true);
  });
});

describe('PRIVACY_NOTICE', () => {
  const full = `${PRIVACY_NOTICE.heading} ${PRIVACY_NOTICE.text}`;

  test('matches the owner-review wording', () => {
    expect(full).toBe(
      "Vos données. Nous collectons votre nom, votre adresse email et le nombre de places demandées, uniquement pour gérer votre réservation et vous écrire à son sujet (confirmation, récapitulatif, annulation). Elles sont conservées jusqu'à 30 jours après la représentation, puis effacées. Le service d'envoi d'emails (Resend) et la vérification anti-robot (Cloudflare Turnstile) traitent techniquement ces échanges. Pour accéder à vos données ou demander leur effacement : infomelangesdegenres@gmail.com."
    );
  });

  test('derives the retention from RECORD_RETENTION_DAYS', () => {
    expect(full).toContain(`${RECORD_RETENTION_DAYS} jours`);
  });

  test('names the contact address and no policy link', () => {
    expect(full).toContain(CONTACT_EMAIL);
    expect(full).not.toMatch(/https?:\/\//);
    expect(full).not.toMatch(/consent/i);
  });
});

describe('state copy', () => {
  test('success text names the address, the deadline and the ordering rule', () => {
    const text = successText('jean@example.ch', 'samedi 20 février à 19:00');
    expect(text).toBe(
      "Un email vient d'être envoyé à jean@example.ch. Vos places ne sont pas garanties tant que vous n'avez pas ouvert le lien qu'il contient : confirmez avant le samedi 20 février à 19:00. Les places sont attribuées dans l'ordre des confirmations. Pensez à vérifier vos spams."
    );
  });

  test('success text omits only the deadline when it is unknown', () => {
    const text = successText('jean@example.ch', null);
    expect(text).toBe(
      "Un email vient d'être envoyé à jean@example.ch. Vos places ne sont pas garanties tant que vous n'avez pas ouvert le lien qu'il contient. Les places sont attribuées dans l'ordre des confirmations. Pensez à vérifier vos spams."
    );
    expect(text).not.toMatch(/réservées/);
  });

  test('unavailable and closed copy', () => {
    expect(UNAVAILABLE_COPY.title).toBe('Réservation momentanément indisponible');
    expect(UNAVAILABLE_COPY.body).toBe(`Merci de réessayer plus tard ou de nous écrire à ${CONTACT_EMAIL}.`);
    expect(CLOSED_COPY.text).toBe('Les réservations ne sont pas ouvertes pour le moment.');
    expect(CLOSED_COPY.notReserved).toBe('Vos places ne sont pas réservées.');
  });

  test('neutral invalid link copy does not distinguish causes', () => {
    expect(INVALID_LINK_COPY).toBe(
      "Ce lien n'est plus valable : il a expiré, a déjà été utilisé ou la représentation n'est plus ouverte à la réservation. Vous pouvez faire une nouvelle demande sur la billetterie ou nous écrire."
    );
  });

  test('full copy handles sold out, one seat and several seats', () => {
    expect(FULL_COPY.soldOut).toBe('Cette représentation est complète.');
    expect(fullText(0, 2)).toBe(FULL_COPY.soldOut);
    expect(fullText(1, 3)).toBe(
      'Complet : il ne reste que 1 place. Cette demande de 3 places ne peut plus être acceptée. Essayez avec moins de places.'
    );
    expect(fullText(2, 1)).toBe(
      'Complet : il ne reste que 2 places. Cette demande de 1 place ne peut plus être acceptée. Essayez avec moins de places.'
    );
  });

  test('recap failure text carries the reservation number and no mail claim', () => {
    const text = recapFailedText('A1B2C3D4');
    expect(text).toBe(
      "Vos places sont réservées (réservation n° A1B2C3D4), mais l'email récapitulatif n'a pas pu vous être envoyé. Conservez ce numéro ou écrivez-nous :"
    );
    expect(text).not.toMatch(/un email vous a été envoyé/i);
  });
});
