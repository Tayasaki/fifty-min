import { SHOWS } from '../src/config/shows';
import { keys, redis } from './_lib/redis';

export async function GET(): Promise<Response> {
  try {
    const booked = await redis<(string | null)[]>('MGET', ...SHOWS.map((s) => keys.booked(s.id)));
    const availability = Object.fromEntries(
      SHOWS.map((s, i) => [s.id, Math.max(0, s.capacity - Number(booked[i] || 0))])
    );
    return Response.json(
      { availability },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    console.error('availability error', err);
    return Response.json({ error: 'Service indisponible' }, { status: 503 });
  }
}
