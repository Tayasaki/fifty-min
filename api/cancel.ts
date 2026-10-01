// GET  /api/cancel?id=<id>&token=<token> → reservation details (read-only, safe for link scanners)
// POST /api/cancel { id, token }           → cancels the reservation and frees the seats

import { getShow, getVenue } from '../src/config/shows';
import { ReservationRecord, cancelAtomic, getReservation } from './_lib/redis';
import { sendCancellation } from './_lib/email';

function error(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

async function findReservation(
  id: string,
  token: string
): Promise<{ record: ReservationRecord } | { response: Response }> {
  if (!/^[A-F0-9]{8}$/.test(id) || !token) {
    return { response: error('Lien d’annulation invalide') };
  }
  let record: ReservationRecord | null;
  try {
    record = await getReservation(id);
  } catch (err) {
    console.error('cancel lookup error', err);
    return { response: error('Service indisponible, merci de réessayer plus tard', 503) };
  }
  if (!record || record.cancelToken !== token) {
    return { response: error('Cette réservation est introuvable ou a déjà été annulée.', 404) };
  }
  return { record };
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const found = await findReservation(url.searchParams.get('id') || '', url.searchParams.get('token') || '');
  if ('response' in found) return found.response;

  const { record } = found;
  return Response.json(
    { id: record.id, showId: record.showId, name: record.name, quantity: record.quantity },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return error('Requête invalide');
  }

  const found = await findReservation(String(body.id || ''), String(body.token || ''));
  if ('response' in found) return found.response;
  const { record } = found;

  let cancelled: boolean;
  try {
    cancelled = await cancelAtomic(record);
  } catch (err) {
    console.error('cancel error', err);
    return error('Service indisponible, merci de réessayer plus tard', 503);
  }
  if (!cancelled) return error('Cette réservation a déjà été annulée.', 404);

  const show = getShow(record.showId);
  const venue = show && getVenue(show.venueId);
  if (show && venue) {
    try {
      await sendCancellation({ record, show, venue });
    } catch (err) {
      console.error('cancellation email error', record.id, err);
    }
  }

  return Response.json({ ok: true });
}
