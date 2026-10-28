import { createHash, timingSafeEqual } from 'node:crypto';

export interface ErrorExtras {
  code?: string;
  retryAfterSeconds?: number;
  [key: string]: unknown;
}

export function error(message: string, status = 400, extra: ErrorExtras = {}): Response {
  const { retryAfterSeconds, ...rest } = extra;
  const body: Record<string, unknown> = { error: message, ...rest };
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
  if (retryAfterSeconds !== undefined) {
    body.retryAfterSeconds = retryAfterSeconds;
    headers['Retry-After'] = String(retryAfterSeconds);
  }
  return Response.json(body, { status, headers });
}

/** Constant-time string comparison: both sides are hashed so the buffers always have the same length. */
export function safeEqual(a: string, b: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(a), digest(b));
}

/** A started show answers 409 with this code; `closed` (403) is reserved for the RESERVATIONS_OPEN gate. */
export const CODE_SHOW_STARTED = 'show-started';

/** User-facing strings shared by several handlers. */
export const ERR = {
  INVALID_REQUEST: 'Requête invalide',
  UNKNOWN_SHOW: 'Représentation inconnue',
  UNKNOWN_ACTION: 'Action inconnue',
  INVALID_LINK: 'Lien invalide',
  UNAVAILABLE: 'Service indisponible, merci de réessayer plus tard',
  NOT_FOUND:
    'Cette réservation est introuvable : elle a peut-être été annulée, ou le délai de confirmation est dépassé. Vous pouvez refaire une réservation sur la billetterie.',
} as const;

/** Messages of the claim-on-confirm flow. NOT_POSSIBLE is shared by the email cap and the domain cap on purpose. */
export const MSG = {
  CLOSED: 'Les réservations ne sont pas ouvertes pour le moment.',
  CAPTCHA: 'La vérification anti-robot a échoué. Merci de réessayer.',
  FULL: 'Cette représentation est complète.',
  fewLeft: (remaining: number): string =>
    `Il ne reste que ${remaining} place${remaining > 1 ? 's' : ''} pour cette représentation.`,
  NOT_POSSIBLE: 'Cette demande ne peut pas être acceptée. Vérifiez le nombre de places demandé ou contactez l’association.',
  BAD_ADDRESS: 'Cette adresse email semble invalide ou ne peut pas recevoir de messages.',
  EMAIL_FAILED: 'L’email n’a pas pu être envoyé. Vous pouvez réessayer immédiatement.',
  EMAIL_SLOW:
    'L’envoi de l’email prend plus de temps que prévu. Vérifiez votre boîte de réception et vos courriers indésirables avant de réessayer dans quelques minutes.',
  SHOW_STARTED: 'Cette représentation a déjà commencé.',
  FORBIDDEN: 'Accès refusé',
} as const;
