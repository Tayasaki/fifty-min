---
type: plan
status: current
review_trigger: "on milestone completion"
created: 2026-10-27
last_updated: 2026-10-27
related: [documentation/decisions/ADR-002-billetterie-claim-on-confirm.md, documentation/milestones/_active/billetterie-claim-on-confirm/README.md, documentation/milestones/_active/billetterie-claim-on-confirm/discovery.md, documentation/milestones/_active/billetterie-claim-on-confirm/outcomes.md, documentation/milestones/_active/billetterie-claim-on-confirm/milestone-2.md]
plan_base_commit: cea6e4f9ef6b50f223aadb4cbc41ab4a59c34098
track: enterprise
mode: milestone-batch
milestone: M3
initiative: billetterie-claim-on-confirm
---

# M3 Plan: API flow, email and admin hardening

Initiative `billetterie-claim-on-confirm`, branch `initiative/billetterie-claim-on-confirm`, base `cea6e4f`. Source: ADR-002 § Data Flow and § Implementation Order steps 4-5, outcome log M1/M2 "Constraint hit" lines (all consumed, see Decision Record), M2 plan "M3 Handoff".

## Objective

Wire the claim-on-confirm flow end to end on the server: `POST /api/reserve` validates, verifies Turnstile, throttles, and emails a signed link **without writing a seat**; `GET/POST /api/reservation` previews, confirms (`claimAtomic`) and cancels (`releaseAtomic`); `GET /api/availability` becomes sweep-free and cacheable; the admin export is hardened; `email.ts` gets timeouts, error classes and per-environment links. Remove the M2 503 bridge in `reserve.ts`.

M3 is **not deployable** alone (README: ships with M4, whose frontend still reads `reservationId` / `expiresAt`). JSON contracts are fixed in § API Contract so M4 can build on them without reading handler code.

Out of scope: any `src/components` change, `vercel.json`, env docs, `documentation/billetterie.md` rewrite (M4/M5). `TicketingSection.tsx`'s own `formatDeadline` keeps existing until M4 swaps it for the shared formatter.

Order is fixed by risk: shared seams and pure modules first, authz tests RED before every handler (V-SEC-13), handlers last, mutation drill after the phase commit.

## Decision Record

| # | Decision | Easy path | Hard path | Choice | Rationale | Confidence |
|---|---|---|---|---|---|---|
| D1 | **Quota vs send order** (M2 R9 / "Constraint hit") | Send first, then count | Quota first (atomic `checkSendQuota('request')`), then send, **compensate on definite non-delivery** with `refundSendQuota` | Quota first + refund | Send-first lets an attacker bomb a victim before any counter moves. Quota-first is the only order where the budget is never exceeded under concurrency (M2 Q11/Q12). No seat is claimed at `/reserve`, so M2's "claim-first needs `releaseAtomic`" alternative does not exist here | High |
| D2 | **Refund policy** (exact) | Never refund (M2 R9 status quo) | Refund by email error class | `bad-address`, `provider` (5xx, 429, network error, 401/403, key missing): **refund**. `timeout` (outcome unknown, mail may be delivered): **keep**. Success: keep | A user whose mail provably failed must be able to retry at once and must not lose one of the 60 daily slots. An unknown outcome keeps the cooldown so a retry cannot double-send; the user is told to check the mailbox. Refund = one `EVAL` (D3) | Medium |
| D3 | Refund implementation | `DEL` + `DECR` as two commands | One `EVAL`: `DEL cooldown`, then `GET day`, `DECR` only when `> 0` | One `EVAL` (script proven on Redis 7.4, § Safety facts) | 1 HTTP call, never a negative counter, no key created when the day key is absent. Day key derives from the **instant captured at check time** (`now` passed to both calls) so a refund after UTC midnight hits the right day | High |
| D4 | **Precheck before quota** (brief lists quota first) | quota, then precheck | read-only precheck, then quota | precheck then quota | A request refused by the precheck sends no mail, so it must leave no cooldown behind. The precheck is 1 read-only `EVAL` (3 inner reads) behind Turnstile (single-use token), so it is not an unauthenticated amplifier | High |
| D5 | Precheck wording must not reveal holdings | Distinct "vous avez déjà N places" | `full` / few-left use **public** availability wording; email cap and domain cap share **one** neutral `MSG.NOT_POSSIBLE` text; claimAtomic stays authoritative | Neutral shared text | An attacker cannot tell "address holds seats" from "domain cap reached". Residual: the M2 cooldown text reveals an email was requested recently; accepted (pinned `QUOTA_MESSAGES.cooldown`) | Medium |
| D6 | Handler injection | Module-level mocks | `api/_lib/deps.ts` `Deps {now, env, fetch, verifyTurnstile}`; `reserve-flow.ts` / `reservation-flow.ts` export `handleX(request, deps)`; `api/reserve.ts` = `export const POST = (r: Request) => handleReserve(r, defaultDeps())` | Factories in `_lib` | Satisfies ADR "Strategy by injection" and the brief (injected verifier, injected Resend `fetch`). Route files export only HTTP verbs (Vercel). `defaultDeps()` binds `now` and `fetch` late (`() => Date.now()`, `(...a) => globalThis.fetch(...a)`) so the existing `mock.method(Date, 'now')` smoke tests and the Redis shim keep working | High |
| D7 | Availability and admin DI | Same factories | Read `process.env` per call; tests save/restore env | Per-call env | They need no network seam beyond Redis (already shimmed); two more modules would be KISS violations (V-KISS-03) | High |
| D8 | Test clock vs real Redis TTL (D11 of M2 again) | Real show dates in handler tests | A helper registers a **synthetic show** (`2100-06-15T19:00`, capacity 100, venue `monique`) by `SHOWS.push` in `before` and removes it in `after`; injected clock in 2099-2100 | Synthetic show | Real shows are in 2027; `EXPIREAT` (claim, quota day key) is evaluated on Redis's real clock, so a suite using them fails after 2027-02-21. Static check in Sprint Contract | High |
| D9 | Token kinds on `/api/reservation` | New `kind` param | Shape decides: `^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$` = signed confirm link, `^[a-f0-9]{32}$` = cancel token, anything else = 400 `INVALID_LINK` with 0 Redis calls. `action:'confirm'` with a cancel token (and the reverse) = 400 | Shape-based, disjoint (hex has no `.`) | No new query contract for M4; kind confusion is refused before any lookup (tests X1-X2) | High |
| D10 | Cancel token compare | `!==` (today, `reservation.ts:21`) | `timingSafeEqual` on SHA-256 digests of both strings | Digest + `timingSafeEqual` | Equal-length buffers always (probe: `timingSafeEqual` throws `ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH` on unequal lengths); one helper `safeEqual` in `http.ts`, reused by admin | High |
| D11 | Turnstile secret missing | Skip verification outside production | **Fail closed in every environment** (503, log label only). Preview/dev set the Cloudflare test secret `1x0000000000000000000000000000000AA` as the env value; tests inject the verifier | Closed everywhere | ADR flags Upstash scoping per environment as unverified: a skip-in-preview path could be a bypass on shared data. Test keys stay usable via env, as asked | High |
| D12 | Honeypot answer | `{ok:true}` (breaks `data.reservationId` reader) | `200 {ok:true, linkExpiresAt: now+48h ISO}`, no Turnstile, no quota, no mail | Same shape as a real success | The client code path is identical; the bot learns nothing. A human who autofilled the field sees "check your email" (as before) | Medium |
| D13 | Run gate also on confirm | Gate only `/reserve` | `RESERVATIONS_OPEN !== 'true'` also refuses **confirm** (403 `closed`); cancel and GET preview always work (`open` echoed) | Gate confirm | The flag is the owner's kill switch; confirm is the only operation that takes seats after a link was mailed. Env change needs a redeploy on Vercel (M5 checklist) | Medium |
| D14 | Recap / cancellation mails and quota | Refuse when budget reached | `checkSendQuota('recap'|'cancellation')` counts only (M2); its `unavailable` result is **logged and ignored**; the mail is still attempted | Never block a mail for a committed transaction | The seat or cancel is already committed; the mail cannot be bombed (needs a valid claim/cancel token). `emailSent` reports the outcome honestly | High |
| D15 | Logging rule | Log `err` objects | Logs carry labels, ids, status codes, error `name`/`kind` only: never email, name, token, provider body, request body. Resend body is **not logged** (it can echo the recipient). Redis/Turnstile transport errors may be logged as today | Label-only | Probe: Node 24 `JSON.parse` errors carry only a position, so parse errors are safe; provider bodies are the real leak (`email.ts:110` today) | High |
| D16 | `BASE_URL` | Module constant (`email.ts:9`) | `site.ts resolveBaseUrl(env)` per call: valid `PUBLIC_SITE_URL`, else `VERCEL_ENV==='production'` ? `SITE_URL` : `VERCEL_URL` ? `https://${VERCEL_URL}` : `http://localhost:3000`. Same module yields `allowedOrigins(env)` | One module for links and Origin | Preview mail can no longer point at production; local runs never mail production links; DRY between email and Origin guard | High |
| D17 | Origin allow-list | `SITE_URL` only | production: origin of `SITE_URL`, `PUBLIC_SITE_URL`, `https://${VERCEL_PROJECT_PRODUCTION_URL}` when set; non-production: `resolveBaseUrl` origin, `https://${VERCEL_URL}`, `https://${VERCEL_BRANCH_URL}`, `http://localhost:3000` | As listed | Previews have two hostnames; `ARCHITECTURE.md:46` and `seo.ts` disagree about the production host (`melangedegenres.vercel.app` vs `.ch`), so the allow-list must not hard-code one. Risk R6 | Medium |
| D18 | Admin status codes | 401 for everything | 401 no/non-Bearer header (+ `WWW-Authenticate: Bearer`), 403 well-formed Bearer with a wrong token, 503 when `ADMIN_TOKEN` unset/empty (logged label only). `?token=` is never read | 401/403/503 | Matches the brief's 401/403 paths and closes the `undefined === undefined` class: an unset token must not authenticate an empty Bearer | High |
| D19 | `formatDateTime` | Keep per-file copies | `src/lib/formatDateTime.ts` (`formatDateTime(ms: number): string`, `fr-CH`, `Europe/Zurich`, options moved verbatim from `TicketingSection.tsx:23-32`); email uses it for the link deadline; M4 deletes `formatDeadline` | Shared module now | Probe: output `samedi 20 février à 19:00` is identical under `TZ` unset, `UTC`, `America/New_York`. The M2 plan already deleted the email copy, so only the frontend copy remains until M4 | High |
| D20 | Show-started rule | Per-handler comparison | `now >= showStart(show)` everywhere (M2 D2): confirm and cancel refuse with 409 `closed`; GET preview returns `status:'closed'` | One rule | Same inclusive boundary as `link.ts` and `guard.ts` | High |
| D21 | Resend error classification | Treat every non-2xx alike | 400/422 with JSON `name` in {`validation_error`, `invalid_to_address`} = `bad-address`; every other non-2xx = `provider`; abort/timeout = `timeout`; no key = `not-configured` | Name-based | A wrong sender domain or a revoked key must not read as "your address is wrong". The `name` values are an assumption to **verify against Resend docs (context7) at the start of T3**; fixtures pin whatever is confirmed | Medium |
| D22 | Timeouts (Vercel function budget unverified) | 10 s everywhere | Turnstile 3 000 ms, Resend 5 000 ms (both overridable in deps for tests) | Short | Worst path = 3 s + 5 s + ~4 Redis round trips < 10 s. `maxDuration` of the project is unverified (M5 checklist) | Medium |

