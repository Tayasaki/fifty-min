// Sends transactional emails through the Resend REST API (no dependency).

import { SHOW_DURATION_MINUTES, showStart, type Show, type Venue } from '../../src/config/shows';
import { formatDateTime } from '../../src/lib/formatDateTime';
import type { ReservationRecord } from './redis';
import { resolveBaseUrl } from './site';

const DEFAULT_FROM = 'Mélange de Genres <billetterie@melangedegenres.ch>';
const DEFAULT_REPLY_TO = 'infomelangesdegenres@gmail.com';
const EVENT_TITLE = '15 minutes — Mélange de Genres';
const DEFAULT_TIMEOUT_MS = 5000;
const BAD_ADDRESS_NAMES = new Set(['validation_error', 'invalid_to_address']);

export interface EmailDeps {
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  timeoutMs?: number;
}

/**
 * bad-address: Resend refused the recipient. provider: nothing was sent (outage, rate limit, bad key).
 * timeout: the outcome is unknown, the message may still be delivered.
 */
export class EmailError extends Error {
  constructor(
    readonly kind: 'bad-address' | 'provider' | 'timeout' | 'not-configured',
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'EmailError';
  }
}

interface EmailParams {
  record: ReservationRecord;
  show: Show;
  venue: Venue;
}

export interface RequestMailParams {
  name: string;
  email: string;
  quantity: number;
  show: Show;
  venue: Venue;
  /** Signed confirmation link, used verbatim */
  link: string;
  /** Epoch milliseconds */
  linkExpiresAt: number;
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

export function buildConfirmLink(env: Record<string, string | undefined>, id: string, signedToken: string): string {
  return `${resolveBaseUrl(env)}/billetterie?confirmer=${id}&token=${signedToken}`;
}

export function buildCancelLink(env: Record<string, string | undefined>, record: ReservationRecord): string {
  return `${resolveBaseUrl(env)}/billetterie?annuler=${record.id}&token=${record.token}`;
}

/** 20270220T193000Z */
function icsDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function eventTimes(show: Show): { start: Date; end: Date } {
  const start = showStart(show);
  return { start, end: new Date(start.getTime() + SHOW_DURATION_MINUTES * 60_000) };
}

function googleCalendarUrl({ record, show, venue }: EmailParams, baseUrl: string): string {
  const { start, end } = eventTimes(show);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: EVENT_TITLE,
    dates: `${icsDate(start)}/${icsDate(end)}`,
    location: `${venue.name}, ${venue.address}`,
    details: `${placesLabel(record.quantity)} — réservation ${record.id}\nOuverture des portes ${show.doorsOpen}\n${baseUrl}/billetterie`,
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

async function send(
  deps: EmailDeps,
  to: string,
  subject: string,
  text: string,
  html: string,
  attachments?: Attachment[]
): Promise<void> {
  const apiKey = deps.env.RESEND_API_KEY;
  if (!apiKey) throw new EmailError('not-configured', 'Email is not configured');
  let res: Response;
  try {
    res = await deps.fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: deps.env.RESERVATION_FROM_EMAIL || DEFAULT_FROM,
        to: [to],
        reply_to: deps.env.RESERVATION_REPLY_TO || DEFAULT_REPLY_TO,
        subject,
        text,
        html,
        attachments,
      }),
      signal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') throw new EmailError('timeout', 'Resend timeout');
    throw new EmailError('provider', 'Resend network error');
  }
  if (res.ok) return;
  throw new EmailError(await classify(res), `Resend HTTP ${res.status}`, res.status);
}

/** Only the documented error name is read from the body: the body can echo the recipient. */
async function classify(res: Response): Promise<'bad-address' | 'provider'> {
  if (res.status !== 400 && res.status !== 422) return 'provider';
  try {
    const parsed = JSON.parse(await res.text()) as { name?: unknown };
    const name = typeof parsed.name === 'string' && /^[a-z_]{1,40}$/.test(parsed.name) ? parsed.name : '';
    return BAD_ADDRESS_NAMES.has(name) ? 'bad-address' : 'provider';
  } catch {
    return 'provider';
  }
}

