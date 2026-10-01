// Organizer export: GET /api/reservations?show=<showId> with header
// "Authorization: Bearer <ADMIN_TOKEN>" (or ?token=<ADMIN_TOKEN>) → CSV list for the door.

import { SHOWS, getShow } from '../src/config/shows';
import { ReservationRecord, keys, redis } from './_lib/redis';

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: Request): Promise<Response> {
  const adminToken = process.env.ADMIN_TOKEN;
  const url = new URL(request.url);
  const provided = request.headers.get('authorization')?.replace(/^Bearer /, '') || url.searchParams.get('token');
  if (!adminToken || provided !== adminToken) {
    return Response.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const showId = url.searchParams.get('show');
  const shows = showId ? [getShow(showId)].filter(Boolean) : SHOWS;
  if (shows.length === 0) return Response.json({ error: 'Représentation inconnue' }, { status: 404 });

  const rows: string[] = ['date;reservation;nom;email;places;reserve_le'];
  for (const show of shows) {
    if (!show) continue;
    const records = await redis<string[]>('LRANGE', keys.reservations(show.id), 0, -1);
    for (const raw of records) {
      const r = JSON.parse(raw) as ReservationRecord;
      rows.push([show.label, r.id, r.name, r.email, r.quantity, r.createdAt].map(csvCell).join(';'));
    }
  }

  return new Response('﻿' + rows.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="reservations${showId ? `-${showId}` : ''}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
