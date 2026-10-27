---
type: analysis
skill: x-analyze
status: current
review_trigger: "on release"
created: 2026-10-27
last_updated: 2026-10-27
target: "billetterie feature (api/, src/config/shows.ts, ticketing components) at 8dd1d58"
related: [documentation/billetterie.md, documentation/decisions/ADR-002-billetterie-claim-on-confirm.md, documentation/runbooks/billetterie-launch-checklist.md]
---

# Billetterie: production-readiness gaps

Five parallel domain reviews (quality, security, performance, architecture, integration), 16/16 HIGH citations
re-verified against the code, then merged. Severities below are **recalibrated by hand**: the mechanical
multi-agent promotion over-rated tests, privacy, the recap email and the sweep.

What was verified by running it (local Redis + real handlers, and the Vercel preview): validation, honeypot,
per-email limit, 30-way concurrent booking (exactly 25 x 4 seats granted), email-failure release, expiry release,
confirm/cancel/double-cancel, CSV auth, mobile layout. The Lua reserve/confirm/release logic is sound.
Not verified: Resend plan limits, Upstash plan cap and environment scoping, deliverability.

## Must fix before production

| # | Gap | Severity | Found by | Scenario | Fix | Effort |
|---|-----|----------|----------|----------|-----|--------|
| 1 | No abuse protection on `POST /api/reserve` | HIGH | Q S A P | ~25 requests with made-up emails put all 100 seats of a show in 'pending' (shown "Complet") for 48h, repeatable. Same loop sends mail from our domain to any victim address, risking the Resend sender reputation. | Vercel WAF per-IP rate limit + Cloudflare Turnstile; cap pending seats per show; shorter first hold; Content-Type/Origin check | 4-5h |
| 2 | Per-email cap and name field are bypassable | HIGH | Q S A | `a.b@gmail.com`, `ab@gmail.com`, `a+1@gmail.com` count as 3 people. A name with newlines and a URL lands in the email body (phishing relay). | Canonicalise email for the limit key; validate name (no CR/LF, no `://`) | 1.5h |
| 3 | Email provider readiness and honest failures | HIGH | A Q | Resend quota hit, domain unverified or key missing: every booking returns "Vérifiez votre adresse email", nobody is alerted. No fetch timeouts: a killed function leaves seats held 48h with no email. | Verify domain (SPF/DKIM/DMARC), check plan quota vs launch volume, distinct error for provider failure, `AbortSignal.timeout`, log tag | 3-4h |
| 4 | Preview/production separation | HIGH (unverified part) | A Q I | Preview emails link to `melangedegenres.ch` (seen live). If the Upstash integration is scoped to all environments, previews and production share one database. | Set `PUBLIC_SITE_URL` per environment (or derive from `VERCEL_ENV`); scope Upstash per environment; document it | 1h |
| 5 | Privacy: data kept forever, no notice | HIGH | A S Q | Names and emails stored with no TTL, no notice at the form, no erasure path. | Notice at the form; TTL/purge ~30 days after each show; written erasure procedure | 3h |
| 6 | No server-side open/closed switch | HIGH | A I | The API is live the moment it deploys while the UI says "Bientôt disponible". Closing in an emergency needs a rebuild. Flag-off copy still sells (`seo.ts:40`, `TeasersSection.tsx:49`, JSON-LD). | Runtime env gate in `/api/reserve`; gate the copy | 1.5h |

## Fix soon (before the first show)

