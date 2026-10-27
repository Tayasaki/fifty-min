// GET  /api/reservation?id&token  read-only preview of a signed confirm link or of a cancel link.
// POST /api/reservation {action, id, token}  confirm (claims the seats) or cancel (frees them).
// Token kinds are disjoint by shape: "payload.signature" is a signed confirm link, 32 hex digits a cancel token.

import { MAX_TICKETS_PER_EMAIL, domainSeatCap, getShow, getVenue, retentionExpiry, showStart, type Show, type Venue } from '../../src/config/shows';
import type { Deps } from './deps';
import { EmailError, buildCancelLink, sendCancellation, sendRecap, type EmailDeps } from './email';
import { canonicalEmail, checkContentType, emailDomain, isReservationsOpen, readJsonBody } from './guard';
import { CODE_SHOW_STARTED, ERR, MSG, error, safeEqual } from './http';
import { loadLinkSecrets, verifyLink, type LinkPayload } from './link';
import { checkSendQuota } from './quota';
import { claimAtomic, getReservation, readLinkState, releaseAtomic, type ReservationRecord } from './redis';

const SIGNED_TOKEN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const CANCEL_TOKEN = /^[a-f0-9]{32}$/;
const ID = /^[A-F0-9]{8}$/;
const NO_STORE = { 'Cache-Control': 'no-store' };

type Kind = 'signed' | 'cancel';
type Parsed = { ok: true; kind: Kind; id: string; token: string } | { ok: false; response: Response };

const notFound = (): Response => error(ERR.NOT_FOUND, 404);
const unavailable = (): Response => error(ERR.UNAVAILABLE, 503);
const json = (value: unknown): Response => Response.json(value, { headers: NO_STORE });

function parseLink(idValue: unknown, tokenValue: unknown): Parsed {
  const id = typeof idValue === 'string' ? idValue : '';
  const token = typeof tokenValue === 'string' ? tokenValue : '';
  const kind: Kind | null = SIGNED_TOKEN.test(token) ? 'signed' : CANCEL_TOKEN.test(token) ? 'cancel' : null;
  if (!ID.test(id) || kind === null) return { ok: false, response: error(ERR.INVALID_LINK) };
  return { ok: true, kind, id, token };
}

type Verified = { ok: true; payload: LinkPayload; show: Show; venue: Venue } | { ok: false; response: Response };

function verifySigned(id: string, token: string, deps: Deps): Verified {
  const secrets = loadLinkSecrets(deps.env);
  if (!secrets) {
    console.error('reservation configuration error');
    return { ok: false, response: unavailable() };
  }
  const verified = verifyLink(token, { secrets, now: deps.now });
  if (!verified.ok || verified.id !== id) return { ok: false, response: notFound() };
  const show = getShow(verified.payload.showId);
  const venue = show && getVenue(show.venueId);
  if (!show || !venue) return { ok: false, response: notFound() };
  return { ok: true, payload: verified.payload, show, venue };
}

type Found = { ok: true; record: ReservationRecord; raw: string; show: Show; venue: Venue } | { ok: false; response: Response };

async function findByCancelToken(id: string, token: string): Promise<Found> {
  let found: Awaited<ReturnType<typeof getReservation>>;
  try {
    found = await getReservation(id);
  } catch (err) {
    console.error('reservation lookup error', err);
    return { ok: false, response: unavailable() };
  }
  if (!found || !safeEqual(found.record.token, token)) return { ok: false, response: notFound() };
  const show = getShow(found.record.showId);
  const venue = show && getVenue(show.venueId);
  if (!show || !venue) return { ok: false, response: notFound() };
  return { ok: true, record: found.record, raw: found.raw, show, venue };
}

const started = (show: Show, deps: Deps): boolean => deps.now() >= showStart(show).getTime();
const emailDeps = (deps: Deps): EmailDeps => ({ fetch: deps.fetch, env: deps.env, timeoutMs: deps.emailTimeoutMs });

/** Runs the mail, reports whether it left; a failure never undoes the committed transaction. */
async function mailAfterCommit(label: string, canonical: string, deps: Deps, send: () => Promise<void>): Promise<boolean> {
  const t = deps.now();
  const kind = label === 'recap' ? 'recap' : 'cancellation';
  // A quota outage must not block a mail for a transaction that is already committed.
  await checkSendQuota(kind, canonical, { now: () => t });
  try {
    await send();
    return true;
  } catch (err) {
    console.error(`${label} email error`, err instanceof EmailError ? err.kind : 'provider', err instanceof EmailError ? err.status : undefined);
    return false;
  }
}