## API Contract (for M4)

All JSON, `Cache-Control: no-store` unless stated. Error bodies: `{error: string, code?: string, retryAfterSeconds?: number}` (`code` is additive: M1/M2 error bodies without it stay byte-identical).

| Endpoint | Success | Errors (status, `code`) |
|---|---|---|
| `POST /api/reserve` `{showId, name, email, quantity, turnstileToken, website?}` | `200 {ok:true, linkExpiresAt: ISO}` (no `reservationId`); honeypot returns the same shape | 405, 415, 403 (origin), 413, 400 (fields, existing texts), 403 `closed`, 400 `captcha`, 409 `full` (public wording, includes `remaining`), 409 `not-possible` (neutral), 429 `cooldown` (+`Retry-After`, `retryAfterSeconds`), 429 `budget`, 400 `bad-address`, 503 `email-failed` (refunded), 503 `email-slow` (not refunded), 503 (`ERR.UNAVAILABLE`) |
| `GET /api/reservation?id&token` signed | `200 {id, showId, name, quantity, status:'claimable'\|'full'\|'confirmed'\|'closed', availability:number, open:boolean}` | 400 `INVALID_LINK`, 404 `ERR.NOT_FOUND` (bad signature, wrong id, expired, tombstoned, cancelled), 503 |
| `GET /api/reservation?id&token` cancel | `200 {id, showId, name, quantity, status:'confirmed'\|'cancelled', closed:boolean}` | 400 `INVALID_LINK`, 404 `ERR.NOT_FOUND`, 503 |
| `POST /api/reservation {action:'confirm', id, token}` | `200 {ok:true, status:'confirmed', id, alreadyConfirmed:boolean, emailSent:boolean\|null}` (`null` = no mail attempted because already confirmed) | 400 `UNKNOWN_ACTION`/`INVALID_LINK`, 403 `closed`, 404 `ERR.NOT_FOUND`, 409 `closed` (show started), 409 `full` (+`remaining`), 409 `not-possible`, 503 |
| `POST /api/reservation {action:'cancel', id, token}` | `200 {ok:true, status:'cancelled', alreadyCancelled:boolean, emailSent:boolean\|null}` | 400, 404, 409 `closed`, 503 |
| `GET /api/availability` | `200 {availability:{[showId]:number}, open:boolean}`, `Cache-Control: public, s-maxage=10, stale-while-revalidate=30` | `503 {error: ERR.UNAVAILABLE}` with `no-store` |
| `GET /api/reservations?show=` (admin) | `200 text/csv`, `no-store` | 401, 403, 404 `ERR.UNKNOWN_SHOW`, 503 |

Links in mails: confirm `${base}/billetterie?confirmer=${id}&token=${signed}`; cancel `${base}/billetterie?annuler=${id}&token=${cancelToken}` (names unchanged for M4). Neither response ever contains the cancel token or the signed token.

## Task Breakdown

Notation: `depends on` lists task ids. Baseline at `cea6e4f` (executed 2026-10-27): `typecheck:api` exit 0; `REDIS_TEST_REQUIRED=1 pnpm run test:api` 274 pass, 0 fail, 0 skipped, 30 suites. Tests are written **red first** by x-tester; code by general-purpose; every Redis suite is gated by `redisSkipReason`, every rail/Redis-down test runs without Redis (stubbed `fetch`).

### T1: Shared seams
depends on: none. Tests first, then code.
- `api/_lib/http.ts`: `error(message, status = 400, extra?: {code?: string; retryAfterSeconds?: number})` adds `code` / `retryAfterSeconds` to the body and `Retry-After` to the headers only when given; `safeEqual(a: string, b: string): boolean` (D10); new exported `MSG` object (CLOSED, CAPTCHA, FULL, `fewLeft(n)`, NOT_POSSIBLE, BAD_ADDRESS, EMAIL_FAILED, EMAIL_SLOW, SHOW_STARTED, FORBIDDEN) with the final French strings pinned in tests. **`ERR` is not touched** (its M2 pin test stays valid).
- `api/_lib/site.ts` (new): `resolveBaseUrl(env)`, `allowedOrigins(env)` (D16, D17). `PUBLIC_SITE_URL` that is not an `http(s)` URL is ignored; trailing slash stripped.
- `api/_lib/deps.ts` (new): `Deps`, `defaultDeps()` (D6). `verifyTurnstile` default is built in T2.
- `src/lib/formatDateTime.ts` (new, D19).
- `api/_lib/guard.ts`: `CONTROL_CHARS` gains `⁠-⁤؜­᠎` (M2 "Constraint hit"). Nothing else changes.
- Tests: `http.test.ts` (+≥ 6: extras, no `code` key when absent, `Retry-After` header, `safeEqual` equal/unequal/different length/empty, MSG pins); `site.test.ts` (new, ≥ 14: production, preview, local, invalid `PUBLIC_SITE_URL`, trailing slash, `VERCEL_ENV` undefined, allow-list per environment, apex vs unknown origin); `format-date-time.test.ts` (new, ≥ 4: pinned string for `Date.UTC(2027,1,20,18)`, stable under three `TZ` values via child process or `Intl` option, integer ms only); `guard.test.ts` (+≥ 14): rejects inside the name U+2060, 2061, 2062, 2063, 2064, 061C, 00AD, 180E (8); rejects leading 2060, 061C, 00AD, 180E (4, `trim()` does not remove them); accepts neighbours U+205F, U+00AC, U+00AE, U+061B (4). The M2 neighbour list (U+200A, 2010, 202F, 206A) stays green and unedited.
- Acceptance: new tests red then green; `git grep -n "Service indisponible" -- api ':!api/__tests__'` lists only `http.ts`; `pnpm run typecheck:api` exit 0; mutation: reverting the character class fails ≥ 12 tests; `git diff --stat` touches only the files above.

