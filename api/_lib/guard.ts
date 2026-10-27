import { MAX_TICKETS_PER_EMAIL, getShow, showStart } from '../../src/config/shows';
import { ERR } from './http';

export interface ReserveFields {
  showId: string;
  name: string;
  email: string;
  quantity: number;
  canonicalEmail: string;
  turnstileToken: string;
}

type Failure = { ok: false; status: number; message: string };
export type GuardResult = { ok: true } | Failure;

const DEFAULT_MAX_BODY_BYTES = 4096;
const MAX_TURNSTILE_TOKEN_LENGTH = 2048;
const NAME_MIN = 2;
const NAME_MAX = 100;
const EMAIL_MAX = 254;
const EMAIL_LOCAL_MAX = 64;

// Control, line-separator, zero-width and bidirectional formatting characters.
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/;
const NAME_URL_HINTS = /:\/\/|www\.|@|\b[a-z0-9-]+\.(com|net|org|ch|fr|io|ru|xyz|top|info|biz|link|click)\b/i;
const EMAIL_LOCAL_RE = /^[A-Za-z0-9!#$%&'*+\/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+\/=?^_`{|}~-]+)*$/;
const EMAIL_DOMAIN_RE = /^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

const fail = (status: number, message: string): Failure => ({ ok: false, status, message });

export function checkMethod(request: Request, allowed: string): GuardResult {
  return request.method === allowed ? { ok: true } : fail(405, 'Méthode non autorisée');
}

export function checkContentType(request: Request): GuardResult {
  const type = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  return type === 'application/json' ? { ok: true } : fail(415, 'Type de contenu non supporté');
}

export function checkOrigin(request: Request, allowed: readonly string[]): GuardResult {
  const origin = request.headers.get('origin');
  return origin !== null && allowed.includes(origin) ? { ok: true } : fail(403, 'Origine non autorisée');
}

export async function readJsonBody(
  request: Request,
  maxBytes = DEFAULT_MAX_BODY_BYTES
): Promise<{ ok: true; body: Record<string, unknown> } | Failure> {
  const tooLarge = fail(413, 'Requête trop volumineuse');
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return tooLarge;

  const chunks: Uint8Array[] = [];
  let total = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return tooLarge;
      }
      chunks.push(value);
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return fail(400, ERR.INVALID_REQUEST);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return fail(400, ERR.INVALID_REQUEST);
  return { ok: true, body: parsed as Record<string, unknown> };
}

export function isHoneypotFilled(body: Record<string, unknown>): boolean {
  return Boolean(body.website);
}

export function isReservationsOpen(env: Record<string, string | undefined>): boolean {
  return (env.RESERVATIONS_OPEN ?? '').trim().toLowerCase() === 'true';
}

export function validateName(raw: unknown): { ok: true; value: string } | { ok: false; message: string } {
  const invalid = { ok: false, message: 'Merci d’indiquer votre nom' } as const;
  if (typeof raw !== 'string') return invalid;
  const value = raw.trim().normalize('NFC');
  const length = [...value].length;
  if (length < NAME_MIN || length > NAME_MAX) return invalid;
  if (CONTROL_CHARS.test(value) || NAME_URL_HINTS.test(value)) return invalid;
  return { ok: true, value };
}

function splitEmail(email: string): { local: string; domain: string } | null {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf('@');
  if (at < 0) return null;
  return { local: normalized.slice(0, at), domain: normalized.slice(at + 1) };
}

export function canonicalEmail(email: string): string {
  const parts = splitEmail(email);
  if (!parts) return '';
  let { local, domain } = parts;
  const untagged = local.split('+')[0];
  // A tag-only local part ("+a") keeps its tag so unrelated addresses never share the empty key.
  local = untagged || local;
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.replace(/\./g, '');
    domain = 'gmail.com';
  }
  return local && domain ? `${local}@${domain}` : '';
}

export function emailDomain(email: string): string {
  return splitEmail(email)?.domain ?? '';
}

function isValidEmail(email: string): boolean {
  if (email.length > EMAIL_MAX) return false;
  const at = email.lastIndexOf('@');
  if (at < 1 || at > EMAIL_LOCAL_MAX) return false;
  return EMAIL_LOCAL_RE.test(email.slice(0, at)) && EMAIL_DOMAIN_RE.test(email.slice(at + 1));
}

export function validateReserveFields(
  body: Record<string, unknown>,
  now: () => number
): { ok: true; value: ReserveFields } | Failure {
  const showId = typeof body.showId === 'string' ? body.showId : '';
  const show = getShow(showId);
  if (!show) return fail(400, ERR.UNKNOWN_SHOW);
  if (now() >= showStart(show).getTime()) return fail(400, 'Les réservations pour cette date sont closes');

  const name = validateName(body.name);
  if (!name.ok) return fail(400, name.message);

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!isValidEmail(email)) return fail(400, 'Adresse email invalide');

  const quantity = body.quantity;
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_TICKETS_PER_EMAIL) {
    return fail(400, `Vous pouvez réserver entre 1 et ${MAX_TICKETS_PER_EMAIL} places`);
  }

  const turnstileToken = typeof body.turnstileToken === 'string' ? body.turnstileToken.trim() : '';
  if (turnstileToken.length > MAX_TURNSTILE_TOKEN_LENGTH) return fail(400, ERR.INVALID_REQUEST);

  return { ok: true, value: { showId, name: name.value, email, quantity, canonicalEmail: canonicalEmail(email), turnstileToken } };
}