export async function handleReservationGet(request: Request, deps: Deps): Promise<Response> {
  const query = new URL(request.url).searchParams;
  const parsed = parseLink(query.get('id'), query.get('token'));
  if (!parsed.ok) return parsed.response;
  const open = isReservationsOpen(deps.env);

  if (parsed.kind === 'signed') {
    const verified = verifySigned(parsed.id, parsed.token, deps);
    if (!verified.ok) return verified.response;
    const { payload, show } = verified;
    try {
      const state = await readLinkState(parsed.id, show.id);
      if (state.tombstone || state.record?.status === 'cancelled') return notFound();
      const availability = Math.max(0, show.capacity - state.booked);
      const status = state.record
        ? 'confirmed'
        : started(show, deps)
          ? 'closed'
          : payload.quantity > availability
            ? 'full'
            : 'claimable';
      return json({ id: parsed.id, showId: show.id, name: payload.name, quantity: payload.quantity, status, availability, open });
    } catch (err) {
      console.error('reservation preview error', err);
      return unavailable();
    }
  }

  const found = await findByCancelToken(parsed.id, parsed.token);
  if (!found.ok) return found.response;
  const { record, show } = found;
  return json({
    id: record.id, showId: record.showId, name: record.name, quantity: record.quantity, status: record.status, closed: started(show, deps),
  });
}

export async function handleReservationPost(request: Request, deps: Deps): Promise<Response> {
  const type = checkContentType(request);
  if (!type.ok) return error(type.message, type.status);
  const read = await readJsonBody(request);
  if (!read.ok) return error(read.message, read.status);

  const action = read.body.action;
  if (action !== 'confirm' && action !== 'cancel') return error(ERR.UNKNOWN_ACTION);
  const parsed = parseLink(read.body.id, read.body.token);
  if (!parsed.ok) return parsed.response;
  if ((action === 'confirm') !== (parsed.kind === 'signed')) return error(ERR.INVALID_LINK);

  return action === 'confirm' ? confirmLink(parsed.id, parsed.token, deps) : cancelReservation(parsed.id, parsed.token, deps);
}

async function confirmLink(id: string, token: string, deps: Deps): Promise<Response> {
  const verified = verifySigned(id, token, deps);
  if (!verified.ok) return verified.response;
  const { payload, show, venue } = verified;

  if (!isReservationsOpen(deps.env)) return error(MSG.CLOSED, 403, { code: 'closed' });
  if (started(show, deps)) return error(MSG.SHOW_STARTED, 409, { code: CODE_SHOW_STARTED });

  const canonical = canonicalEmail(payload.email);
  let result: Awaited<ReturnType<typeof claimAtomic>>;
  try {
    result = await claimAtomic(
      {
        id, showId: show.id, name: payload.name, email: payload.email, canonicalEmail: canonical, quantity: payload.quantity,
        capacity: show.capacity, maxPerEmail: MAX_TICKETS_PER_EMAIL, maxPerDomain: domainSeatCap(emailDomain(canonical)), expireAt: retentionExpiry(show),
      },
      { now: deps.now }
    );
  } catch (err) {
    console.error('claim error', err);
    return unavailable();
  }

  switch (result.status) {
    case 'already-confirmed':
      return json({ ok: true, status: 'confirmed', id, alreadyConfirmed: true, emailSent: null });
    case 'blocked':
      return notFound();
    case 'closed':
      return error(MSG.SHOW_STARTED, 409, { code: CODE_SHOW_STARTED });
    case 'full':
      return error(result.remaining <= 0 ? MSG.FULL : MSG.fewLeft(result.remaining), 409, { code: 'full', remaining: Math.max(0, result.remaining) });
    case 'email-limit':
    case 'domain-limit':
      return error(MSG.NOT_POSSIBLE, 409, { code: 'not-possible' });
    default: {
      const { record } = result;
      const emailSent = await mailAfterCommit('recap', canonical, deps, () =>
        sendRecap({ record, show, venue, cancelLink: buildCancelLink(deps.env, record) }, emailDeps(deps))
      );
      return json({ ok: true, status: 'confirmed', id, alreadyConfirmed: false, emailSent });
    }
  }
}

async function cancelReservation(id: string, token: string, deps: Deps): Promise<Response> {
  const found = await findByCancelToken(id, token);
  if (!found.ok) return found.response;
  const { record, raw, show, venue } = found;
  if (started(show, deps)) return error(MSG.SHOW_STARTED, 409, { code: CODE_SHOW_STARTED });

  let released: Awaited<ReturnType<typeof releaseAtomic>>;
  try {
    released = await releaseAtomic(raw, record, retentionExpiry(show), { now: deps.now });
  } catch (err) {
    console.error('cancel error', err);
    return unavailable();
  }
  if (released === 'not-found') return notFound();
  if (released === 'already-cancelled') return json({ ok: true, status: 'cancelled', id, alreadyCancelled: true, emailSent: null });

  const emailSent = await mailAfterCommit('cancellation', record.canonicalEmail, deps, () =>
    sendCancellation({ record, show, venue }, emailDeps(deps))
  );
  return json({ ok: true, status: 'cancelled', id, alreadyCancelled: false, emailSent });
}
