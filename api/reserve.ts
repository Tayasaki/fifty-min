import { MAX_TICKETS_PER_EMAIL, getShow, showStart } from '../src/config/shows';
import { ERR, error } from './_lib/http';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return error(ERR.INVALID_REQUEST);
  }

  // Honeypot: real users never fill this hidden field.
  if (body.website) return Response.json({ ok: true });

  const showId = String(body.showId || '');
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const quantity = Number(body.quantity);

  const show = getShow(showId);
  if (!show) return error(ERR.UNKNOWN_SHOW);
  if (Date.now() >= showStart(show).getTime()) return error('Les réservations pour cette date sont closes');
  if (name.length < 2 || name.length > 100) return error('Merci d’indiquer votre nom');
  if (email.length > 254 || !EMAIL_RE.test(email)) return error('Adresse email invalide');
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_TICKETS_PER_EMAIL) {
    return error(`Vous pouvez réserver entre 1 et ${MAX_TICKETS_PER_EMAIL} places`);
  }

  // The claim-on-confirm flow is not wired to this endpoint yet: every valid request is refused
  // before any Redis or email call, so no seat is held and no message is sent.
  return error(ERR.UNAVAILABLE, 503);
}