### T2: Turnstile verifier
depends on: T1. Tests first (`api/__tests__/turnstile.test.ts`, ≥ 12, no network): then `api/_lib/turnstile.ts`.
```ts
export type TurnstileResult = { ok: true } | { ok: false; reason: 'missing-token' | 'rejected' | 'unavailable' | 'not-configured' };
export type TurnstileVerifier = (token: string) => Promise<TurnstileResult>;
export function createTurnstileVerifier(opts: { env: Record<string, string | undefined>; fetch: typeof fetch; timeoutMs?: number }): TurnstileVerifier;
```
- `POST https://challenges.cloudflare.com/turnstile/v0/siteverify`, `application/x-www-form-urlencoded` with `secret` and `response` only (no `remoteip`: no IP is sent to a third party), `signal: AbortSignal.timeout(timeoutMs ?? 3000)`.
- Cases: empty token → `missing-token` with 0 fetch calls; secret unset/empty → `not-configured` with 0 fetch calls in **every** `VERCEL_ENV` (D11); `{success:true}` → ok; `{success:false, 'error-codes':['timeout-or-duplicate']}` → `rejected`; `{success:false,'error-codes':['internal-error']}`, HTTP 5xx, invalid JSON, fetch reject, abort → `unavailable`; the request body contains the secret and token and the log capture contains neither; a stub with a spent-token set proves the **single-use contract**: second use of one token is `rejected`.
- A hung fetch test keeps the event loop alive with a ref'd interval (probe: `AbortSignal.timeout` timers are unref'd, a bare await can end the run silently).
- Acceptance: ≥ 12 tests, 3 identical runs; `git grep -nE "console\.|process\.env" api/_lib/turnstile.ts` empty (env injected, no logging inside).

### T3: `email.ts` (timeouts, error classes, signed links, honest result)
depends on: T1. First step: look up Resend's documented error `name` values with context7 and pin them in fixtures (D21). Tests first (`api/__tests__/email.test.ts`, ≥ 24, injected `fetch`).
- API: `class EmailError extends Error { kind: 'bad-address'|'provider'|'timeout'|'not-configured'; status?: number }` (message is `Resend HTTP <status>` or a fixed label, never the provider body or recipient); `EmailDeps {fetch: typeof fetch; env: Env; timeoutMs?: number}` (default 5000); `sendConfirmRequest({name, email, quantity, show, venue, link, linkExpiresAt}, deps)`, `sendRecap({record, show, venue, cancelLink}, deps)` (renamed from `sendConfirmed`), `sendCancellation({record, show, venue}, deps)`. `send()` passes `signal: AbortSignal.timeout(timeoutMs)`, classifies (D21), reads the error body only to extract a `[a-z_]{1,40}` `name`.
- Request mail wording (pinned): subject `Confirmez votre demande de réservation — 15 minutes, <label>`; text and html both contain `ne sont pas garanties` and `avant le <formatDateTime(exp)>`; the confirm button href equals `link` exactly. Recap and cancellation texts keep their current content; the cancel/recap links use `resolveBaseUrl(deps.env)`.
- Tests: preview env → every link starts `https://preview-abc.vercel.app`; production env without `PUBLIC_SITE_URL` → `https://melangedegenres.ch`; `PUBLIC_SITE_URL` wins; a captured request has `Authorization: Bearer`, `to: [email]`, an `.ics` only on the recap; names with `<script>` / quotes are HTML-escaped in html and unescaped in text; classification table (422 `validation_error` → bad-address; 422 with another name → provider; 401, 403, 429, 500, 503 → provider; fetch reject `TypeError` → provider; hung fetch + `timeoutMs: 20` → `timeout`; key unset → `not-configured` with 0 fetch calls); `EmailError.message` and the captured console output never contain the recipient even when the stubbed Resend body echoes it (`"Invalid to: jean@example.ch"`).
- Acceptance: ≥ 24 tests green; `git grep -nE "BASE_URL|process\.env\.PUBLIC_SITE_URL" api/_lib/email.ts` empty; `git grep -n "res.text()" api/_lib/email.ts` shows only the guarded read; typecheck 0.

### T4: Quota refund and read-only Redis helpers
depends on: T1. Tests first (`api/__tests__/quota-refund.test.ts` ≥ 8 and `api/__tests__/redis-reads.test.ts` ≥ 8, Redis-gated, clocks in 2030+, M2 D11 rules), then code.
- `quota.ts`: `refundSendQuota(canonicalEmail: string, deps?: {now?: () => number}): Promise<boolean>` — one `EVAL` (D3):
```lua
-- KEYS: cooldown, day.  Returns the day counter before the refund.
redis.call('DEL', KEYS[1]); local u = tonumber(redis.call('GET', KEYS[2]) or '0')
if u > 0 then redis.call('DECR', KEYS[2]) end
return u
```
  Returns `false` and logs `'send quota refund error'` (no address) on any Redis error; `''`/address-less key returns `false` with 0 fetch calls.
- `redis.ts`: `readClaimState(showId, canonicalEmail, domain): Promise<{booked: number; mine: number; theirs: number}>` (1 `EVAL`, 3 inner reads, proven § Safety facts) and `readLinkState(id, showId): Promise<{record: ReservationRecord | null; tombstone: boolean; booked: number}>` (1 `MGET` of `reservation:<id>`, `tombstone:<id>`, `show:<id>:booked`; nil → null/false/0).
- Tests: refund after a request removes the cooldown and decrements `quota:sent:<day>`; refund twice never goes below the first value; refund on an empty day creates no key; other address' cooldown untouched; day rollover (check at 23:59:59.900Z, refund with the pinned instant after midnight hits the old day); `request` → `refund` → `request` again succeeds for the same address; Redis 500 → `false` and no address in logs; each helper = exactly 1 fetch call; `readClaimState` after `claimAtomic` returns the counters; `readLinkState` for claimed, cancelled (tombstone), unknown; neither helper writes (`DBSIZE`/key snapshot equal before and after).
- Acceptance: ≥ 16 tests; `git diff -- api/__tests__/quota.test.ts` empty; typecheck 0; `git grep -nE "Date\.now|Math\.random" api/_lib/quota.ts` empty.

### T5: `POST /api/reserve`
depends on: T2, T3, T4. Tests first (`api/__tests__/reserve-flow.test.ts`, ≥ 40, authz RED first), then `api/_lib/reserve-flow.ts`, `api/reserve.ts` (3 lines).
Flow (the contract; each numbered step is a separate early return, no Redis before step 7):
1. `checkMethod` POST, `checkContentType`, `checkOrigin(request, allowedOrigins(env))`, `readJsonBody` (4096 bytes; `null`/array/invalid → 400).
2. `isHoneypotFilled` → D12 response.
3. `validateReserveFields(body, now)` (names, `canonicalEmail`, quantity, start boundary `>=`).
4. `isReservationsOpen(env)` else 403 `closed` + `MSG.CLOSED`.
5. `verifyTurnstile(token)`: `missing-token`/`rejected` → 400 `captcha`; `unavailable`/`not-configured` → 503 `ERR.UNAVAILABLE` (label log).
6. Configuration preflight with **no Redis call**: `loadLinkSecrets(env)` non-null and `env.RESEND_API_KEY` non-empty, else 503 (nothing consumed).
7. `readClaimState` (1 `EVAL`): `quantity > capacity - booked` → 409 `full` (`MSG.FULL` when 0 left, else `MSG.fewLeft(n)`, `remaining` in the body); `mine + qty > MAX_TICKETS_PER_EMAIL` or (`domainSeatCap(domain) > 0` and `theirs + qty > cap`) → 409 `not-possible` (D5). Redis error → 503.
8. `checkSendQuota('request', canonicalEmail, {now: () => t})` where `t = deps.now()` captured once: `cooldown` → 429 + `Retry-After`; `budget` → 429; `unavailable` → 503; `invalid` → 400.
9. `signLink({showId, name, email, quantity}, {secrets, now})`; link = `${resolveBaseUrl(env)}/billetterie?confirmer=${id}&token=${token}`.
10. `sendConfirmRequest` (D22 timeouts). Success → `200 {ok:true, linkExpiresAt}`. `EmailError`: `bad-address` → refund + 400 `bad-address`; `provider`/`not-configured` → refund + 503 `email-failed`; `timeout` → **no** refund + 503 `email-slow`. Refund = `refundSendQuota(canonicalEmail, {now: () => t})`.
Redis commands, success path: step 7 `EVAL` (reads), step 8 `EVAL` (`TTL`, `GET`, `SET … EX 600`, `INCR`, `EXPIREAT` once). **Nothing under `show:*` or `reservation:*` is ever written** (asserted).
Tests, authz and abuse first (each asserts the exact status/body, **0 Resend calls** and an unchanged key snapshot): missing/wrong/`null` Origin → 403; `text/plain` → 415; 4097-byte body → 413; body `null`/`[]`/invalid JSON → 400; honeypot → D12 shape with 0 verifier calls; gate closed (unset, `'1'`, `'TRUE '` only `true` after trim/lower-case per `isReservationsOpen`) → 403; Turnstile missing/rejected/spent token → 400, quota untouched; verifier `unavailable` → 503; `LINK_SECRET` short or `RESEND_API_KEY` empty → 503 and **no `quota:*` key**; precheck refusals (full, few left, email cap via `+tag` alias and `googlemail` alias, domain cap) leave **no cooldown key**; the email-cap and domain-cap bodies are byte-identical (D5); cooldown (second call, other `+tag` alias) → 429 with `retryAfterSeconds` 1-600; budget → 429 with 0 Resend calls; happy path: exactly 1 Resend request, `to` is the address, the link verifies with `verifyLink` and its payload equals the request, `link` host equals `resolveBaseUrl`, the response has `linkExpiresAt` = now + 48 h and no `reservationId`, keys created are exactly the two `quota:*` keys; Resend 422 `validation_error` → 400 `bad-address` and cooldown key absent, counter back to its prior value; Resend 500 → 503 `email-failed`, same refund assertions, retry succeeds at once; hung Resend → 503 `email-slow`, cooldown key **present**, counter unchanged; refund Redis failure still returns the email error; Redis down at steps 7/8 → 503 `ERR.UNAVAILABLE`, body and logs contain neither address, name, `KV_`, token nor `Redis`; log capture across the whole file never contains an address, name, signed token or Resend body.
- Acceptance: ≥ 40 tests green, 3 identical runs; `git grep -nE "reservationId|expiresAt|reserveAtomic|claimAtomic" api/_lib/reserve-flow.ts api/reserve.ts` empty; `api/reserve.ts` ≤ 8 lines; the 503 bridge and its comment are gone (`git grep -n "not wired" api` empty); the three deliberate smoke changes (§ Forced test changes) done.

