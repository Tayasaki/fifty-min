// Shared between the frontend (src/) and the serverless API (api/).
// Keep this file free of React / browser-only imports.

export interface Venue {
  id: string;
  name: string;
  location: string;
  address: string;
  accessibility: string;
}

export interface Show {
  id: string;
  venueId: string;
  /** ISO date-time, Europe/Zurich local time */
  date: string;
  /** Doors opening time, as displayed */
  doorsOpen: string;
  label: string;
  /** Number of seats that can be reserved */
  capacity: number;
}

export const MAX_TICKETS_PER_EMAIL = 4;

/** Reservations open on 15 November 2026 at midnight, Geneva time (CET). */
export const RESERVATIONS_OPEN_AT = new Date('2026-11-15T00:00:00+01:00');

/**
 * Whether reservations are accepted at `now`.
 * `forceOpen` (REACT_APP_SHOW_TICKETING=true) opens them early, e.g. on a preview deployment.
 */
export function reservationsOpen(now: number = Date.now(), forceOpen = false): boolean {
  return forceOpen || now >= RESERVATIONS_OPEN_AT.getTime();
}

/** 2h45 with intermission (used for calendar events). */
export const SHOW_DURATION_MINUTES = 165;

/** Show start as an absolute date. All performances are before the switch to summer time (CET, UTC+1). */
export function showStart(show: Show): Date {
  return new Date(`${show.date}:00+01:00`);
}

// --- Reservation limits (server enforced) ---------------------------------

/** Seats one non-major email domain can hold in a show (a catch-all domain cannot fill it). */
export const MAX_TICKETS_PER_DOMAIN = 12;

/** Providers shared by many unrelated people: no per-domain seat cap applies. */
export const MAJOR_EMAIL_DOMAINS: readonly string[] = [
  'gmail.com', 'googlemail.com', 'outlook.com', 'outlook.fr', 'hotmail.com', 'hotmail.fr', 'live.com', 'live.fr',
  'msn.com', 'yahoo.com', 'yahoo.fr', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'protonmail.ch',
  'bluewin.ch', 'gmx.ch', 'gmx.com', 'gmx.net', 'hispeed.ch', 'sunrise.ch', 'orange.fr', 'free.fr', 'sfr.fr',
  'laposte.net', 'wanadoo.fr',
];

/** Minimum delay between two confirmation-request emails to the same address. */
export const SEND_COOLDOWN_SECONDS = 600;

/** Confirmation-request emails accepted per UTC day, all addresses together. */
export const DAILY_REQUEST_EMAIL_BUDGET = 60;

/** Personal data is kept this many days after the show starts. */
export const RECORD_RETENTION_DAYS = 30;

/** Epoch seconds at which a show's reservation data expires. */
export function retentionExpiry(show: Show): number {
  return Math.floor(showStart(show).getTime() / 1000) + RECORD_RETENTION_DAYS * 86400;
}

/** Per-show seat cap for an email domain; 0 means not enforced (major provider). */
export function domainSeatCap(domain: string): number {
  return MAJOR_EMAIL_DOMAINS.includes(domain.toLowerCase()) ? 0 : MAX_TICKETS_PER_DOMAIN;
}

// --- end of reservation limits ----------------------------------------------

export const VENUES: Venue[] = [
  {
    id: 'monique',
    name: 'Théâtre Le Monique',
    location: 'Cointrin',
    address: '54 avenue Louis-Casaï, 1216 Cointrin',
    accessibility: 'Accès handicapé',
  },
  {
    id: 'julienne',
    name: 'Théâtre de la Julienne',
    location: 'Plan-les-Ouates',
    address: 'Route de St-Julien 116, 1228 Plan-les-Ouates',
    accessibility: 'Accessible AA+',
  },
];

// Le Monique capacity: 100 is the conservative figure (the venue may have 120 seats). Raising it is safe; lowering it below the booked count overbooks. Open question: launch checklist, step 0.
export const SHOWS: Show[] = [
  { id: '2027-02-19-monique', venueId: 'monique', date: '2027-02-19T19:00', doorsOpen: '18h30', label: 'Vendredi 19 février 2027 — 19h', capacity: 100 },
  { id: '2027-02-20-monique', venueId: 'monique', date: '2027-02-20T19:00', doorsOpen: '18h30', label: 'Samedi 20 février 2027 — 19h', capacity: 100 },
  { id: '2027-02-21-monique', venueId: 'monique', date: '2027-02-21T17:00', doorsOpen: '16h30', label: 'Dimanche 21 février 2027 — 17h', capacity: 100 },
  { id: '2027-03-11-julienne', venueId: 'julienne', date: '2027-03-11T19:00', doorsOpen: '18h30', label: 'Jeudi 11 mars 2027 — 19h', capacity: 100 },
  { id: '2027-03-12-julienne', venueId: 'julienne', date: '2027-03-12T19:00', doorsOpen: '18h30', label: 'Vendredi 12 mars 2027 — 19h', capacity: 100 },
  { id: '2027-03-13-julienne', venueId: 'julienne', date: '2027-03-13T19:00', doorsOpen: '18h30', label: 'Samedi 13 mars 2027 — 19h', capacity: 100 },
  { id: '2027-03-14-julienne', venueId: 'julienne', date: '2027-03-14T17:00', doorsOpen: '16h30', label: 'Dimanche 14 mars 2027 — 17h', capacity: 100 },
];

export function getShow(id: string): Show | undefined {
  return SHOWS.find((s) => s.id === id);
}

export function getVenue(id: string): Venue | undefined {
  return VENUES.find((v) => v.id === id);
}