| Gap | Severity | Found by | Fix | Effort |
|-----|----------|----------|-----|--------|
| `releaseExpired()` serial sweep on every availability call; no LIMIT; one corrupt record = 503 everywhere | HIGH | P A S Q | One Lua sweep with LIMIT, per-record try/catch, cache availability (`s-maxage`), return `remaining` from reserve | 3-4h |
| Recap-email failure swallowed; UI says "sent"; cancel link exists only in that email | MEDIUM | A Q | Honest UI message, retry, "resend my links" flow | 3h |
| CSV formula injection (`=HYPERLINK(...)` in name) | MEDIUM | S Q A P I | Prefix `'` on cells starting `= + - @ \t \r` | 0.5h |
| Admin token accepted in `?token=`, non-constant-time compare, no try/catch | MEDIUM | S A Q I | Header only, `timingSafeEqual`, wrap handler, fix docs | 1.5h |
| Cannot email attendees (21 Feb already moved 19h to 17h; `.ics` UID is per reservation) | HIGH | A | Admin broadcast per show + J-2 reminder | 4h |
| Night-of tooling is a CSV that includes pending rows; no manual cancel, walk-in or check-in | MEDIUM | A | Confirmed-only door list; small admin actions reusing the Lua scripts | 3h |
| `DEL` on cancel/expiry destroys the audit trail; show id is also the Redis key | MEDIUM | A | Keep a status + TTL instead of deleting; never rename show ids | 4.5h |
| Cancel and confirm work after show start; booking closes only at start | MEDIUM | A Q | Server cutoffs (e.g. book T-2h, cancel T-1h) | 1h |
| Retry after network error creates a duplicate pending reservation; honeypot returns no `expiresAt` ("Invalid Date") | MEDIUM | Q | Dedupe window or idempotency key; make UI tolerate missing fields | 2h |
| Availability not refreshed after a failed submit (reproduced) | MEDIUM | Q | Call `loadAvailability()` on error | 0.5h |
| No tests for `api/` (race on last seat, expiry, admin 401, wrong-token 404); `App.test.tsx` cannot run (Jest 27 vs react-router v7, same on main) | HIGH | Q A I | Integration tests against local Redis; fix the Jest resolver | 8h |
| `api/` is never typechecked; `tsc -p api` fails with TS5107 on the installed TypeScript | MEDIUM | I (+ run) | `ignoreDeprecations`/`moduleResolution`, add a `typecheck` script | 1h |
| TODO on Le Monique capacity (100 vs 120); lowering capacity below booked silently overbooks | MEDIUM | Q A I | Confirm with the venue, remove TODO | 0.5h |
| Logs only (`console.error`), short retention; availability failure invisible on the page | MEDIUM | A | Alert on 5xx, show "billetterie indisponible" | 2h |

## Later / hygiene

`--no-frozen-lockfile` in `vercel.json`; `SET` without NX on 32-bit ids; 409 text reveals whether an address holds
seats; security headers / Referrer-Policy; one token for confirm and cancel, cancel link never expires; Resend
error bodies logged with the recipient; JSON `null` body gives an uncaught 500; hardcoded `+01:00` (wrong for shows
after 28 Mar 2027); emailTypos false suggestions (`gmx.de` to `gmx.ch`); emails hash fields never removed; DRY
(duplicated `error()`, `formatDateTime`, "Service indisponible" x4, contact email x4) and `redis.ts` mixing transport,
keys and Lua; docs drift (`ARCHITECTURE.md` site URL and missing `api/`, Agenda meta description, JSON-LD location
"Suisse romande", past event still listed, no frontmatter on `billetterie.md`, no `DESIGN.md`).

## Downgraded or dropped

- "`react-snap || true` could 404 `/billetterie`": production answers every path with `index.html` (checked live).
- Reservation id collision: real but needs millions of requests; kept as hygiene.

## Open verification (5 minutes each)

1. Vercel dashboard: is the Upstash integration scoped to Preview as well as Production?
2. Resend: free tier is 100 emails/day and 3,000/month (checked in the Resend docs), and a booking sends up to 3
   emails, so about 33 full bookings a day exhaust it. Plan an upgrade before launch. Is `melangedegenres.ch` verified?
3. Upstash: free tier is 500K commands/month (checked in the Upstash docs; the "10K/day" figure in the performance
   review was outdated). Quota risk is lower than first reported but still real under bot traffic.

## Top 80/20 set

Items 1-6 above (~15h) plus the sweep rework (~3h) cover most of the abuse, availability and privacy risk. The
largest cheap wins: CSV escaping (0.5h), email canonicalisation (1h), refetch-on-error (0.5h), admin token hardening
(1.5h).

## Resolution (initiative billetterie-claim-on-confirm)

The six must-fix gaps are closed in code on the branch `initiative/billetterie-claim-on-confirm`. Nothing is deployed yet.

| # | Gap | Closed by |
|---|-----|-----------|
| 1 | No abuse protection on `POST /api/reserve` | ADR-002 claim-on-confirm; M3 (Turnstile, send quota); one WAF rule remains a launch step |
| 2 | Per-email cap and name field bypassable | M1/M2 (canonical email, name validation); caps enforced at confirm |
| 3 | Email provider readiness and honest failures | M3/M4 (timeouts, error classes, honest `emailSent`); Resend plan remains a launch step |
| 4 | Preview/production separation | M3 (derived base URL); one database per environment remains a launch step |
| 5 | Privacy: retention and notice | M2 (`EXPIREAT`), M4 (notice), M5 (`documentation/billetterie.md` erasure procedure) |
| 6 | No server-side open/closed switch | M3 (`RESERVATIONS_OPEN`, `open` in availability), M5 (redeploy-to-close procedure) |

Still open, tracked in `documentation/runbooks/billetterie-launch-checklist.md`: Resend plan and domain verification, Upstash environment scoping, the Vercel rate-limit rule.