### T6: `GET/POST /api/reservation`
depends on: T3, T4. Tests first (`api/__tests__/reservation-flow.test.ts`, ≥ 45), then `api/_lib/reservation-flow.ts` (`handleReservationGet`, `handleReservationPost`), `api/reservation.ts` (two one-line exports).
Behaviour as in § API Contract plus D9, D10, D13, D14, D20. Confirm = verify → id check → gate → start check → `claimAtomic({id, showId, name, email, canonicalEmail: canonicalEmail(email), quantity, capacity: show.capacity, maxPerEmail: MAX_TICKETS_PER_EMAIL, maxPerDomain: domainSeatCap(domain), expireAt: retentionExpiry(show)})`; `claimed` → `checkSendQuota('recap', …)` (ignore result, D14) → `sendRecap` → `emailSent`; `already-confirmed` → `alreadyConfirmed:true, emailSent:null`, **no mail**; `blocked` → 404; `full`/`email-limit`/`domain-limit`/`closed` per contract. Cancel = find by id + `safeEqual` token → start check → `releaseAtomic` → `released`: quota `cancellation` + `sendCancellation`; `already-cancelled`: no mail. Body is read with `readJsonBody` (fixes the JSON `null` TypeError found by the probe: 400 instead of a thrown 500).
Authz and abuse tests, RED first (all assert the status/body, an unchanged key snapshot for refusals, and 0 Resend calls):
- X1 confirm action with a cancel token, X2 cancel action with a signed link, X3 token of neither shape, X4 empty token, X5 lower-case/short/long id: 400 `INVALID_LINK`, 0 Redis calls.
- Signature: A1 one character flipped in payload, A2 one in signature, A3 payload swapped for another email/quantity with the old signature, A4 signed with another secret, A5 unknown `kid`, A6 signed link with correct signature but **URL id of another link** (forged id), A7 expired by 1 s (exact boundary: `exp` valid at `exp-1`, expired at `exp`), A8 `LINK_SECRET` unset → 503: all 404 `ERR.NOT_FOUND` except A8, and none mutates.
- Cross-account: C1 cancel token of reservation A with id of B → 404 and A, B unchanged; C2 prefix/suffix of a valid token → 404; C3 a valid cancel token for a record in another show → 404 cannot be used to read it.
- Replay and idempotency: P1 confirm twice sequentially → 2nd `alreadyConfirmed:true, emailSent:null`, one recap mail total, booked = qty; P2 5 concurrent confirms of one link → exactly 1 `alreadyConfirmed:false`, 4 `true`, 1 mail; P3 cancel then confirm replay → 404 and booked unchanged; P4 cancel twice → 2nd `alreadyCancelled:true`, one cancellation mail, counters decremented once; P5 5 concurrent cancels → 1 mail.
- Preview: V1 fresh link → `claimable`, with `availability` equal to remaining; V2 `quantity` > remaining → `full`; V3 after confirm → `confirmed`; V4 after cancel (signed link) → 404; V5 cancel link of a cancelled record → 200 `status:'cancelled'`; V6 show started (`now = start`) → `closed`; every GET: key snapshot identical before/after and the only commands issued are `MGET`/`GET`; response never contains `token`, `email`, `canonicalEmail`.
- Confirm outcomes: F1 full → 409 `full` with `remaining`; F2 email cap and domain cap (`corp.example`, 3 × 4 then 13th seat) → 409 `not-possible` with the same body; F3 gate closed → 403 `closed` but cancel and GET still work; F4 `now = start` → 409 `closed` for confirm **and** cancel, nothing written; F5 recap provider failure → `200 {status:'confirmed', emailSent:false}` and the seat **stays claimed** (booked = qty), log has label/kind only; F6 recap timeout → `emailSent:false`; F7 quota `unavailable` during recap → mail still sent, `emailSent:true`; F8 recap carries the cancel link whose token equals the stored `record.token`, host from `resolveBaseUrl`, never the signed token; F9 `claimAtomic` and Redis 500 → 503 body `ERR.UNAVAILABLE`, no leak.
- Body: JSON `null`, `[]`, `"x"`, 4097 bytes, `text/plain` → 400 / 400 / 400 / 413 / 415 (the `null` case is red today: TypeError).
- Acceptance: ≥ 45 tests, 3 identical runs; `git grep -nE "token !==|\.token ===" api/_lib/reservation-flow.ts api/reservation.ts` empty (constant-time only); `api/reservation.ts` ≤ 10 lines; typecheck 0.

### T7: `GET /api/availability`
depends on: T1. Tests first (`api/__tests__/availability.test.ts`, ≥ 8), then edit `api/availability.ts`.
- 1 `MGET` of the booked keys (no `releaseExpired`, none exists after M2), `open = isReservationsOpen(process.env)`, headers `Cache-Control: public, s-maxage=10, stale-while-revalidate=30`; failure → `Response.json({error: ERR.UNAVAILABLE}, {status: 503, headers: {'Cache-Control': 'no-store'}})` and `console.error('availability error', err)` unchanged.
- Tests: values `capacity - booked` clamped at 0 and `NaN`-safe on a corrupt counter; `open` follows `RESERVATIONS_OPEN` (true/false/unset); exact header; exactly 1 fetch call; Redis 500 → 503 `no-store`, body has no `Redis`; the key snapshot is unchanged by the call.
- Acceptance: ≥ 8 tests; `git grep -n "'Service indisponible'" api` empty; typecheck 0.

### T8: Admin export `GET /api/reservations`
depends on: T1. Tests first (`api/__tests__/admin-export.test.ts`, ≥ 16, 5 of them need no Redis), then `api/reservations.ts`.
- Auth per D18: header `Authorization: Bearer <token>` only; compare `safeEqual(provided, ADMIN_TOKEN)`; `?token=` never read.
- CSV: every text cell passes `csvCell`: a cell starting with `=`, `+`, `-`, `@`, TAB or CR is prefixed with `'`, then quoted when it contains `"`, `;`, `,`, `\n` or `\r` (CR added to the quoting class); status `confirmed` → `confirmée`, `cancelled` → `annulée`, anything else → `inconnu` (no `en attente` literal remains); a record whose JSON cannot be parsed is skipped and logged as `'export row skipped'` + id; `token`/`canonicalEmail` never appear; the first line, BOM and `Content-Disposition` are unchanged; add `X-Content-Type-Options: nosniff`.
- try/catch around all Redis reads → 503 `ERR.UNAVAILABLE`, `console.error('admin export error', err)`.
- Tests: A1 no header 401 + `WWW-Authenticate`; A2 `Basic abc` 401; A3 `Bearer ` (empty) with `ADMIN_TOKEN` set → 403; A4 wrong token 403; A5 right token 200; A6 `?token=<right>` without header 401; A7 `?token=<right>` plus wrong header 403; A8 `ADMIN_TOKEN` unset and header `Bearer undefined` / `Bearer ` / none → 503 (never 200); A9 a token differing only in the last character → 403; A10 lengths differ → 403 without throwing. CSV: formula cells (`=1+1`, `+33`, `-1`, `@SUM(A1)`, TAB, CR prefixes) in name and email, including the valid address `+a@x.ch`; a name with `"` and `;`; cancelled record labelled `annulée`; unknown show 404; Redis 500 → 503, body and logs without any name/email; an unparsable record does not break the export.
- Acceptance: ≥ 16 tests green; `git grep -nE "searchParams\.get\('token'\)|en attente" api` empty; typecheck 0.

