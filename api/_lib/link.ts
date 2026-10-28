import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface LinkSecret {
  kid: string;
  secret: string;
}
export interface LinkSecrets {
  current: LinkSecret;
  previous?: LinkSecret;
}
export interface LinkPayload {
  v: 1;
  purpose: string;
  showId: string;
  name: string;
  email: string;
  quantity: number;
  exp: number;
  nonce: string;
  kid: string;
}
export type VerifyFailure = 'no-secret' | 'malformed' | 'unknown-kid' | 'bad-signature' | 'wrong-purpose' | 'expired';

export class LinkSecretError extends Error {}

const PURPOSE = 'confirm:v1';
const MAC_PREFIX = `${PURPOSE}\n`;
/** Shortest accepted LINK_SECRET and ADMIN_TOKEN. */
export const MIN_SECRET_LENGTH = 32;
/** Lifetime of a signed confirmation link. */
export const LINK_TTL_SECONDS = 48 * 3600;
const MAX_TOKEN_LENGTH = 2048;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export function loadLinkSecrets(env: Record<string, string | undefined>): LinkSecrets | null {
  const secret = env.LINK_SECRET ?? '';
  if (secret.length < MIN_SECRET_LENGTH) return null;
  const current: LinkSecret = { kid: env.LINK_SECRET_KID || '1', secret };
  const previousSecret = env.LINK_SECRET_PREVIOUS ?? '';
  if (previousSecret.length < MIN_SECRET_LENGTH) return { current };
  return { current, previous: { kid: env.LINK_SECRET_PREVIOUS_KID || '0', secret: previousSecret } };
}

function mac(secret: string, encodedPayload: string): Buffer {
  return createHmac('sha256', secret).update(MAC_PREFIX + encodedPayload).digest();
}

export function signLink(
  input: { showId: string; name: string; email: string; quantity: number },
  opts: { secrets: LinkSecrets | null; now?: () => number; ttlSeconds?: number; nonce?: string }
): { token: string; id: string; exp: number } {
  if (!opts.secrets) throw new LinkSecretError('Link secret is not configured');
  const { kid, secret } = opts.secrets.current;
  const nowMs = (opts.now ?? Date.now)();
  const exp = Math.floor(nowMs / 1000) + (opts.ttlSeconds ?? LINK_TTL_SECONDS);
  const payload: LinkPayload = {
    v: 1,
    purpose: PURPOSE,
    showId: input.showId,
    name: input.name,
    email: input.email,
    quantity: input.quantity,
    exp,
    nonce: opts.nonce ?? randomBytes(16).toString('base64url'),
    kid,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = mac(secret, encoded);
  return {
    token: `${encoded}.${signature.toString('base64url')}`,
    id: signature.toString('hex').slice(0, 8).toUpperCase(),
    exp,
  };
}

function parseJson(encoded: string): unknown {
  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asPayload(value: unknown): LinkPayload | null {
  if (!isRecord(value)) return null;
  const { v, purpose, showId, name, email, quantity, exp, nonce, kid } = value;
  if (v !== 1) return null;
  if (typeof purpose !== 'string' || typeof showId !== 'string' || typeof name !== 'string') return null;
  if (typeof email !== 'string' || typeof nonce !== 'string' || typeof kid !== 'string') return null;
  if (!Number.isInteger(quantity) || !Number.isInteger(exp)) return null;
  return { v, purpose, showId, name, email, quantity: quantity as number, exp: exp as number, nonce, kid };
}

export function verifyLink(
  token: string,
  opts: { secrets: LinkSecrets | null; now?: () => number }
): { ok: true; payload: LinkPayload; id: string } | { ok: false; reason: VerifyFailure } {
  const failure = (reason: VerifyFailure) => ({ ok: false as const, reason });
  if (!opts.secrets) return failure('no-secret');
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) return failure('malformed');

  const parts = token.split('.');
  if (parts.length !== 2 || !BASE64URL.test(parts[0]) || !BASE64URL.test(parts[1])) return failure('malformed');
  const [encoded, signatureB64] = parts;

  // Only the key id is read before the signature check, to pick the verifying key.
  const unverified = parseJson(encoded);
  if (!isRecord(unverified) || typeof unverified.kid !== 'string') return failure('malformed');
  const key = [opts.secrets.current, opts.secrets.previous].find((s) => s?.kid === unverified.kid);
  if (!key) return failure('unknown-kid');

  const expected = mac(key.secret, encoded);
  const provided = Buffer.from(signatureB64, 'base64url');
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return failure('bad-signature');

  const payload = asPayload(unverified);
  if (!payload) return failure('malformed');
  if (payload.purpose !== PURPOSE) return failure('wrong-purpose');
  const nowSeconds = Math.floor((opts.now ?? Date.now)() / 1000);
  if (nowSeconds >= payload.exp) return failure('expired');

  return { ok: true, payload, id: expected.toString('hex').slice(0, 8).toUpperCase() };
}
