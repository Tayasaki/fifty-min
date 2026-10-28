import { reservationsOpen } from './shows';

/**
 * Whether the booking UI and copy are live at `now`: the opening date (RESERVATIONS_OPEN_AT) decides, and
 * REACT_APP_SHOW_TICKETING=true opens early (previews). The server answers the same question for the API in
 * api/_lib/guard.ts (isReservationsOpen), where RESERVATIONS_OPEN can also force the gate closed.
 */
export function ticketingOpen(now: number = Date.now()): boolean {
  return reservationsOpen(now, process.env.REACT_APP_SHOW_TICKETING === 'true');
}

export function getTurnstileSiteKey(): string {
  return (process.env.REACT_APP_TURNSTILE_SITE_KEY ?? '').trim();
}