### T9: End-to-end, concurrency and Redis-down
depends on: T5, T6, T7, T8. Owner x-tester, `api/__tests__/flow-integration.test.ts` (≥ 8) + shared helper `api/__tests__/helpers/flow.ts` (created in T5, reused here).
- Helper: `registerTestShow()` (D8), `makeDeps({now, env})` with `outbox` (captured Resend requests, link extractor from `text`), `turnstile` stub with a spent-token set, `logs` capture of `console.error/warn/log/info`, `snapshot()` (all keys with type and value, sorted).
- E1 full flow: reserve → extract link from the captured mail → GET preview (`claimable`) → POST confirm (`emailSent:true`, one recap in the outbox with the cancel link) → GET cancel link (`confirmed`) → POST cancel (`cancelled`, cancellation mail) → replay the original confirm link → 404, `booked` back to 0, tombstone exists, record `cancelled`. Asserts the outbox order and that no log line contains the address.
- E2 **30-way concurrent confirm** on one show (capacity 100, quantity 4, 30 distinct `gmail.com` addresses, links from `signLink`): exactly 25 `200`, 5 `409 full`, `booked = 100`, hash sums = 100, list length 25, recap mails = 25. E3 same with capacity 50 and quantity 3: exactly 16 claims, `booked = 48 ≤ 50`. E4 30 concurrent confirms of **one** link: 1 claimed, 29 already-confirmed, `booked = qty`. E5 double-click confirm and double-click reserve (same address: 1 mail, 1 `cooldown`). E6 reserve ×2 for the same address across two shows: second is `cooldown` (cross-show) and no seat is written by either. E7 Redis down (stubbed `fetch` returning HTTP 500 for the shim host) for every endpoint: `503`, body `{error: ERR.UNAVAILABLE}` only, no Resend call, logs free of PII; E8 invariant test (seeded LCG, 200 random reserve/confirm/cancel operations over the synthetic show): `booked` = sum of confirmed quantities = hash sums = list quantities, never negative or above capacity, recap/cancel mails equal the number of successful transitions.
- Acceptance: ≥ 8 tests, 3 identical consecutive runs; `git grep -nE "Date\.UTC\(2027|2027-0" api/__tests__/flow-integration.test.ts api/__tests__/helpers/flow.ts` empty (D8).

### T10: Mutation drill
depends on: T9, **after the phase commit** (restore proof is an empty `git diff`). Owner x-tester. One mutation at a time via targeted Edit, run `pnpm run test:api`, record failing test names, restore with a targeted Edit (never `git checkout --`, `restore`, `stash`, `reset`, `clean`).

| # | Mutation | Must fail |
|---|---|---|
| M1 | drop `checkOrigin` in `reserve-flow` | origin tests (≥ 2) |
| M2 | skip `isReservationsOpen` in reserve | gate tests, smoke 1-ms test |
| M3 | ignore the Turnstile result | captcha tests |
| M4 | move `checkSendQuota` above `readClaimState` | "precheck refusal leaves no cooldown" |
| M5 | drop refund on `provider` error | refund tests |
| M6 | refund on `timeout` too | `email-slow` keeps cooldown |
| M7 | email cap and domain cap return different bodies | byte-identical test |
| M8 | drop the id-vs-signature check | A6 |
| M9 | drop the kind check (cancel token accepted for confirm) | X1, X2 |
| M10 | cancel token compared with `startsWith` | C2 |
| M11 | drop the show-start refusal on confirm | F4 |
| M12 | drop the gate on confirm | F3 |
| M13 | `emailSent` hard-coded `true` | F5, F6 |
| M14 | preview ignores tombstone / cancelled | V4 |
| M15 | GET preview issues a write | snapshot tests |
| M16 | CSV escape for `@` removed | CSV tests |
| M17 | admin reads `?token=` again | A6 |
| M18 | `BASE_URL` ignores `VERCEL_ENV` | site + email preview tests |
| M19 | log line includes the recipient | log-capture tests |
| M20 | `Cache-Control` of availability changed | T7 header test |
| M21 | `guard.ts` character class reverted | name rejects (≥ 12) |
- Acceptance: 21/21 killed (each fails at least the listed tests, ≥ 2 distinct tests for M1-M3, M8-M9); `git diff --stat` empty after each restore; results table quoted in the commit body.

### T11: Documentation
depends on: T9. Owner x-doc-writer. (1) Search before write: grep `documentation/` for an existing API contract doc; `documentation/billetterie.md` exists and is rewritten in M5, so create `documentation/reference/billetterie-api-contract.md` (frontmatter per governance, ≤ 150 lines) containing the § API Contract table, the link formats, the neutral-wording rule and the log rule; add a row to `documentation/INDEX.md` only if that file exists (it does not today: do not create it). (2) Update `documentation/runbooks/api-tests.md` in place (≤ 120 lines; new files, `registerTestShow` rule D8, how to simulate Redis down, the event-loop keep-alive rule for hung-fetch tests). Acceptance: every command in the runbook executed by T12; no emoji; frontmatter dates bumped.

### T12: Final verification and enforcement summary
depends on: T10, T11. Owner x-tester, 5-step gate with quoted output: `pnpm run typecheck:api`; container up via `pnpm run test:api:redis`; `REDIS_TEST_REQUIRED=1 pnpm run test:api` ×3; container stopped run (SKIPPED path still runs pure suites, rail and Redis-down tests); `REDIS_TEST_REQUIRED=1` stopped → exit 1; `pnpm exec tsc -p tsconfig.json --noEmit` unchanged versus `cea6e4f`; Sprint Contract greps; `git diff --stat cea6e4f..HEAD`. Container stopped at the end.
- Acceptance: all machine items of the Sprint Contract green; changed-file list equals Critical Files.

### Forced changes to M1/M2 tests (each listed; anything else is Stop Condition 3)

| Test (file) | Change | Why |
|---|---|---|
| `handlers-smoke.test.ts` `post()` helper | adds `origin` header (`https://melangedegenres.ch`, production-shaped env set in `beforeEach`) and clears `RESERVATIONS_OPEN` | `/api/reserve` now enforces Origin; determinism against the developer's env |
| `answers 200 ok to a filled honeypot…` | expected body `{ok:true}` becomes `{ok:true, linkExpiresAt: <ISO of now+48h>}` (D12) | the UI contract needs the same shape |
| `refuses a valid request one millisecond before the start…` | 503 `ERR.UNAVAILABLE` becomes 403 `MSG.CLOSED` (gate unset); **still asserts 0 fetch calls** | the M2 bridge is removed; the gate is the next early return |
| 11 other smoke tests | none (they pass with the Origin helper) | pins |
| `http.test.ts` ERR pin | none (`ERR` untouched; `MSG` is new) | |
| `quota.test.ts`, `redis-*.test.ts`, `limits.test.ts`, `link.test.ts`, `guard.test.ts` existing cases | none; guard gets additions only | |

## Critical Files

| File | Change | Task | Exists |
|---|---|---|---|
| `api/reserve.ts` | Rewrite (3-line export) | T5 | yes |
| `api/reservation.ts` | Rewrite (two exports) | T6 | yes |
| `api/availability.ts` | Modify (header, `open`, `ERR.UNAVAILABLE`) | T7 | yes |
| `api/reservations.ts` | Rewrite auth, CSV, status labels, try/catch | T8 | yes |
| `api/_lib/reserve-flow.ts` | New | T5 | no |
| `api/_lib/reservation-flow.ts` | New | T6 | no |
| `api/_lib/turnstile.ts` | New | T2 | no |
| `api/_lib/site.ts` | New | T1 | no |
| `api/_lib/deps.ts` | New | T1 | no |
| `api/_lib/email.ts` | Rewrite (error classes, timeouts, signed links, `sendRecap`) | T3 | yes |
| `api/_lib/http.ts` | Modify (`error` extras, `safeEqual`, `MSG`) | T1 | yes |
| `api/_lib/guard.ts` | Modify (`CONTROL_CHARS` only) | T1 | yes |
| `api/_lib/quota.ts` | Modify (add `refundSendQuota`) | T4 | yes |
| `api/_lib/redis.ts` | Modify (add `readClaimState`, `readLinkState`) | T4 | yes |
| `src/lib/formatDateTime.ts` | New | T1 | no |
| `api/__tests__/{site,format-date-time,turnstile,email,quota-refund,redis-reads,reserve-flow,reservation-flow,availability,admin-export,flow-integration}.test.ts` | New | T1-T9 | no |
| `api/__tests__/helpers/flow.ts` | New | T5, T9 | no |
| `api/__tests__/{http,guard,handlers-smoke}.test.ts` | Modify (additions + 3 listed changes) | T1, T5 | yes |
| `documentation/reference/billetterie-api-contract.md` | New | T11 | no |
| `documentation/runbooks/api-tests.md` | Modify (in place) | T11 | yes |
| `api/tsconfig.json`, `package.json`, `scripts/test-api.mjs`, `api/_lib/link.ts`, `src/config/shows.ts`, `src/components/**`, `vercel.json` | Read-only (must stay unchanged) | - | yes |

