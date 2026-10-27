export function error(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

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
