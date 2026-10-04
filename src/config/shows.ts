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

/** Unconfirmed reservations are released after this delay (or at show start, whichever comes first). */
export const CONFIRMATION_DELAY_HOURS = 48;

/** 2h45 with intermission (used for calendar events). */
export const SHOW_DURATION_MINUTES = 165;

/** Show start as an absolute date. All performances are before the switch to summer time (CET, UTC+1). */
export function showStart(show: Show): Date {
  return new Date(`${show.date}:00+01:00`);
}

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

// TODO: confirm Le Monique capacity with the venue (100 for now, they may have 120 seats).
export const SHOWS: Show[] = [
  { id: '2027-02-20-monique', venueId: 'monique', date: '2027-02-20T19:00', doorsOpen: '18h30', label: 'Samedi 20 février 2027 — 19h', capacity: 100 },
  { id: '2027-02-21-monique', venueId: 'monique', date: '2027-02-21T19:00', doorsOpen: '18h30', label: 'Dimanche 21 février 2027 — 19h', capacity: 100 },
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
