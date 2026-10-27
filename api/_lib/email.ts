// Sends transactional emails through the Resend REST API (no dependency).

import { SHOW_DURATION_MINUTES, showStart, type Show, type Venue } from '../../src/config/shows';
import { SITE_URL } from '../../src/config/seo';
import type { ReservationRecord } from './redis';

const FROM = process.env.RESERVATION_FROM_EMAIL || 'Mélange de Genres <billetterie@melangedegenres.ch>';
const REPLY_TO = process.env.RESERVATION_REPLY_TO || 'infomelangesdegenres@gmail.com';
const BASE_URL = process.env.PUBLIC_SITE_URL || SITE_URL;
const EVENT_TITLE = '15 minutes — Mélange de Genres';

interface EmailParams {
  record: ReservationRecord;
  show: Show;
  venue: Venue;
}

interface Attachment {
  filename: string;
  content: string; // base64
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function placesLabel(quantity: number): string {
  return quantity > 1 ? `${quantity} places` : '1 place';
}

function actionUrl(action: 'confirmer' | 'annuler', record: ReservationRecord): string {
  return `${BASE_URL}/billetterie?${action}=${record.id}&token=${record.token}`;
}

function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString('fr-CH', {
    timeZone: 'Europe/Zurich',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 20270220T193000Z */
function icsDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function eventTimes(show: Show): { start: Date; end: Date } {
  const start = showStart(show);
  return { start, end: new Date(start.getTime() + SHOW_DURATION_MINUTES * 60_000) };
}

function googleCalendarUrl({ record, show, venue }: EmailParams): string {
  const { start, end } = eventTimes(show);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: EVENT_TITLE,
    dates: `${icsDate(start)}/${icsDate(end)}`,
    location: `${venue.name}, ${venue.address}`,
    details: `${placesLabel(record.quantity)} — réservation ${record.id}\nOuverture des portes ${show.doorsOpen}\n${BASE_URL}/billetterie`,
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

function icsAttachment({ record, show, venue }: EmailParams): Attachment {
  const { start, end } = eventTimes(show);
  const escape = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Melange de Genres//Billetterie//FR',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${record.id}@melangedegenres.ch`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${escape(EVENT_TITLE)}`,
    `LOCATION:${escape(`${venue.name}, ${venue.address}`)}`,
    `DESCRIPTION:${escape(`${placesLabel(record.quantity)} — réservation ${record.id}\nOuverture des portes ${show.doorsOpen}`)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  return { filename: '15-minutes.ics', content: Buffer.from(ics, 'utf-8').toString('base64') };
}

function layout(inner: string): string {
  return `
<div style="font-family:Inter,Arial,sans-serif;color:#1F1F2E;max-width:520px;margin:0 auto;padding:24px;background:#FAF8F6">
  <h1 style="font-family:'Playfair Display',Georgia,serif;font-size:24px;margin:0 0 16px">15 minutes</h1>
  ${inner}
  <p>À très vite !<br>Mélange de Genres</p>
</div>`;
}

function recapHtml({ record, show, venue }: EmailParams): string {
  return `
  <div style="background:#fff;border-radius:12px;padding:16px 20px;border:1px solid #7BB7AA55">
    <p style="margin:0 0 6px"><strong>${placesLabel(record.quantity)}</strong></p>
    <p style="margin:0 0 6px">${escapeHtml(show.label)} <span style="color:#525968">(ouverture des portes ${show.doorsOpen})</span></p>
    <p style="margin:0 0 6px">${escapeHtml(venue.name)}, ${escapeHtml(venue.address)}</p>
    <p style="margin:0;color:#525968;font-size:14px">Réservation n° <strong>${record.id}</strong></p>
  </div>`;
}

function button(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;background:#1F1F2E;color:#fff;text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:600">${label}</a>`;
}

async function send(to: string, subject: string, text: string, html: string, attachments?: Attachment[]): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('Email is not configured');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], reply_to: REPLY_TO, subject, text, html, attachments }),
  });
  if (!res.ok) throw new Error(`Resend HTTP ${res.status}: ${await res.text()}`);
}

