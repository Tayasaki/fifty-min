import { RECORD_RETENTION_DAYS } from './shows';

// Proposed wording: the association must confirm it before launch.

export const CONTACT_EMAIL = 'infomelangesdegenres@gmail.com';

/** The recipient is constant; only the subject is encoded. */
export function contactMailto(subject?: string): string {
  const base = `mailto:${CONTACT_EMAIL}`;
  return subject ? `${base}?subject=${encodeURIComponent(subject)}` : base;
}

export const PRIVACY_NOTICE = {
  heading: 'Vos données.',
  text: `Nous collectons votre nom, votre adresse email et le nombre de places demandées, uniquement pour gérer votre réservation et vous écrire à son sujet (confirmation, récapitulatif, annulation). Elles sont conservées jusqu'à ${RECORD_RETENTION_DAYS} jours après la représentation, puis effacées. Le service d'envoi d'emails (Resend) et la vérification anti-robot (Cloudflare Turnstile) traitent techniquement ces échanges. Pour accéder à vos données ou demander leur effacement : ${CONTACT_EMAIL}.`,
} as const;

export const SUCCESS_TITLE = 'Vérifiez votre boîte mail';

/** `deadline` is a formatted date, or null when the server value is unusable. */
export function successText(email: string, deadline: string | null): string {
  const confirmBefore = deadline ? ` : confirmez avant le ${deadline}.` : '.';
  return `Un email vient d'être envoyé à ${email}. Vos places ne sont pas garanties tant que vous n'avez pas ouvert le lien qu'il contient${confirmBefore} Les places sont attribuées dans l'ordre des confirmations. Pensez à vérifier vos spams.`;
}

export const UNAVAILABLE_COPY = {
  title: 'Réservation momentanément indisponible',
  body: `Merci de réessayer plus tard ou de nous écrire à ${CONTACT_EMAIL}.`,
} as const;

export const CLOSED_COPY = {
  text: 'Les réservations ne sont pas ouvertes pour le moment.',
  notReserved: 'Vos places ne sont pas réservées.',
} as const;

/** Owner review: label of a show button once its performance has started. */
export const STARTED_LABEL = 'Représentation commencée';

export const INVALID_LINK_COPY =
  "Ce lien n'est plus valable : il a expiré, a déjà été utilisé ou la représentation n'est plus ouverte à la réservation. Vous pouvez faire une nouvelle demande sur la billetterie ou nous écrire.";

export const FULL_COPY = {
  soldOut: 'Cette représentation est complète.',
} as const;

function places(n: number): string {
  return `${n} place${n > 1 ? 's' : ''}`;
}

export function fullText(remaining: number, requested: number): string {
  if (remaining <= 0) return FULL_COPY.soldOut;
  return `Complet : il ne reste que ${places(remaining)}. Cette demande de ${places(requested)} ne peut plus être acceptée. Essayez avec moins de places.`;
}

/** Ends with a colon: the caller renders the contact mailto right after it. */
export function recapFailedText(id: string): string {
  return `Vos places sont réservées (réservation n° ${id}), mais l'email récapitulatif n'a pas pu vous être envoyé. Conservez ce numéro ou écrivez-nous :`;
}
