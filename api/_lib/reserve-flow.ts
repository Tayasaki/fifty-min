// POST /api/reserve: validate, verify the captcha, throttle, then mail a signed link.
// No seat is written here: seats are claimed only when the link is confirmed (reservation-flow.ts).

import type { Deps } from './deps';
import { EmailError, buildConfirmLink, sendConfirmRequest } from './email';
import {
  checkContentType, checkMethod, checkOrigin, isHoneypotFilled, isReservationsOpen, readJsonBody, validateReserveFields,
} from './guard';
import { ERR, MSG, error } from './http';
import { LINK_TTL_SECONDS, loadLinkSecrets, signLink } from './link';
import { checkSendQuota, refundSendQuota } from './quota';
import { readBooked } from './redis';
import { allowedOrigins } from './site';

const NO_STORE = { 'Cache-Control': 'no-store' };

const linkSent = (expSeconds: number): Response =>
  Response.json({ ok: true, linkExpiresAt: new Date(expSeconds * 1000).toISOString() }, { headers: NO_STORE });

export async function handleReserve(request: Request, deps: Deps): Promise<Response> {
  const { env } = deps;

  const method = checkMethod(request, 'POST');
  if (!method.ok) return error(method.message, method.status);
  const origin = checkOrigin(request, allowedOrigins(env));
  if (!origin.ok) return error(origin.message, origin.status);
  const type = checkContentType(request);
  if (!type.ok) return error(type.message, type.status);
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return error(parsed.message, parsed.status);

  // Honeypot: same shape as a success so a bot learns nothing.
  if (isHoneypotFilled(parsed.body)) return linkSent(Math.floor(deps.now() / 1000) + LINK_TTL_SECONDS);

  const validated = validateReserveFields(parsed.body, deps.now);
  if (!validated.ok) return error(validated.message, validated.status, { code: validated.code });
  const fields = validated.value;
  const { show, venue } = fields;

  if (!isReservationsOpen(env)) return error(MSG.CLOSED, 403, { code: 'closed' });

  const captcha = await deps.verifyTurnstile(fields.turnstileToken);
  if (!captcha.ok) {
    if (captcha.reason === 'missing-token' || captcha.reason === 'rejected') {
      return error(MSG.CAPTCHA, 400, { code: 'captcha' });
    }
    console.error('turnstile unavailable', captcha.reason);
    return error(ERR.UNAVAILABLE, 503);
  }

  // Configuration is checked before any Redis call so a misconfigured deployment consumes no quota.
  const secrets = loadLinkSecrets(env);
  if (!secrets || !env.RESEND_API_KEY) {
    console.error('reserve configuration error');
    return error(ERR.UNAVAILABLE, 503);
  }

  // Only the public availability is checked here: the answer must not depend on what an address already holds.
  // The per-address and per-domain caps are enforced atomically when the link is confirmed.
  try {
    const remaining = Math.max(0, show.capacity - (await readBooked(show.id)));
    if (fields.quantity > remaining) {
      return error(remaining === 0 ? MSG.FULL : MSG.fewLeft(remaining), 409, { code: 'full', remaining });
    }
  } catch (err) {
    console.error('reserve state error', err);
    return error(ERR.UNAVAILABLE, 503);
  }

  // One instant for the quota and its refund, so a refund after UTC midnight hits the day that was charged.
  const t = deps.now();
  const quota = await checkSendQuota('request', fields.canonicalEmail, { now: () => t });
  if (!quota.ok) {
    if (quota.reason === 'cooldown') {
      return error(quota.message, 429, { code: 'cooldown', retryAfterSeconds: quota.retryAfterSeconds });
    }
    if (quota.reason === 'budget') return error(quota.message, 429, { code: 'budget' });
    return error(quota.message, quota.reason === 'invalid' ? 400 : 503);
  }

  const signed = signLink(
    { showId: show.id, name: fields.name, email: fields.email, quantity: fields.quantity },
    { secrets, now: () => t, ttlSeconds: LINK_TTL_SECONDS }
  );

  try {
    await sendConfirmRequest(
      {
        email: fields.email,
        quantity: fields.quantity,
        show,
        venue,
        link: buildConfirmLink(env, signed.id, signed.token),
        linkExpiresAt: signed.exp * 1000,
      },
      { fetch: deps.fetch, env, timeoutMs: deps.emailTimeoutMs }
    );
  } catch (err) {
    const kind = err instanceof EmailError ? err.kind : 'provider';
    console.error('request email error', kind, err instanceof EmailError ? err.status : undefined);
    if (kind === 'timeout') return error(MSG.EMAIL_SLOW, 503, { code: 'email-slow' });
    await refundSendQuota(fields.canonicalEmail, { now: () => t });
    if (kind === 'bad-address') return error(MSG.BAD_ADDRESS, 400, { code: 'bad-address' });
    return error(MSG.EMAIL_FAILED, 503, { code: 'email-failed' });
  }

  return linkSent(signed.exp);
}
