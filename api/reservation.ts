// GET  /api/reservation?id=<id>&token=<token>            → reservation details (read-only, safe for link scanners)
// POST /api/reservation { action: 'confirm' | 'cancel', id, token }

import { getShow, getVenue } from '../src/config/shows';
import { ReservationRecord, confirmAtomic, getReservation, releaseAtomic } from './_lib/redis';
import { sendCancellation, sendConfirmed } from './_lib/email';

function error(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

const NOT_FOUND =
  'Cette réservation est introuvable : elle a peut-être été annulée, ou le délai de confirmation est dépassé. Vous pouvez refaire une réservation sur la billetterie.';

async function findReservation(
  id: string,
  token: string
): Promise<{ record: ReservationRecord; raw: string } | { response: Response }> {
  if (!/^[A-F0-9]{8}$/.test(id) || !token) return { response: error('Lien invalide') };
  let found: { record: ReservationRecord; raw: string } | null;
  try {
    found = await getReservation(id);
  } catch (err) {
    console.error('reservation lookup error', err);
    return { response: error('Service indisponible, merci de réessayer plus tard', 503) };
  }
  if (!found || found.record.token !== token) return { response: error(NOT_FOUND, 404) };
  if (found.record.status === 'pending' && Date.now() > found.record.expiresAt) {
    // Expired but not yet cleaned up: free the seats now.
    await releaseAtomic(found.raw, found.record).catch((e) => console.error('release error', id, e));
    return { response: error(NOT_FOUND, 404) };
  }
  return found;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const found = await findReservation(url.searchParams.get('id') || '', url.searchParams.get('token') || '');
  if ('response' in found) return found.response;

  const { id, showId, name, quantity, status, expiresAt } = found.record;
  return Response.json({ id, showId, name, quantity, status, expiresAt }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return error('Requête invalide');
  }

  const action = body.action;
  if (action !== 'confirm' && action !== 'cancel') return error('Action inconnue');

  const found = await findReservation(String(body.id || ''), String(body.token || ''));
  if ('response' in found) return found.response;
  const { record, raw } = found;

  const show = getShow(record.showId);
  const venue = show && getVenue(show.venueId);
  if (!show || !venue) return error('Représentation inconnue', 404);

  if (action === 'confirm') {
    if (record.status === 'confirmed') return Response.json({ ok: true, status: 'confirmed' });

    const confirmed: ReservationRecord = { ...record, status: 'confirmed', confirmedAt: new Date().toISOString() };
    let ok: boolean;
    try {
      ok = await confirmAtomic(raw, confirmed);
    } catch (err) {
      console.error('confirm error', err);
      return error('Service indisponible, merci de réessayer plus tard', 503);
    }
    if (!ok) return error(NOT_FOUND, 404);

    try {
      await sendConfirmed({ record: confirmed, show, venue });
    } catch (err) {
      console.error('confirmed email error', record.id, err);
    }
    return Response.json({ ok: true, status: 'confirmed' });
  }

  let released: boolean;
  try {
    released = await releaseAtomic(raw, record);
  } catch (err) {
    console.error('cancel error', err);
    return error('Service indisponible, merci de réessayer plus tard', 503);
  }
  if (!released) return error(NOT_FOUND, 404);

  try {
    await sendCancellation({ record, show, venue });
  } catch (err) {
    console.error('cancellation email error', record.id, err);
  }
  return Response.json({ ok: true, status: 'cancelled' });
}