## Codebase Conventions

| Touchpoint | Convention to follow | Source | Required by |
|---|---|---|---|
| Handlers | Web-standard named `GET`/`POST(request: Request): Promise<Response>` in `api/*.ts`; logic in `api/_lib` (underscore prefix = not a route) | `api/reserve.ts`, `api/_lib/*` | V-ARCH, V-SOLID-05 |
| Errors | French messages via `error(message, status)` / `ERR`; additive `code`; handlers decide HTTP status, helpers return structured results | `api/_lib/http.ts:1-14`, `quota.ts:13-15` | V-INT-01..03 |
| Config and time | Shared `src/config/shows.ts`; relative imports (`../../src/...`); clock, env, fetch injected, never read inside pure logic | `quota.ts:48`, `link.ts:48` | V-SOLID-05, V-DRY-01 |
| Redis | `redis(...)` single command, `keys.*`, Lua via `EVAL` with `{code, value}` replies, one HTTP call per operation | `api/_lib/redis.ts:9-30,82-106` | V-INT-02, V-DRY-01 |
| Logging | `console.error('<label> error', err)` for transport errors only; no address, name, token, provider body (D15) | `availability.ts:15`, `quota.ts:73` | V-SEC-03 |
| Tests | `api/__tests__/`, `node:test` + `node:assert/strict`, `import './helpers/redis-env'` first, `redisSkipReason`, fetch counting, synthetic far-future time (D8), no new dependency | `redis-lifecycle.test.ts`, `helpers/fetch-count.ts` | V-TEST-01..03 |
| TypeScript | strict, no `any`, `.ts` only, relative imports, no TODO comments, no `@/` | project `CLAUDE.md` | V-INT-03 |
| Commits | `{type}({scope}): {description}`, no `Co-Authored-By`, no AI attribution | user rules | V-GIT |

## Threat Model / STRIDE

| Threat | Category | Severity | Mitigation | Test |
|---|---|---|---|---|
| Forged or tampered confirm link (payload swapped, id forged, other secret, unknown `kid`) claims seats for someone else | Spoofing / Tampering | HIGH | `verifyLink` (HMAC, `confirm:v1`, expiry in signature) + derived-id equality; neutral 404 for every failure | A1-A7 |
| Kind confusion (cancel token used to confirm, signed link used to cancel) | Elevation of Privilege | HIGH | Disjoint token shapes, `action` must match the shape (D9) | X1-X3 |
| Cross-account cancel (token of A with id of B) | Elevation of Privilege | HIGH | Record fetched by id, `safeEqual` on the stored token, 404 otherwise | C1-C3 |
| Replay of a confirm link after cancel; double click; two devices | Tampering | HIGH | M2 tombstone + idempotent `claimAtomic`; P1-P5, E4 | P1-P5, E1, E4 |
| Email bombing a victim / spam relay via `/reserve` | Denial of Service | HIGH | Turnstile (single use), Origin, honeypot, size cap, cooldown + budget (fail closed), refund only on proven non-delivery | T5 list, E5-E6 |
| Resend quota exhausted by failed or hung sends | Denial of Service | HIGH | Budget counts attempts; timeout keeps the slot; refund only for definite failure (D2) | T5 refund tests |
| Address enumeration (does this person hold seats?) | Information Disclosure | MEDIUM | D5 identical neutral body for email cap and domain cap; GET never returns email/tokens | T5, T6 V-list |
| PII leak through logs, error bodies, Resend body | Information Disclosure | HIGH | D15; `EmailError` message fixed; log-capture assertions in every flow file | T3, T5, T9 |
| Admin export brute force / timing / query-string token in logs / `undefined === undefined` | Spoofing / Information Disclosure | HIGH | Header only, `safeEqual` on digests, unset token = 503, 401/403 split | A1-A10 |
| CSV formula injection in the door list | Tampering | MEDIUM | `'` prefix for `= + - @ TAB CR`, quoting incl. CR | T8 CSV, M16 |
| CSRF on POST endpoints | Tampering | LOW | JSON `Content-Type` required (cross-site simple forms cannot send it), Origin on `/reserve`, bearer secrets in the body | T5, T6 body tests |
| Confirm link scanner / prefetch claims a seat | Tampering | MEDIUM | GET is read-only (snapshot tests); only the button POST claims; residual accepted by ADR | V-list |
| Name/email/quantity inside the signed URL leak via Referer or history | Information Disclosure | MEDIUM | Residual accepted by ADR; `Referrer-Policy: no-referrer` ships in M5; link expires in 48 h | M5 |
| Redis or Resend outage reveals configuration or lets requests through | Elevation of Privilege / Info | HIGH | Quota `unavailable` → 503; preflight 503 before any quota; generic `ERR.UNAVAILABLE`; Turnstile missing secret fails closed (D11) | E7 |
| Repudiation: owner cannot show who confirmed/cancelled | Repudiation | LOW | `confirmedAt`/`cancelledAt` stored (M2); mail outbox visible at the provider | M2 |

## Performance Budget

Source: ADR-002 design target (Upstash free 500K commands/month; no earlier baseline). Counts are tested by fetch counting.

| Operation | HTTP calls to Redis | Inner commands | Other network | Test |
|---|---|---|---|---|
| `POST /reserve` success | 2 (`readClaimState`, `checkSendQuota`) | 3 + ≤ 5 | Turnstile ≤ 3 s, Resend ≤ 5 s | T5 |
| `POST /reserve` provider failure | 3 (+ refund) | + ≤ 4 | same | T5 |
| `GET /reservation` signed / cancel | 1 `MGET` / 1 `GET` | 1 | none | T6 |
| `POST confirm` | 2 (`claimAtomic` 16 inner, recap quota ≤ 3) | ≤ 19 | Resend ≤ 5 s | T6 |
| `POST cancel` | 3 (`GET`, `releaseAtomic` 10 inner, quota) | ≤ 14 | Resend ≤ 5 s | T6 |
| `GET /availability` | 1 `MGET` of 6 keys | 1 | CDN `s-maxage=10` | T7 |

Monthly ceiling: 600 seats × (reserve 8 + confirm 19 + cancel ~14 for 2/3 of them) ≈ 20K inner commands, 4% of 500K. Availability is the only variable cost: with `s-maxage=10` each CDN region hits the origin at most once per 10 s, i.e. at most 259 200 calls per region-month if traffic never pauses (52% of the free tier in that worst case, 1 command each); M4 must not poll. Worst serial latency on the reserve path: 3 s + 5 s + 3 Redis round trips, inside a 10 s function limit (D22; `maxDuration` unverified, M5).

## Dependency Blast-Radius

| Changed file | Downstream consumers | Radius |
|---|---|---|
| `api/_lib/email.ts` | `reservation.ts`, new `reserve-flow.ts`, `reservation-flow.ts`; `sendConfirmed` renamed `sendRecap` (1 caller) | MEDIUM, contained |
| `api/_lib/http.ts` | 5 handlers + 4 test files import `error`/`ERR`; additions only | LOW |
| `api/_lib/guard.ts` | `reserve-flow.ts` (new), tests; character class widened | LOW |
| `api/_lib/quota.ts`, `redis.ts` | additions only; M2 exports unchanged | LOW |
| `api/reserve.ts`, `reservation.ts` | `TicketingSection.tsx` / `ReservationAction.tsx` read old shapes (`reservationId`, `expiresAt`, `status:'pending'`) | HIGH, contained: M3 not deployable, M4 consumes § API Contract |
| `api/availability.ts` | `TicketingSection.tsx` (additive `open`, longer cache) | LOW |
| `api/reservations.ts` | organizer scripts calling with `?token=` break (by design) | MEDIUM, documented in the contract doc |
| `src/lib/formatDateTime.ts` | email only until M4 | LOW |

**Overall**: MEDIUM-HIGH, bounded by the non-deployable flag and the single final deploy.

## Blast Radius

