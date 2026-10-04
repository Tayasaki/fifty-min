import { CONFIRMATION_DELAY_HOURS, MAX_TICKETS_PER_EMAIL, getShow, getVenue, showStart } from '../src/config/shows';
import { ReservationRecord, releaseAtomic, releaseExpired, reserveAtomic } from './_lib/redis';
import { sendConfirmationRequest } from './_lib/email';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function error(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

function newReservationId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return error('Requête invalide');
  }

  // Honeypot: real users never fill this hidden field.
  if (body.website) return Response.json({ ok: true });

  const showId = String(body.showId || '');
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const quantity = Number(body.quantity);

  const show = getShow(showId);
  const venue = show && getVenue(show.venueId);
  if (!show || !venue) return error('Représentation inconnue');
  const start = showStart(show).getTime();
  if (Date.now() > start) return error('Les réservations pour cette date sont closes');
  if (name.length < 2 || name.length > 100) return error('Merci d’indiquer votre nom');
  if (email.length > 254 || !EMAIL_RE.test(email)) return error('Adresse email invalide');
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_TICKETS_PER_EMAIL) {
    return error(`Vous pouvez réserver entre 1 et ${MAX_TICKETS_PER_EMAIL} places`);
  }

  const record: ReservationRecord = {
    id: newReservationId(),
    showId,
    name,
    email,
    quantity,
    createdAt: new Date().toISOString(),
    status: 'pending',
    expiresAt: Math.min(Date.now() + CONFIRMATION_DELAY_HOURS * 3_600_000, start),
    token: crypto.randomUUID().replace(/-/g, ''),
  };

  let result: { status: number; remaining: number };
  try {
    await releaseExpired();
    result = await reserveAtomic({ capacity: show.capacity, maxPerEmail: MAX_TICKETS_PER_EMAIL, record });
  } catch (err) {
    console.error('reserve error', err);
    return error('Service indisponible, merci de réessayer plus tard', 503);
  }

  if (result.status === -1) {
    return error(
      result.remaining > 0
        ? `Cette adresse email ne peut plus réserver que ${result.remaining} place(s) pour cette date (maximum ${MAX_TICKETS_PER_EMAIL}, réservations en attente de confirmation comprises).`
        : `Cette adresse email a déjà réservé le maximum de ${MAX_TICKETS_PER_EMAIL} places pour cette date (réservations en attente de confirmation comprises).`,
      409
    );
  }
  if (result.status === -2) {
    return error(
      result.remaining > 0 ? `Il ne reste que ${result.remaining} place(s) pour cette date.` : 'Cette représentation est complète.',
      409
    );
  }

  try {
    await sendConfirmationRequest({ record, show, venue });
  } catch (err) {
    // Without the email the reservation can never be confirmed: free the seats right away.
    console.error('confirmation request email error', record.id, err);
    await releaseAtomic(JSON.stringify(record), record).catch((e) => console.error('release error', record.id, e));
    return error("Impossible d'envoyer l'email de confirmation. Vérifiez votre adresse email et réessayez.", 502);
  }

  return Response.json({ ok: true, reservationId: record.id, expiresAt: record.expiresAt });
}
