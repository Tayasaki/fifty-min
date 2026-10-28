// Organizer export: GET /api/reservations?show=<showId> with the header
// "Authorization: Bearer <ADMIN_TOKEN>" → CSV list for the door. The token is never read from the URL.

import { SHOWS, getShow } from '../src/config/shows';
import { ERR, MSG, error, safeEqual } from './_lib/http';
import { MIN_SECRET_LENGTH } from './_lib/link';
import { ReservationRecord, keys, redis } from './_lib/redis';

const STATUS_LABELS: Record<string, string> = { confirmed: 'confirmée', cancelled: 'annulée' };

// A cell opening with = + - @ TAB or CR would run as a formula in a spreadsheet: neutralize it, then quote.
function csvCell(value: string | number): string {
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function authenticate(request: Request): Response | null {
  const adminToken = process.env.ADMIN_TOKEN ?? '';
  if (adminToken.length < MIN_SECRET_LENGTH) {
    console.error('admin export is not configured');
    return error(ERR.UNAVAILABLE, 503);
  }
  const bearer = /^Bearer(?: (.*))?$/s.exec(request.headers.get('authorization') ?? '');
  if (!bearer) {
    return Response.json({ error: 'Non autorisé' }, { status: 401, headers: { 'WWW-Authenticate': 'Bearer', 'Cache-Control': 'no-store' } });
  }
  return safeEqual(bearer[1] ?? '', adminToken) ? null : error(MSG.FORBIDDEN, 403);
}

export async function GET(request: Request): Promise<Response> {
  const denied = authenticate(request);
  if (denied) return denied;

  const showId = new URL(request.url).searchParams.get('show');
  const shows = showId ? [getShow(showId)].filter(Boolean) : SHOWS;
  if (shows.length === 0) return error(ERR.UNKNOWN_SHOW, 404);

  const rows: string[] = ['date;reservation;statut;nom;email;places;reserve_le'];
  try {
    for (const show of shows) {
      if (!show) continue;
      const ids = await redis<string[]>('LRANGE', keys.reservations(show.id), 0, -1);
      if (ids.length === 0) continue;
      const records = await redis<(string | null)[]>('MGET', ...ids.map(keys.reservation));
      records.forEach((raw, i) => {
        if (!raw) return;
        let r: ReservationRecord;
        try {
          r = JSON.parse(raw) as ReservationRecord;
        } catch {
          console.error('export row skipped', ids[i]);
          return;
        }
        const status = STATUS_LABELS[r.status] ?? 'inconnu';
        rows.push([show.label, r.id, status, r.name, r.email, r.quantity, r.createdAt].map(csvCell).join(';'));
      });
    }
  } catch (err) {
    console.error('admin export error', err);
    return error(ERR.UNAVAILABLE, 503);
  }

  return new Response('\uFEFF' + rows.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="reservations${showId ? `-${showId}` : ''}.csv"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
