// Sends transactional emails through the Resend REST API (no dependency).

import type { Show, Venue } from '../../src/config/shows';
import { SITE_URL } from '../../src/config/seo';
import type { ReservationRecord } from './redis';

const FROM = process.env.RESERVATION_FROM_EMAIL || 'Mélange de Genres <billetterie@melangedegenres.ch>';
const REPLY_TO = process.env.RESERVATION_REPLY_TO || 'infomelangesdegenres@gmail.com';
const BASE_URL = process.env.PUBLIC_SITE_URL || SITE_URL;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function placesLabel(quantity: number): string {
  return quantity > 1 ? `${quantity} places` : '1 place';
}

export function cancelUrl(record: ReservationRecord): string {
  return `${BASE_URL}/billetterie?annuler=${record.id}&token=${record.cancelToken}`;
}

function layout(inner: string): string {
  return `
<div style="font-family:Inter,Arial,sans-serif;color:#1F1F2E;max-width:520px;margin:0 auto;padding:24px;background:#FAF8F6">
  <h1 style="font-family:'Playfair Display',Georgia,serif;font-size:24px;margin:0 0 16px">15 minutes</h1>
  ${inner}
  <p>À très vite !<br>Mélange de Genres</p>
</div>`;
}

async function send(to: string, subject: string, text: string, html: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('Email is not configured');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], reply_to: REPLY_TO, subject, text, html }),
  });
  if (!res.ok) throw new Error(`Resend HTTP ${res.status}: ${await res.text()}`);
}

export async function sendConfirmation(params: { record: ReservationRecord; show: Show; venue: Venue }): Promise<void> {
  const { record, show, venue } = params;
  const places = placesLabel(record.quantity);
  const link = cancelUrl(record);

  const text = [
    `Bonjour ${record.name},`,
    '',
    `Votre réservation pour « 15 minutes » est confirmée :`,
    `- ${places}`,
    `- ${show.label}`,
    `- ${venue.name}, ${venue.address}`,
    '',
    `Numéro de réservation : ${record.id}`,
    '',
    `L'entrée est gratuite. Merci de vous présenter à l'accueil au moins 15 minutes avant le début avec ce numéro ou le nom de la réservation.`,
    '',
    `Un empêchement ? Libérez vos places pour d'autres spectateur·ice·s :`,
    link,
    '',
    `À très vite !`,
    `Mélange de Genres`,
  ].join('\n');

  const html = layout(`
  <p>Bonjour ${escapeHtml(record.name)},</p>
  <p>Votre réservation est confirmée :</p>
  <div style="background:#fff;border-radius:12px;padding:16px 20px;border:1px solid #7BB7AA55">
    <p style="margin:0 0 6px"><strong>${places}</strong></p>
    <p style="margin:0 0 6px">${escapeHtml(show.label)}</p>
    <p style="margin:0">${escapeHtml(venue.name)}, ${escapeHtml(venue.address)}</p>
  </div>
  <p style="margin-top:16px">Numéro de réservation : <strong>${record.id}</strong></p>
  <p style="color:#525968;font-size:14px">L'entrée est gratuite. Merci de vous présenter à l'accueil au moins 15 minutes avant le début avec ce numéro ou le nom de la réservation.</p>
  <p style="color:#525968;font-size:14px">Un empêchement ? <a href="${link}" style="color:#3F7165">Annuler ma réservation</a> pour libérer vos places.</p>`);

  await send(record.email, `Confirmation de réservation — 15 minutes, ${show.label}`, text, html);
}

export async function sendCancellation(params: { record: ReservationRecord; show: Show; venue: Venue }): Promise<void> {
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
