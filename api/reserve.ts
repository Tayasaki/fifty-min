import { MAX_TICKETS_PER_EMAIL, getShow, getVenue } from '../src/config/shows';
import { ReservationRecord, reserveAtomic } from './_lib/redis';
import { sendConfirmation } from './_lib/email';

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
  if (Date.now() > Date.parse(`${show.date}:00+01:00`)) return error('Les réservations pour cette date sont closes');
  if (name.length < 2 || name.length > 100) return error('Merci d’indiquer votre nom');
  if (email.length > 254 || !EMAIL_RE.test(email)) return error('Adresse email invalide');
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_TICKETS_PER_EMAIL) {
    return error(`Vous pouvez réserver entre 1 et ${MAX_TICKETS_PER_EMAIL} places`);
  }

  const reservationId = newReservationId();
  const record: ReservationRecord = {
    id: reservationId,
    showId,
    name,
    email,
    quantity,
    createdAt: new Date().toISOString(),
    cancelToken: crypto.randomUUID().replace(/-/g, ''),
  };

  let result: { status: number; remaining: number };
  try {
    result = await reserveAtomic({
      quantity,
      capacity: show.capacity,
      maxPerEmail: MAX_TICKETS_PER_EMAIL,
      record,
    });
  } catch (err) {
    console.error('reserve error', err);
    return error('Service indisponible, merci de réessayer plus tard', 503);
  }

  if (result.status === -1) {
    return error(
      result.remaining > 0
        ? `Cette adresse email ne peut plus réserver que ${result.remaining} place(s) pour cette date (maximum ${MAX_TICKETS_PER_EMAIL}).`
        : `Cette adresse email a déjà réservé le maximum de ${MAX_TICKETS_PER_EMAIL} places pour cette date.`,
      409
    );
  }
  if (result.status === -2) {
    return error(
      result.remaining > 0
        ? `Il ne reste que ${result.remaining} place(s) pour cette date.`
        : 'Cette représentation est complète.',
      409
    );
  }

  let emailSent = true;
  try {
    await sendConfirmation({ record, show, venue });
  } catch (err) {
    emailSent = false;
    console.error('confirmation email error', reservationId, err);
  }

  return Response.json({ ok: true, reservationId, emailSent, remaining: result.remaining });
}