| Surface | Outside the diff | How it keeps working |
|---|---|---|
| Frontend consumers | `TicketingSection.tsx:86,317` (`reservationId`, `expiresAt`), `ReservationAction.tsx:45-75` (`status`, NETWORK_ERROR), `BilletteriePage.tsx` link parsing | Not compiled by `api/tsconfig.json`; CRA build unaffected; runtime mismatch is intended until M4. Link query names (`confirmer`, `annuler`, `token`) are unchanged |
| Callers of changed exports | `sendConfirmed` (1 caller, `reservation.ts`), `sendCancellation` (1), `error()` (5 handlers) | `git grep -nE "sendConfirmed|sendConfirmationRequest" -- api src` must be empty after T3/T6; `typecheck:api` is the gate |
| Config / env | New env names: `TURNSTILE_SECRET_KEY`, `LINK_SECRET` (+`_KID`, `_PREVIOUS`, `_PREVIOUS_KID`), `RESERVATIONS_OPEN`, `ADMIN_TOKEN` (existing), `RESEND_API_KEY` (existing), `PUBLIC_SITE_URL`, `VERCEL_ENV`, `VERCEL_URL`, `VERCEL_BRANCH_URL`, `VERCEL_PROJECT_PRODUCTION_URL` | Every missing secret fails closed (503) before any quota is consumed; env matrix lands in M5. CRA root `tsconfig.json` includes `src`, so `formatDateTime.ts` is compiled by CRA too: `pnpm exec tsc -p tsconfig.json --noEmit` must equal the pre-M3 result |
| Data | No new key families. `quota:*` keys gain refunds; `show:*`/`reservation:*` are untouched by `/reserve` | Snapshot tests; M5 flushes the Preview database |
| Operators | Organizer scripts using `?token=`; Vercel env change needs a redeploy for `RESERVATIONS_OPEN` | Contract doc + M5 checklist |
| CI / deploy | No CI; `_lib` files are not routes; one deploy after M5 | README |

**Safety facts** (executed 2026-10-27 at `cea6e4f` by a delegated probe run, throwaway Redis 7.4 on 6390, DB 15, keys `m3probe:*` removed, `DBSIZE` 0 before and after, container stopped, `git status --short` identical before and after: only the pre-existing `.claude/initiatives/*.json` change):
- Baseline: `pnpm run typecheck:api` exit 0; `REDIS_TEST_REQUIRED=1 pnpm run test:api` exit 0 with `tests 274 / suites 30 / pass 274 / fail 0 / skipped 0`.
- **The current `POST /api/reservation` with body `null` throws**: `TypeError: Cannot read properties of null (reading 'action')` (compiled handler, not a 4xx Response). T6 fixes it via `readJsonBody`.
- `crypto.timingSafeEqual(Buffer.alloc(3), Buffer.alloc(4))` throws `ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH` (hence digests in `safeEqual`, D10). `AbortSignal.timeout(20)` rejects with `reason.name === 'TimeoutError'`, but its timer is unref'd: a probe without a keep-alive exited silently, which is why hung-fetch tests hold an interval (T2/T3).
- `new Request(url, {headers: {origin}}).headers.get('origin')` returns the value on Node v24.22.1 (Origin tests can build real `Request`s).
- `toLocaleString('fr-CH', {timeZone:'Europe/Zurich', …})` of `Date.UTC(2027,1,20,18)` prints `samedi 20 février à 19:00` under `TZ` unset, `UTC` and `America/New_York` (D19).
- Node 24 `JSON.parse` errors contain only a position (`… at position 48 (line 1 column 49)`), no input fragment (D15: provider bodies, not parse errors, are the leak).
- Redis: `SET cd 1 EX 600; SET day 5; EVAL <refund script>` returned `5`, then `GET day` = `4`, `EXISTS cd` = `0`; with `day` absent the same script returned `0` and left no `day` key (no negative, no creation). `MGET` of one present and two absent keys returns the value and two nils. The `readClaimState` script returned `7, 3, 0` for booked 7, address count 3, absent domain hash. Upstash parity is not locally provable (M2 R6).

## Edge Cases & Boundary Conditions

| Boundary | Scenario | Acceptance |
|---|---|---|
| Time | link valid at `exp-1`, expired at `exp`; confirm/cancel at `start-1ms` vs `start`; refund across UTC midnight; link requested 1 ms before show start | A7, F4, T4 rollover, T5 boundary test |
| Empty / hostile input | body `null`, `[]`, `"x"`, 4097 bytes, `text/plain`; token empty, 2049 chars, unicode; id lower-case; `quantity` string / 1.5 / 0 / 5; honeypot `0` / `false` strings | T5, T6 body and X-lists |
| Addresses | `+a@x.ch`, `a.b+x@gmail.com` vs `ab@googlemail.com`, upper case, 254 chars, IDN-looking domain | T5 alias tests (M2 D1 key) |
| Concurrency | 30 confirms, 30 confirms of one link, 5 cancels, 10 reserves same address | E2-E5, P2, P5 |
| Partial failure | mail fails after claim; refund Redis fails; quota unavailable on recap; timeout after Resend accepted | F5-F7, T5 refund-failure test, D2 |
| Environment | Redis 500, Redis unreachable, Resend 500/429/hang, Turnstile hang, secrets unset | E7, T2, T3, T5 preflight tests |
| Configuration | `PUBLIC_SITE_URL` invalid, `VERCEL_ENV` unset, apex vs preview vs branch origin | T1 `site.test.ts` |
| Display | name with `<`, `&`, quotes, accents, emoji in html and text; ICS escaping unchanged | T3 |

## Risk Assessment

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Authz gap on a new endpoint (forged id, kind confusion, cross-account) | HIGH | All authz tests written RED before the handler; mutants M8-M10, M14 |
| R2 | Quota refunded wrongly (free unlimited sends) or never (lost slots) | HIGH | Refund only on proven non-delivery, one script, tests for refund/keep/rollover; mutants M5-M6; Resend 429 counts as refunded because nothing was sent |
| R3 | Resend error names differ from the D21 assumption: bad address mis-classified as provider (user told to retry) | MEDIUM | Verify against docs at T3 start; fallback class is `provider` (safe: refunded); fixture table |
| R4 | PII leaks into logs or error bodies | HIGH | D15; log-capture assertions in T3, T5, T6, T8, T9; mutant M19 |
| R5 | Hung dependency pushes the request past the function limit | MEDIUM | 3 s + 5 s timeouts (D22); `maxDuration` verification on the M5 checklist |
| R6 | Origin allow-list rejects the real site (host mismatch `.ch` vs `.vercel.app`, preview aliases) so every reserve gets 403 | HIGH | D17 built from env, not constants; preview smoke is an M5 checklist item before launch; failure is loud, not silent |
| R7 | Suite time-bomb (real 2027 dates vs Redis clock) | MEDIUM | D8 synthetic show; static grep in Sprint Contract |
| R8 | Handler tests become order-dependent through shared `SHOWS`/env | MEDIUM | `before`/`after` register/unregister; env saved and restored by helper; `--test-concurrency=1` already set |
| R9 | Recap failure leaves a confirmed attendee without a cancel link | MEDIUM | Honest `emailSent:false` + `id` in the response; M4 copy tells them to note the number and contact the association; no resend endpoint (YAGNI, abuse surface) |
| R10 | Availability cache shows stale `open` or counts up to 40 s | LOW | Intended (ADR); `claimAtomic` is authoritative |
| R11 | Sonnet agent widens scope into `src/components` or `api/tsconfig.json` | MEDIUM | Critical Files list, `git diff --stat` gate, Stop Condition 1 |
| R12 | `SHOWS.push` seam leaks a test show into another test file | LOW | One process per test file (`node --test`), removal in `after`, grep check |

## Stop Conditions

> On encountering any condition below, halt and report (structured "halted" status in headless mode) rather than improvising.

1. **Scope drift**: making the suite pass needs an edit outside the Critical Files table (`src/components`, `vercel.json`, `package.json`, `api/tsconfig.json`, `scripts/test-api.mjs`, `link.ts`, `shows.ts`). Halt.
2. **Shared or foreign Redis**: `REDIS_TEST_URL` resolves to port 6379 or any container other than `fifty-min-test-redis`, DB 15 holds foreign keys. Never FLUSH anything to make a test pass.
3. **Existing test weakened**: a test outside the Forced-changes table needs editing. Halt; do not alter expectations to match.
4. **Network in tests**: any test reaches `challenges.cloudflare.com`, `api.resend.com` or the real Upstash (the shim throws "Network access is disabled in tests"). Fix the injection, never allow the host.
5. **Real clock dependency**: a test passes or fails depending on today's date (D8). Fix before continuing.
6. **Authz test cannot be made red first** (the behaviour already exists or the assertion is vacuous): stop and re-examine the assertion before writing the handler.
7. **PII in output**: a captured log line, error body or response contains an address, name, token or provider body. Halt: this is a V-SEC-03 defect, not a flaky test.
8. **Deploy**: asked to deploy or merge before M4/M5 complete: halt.
9. **Docker unavailable**: complete everything that does not need Redis, report Redis-gated tests as unverified, do not report the milestone done.

## Agent-Asset Ripple

| Asset | Update | Why |
|---|---|---|
| `documentation/reference/billetterie-api-contract.md` | new (T11) | M4 and M5 need one durable contract |
| `documentation/runbooks/api-tests.md` | in place (T11) | new files and seams |
| `documentation/billetterie.md`, `CLAUDE.md`, `ARCHITECTURE.md` (note the `.ch` / `.vercel.app` SITE_URL disagreement), `documentation/decisions/INDEX.md` | none in M3 | single docs pass in M5; ADR-002 stays `proposed` |