/** Step 1: the signed confirmation link. No seat is held until the link is opened and confirmed. */
export async function sendConfirmRequest(params: RequestMailParams, deps: EmailDeps): Promise<void> {
  const { name, email, quantity, show, venue, link, linkExpiresAt } = params;
  const places = placesLabel(quantity);
  const deadline = formatDateTime(linkExpiresAt);

  const text = [
    `Bonjour ${name},`,
    '',
    `Vous avez demandé ${places} pour « 15 minutes » :`,
    `- ${show.label} (ouverture des portes ${show.doorsOpen})`,
    `- ${venue.name}, ${venue.address}`,
    '',
    `Vos places ne sont pas garanties tant que vous ne les avez pas confirmées. Confirmez avant le ${deadline} en ouvrant ce lien :`,
    link,
    '',
    `Les places sont attribuées dans l'ordre des confirmations, dans la limite des places disponibles.`,
    `Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : aucune place ne sera réservée.`,
    '',
    `Mélange de Genres`,
  ].join('\n');

  const html = layout(`
  <p>Bonjour ${escapeHtml(name)},</p>
  <p>Vous avez demandé <strong>${places}</strong> pour « 15 minutes » :</p>
  <div style="background:#fff;border-radius:12px;padding:16px 20px;border:1px solid #7BB7AA55">
    <p style="margin:0 0 6px">${escapeHtml(show.label)} <span style="color:#525968">(ouverture des portes ${show.doorsOpen})</span></p>
    <p style="margin:0">${escapeHtml(venue.name)}, ${escapeHtml(venue.address)}</p>
  </div>
  <p style="margin:16px 0"><strong>Vos places ne sont pas garanties</strong> tant que vous ne les avez pas confirmées. Confirmez avant le ${escapeHtml(deadline)} :</p>
  <p style="margin:24px 0;text-align:center">${button(escapeHtml(link), 'Confirmer ma réservation')}</p>
  <p style="color:#525968;font-size:14px">Les places sont attribuées dans l'ordre des confirmations, dans la limite des places disponibles. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : aucune place ne sera réservée.</p>`);

  await send(deps, email, `Confirmez votre demande de réservation — 15 minutes, ${show.label}`, text, html);
}

/** Step 2: recap once confirmed, with calendar links and the cancellation link. */
export async function sendRecap(params: EmailParams & { cancelLink: string }, deps: EmailDeps): Promise<void> {
  const { record, show, venue, cancelLink } = params;
  const calendarLink = googleCalendarUrl(params, resolveBaseUrl(deps.env));

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

  await send(deps, record.email, `Réservation confirmée — 15 minutes, ${show.label}`, text, html, [icsAttachment(params)]);
}

export async function sendCancellation(params: EmailParams, deps: EmailDeps): Promise<void> {
  const { record, show, venue } = params;
  const baseUrl = resolveBaseUrl(deps.env);
  const places = placesLabel(record.quantity);

  const text = [
    `Bonjour ${record.name},`,
    '',
    `Votre réservation ${record.id} (${places}, ${show.label}, ${venue.name}) a bien été annulée.`,
    `Vous pouvez réserver à nouveau à tout moment sur ${baseUrl}/billetterie, dans la limite des places disponibles.`,
    '',
    `Mélange de Genres`,
  ].join('\n');

  const html = layout(`
  <p>Bonjour ${escapeHtml(record.name)},</p>
  <p>Votre réservation <strong>${record.id}</strong> (${places}, ${escapeHtml(show.label)}, ${escapeHtml(venue.name)}) a bien été annulée.</p>
  <p style="color:#525968;font-size:14px">Vous pouvez réserver à nouveau à tout moment sur <a href="${baseUrl}/billetterie" style="color:#3F7165">la billetterie</a>, dans la limite des places disponibles.</p>`);

  await send(deps, record.email, `Annulation de votre réservation — 15 minutes, ${show.label}`, text, html);
}
