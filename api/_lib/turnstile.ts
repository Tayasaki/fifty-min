// Cloudflare Turnstile server-side verification. Env and fetch are injected; nothing is logged here.

export type TurnstileResult = { ok: true } | { ok: false; reason: 'missing-token' | 'rejected' | 'unavailable' | 'not-configured' };
export type TurnstileVerifier = (token: string) => Promise<TurnstileResult>;

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const DEFAULT_TIMEOUT_MS = 3000;
// Error codes that mean the token itself is bad; anything else is treated as a verifier outage.
const TOKEN_ERRORS = new Set(['missing-input-response', 'invalid-input-response', 'timeout-or-duplicate', 'bad-request']);

export function createTurnstileVerifier(opts: {
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  timeoutMs?: number;
}): TurnstileVerifier {
  return async (token) => {
    if (!token) return { ok: false, reason: 'missing-token' };
    const secret = opts.env.TURNSTILE_SECRET_KEY;
    if (!secret) return { ok: false, reason: 'not-configured' };
    try {
      const response = await opts.fetch(VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret, response: token }).toString(),
        signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
      if (!response.ok) return { ok: false, reason: 'unavailable' };
      const data = (await response.json()) as { success?: unknown; 'error-codes'?: unknown };
      if (data.success === true) return { ok: true };
      const codes = Array.isArray(data['error-codes']) ? data['error-codes'] : [];
      if (codes.length > 0 && codes.every((code) => typeof code === 'string' && TOKEN_ERRORS.has(code))) {
        return { ok: false, reason: 'rejected' };
      }
      return { ok: false, reason: 'unavailable' };
    } catch {
      return { ok: false, reason: 'unavailable' };
    }
  };
}