No rule or agent asset is renamed or removed (V-ASSET-03 satisfied).

## M4 Handoff (facts M4 must act on)

- Replace reads of `reservationId`/`expiresAt` with `linkExpiresAt`; delete `CONFIRMATION_DELAY_HOURS` and `formatDeadline` (use `src/lib/formatDateTime.ts`); statuses are `claimable | full | confirmed | closed` (signed) and `confirmed | cancelled` (cancel); map every `code` in § API Contract to a user-visible state; reset the Turnstile widget on every error; `GET /api/availability` now returns `open` and is cached 10 s, do not poll.
- The page URL carries the signed token (PII): do not log it client-side and keep the `Referrer-Policy` item for M5.
- Preview `status:'full'` means the quantity no longer fits; confirm can still fail on address or domain caps (`not-possible`), so the confirm button needs an error state.

## Sprint Contract

### Machine-verifiable
- [ ] `pnpm run typecheck:api` exits 0 with empty output; `pnpm exec tsc -p tsconfig.json --noEmit` result identical to the pre-M3 result.
- [ ] With Redis up, `REDIS_TEST_REQUIRED=1 pnpm run test:api` exits 0 with 0 failed, 0 skipped, 0 cancelled; total ≥ 450 (baseline 274 + new ≥ 176: guard/http/site/format ≥ 38, turnstile ≥ 12, email ≥ 24, quota-refund + redis-reads ≥ 16, reserve ≥ 40, reservation ≥ 45, availability ≥ 8, admin ≥ 16, integration ≥ 8, minus none removed); identical on three consecutive runs.
- [ ] Container stopped: exit 0, prints `SKIPPED`, still runs pure suites, rail tests and Redis-down tests; `REDIS_TEST_REQUIRED=1` exit 1.
- [ ] `git grep -nE "reservationId|expiresAt|CONFIRMATION_DELAY_HOURS|sendConfirmed|sendConfirmationRequest|en attente|not wired" -- api` is empty; `git grep -nE "searchParams\.get\('token'\)" -- api` is empty.
- [ ] `git grep -nE "token !==|\.token ===" -- api ':!api/__tests__'` is empty (constant-time compare only).
- [ ] `git grep -nE "Date\.UTC\(2027|2027-0[23]" -- api/__tests__/reserve-flow.test.ts api/__tests__/reservation-flow.test.ts api/__tests__/flow-integration.test.ts api/__tests__/helpers/flow.ts api/__tests__/admin-export.test.ts api/__tests__/availability.test.ts` is empty (D8).
- [ ] `git grep -nE "console\.(log|info|warn|error)" -- api/_lib/email.ts api/_lib/turnstile.ts api/_lib/reserve-flow.ts api/_lib/reservation-flow.ts` shows only lines whose arguments contain no email, name, token or response-body variable (reviewed by x-tester); log-capture tests green.
- [ ] Every handler file: `api/reserve.ts` ≤ 8 lines, `api/reservation.ts` ≤ 10 lines; `git grep -n "claimAtomic\|releaseAtomic" api/reserve.ts` empty.
- [ ] Mutation drill T10: 21/21 killed; tree clean after (`git diff --stat` empty before the final commit).
- [ ] `git diff cea6e4f..HEAD -- package.json pnpm-lock.yaml api/tsconfig.json scripts api/_lib/link.ts src/config src/components vercel.json` is empty; `git diff -U0 cea6e4f..HEAD | grep -E '^\+.*(TODO|Co-Authored-By)'` empty; `git log cea6e4f..HEAD --format=%B | grep -ci "co-authored-by"` prints `0`.
- [ ] `git diff --stat cea6e4f..HEAD` lists exactly the Critical Files; container `fifty-min-test-redis` stopped at the end.

### Human-verifiable
- [ ] The French messages in `MSG` and the request-mail wording read naturally and state that places are not guaranteed before confirmation.
- [ ] `documentation/reference/billetterie-api-contract.md` is enough for M4 to build the UI without opening a handler.
- [ ] Test names in `reserve-flow`, `reservation-flow` and `flow-integration` read as the specification of the flow.

## Execution Strategy

**Pattern**: sequential spine, TDD (x-tester writes each red file before the code it covers), bounded parallelism on disjoint files (≤ 3 agents per phase). Estimate ~11-13 h.

| Agent | Task(s) | Model | Delegation Contract |
|-------|---------|-------|---------------------|
| x-tester | tests of T1-T9, T10, T12 | sonnet | **Objective**: write the listed tests red first, run the drill and the final gate. **Output format**: files + per-file pass/fail table with quoted runner output. **Scope**: `api/__tests__/**` incl. `helpers/`; production code read-only except the targeted, restored mutations of T10 (never `git checkout --`, `restore`, `stash`, `reset`, `clean`). **Tool guidance**: node:test + `node:assert/strict`; `pnpm run test:api`; Redis only via `pnpm run test:api:redis` on 6390, never 6379; stubbed `fetch` for Resend/Turnstile/Redis-down. **Stop condition**: every test listed for the task exists and results match the acceptance; container stopped after T12. |
| general-purpose | code of T1-T8 | sonnet | **Objective**: implement exactly the contract of each task after its red tests exist. **Output format**: changed files + quoted green test output + `git diff --stat`. **Scope**: files in the task's Critical Files rows only; never edit `*.test.ts` or `helpers/`. **Tool guidance**: Edit, Bash for `pnpm run typecheck:api` / `pnpm run test:api`; strict TS, relative imports, no TODO comments, no new dependency; context7 for the Resend error names (T3). **Stop condition**: task acceptance met and typecheck 0, or a Stop Condition is hit. |
| x-doc-writer | T11 | sonnet | **Objective**: create the contract reference doc and update the runbook in place. **Output format**: the two files, line limits as in T11. **Scope**: those two files only; grep `documentation/` first (search-before-write). **Tool guidance**: copy the contract table from this plan; cross-check commands with `package.json`. **Stop condition**: every command cross-checked. |

**Phases**:
- P1: T1 (x-tester tests → general-purpose code) ‖ T2 tests (x-tester) once `deps.ts`/`http.ts` types exist; T2 code follows. Commit `feat(api): add site urls, shared http helpers and invisible-character guard`.
- P2: T3 ‖ T4 (disjoint files: `email.ts` vs `quota.ts`/`redis.ts`). Commits `feat(api): send mail with timeouts, error classes and signed links`, `feat(api): refund send quota and read-only redis helpers`.
- P3: T5 (RED authz first, then flow) → commit `feat(api): validate, verify and email a signed link without holding seats`; T6 → commit `feat(api): preview, confirm and cancel through signed links`.
- P4: T7 ‖ T8 (disjoint files). Commits `feat(api): serve cacheable availability with the open flag`, `fix(api): harden the admin export`.
- P5: T9 → commit `test(api): cover the full flow and concurrent claims`; then T10 (after the commit) ‖ T11; then T12. Commit `docs(api): add the billetterie API contract`. No attribution lines anywhere.

## Plan Quality Gate (self-check, 8 checks)

- [x] 1 Acceptance criteria: 12/12 tasks carry measurable criteria with commands or counts.
- [x] 2 Critical file existence: every "Modify"/"Read-only" row was read this session (`api/reserve.ts`, `reservation.ts`, `availability.ts`, `reservations.ts`, `_lib/{email,http,guard,quota,redis,link}.ts`, `src/config/shows.ts`, `scripts/test-api.mjs`, `api/tsconfig.json`, `handlers-smoke.test.ts`, `http.test.ts`); the rest are marked "New".
- [x] 3 Dependencies: each task lists `depends on`; order acyclic (T1 → T2, T3, T4 → T5, T6; T1 → T7, T8; T9 needs T5-T8; T10 needs T9; T11 needs T9; T12 needs T10, T11).
- [x] 4 Risk concreteness: every mitigation names a test id, mutant, constant or command.
- [x] 5 Success criteria: Sprint Contract items are commands or file-state checks.
- [x] 6 Boundary conditions: dedicated section plus per-task cases.
- [x] 7 Stop conditions: present (HIGH risks R1, R2, R4, R6).
- [x] 8 Codebase Conventions and Blast Radius: both present; one safety fact set proven by executed commands (quoted above); consumers and env names listed.
- Sections: Threat Model, Performance Budget, Dependency Blast-Radius, Execution Strategy, Sprint Contract included (enterprise track). Owner-ruling ledger `documentation/reference/product-principles.md` not present (absence is not a plan-time HIGH, not created). `ARCHITECTURE.md` exists (V-ADA-01 satisfied). Markers: none emitted. Open assumption to verify inside T3: Resend error `name` values (D21).
