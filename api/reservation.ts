// GET  /api/reservation?id=<id>&token=<token>            → reservation details (read-only, safe for link scanners)
// POST /api/reservation { action: 'confirm' | 'cancel', id, token }

import { getShow, getVenue, retentionExpiry } from '../src/config/shows';
import { ReleaseResult, ReservationRecord, getReservation, releaseAtomic } from './_lib/redis';
import { sendCancellation } from './_lib/email';
import { ERR, error } from './_lib/http';

async function findReservation(
  id: string,
  token: string
): Promise<{ record: ReservationRecord; raw: string } | { response: Response }> {
  if (!/^[A-F0-9]{8}$/.test(id) || !token) return { response: error(ERR.INVALID_LINK) };
  let found: { record: ReservationRecord; raw: string } | null;
  try {
    found = await getReservation(id);
  } catch (err) {
    console.error('reservation lookup error', err);
    return { response: error(ERR.UNAVAILABLE, 503) };
  }
  if (!found || found.record.token !== token) return { response: error(ERR.NOT_FOUND, 404) };
  return found;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const found = await findReservation(url.searchParams.get('id') || '', url.searchParams.get('token') || '');
  if ('response' in found) return found.response;

  const { id, showId, name, quantity, status } = found.record;
  return Response.json({ id, showId, name, quantity, status }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return error(ERR.INVALID_REQUEST);
  }

  const action = body.action;
  if (action !== 'confirm' && action !== 'cancel') return error(ERR.UNKNOWN_ACTION);

  const found = await findReservation(String(body.id || ''), String(body.token || ''));
  if ('response' in found) return found.response;
  const { record, raw } = found;

  const show = getShow(record.showId);
  const venue = show && getVenue(show.venueId);
  if (!show || !venue) return error(ERR.UNKNOWN_SHOW, 404);

  if (action === 'confirm') {
    if (record.status === 'confirmed') return Response.json({ ok: true, status: 'confirmed' });
    return error(ERR.NOT_FOUND, 404);
  }

  let released: ReleaseResult;
  try {
    released = await releaseAtomic(raw, record, retentionExpiry(show));
  } catch (err) {
    console.error('cancel error', err);
    return error(ERR.UNAVAILABLE, 503);
  }
  if (released === 'not-found') return error(ERR.NOT_FOUND, 404);

  if (released === 'released') {
    try {
      await sendCancellation({ record, show, venue });
    } catch (err) {
      console.error('cancellation email error', record.id, err);
    }
  }
  return Response.json({ ok: true, status: 'cancelled' });
}