/** Step 1: asks the person to confirm their email address. */
export async function sendConfirmationRequest(params: EmailParams): Promise<void> {
  const { record, show, venue } = params;
  const link = actionUrl('confirmer', record);
  const deadline = formatDateTime(record.expiresAt);

  const text = [
    `Bonjour ${record.name},`,
    '',
    `Merci pour votre réservation pour « 15 minutes » :`,
    `- ${placesLabel(record.quantity)}`,
    `- ${show.label} (ouverture des portes ${show.doorsOpen})`,
    `- ${venue.name}, ${venue.address}`,
    '',
    `Pour la valider, confirmez-la avant le ${deadline} en ouvrant ce lien :`,
    link,
    '',
    `Sans confirmation, les places seront libérées pour d'autres spectateur·ice·s.`,
    `Vous n'êtes pas à l'origine de cette réservation ? Ignorez simplement cet email.`,
    '',
    `Mélange de Genres`,
  ].join('\n');

  const html = layout(`
  <p>Bonjour ${escapeHtml(record.name)},</p>
  <p>Merci pour votre réservation ! Il ne reste qu'une étape&nbsp;: la confirmer.</p>
  ${recapHtml(params)}
  <p style="margin:24px 0;text-align:center">${button(link, 'Confirmer ma réservation')}</p>
  <p style="color:#525968;font-size:14px">À confirmer avant le <strong>${escapeHtml(deadline)}</strong>. Sans confirmation, les places seront libérées pour d'autres spectateur·ice·s.<br>Vous n'êtes pas à l'origine de cette réservation ? Ignorez simplement cet email.</p>`);

  await send(record.email, `Confirmez votre réservation — 15 minutes, ${show.label}`, text, html);
}

/** Step 2: recap once confirmed, with calendar links and the cancellation link. */
export async function sendConfirmed(params: EmailParams): Promise<void> {
  const { record, show, venue } = params;
  const cancelLink = actionUrl('annuler', record);
  const calendarLink = googleCalendarUrl(params);

  const text = [
    `Bonjour ${record.name},`,
    '',
    `Votre réservation pour « 15 minutes » est confirmée :`,
    `- ${placesLabel(record.quantity)}`,
    `- ${show.label} (ouverture des portes ${show.doorsOpen})`,
    `- ${venue.name}, ${venue.address}`,
    `- Réservation n° ${record.id}`,
    '',
    `L'entrée est gratuite. Les portes ouvrent à ${show.doorsOpen} : merci de vous présenter à l'accueil avant le début du spectacle avec ce numéro ou le nom de la réservation.`,
    '',
    `Ajouter à Google Agenda : ${calendarLink}`,
    `(Un fichier .ics est joint pour Apple Calendar, Outlook, etc.)`,
    '',
    `Un empêchement ? Libérez vos places pour d'autres spectateur·ice·s :`,
    cancelLink,
    '',
    `À très vite !`,
    `Mélange de Genres`,
  ].join('\n');

  const html = layout(`
  <p>Bonjour ${escapeHtml(record.name)},</p>
  <p>Votre réservation est <strong>confirmée</strong>&nbsp;!</p>
  ${recapHtml(params)}
  <p style="color:#525968;font-size:14px;margin-top:16px">L'entrée est gratuite. Les portes ouvrent à ${show.doorsOpen} : merci de vous présenter à l'accueil avant le début du spectacle avec ce numéro ou le nom de la réservation.</p>
  <p style="margin:24px 0;text-align:center">${button(calendarLink, 'Ajouter à Google Agenda')}</p>
  <p style="color:#525968;font-size:13px;text-align:center">Un fichier .ics est joint pour Apple Calendar, Outlook, etc.</p>
  <p style="color:#525968;font-size:14px">Un empêchement ? <a href="${cancelLink}" style="color:#3F7165">Annuler ma réservation</a> pour libérer vos places.</p>`);

  await send(record.email, `Réservation confirmée — 15 minutes, ${show.label}`, text, html, [icsAttachment(params)]);
}

export async function sendCancellation(params: EmailParams): Promise<void> {
  const { record, show, venue } = params;
  const places = placesLabel(record.quantity);

  const text = [
    `Bonjour ${record.name},`,
    '',
    `Votre réservation ${record.id} (${places}, ${show.label}, ${venue.name}) a bien été annulée.`,
    `Vous pouvez réserver à nouveau à tout moment sur ${BASE_URL}/billetterie, dans la limite des places disponibles.`,
    '',
    `Mélange de Genres`,
  ].join('\n');

  const html = layout(`
  <p>Bonjour ${escapeHtml(record.name)},</p>
  <p>Votre réservation <strong>${record.id}</strong> (${places}, ${escapeHtml(show.label)}, ${escapeHtml(venue.name)}) a bien été annulée.</p>
  <p style="color:#525968;font-size:14px">Vous pouvez réserver à nouveau à tout moment sur <a href="${BASE_URL}/billetterie" style="color:#3F7165">la billetterie</a>, dans la limite des places disponibles.</p>`);

  await send(record.email, `Annulation de votre réservation — 15 minutes, ${show.label}`, text, html);
}
