import { SHOWS } from '../src/config/shows';
import { isReservationsOpen } from './_lib/guard';
import { ERR } from './_lib/http';
import { keys, redis } from './_lib/redis';

// Counts are cached at the CDN: claimAtomic stays the authority on whether seats are left.
const CACHEABLE = 'public, s-maxage=10, stale-while-revalidate=30';

export async function GET(): Promise<Response> {
  try {
    const booked = await redis<(string | null)[]>('MGET', ...SHOWS.map((s) => keys.booked(s.id)));
    const availability = Object.fromEntries(
      SHOWS.map((s, i) => [s.id, Math.max(0, s.capacity - (Number(booked[i]) || 0))])
    );
    return Response.json(
      { availability, open: isReservationsOpen(process.env) },
      { headers: { 'Cache-Control': CACHEABLE } }
    );
  } catch (err) {
    console.error('availability error', err);
    return Response.json({ error: ERR.UNAVAILABLE }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
