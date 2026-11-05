---
type: plan
status: current
review_trigger: "on milestone completion"
created: 2026-10-27
last_updated: 2026-10-27
related: [documentation/decisions/ADR-002-billetterie-claim-on-confirm.md, documentation/milestones/_active/billetterie-claim-on-confirm/README.md, documentation/milestones/_active/billetterie-claim-on-confirm/discovery.md, documentation/milestones/_active/billetterie-claim-on-confirm/outcomes.md, documentation/milestones/_active/billetterie-claim-on-confirm/milestone-3.md, documentation/reference/billetterie-api-contract.md]
plan_base_commit: 6c5b0aeca347366de71af9eef5ac8e666eab6a88
track: enterprise
mode: milestone-batch
milestone: M4
initiative: billetterie-claim-on-confirm
---

# M4 Plan: Frontend: Turnstile, notice, honest states

Initiative `billetterie-claim-on-confirm`, branch `initiative/billetterie-claim-on-confirm`, base `6c5b0ae`. Sources: ADR-002, README M4 section, outcome log M1-M3 (the M3 "Constraint hit" line is fully consumed in Phase A), `documentation/reference/billetterie-api-contract.md`, the current frontend files.

## Objective

Two phases, in this order, because Phase A changes the contract the UI consumes.

- **Phase A (server, `api/`)**: close the M3 review findings: remove the address-holdings oracle from `POST /api/reserve`, drop the attacker-chosen name from the unsolicited mail, enforce `ADMIN_TOKEN` >= 32 chars, remove duplication and dead code, make the started-show answer consistent, fix the contract doc, strengthen the weak tests, stop the smoke test depending on a real 2027 show.
- **Phase B (frontend, `src/`)**: `TicketingSection` with Cloudflare Turnstile (no new npm dependency), privacy notice, honest success and error states mapped from the API `code`, `open` flag, availability refetch on every error; `ReservationAction` with the full state set (preview, full, already confirmed, confirmed with/without recap mail, cancelled, neutral invalid/expired/closed); copy that does not advertise reservations while `REACT_APP_SHOW_TICKETING` is not `'true'` (one shared helper); and a runnable UI test suite.

M4 is **not deployable alone** (README: ships with M1-M5 in one deploy). Out of scope: `vercel.json`, `documentation/billetterie.md`, `CLAUDE.md`/`ARCHITECTURE.md` edits, `DESIGN.md` (absent, see Agent-Asset Ripple), Navbar, the Upstash/Resend/Turnstile dashboards, any new npm dependency, any change to `.env`.

## Decision Record

| # | Decision | Easy path | Hard path | Choice | Rationale | Confidence |
|---|---|---|---|---|---|---|
| D1 | **Address-holdings oracle** (`reserve-flow.ts:63-76`) | Keep the pre-check, add jitter | (a) drop the email-cap and domain-cap pre-check; (b) charge quota and return the success shape without mailing; (c) mail the address owner a different "you already hold seats" message | **(a)** drop; keep only the public `full` check. The caps stay enforced atomically at confirm (`claimAtomic`, `409 not-possible`) | After (a) the response to `/reserve` no longer depends on holdings at all, so there is nothing to probe; the link goes to the address owner, who alone can reach confirm. (b) tells a real user "check your mailbox" for a mail that never comes (dishonest, V-FIX-01 spirit). (c) is the best UX but adds a third mail template, tests and a new bombing vector for ~2 h with no launch need (Pareto). Cost of (a): an address at its cap gets a mail and learns "not possible" only at the click. Follow-up trigger for (c): association reports confusion | Medium |
| D2 | Name in the **unsolicited** mail | Whitelist letters in `validateName` (rejects "O'Brien Jr.", "Dr.", digits, rare names) | Drop the name from the pre-confirmation mail only | Greeting becomes `Bonjour,`; subject and body carry no user text | The request mail is the only mail sent without proof of mailbox ownership; with no attacker text in it, URL-blacklist gaps (`evil.de/x`, `bit.ly/x`, phone numbers) stop mattering. Recap and cancellation mails keep the name: they need a valid click first. `validateName` unchanged | High |
| D3 | `ADMIN_TOKEN` strength | Document "use a long token" | Refuse a short token at runtime | `< 32` chars (after no trimming) = 503 with the existing unavailable body and a label-only log; `MIN_SECRET_LENGTH` is exported from `link.ts` and shared, never copied | Same threshold as `LINK_SECRET`; a weak secret then fails closed instead of authenticating | High |
| D4 | 48 h TTL "exported once" | Keep three literals (`link.ts`, `reserve-flow.ts`, `shows.ts` as `CONFIRMATION_DELAY_HOURS`) | One export owned by the module that signs | `link.ts` exports `LINK_TTL_SECONDS` (was private `DEFAULT_TTL_SECONDS`); `reserve-flow.ts` imports it; `CONFIRMATION_DELAY_HOURS` is deleted from `shows.ts` (0 consumers in `src/` and `api/` after Phase B) | The server alone knows the expiry; the UI reads `linkExpiresAt` | High |
| D5 | Started show on `/reserve` | Document "400 on reserve, 409 on confirm" | Same answer everywhere | `/reserve` returns `409 {code:'closed', error: MSG.SHOW_STARTED}` like confirm and cancel | The UI then has one rule: `code === 'closed'` = this show or the whole service is not bookable. Existing tests that pin the old 400 text are listed in Forced changes | Medium |
| D6 | Client error wording | Duplicate a French string table in the UI | Code decides **behaviour**; the server's `error` text is the **wording**, a three-entry fallback table covers a missing/oversized body | Server text shown as a React text node (max 300 chars), fallback by class: network, 4xx, 5xx | The strings are already pinned by server tests (`MSG`); a second copy drifts (V-DRY-01). Behaviour per code (reset, refetch, switch to closed state) is the part only the UI can decide | Medium |
| D7 | Turnstile integration | Add `react-turnstile` / `@marsidev/react-turnstile` | Hand-written loader + widget (~120 lines), explicit render mode | No new dependency (brief). `src/lib/turnstile.ts` loads `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit` once; `window.turnstile` already present short-circuits the load (also the test seam) | Supply chain stays at one third party (Cloudflare itself). SRI is not possible for that script (Cloudflare forbids pinning); accepted, see STRIDE | High |
| D8 | "Reset after every error" | Imperative `reset()` ref | The parent owns a `captchaEpoch` counter used as the widget `key` | Every error path, plus every success, increments the epoch: remove + re-render of the widget, token state cleared | Tokens are single use (Turnstile contract): reusing one after any server round trip is a guaranteed `captcha` error. A counter cannot be forgotten on one path if all errors flow through one `fail()` function (tested) | High |
| D9 | Flag helper | Read `process.env` in each file | `src/config/features.ts`: `isTicketingEnabled()` and `getTurnstileSiteKey()` as **functions** | Called at render time, never cached in a module constant | CRA's DefinePlugin still inlines `process.env.REACT_APP_*` inside a function; tests can set the env var and render without reloading modules (the probe showed `jest.isolateModules` loads a second React and breaks hooks). `PAGE_META` uses getters for the two gated descriptions so `{...PAGE_META.billetterie}` evaluates them | High |
| D10 | Test runner for `src/` | Fallback to `node:test` pure functions only | Make CRA Jest 27 work | **Make Jest work** (executed, § Safety facts): `moduleNameMapper` for 3 exports-only packages + `setupTests.ts` polyfills (TextEncoder, IntersectionObserver, scroll stubs). `testMatch` override so `src/__tests__/helpers/*` are not collected | Component tests catch the state-mapping bugs the user would see; the fallback would leave the highest-risk code (state machines) untested | High |
| D11 | Missing site key | Fall back to the public always-pass test key | Refuse | Key absent/blank: the form is replaced by "Réservation momentanément indisponible" with the contact mailto; no widget, no network call to Cloudflare, no POST | A silent test-key fallback in production would look healthy while the server rejects every token (or, with the test secret set, accept bots) | High |
| D12 | Closed state | Keep the form and let the server answer 403 | `open === false` replaces the panel; show buttons disabled; `open === null` (not loaded / fetch failed) keeps the form | Server remains authoritative (`403 closed` also routes to the closed state) | `open` is cached 10 s + 30 s stale; a stale `true` is corrected by the 403 | High |
| D13 | POST confirm that fails on the network | Terminal error | Stay on the preview with an error banner and an enabled button | Retry is safe: confirm is idempotent (`alreadyConfirmed:true`, no second mail) | The claim may have succeeded server-side; a terminal error would strand the user | High |
| D14 | `Referrer-Policy` | Add `<meta name="referrer">` now | M5 hand-off (M5 owns `vercel.json`) | Hand-off only. Fact: browsers default to `strict-origin-when-cross-origin`, so a cross-origin request from the confirm page sends the origin without path or query; the token does not leave via Referer by default | Header hardening is M5; no duplicate mechanism | Medium |
| D15 | Privacy notice text | Invent a policy URL / consent wording | Factual notice, no URL, no "you consent" | Text lives in `src/config/billetterieCopy.ts`, retention derived from `RECORD_RETENTION_DAYS`; **owner-review text** (table in § Owner-review text) | The association must confirm wording before launch; the plan does not claim legal sufficiency | Medium |

## API contract deltas consumed by Phase B

Only what changes versus `billetterie-api-contract.md` at `6c5b0ae`:

| Endpoint | Before | After Phase A |
|---|---|---|
| `POST /api/reserve` | `409 not-possible` possible | **never** `not-possible`; errors: 405, 415, 403 origin, 413, 400 fields, **409 `closed` (show started, was 400)**, 403 `closed` (gate), 400 `captcha`, 409 `full` (+`remaining`), 429 `cooldown` (+`retryAfterSeconds`), 429 `budget`, 400 `bad-address`, 503 `email-failed`, 503 `email-slow`, 503 |
| `POST /api/reservation` confirm | unchanged | `409 not-possible` remains the only place the email/domain caps surface |
| Error body | `{error, code?, retryAfterSeconds?}` | `{error, code?, retryAfterSeconds?, remaining?}` (documented; `remaining` was already sent on `full`) |
| `GET /api/reservations` | any non-empty `ADMIN_TOKEN` | 503 when `ADMIN_TOKEN.length < 32` |
| Request mail | greeting `Bonjour {name},` | `Bonjour,` |

## Task Breakdown

Notation: `depends on` lists task ids. Baseline at `6c5b0ae` (executed 2026-10-27 by a delegated probe): `pnpm run typecheck:api` exit 0; `REDIS_TEST_REQUIRED=1 pnpm run test:api` = `tests 495 / suites 53 / pass 495 / fail 0 / skipped 0`. Tests are written red first by x-tester; code by general-purpose. Redis only via `pnpm run test:api:redis` (127.0.0.1:6390, DB 15, container `fifty-min-test-redis`), stopped at the end.

### Phase A: server follow-ups

#### A1: Drop the address-holdings pre-check
depends on: none. Tests first.
- `api/_lib/reserve-flow.ts`: remove the email-cap and domain-cap branch, the `domain` variable, `domainSeatCap` and `MAX_TICKETS_PER_EMAIL` imports. Keep the `full` / `fewLeft` check (public availability wording).
- `api/_lib/redis.ts`: replace `readClaimState` by `readBooked(showId): Promise<number>` (1 `GET show:<id>:booked`, non-numeric or absent = 0). Delete `readClaimState` only if `git grep -n readClaimState -- api src` shows no consumer left.
- Tests (red first): in `reserve-flow.test.ts` an address already holding 4 seats gets `200 {ok, linkExpiresAt}` and exactly 1 mail (was 409); same for a `corp.example` domain at its cap; the response body and status are **identical** for an address holding 0, 3 and 4 seats (the oracle test: three runs, `deepEqual` of bodies modulo `linkExpiresAt`); `full` still answers 409 with `remaining`; confirm still answers `409 not-possible` for both caps (reservation-flow F2 stays green); Redis calls on the reserve success path are exactly 1 `GET` + the quota `EVAL`. `redis-reads.test.ts`: `readBooked` cases (absent, number, garbage string, 1 fetch call, no write) replace the `readClaimState` cases.
- Acceptance: the oracle test fails on the old code and passes on the new; `git grep -nE "not-possible|NOT_POSSIBLE|MAX_TICKETS_PER_EMAIL|domainSeatCap" -- api/_lib/reserve-flow.ts` is empty; `git grep -n readClaimState -- api` is empty or lists only a deliberate remaining consumer; typecheck 0.

#### A2: Greeting without the attacker-chosen name
depends on: none. Tests first (`email.test.ts`).
- `api/_lib/email.ts` `sendConfirmRequest`: text and html start `Bonjour,`; the `name` field of `RequestMailParams` is removed (callers: `reserve-flow.ts` only).
- Tests: a request with name `Évil <script> http://evil.de/x +41 79 000 00 00` yields subject, text and html that contain none of those fragments (assert the captured Resend body does not contain the name at all); recap and cancellation mails still greet by name (unchanged tests green).
- Acceptance: `git grep -n "Bonjour \${" -- api/_lib/email.ts` shows only the recap and cancellation builders; the captured request body of `reserve` contains neither `name` nor the string passed as name.

#### A3: `ADMIN_TOKEN` minimum length and the shared secret constants
depends on: none. Tests first (`admin-export.test.ts` +4).
- `api/_lib/link.ts`: export `MIN_SECRET_LENGTH` and rename the private `DEFAULT_TTL_SECONDS` to exported `LINK_TTL_SECONDS` (value unchanged); `reserve-flow.ts` deletes its own `LINK_TTL_SECONDS` and imports it.
- `api/reservations.ts`: `adminToken.length < MIN_SECRET_LENGTH` -> `console.error('admin export is not configured')` (label only, no length) and 503 `ERR.UNAVAILABLE`, before the Bearer check.
- Tests: token of 31 chars set + correct Bearer -> 503 (never 200); 32 chars + correct Bearer -> 200; 32 chars + wrong -> 403; unset/empty -> 503 unchanged; logs contain no token.
- Acceptance: `git grep -nE "48 \* 3600|DEFAULT_TTL_SECONDS" -- api` lists only `link.ts` (one definition); `link.test.ts` unchanged and green.

#### A4: Duplication, dead code, started-show consistency
depends on: A1. Tests first.
- `api/_lib/reservation-flow.ts:145`: `canonical.slice(canonical.lastIndexOf('@') + 1)` becomes `emailDomain(canonical)` (import from `guard`).
- `api/_lib/guard.ts`: `ReserveFields` gains `show: Show` and `venue: Venue` resolved once in `validateReserveFields` (unknown show or venue = `ERR.UNKNOWN_SHOW`); `reserve-flow.ts` deletes its second lookup and the dead `if (!show || !venue)` branch. `Failure` gains optional `code`; a started show returns `{status: 409, code: 'closed', message: MSG.SHOW_STARTED}` (D5) and `reserve-flow.ts` passes `code` through `error(..., {code})`. `MSG` is imported from `http.ts` (no cycle: `http.ts` imports nothing from `guard.ts`).
- `src/config/shows.ts`: delete `CONFIRMATION_DELAY_HOURS` and its comment. The comment above it ("Unconfirmed reservations are released after this delay") describes the old model.
- Tests: `guard.test.ts` started-show case expects 409 + `code:'closed'` + `MSG.SHOW_STARTED`; `handlers-smoke` / `reserve-flow` boundary tests (`start-1ms` accepted by the guard, `start` refused) keep their instants; `deepEqual` assertions on `validateReserveFields(...).value` gain `show` and `venue` (Forced changes).
- Acceptance: `git grep -nE "CONFIRMATION_DELAY_HOURS|lastIndexOf\('@'\)" -- api src` is empty except `guard.ts` internals (`splitEmail`/`isValidEmail`); `git grep -n "UNKNOWN_SHOW" -- api/_lib/reserve-flow.ts` is empty; typecheck 0.

#### A5: Strengthen the weak tests, synthetic show in the smoke test
depends on: A1-A4 (same files). x-tester only.
- `reserve-flow.test.ts` "still answers the mail error when the refund itself fails" (lines ~450-464): count the intercepted calls and assert that the `DECR`/refund `EVAL` was **actually attempted** exactly once, that the cooldown key is still present or absent as the failing refund implies (assert the real state, not nothing), and that the body/logs contain no address.
- `reservation-flow.test.ts` F7 (~496-510): assert that the intercepted `quota:sent` call happened (counter > 0) and add two tests that prove recap and cancellation **are counted**: after one confirm, `quota:sent:<day>` for `recap` increments by exactly 1 (read through Redis); after one cancel, `cancellation` increments by exactly 1; a second `already-confirmed` confirm increments nothing.
- `handlers-smoke.test.ts`: replace `SHOW_ID = '2027-02-20-monique'` and the `new Date('2027-02-20T19:00:00+01:00')` at line ~90 by `registerTestShow()` / `SYNTH_SHOW_ID` / `SYNTH_START` from `helpers/flow.ts` (register in `before`, unregister in `after`).
- Acceptance: each strengthened test **fails** when its guarded behaviour is mutated (mutants A5-m1 refund call removed, A5-m2 recap quota call removed, A5-m3 cancellation quota call removed: 3/3 killed, restored by targeted Edit); `git grep -nE "2027" -- api/__tests__/handlers-smoke.test.ts api/__tests__/reserve-flow.test.ts api/__tests__/reservation-flow.test.ts` is empty.

#### A6: Contract doc corrections
depends on: A1-A4. Owner x-doc-writer, in place: `documentation/reference/billetterie-api-contract.md` (stays <= 150 lines).
- Add: `413`/`415` for confirm and cancel; "Origin is checked on `POST /api/reserve` only"; `remaining` in the error shape; `/reserve` started show = `409 closed` (D5); `/reserve` never answers `not-possible` (D1) with the reason written in one sentence; omitted `?show=` exports **all** shows; `ADMIN_TOKEN` >= 32 (503 below); the log rule's wording about Redis/Turnstile transport errors ("labels, ids, status, error name/kind; transport error objects of Redis and Turnstile may be logged, never provider bodies"); request mail has no name.
- Acceptance: every bullet above greps in the file; frontmatter `last_updated: 2026-10-27` (no date in filename); no emoji.

**Phase A gate** (before any Phase B code merges): `pnpm run typecheck:api` exit 0; `REDIS_TEST_REQUIRED=1 pnpm run test:api` 0 fail / 0 skipped / total >= 495 (replacement tests offset removed ones; net additions listed per task: A1 >= 6, A2 >= 2, A3 >= 4, A4 >= 3, A5 >= 5); 3 identical runs; commit(s) `fix(api): stop revealing address holdings from the reserve endpoint`, `fix(api): keep user text out of the unsolicited mail and require a 32-char admin token`, `refactor(api): share the link ttl and secret length, drop dead branches`, `test(api): prove refund and recap quota counting, use a synthetic show in smoke tests`, `docs(api): correct the billetterie API contract`.

### Phase B: frontend

#### B1: Make the UI test runner work
depends on: none (runs in parallel with Phase A: disjoint files). Owner x-tester + general-purpose.
- Reproduce first and record: `CI=true pnpm test --watchAll=false` at `6c5b0ae` fails with `Cannot find module 'react-router-dom' from 'src/App.tsx'` (executed, § Safety facts).
- `package.json`: add the `jest` block verified in the probe, plus `"test:ui": "react-scripts test --watchAll=false"`:
```json
"jest": {
  "moduleNameMapper": {
    "^react-router-dom$": "<rootDir>/node_modules/react-router-dom/dist/index.js",
    "^react-router/dom$": "<rootDir>/node_modules/.pnpm/node_modules/react-router/dist/development/dom-export.js",
    "^@vercel/analytics/react$": "<rootDir>/node_modules/@vercel/analytics/dist/react/index.js"
  },
  "testMatch": ["<rootDir>/src/**/__tests__/**/*.test.{ts,tsx}", "<rootDir>/src/**/*.test.{ts,tsx}"]
}
```
  Cause: Jest 27 ignores package `exports`; `react-router-dom`'s `main` (`./dist/main.js`) does not exist, `react-router/dom` and `@vercel/analytics/react` are exports-only.
- `src/setupTests.ts` (append, keep the jest-dom import): `TextEncoder`/`TextDecoder` from `util` onto `global` (react-router needs it under jsdom 16); an `IntersectionObserver` stub (framer-motion `whileInView`); `window.scrollTo` and `Element.prototype.scrollIntoView` as `jest.fn()`.
- `testMatch` is required because CRA's default collects **every** file under `__tests__/`: a helper placed in `src/__tests__/helpers/` would be run as an empty suite. Verify with `pnpm exec react-scripts test --listTests`.
- Acceptance: `CI=true pnpm test` and `pnpm run test:ui` exit 0 with `src/App.test.tsx` passing; `--listTests` lists no file under `helpers/`; `git diff --stat` for B1 touches only `package.json` and `src/setupTests.ts`; `pnpm-lock.yaml` unchanged (no dependency added); `pnpm exec tsc -p tsconfig.json --noEmit --ignoreDeprecations 6.0` exit 0.
- Documented pitfall (probe): `pnpm test -- --watchAll=false` (pnpm 10.12.4) forwards the `--` to react-scripts, which then drops CRA's config and runs `api/__tests__` untransformed. Use `CI=true pnpm test` or `pnpm run test:ui`.

#### B2: Shared helpers (config, API client, Turnstile loader)
depends on: B1, Phase A gate. Tests first (`src/__tests__/*.test.ts`, pure, no React).
- `src/config/features.ts`: `isTicketingEnabled(): boolean` (`process.env.REACT_APP_SHOW_TICKETING === 'true'`, strict: `'TRUE'`, `'1'`, unset = false) and `getTurnstileSiteKey(): string` (trimmed `REACT_APP_TURNSTILE_SITE_KEY` or `''`).
- `src/config/billetterieCopy.ts`: `CONTACT_EMAIL = 'infomelangesdegenres@gmail.com'` (already hard-coded in Footer, ContactSection, SupportSection and the API: de-duplicating those is a follow-up, not M4), `contactMailto(subject?: string): string` (constant address, `encodeURIComponent` subject only), `PRIVACY_NOTICE` (derived retention from `RECORD_RETENTION_DAYS`), `UNAVAILABLE_COPY`, `CLOSED_COPY`, all owner-review text.
- `src/lib/billetterieApi.ts`:
  - `export const NETWORK_ERROR = 'Impossible de contacter le serveur. Merci de réessayer.'` and `GENERIC_ERROR` (**the only** definitions; `git grep -n "Impossible de contacter" -- src` lists one non-test line).
  - `type ApiFailure = { kind: 'network' } | { kind: 'http'; status: number; code?: string; message?: string; retryAfterSeconds?: number; remaining?: number }`.
  - `readApiFailure(res: Response): Promise<ApiFailure>` (JSON parse guarded; non-JSON, array or oversized body gives no code and no message), `failureText(f: ApiFailure): string` (D6: server `error` string if a string of 1-300 chars, else fallback network/4xx/5xx), `isClosed(f)`, `retryMinutes(f)` (`ceil(retryAfterSeconds/60)`, min 1, `undefined` if absent or negative).
  - Typed response guards `parseReserveSuccess(data): { linkExpiresAt: number | null } | null`, `parsePreview(data): Preview | null`, `parseConfirmResult`, `parseCancelResult`: unknown fields ignored, wrong types give `null`, which the UI shows as `GENERIC_ERROR`, never a crash.
- `src/lib/turnstile.ts`: `loadTurnstile(): Promise<TurnstileApi>` (resolves at once if `window.turnstile` exists; otherwise appends one `<script async defer src=".../api.js?render=explicit">` and caches the promise; `onerror` rejects and clears the cache so a retry can load again), `TurnstileApi` type (`render`, `remove`, `reset`).
- Tests (>= 36): features (flag true/false/unset/`'TRUE'`/`'1'`, site key trimmed/blank/unset); `failureText` for every `code` of the contract table with and without a body, oversized body, `<b>x</b>` text kept verbatim as a string; `retryMinutes` (1, 59, 60, 61, 0, negative, NaN, absent); `readApiFailure` on JSON, HTML, empty and array bodies; parse guards on valid/invalid/extra-field payloads including a `pending` status (rejected) and `expiresAt` (ignored); `loadTurnstile` existing-global shortcut, single script tag after two calls, error then retry; `contactMailto` encodes `&`, `#`, newline and keeps the address constant; `NETWORK_ERROR` single definition (grep test via `fs` is NOT used; asserted by Sprint Contract grep instead).
- Acceptance: >= 36 tests green; coverage of the new `src/lib` and `src/config` files by these tests (every exported function called); `git grep -nE "CONFIRMATION_DELAY_HOURS|expiresAt|reservationId" -- src` empty after B4/B5.

#### B3: `TurnstileWidget`
depends on: B2. Tests first (`src/__tests__/TurnstileWidget.test.tsx`, >= 8; fake `window.turnstile` in `src/__tests__/helpers/turnstile.ts`).
- `src/components/sections/TurnstileWidget.tsx` (`export default function TurnstileWidget({ siteKey, onToken, onUnavailable })`): loads the API, renders into a `div` with `sitekey`, `callback` (token), `expired-callback`, `timeout-callback`, `error-callback` (all call `onToken(null)`; error also reports), `theme: 'light'`, `language: 'fr'`; `useEffect` cleanup calls `remove(widgetId)`; load failure calls `onUnavailable()` once. The token is never put in the DOM, URL, storage or console.
- Tests: renders with the site key; token callback propagates; expired/timeout/error clear the token; unmount removes the widget; load rejection reports unavailable; remount (key change) renders a second widget and removes the first (D8).
- Acceptance: >= 8 tests; `git grep -nE "console\.|localStorage|sessionStorage" -- src/components/sections/TurnstileWidget.tsx src/lib/turnstile.ts` empty.

#### B4: `TicketingSection`
depends on: B2, B3. Tests first (`src/__tests__/TicketingSection.test.tsx`, >= 32).
Behaviour (each bullet is a test group):
1. **Flag off** (`isTicketingEnabled()` false): "Bientôt disponible" panel, no `fetch` call at all.
2. **Flag on**: availability fetched once on mount; `{availability, open}` parsed; show buttons labelled from availability; `open === false` -> closed panel replaces form/hint and show buttons are disabled (D12); `open === null` (fetch failed) keeps the form.
3. **No site key**: after selecting a show, "Réservation momentanément indisponible" with the contact mailto; no widget, no submit control, 0 `POST`.
4. **Form**: existing fields kept (name, email, confirm email, quantity clamped to `min(MAX_TICKETS_PER_EMAIL, remaining)`, typo suggestion via `suggestEmail`, honeypot `website` hidden with `tabIndex={-1}`); privacy notice rendered **inside the form above the submit button**, containing the collected fields, purpose, `30 jours` (from `RECORD_RETENTION_DAYS`), the contact address; the submit button is disabled until a Turnstile token exists and while loading; mismatching emails block the submit with no request.
5. **Request body** is exactly `{showId, name, email, quantity, turnstileToken, website}` with `Content-Type: application/json`, `POST /api/reserve`, same-origin (no `mode`/`credentials` override).
6. **Success** (`{ok:true, linkExpiresAt}`): panel "Vérifiez votre boîte mail": names the address, says the places are **not guaranteed until the link is opened**, shows `formatDateTime(linkExpiresAt)` ("avant le ..."), says places are given in order of confirmation, mentions spam folder. Unparseable `linkExpiresAt` -> the deadline sentence is omitted, rest unchanged. No claim that seats are "réservées".
7. **Errors** by `code` (each: message shown, button re-enabled, widget epoch incremented, token cleared, **one** extra `GET /api/availability`): `captcha`, `full` (quantity clamps to `remaining`, 0 left disables the show), `cooldown` (text includes minutes from `retryAfterSeconds`), `budget`, `bad-address`, `email-failed`, `email-slow`, `closed` (switches to the closed panel), 400 field error without code (server text), 500 without body (fallback), 403 origin (fallback 4xx text), invalid JSON, `fetch` rejection (`NETWORK_ERROR`).
8. **One failure path**: every branch above goes through a single `fail(failure)` function (grep-checked), which resets the widget and refetches; a table-driven test enumerates all contract codes and asserts epoch +1 and refetch +1 for each (D8).
9. After a **success** the widget is also reset and availability refetched (the token is spent).
10. `formatDeadline` and the `reservationId`/`expiresAt` fields are gone; `formatDateTime` imported from `src/lib`.
11. XSS: an API error text `<img src=x onerror=alert(1)>` renders as visible text, no element created (`container.querySelector('img')` null).
- Acceptance: >= 32 tests green; `git grep -nE "formatDeadline|expiresAt|reservationId|Impossible de contacter" -- src/components` empty; `git grep -n "dangerouslySetInnerHTML" -- src` empty; no `console.` in the file; design tokens unchanged (only existing Tailwind classes `text-teal-deep`, `bg-purple/10`, `bg-white`, `shadow-card`, `font-display`).

#### B5: `ReservationAction`
depends on: B2. Tests first (`src/__tests__/ReservationAction.test.tsx`, >= 34).
State machine (`kind`): `loading`, `invalid`, `ready` (+ optional `banner`), `submitting`, `full`, `closed`, `already` (confirmed or cancelled before), `done` (confirm: `emailSent`; cancel: `emailSent`), `error` (non-terminal fetch failure of the preview, with a retry button).

| Action | Server answer | Rendered state | Must show | Must NOT show |
|---|---|---|---|---|
| confirm | GET `claimable`, `open:true` | ready | name, quantity, show label, venue, "Il reste N places" (availability), confirm button | `pending`, a deadline |
| confirm | GET `claimable`, `open:false` | closed | "Les réservations ne sont pas ouvertes pour le moment. Vos places ne sont pas réservées." + back link | confirm button |
| confirm | GET `full` | full | availability 0 -> "complet"; else "il ne reste que N place(s)" + "essayez avec moins de places" + link to `/billetterie` + contact mailto (subject `Réservation <id>`) | confirm button |
| confirm | GET `confirmed` | already | "déjà confirmée", reservation number, "vérifiez vos spams ou contactez-nous" | confirm button |
| confirm | GET `closed`, 400, 404 | invalid | one neutral text (expired / used / cancelled / show started are **not** distinguished) + link to `/billetterie` + contact | the cause |
| confirm | POST ok, `emailSent:true`, `alreadyConfirmed:false` | done | "Réservation confirmée", recap mail sent | n° warning |
| confirm | POST ok, `emailSent:false` | done (warning) | "Vos places sont réservées", the **reservation number**, "l'email récapitulatif n'a pas pu être envoyé", contact mailto with the number | "un email vous a été envoyé" |
| confirm | POST ok, `alreadyConfirmed:true` / `emailSent:null` | already | as above | duplicate-mail claim |
| confirm | POST 409 `full` | full | uses `remaining` | |
| confirm | POST 409 `not-possible` | not-possible banner on `ready` replaced by terminal text | server text (neutral) + contact | the cap that was hit |
| confirm | POST 403/409 `closed` | closed | as above | |
| confirm | POST 404/400 | invalid | neutral | |
| confirm | POST 5xx / network | ready + banner (D13) | `failureText`, button enabled | terminal state |
| cancel | GET `confirmed`, `closed:false` | ready | details, "Confirmer l'annulation" | |
| cancel | GET `cancelled` | already | "déjà annulée" | cancel button |
| cancel | GET `confirmed`, `closed:true` | invalid (neutral) | back link | cancel button |
| cancel | POST ok `alreadyCancelled:false`, `emailSent:true/false` | done | "annulée"; `false` adds "l'email de confirmation n'a pas pu être envoyé, l'annulation est bien enregistrée" | |
| cancel | POST ok `alreadyCancelled:true` | already | | second-mail claim |
| either | empty token or id not matching `^[A-F0-9]{8}$` | invalid | neutral | any `fetch` call (0 requests) |
| either | preview fetch rejects | error | `NETWORK_ERROR` + "Réessayer" | |

- Preview requests use `GET /api/reservation?id=&token=` via `URLSearchParams`; the POST body is `{action, id, token}`. The token is never rendered, logged, or copied into any link or `mailto`.
- `status: 'pending'` and `expiresAt` appear nowhere (grep gate); an unknown `status` from the server is treated as `invalid`, not as ready.
- Tests: every row of the table; double-click on confirm sends one POST (button disabled while submitting); retry after a network failure sends a second POST and ends in `done`; name `<script>x</script>` is text; `mailto` href starts with `mailto:infomelangesdegenres@gmail.com?subject=` and the subject contains only the validated 8-hex id; reservation id from the URL that fails the regex never reaches `mailto`.
- `BilletteriePage.tsx`: render `ReservationAction` whenever `confirmer` or `annuler` is present (token defaults to `''`, which the component turns into the neutral invalid state with 0 requests) instead of silently showing the booking form for a half-link. Test in `BilletteriePage.test.tsx` (>= 4): `?confirmer=ABCD1234` without token -> invalid; with token -> confirm; `?annuler=...&token=...` -> cancel; none -> form.
- Acceptance: >= 34 + 4 tests green; `git grep -nE "pending|expiresAt|CONFIRMATION_DELAY_HOURS" -- src` empty; `git grep -n "NETWORK_ERROR" -- src` lists the one definition and imports only.

#### B6: Flag-gated copy
depends on: B2. Tests first (`src/__tests__/featureFlagCopy.test.tsx`, >= 14).
- `src/config/seo.ts`: `PAGE_META.billetterie.description` and `PAGE_META.agenda.description` become getters (D9). Off: billetterie "La billetterie de « 15 minutes », la comédie musicale originale de Mélange de Genres, ouvrira prochainement."; agenda "Retrouvez les rendez-vous de l'association Mélange de Genres autour de « 15 minutes »." On: the current strings unchanged. (Owner-review text.)
- `TeasersSection.tsx`: the Billetterie teaser description is `isTicketingEnabled()` ? current : "La billetterie ouvrira prochainement." Build the array through an exported pure function `buildTeasers(ticketingEnabled: boolean)` called in render. Link target unchanged (the page itself shows "Bientôt disponible").
- `StructuredData.tsx`: `TheaterEventLD` builds the event through a pure `theaterEvent(ticketingEnabled: boolean)`; `offers` (with `availability: PreOrder`) is present only when enabled. Other fields unchanged.
- Navbar unchanged (asserted by `git diff`).
- Tests: flag unset/`'false'`/`'true'` x each of the four surfaces; the off output contains none of `Réservez`, `réservez`, `Réservations`, `PreOrder`, `Offer`; on output equals today's strings exactly (regression pin); `{...PAGE_META.billetterie}` spread evaluates the getter at call time (env change between two spreads changes the result).
- Acceptance: >= 14 tests; with the flag **unset**, `grep -rEl "Réservez|réservez votre place|PreOrder" build/` over the built output is empty for the page chunks and the prerendered HTML is unaffected by M4 (react-snap not run in this check, see Blast Radius); `git diff --stat` shows no change in `src/components/layout/`.

#### B7: Email-typo helper tests
depends on: B1. `src/__tests__/emailTypos.test.ts` (>= 10, x-tester, no production change): `gmial.com` -> `gmail.com`, `hotmail.con` -> `hotmail.com`, local part and case preserved (`Jean.D@GMIAL.COM`), exact common domain -> `null`, domain shorter than 4 chars -> `null`, no `@` or `@` first -> `null`, distance 3 -> `null`, tie resolved deterministically (first best candidate), whitespace trimmed in the domain, `+tag` kept.

#### B8: UI documentation
depends on: B4, B5. Owner x-doc-writer. Search first (`documentation/runbooks/api-tests.md` covers `api/`; UI tests are another concern, so create `documentation/runbooks/ui-tests.md`, <= 100 lines, frontmatter per governance): how to run (`CI=true pnpm test`, `pnpm run test:ui`, the `--` pitfall), why the `jest` block exists and the one-line fix if the hoisted react-router path moves (`pnpm add react-router@<installed version>` then map to `node_modules/react-router/...`), the `testMatch`/`helpers` rule, the fake Turnstile helper, the one-env-per-render rule (`isolateModules` breaks hooks), build checks, the local dev keys (site key `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`; failing pair `2x00000000000000000000AB` / `2x0000000000000000000000000000000AA`). Update `documentation/reference/billetterie-api-contract.md` with the UI mapping table (code -> behaviour) in place (file stays <= 150 lines; if it would exceed, put the mapping in `ui-tests.md`). No `documentation/INDEX.md` exists: do not create it. Acceptance: every command in the runbook is executed in B10.

#### B9: Build, type and regression checks
depends on: B4-B7. Owner x-tester.
- `REACT_APP_SHOW_TICKETING=true REACT_APP_TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm exec react-scripts build` exit 0, no ESLint warnings; `env -u REACT_APP_SHOW_TICKETING pnpm exec react-scripts build` exit 0, no warnings (note `.env` sets `REACT_APP_SHOW_TICKETING=false`, so "unset" in the shell still reads `false`; both are the off state).
- Off build: the TicketingSection chunk contains the "ouvrira" text and not `api/availability`; on build: the opposite (probe-proven on the current code; re-prove on the new code). The Turnstile script URL appears in the on build only.
- `pnpm exec tsc -p tsconfig.json --noEmit --ignoreDeprecations 6.0` exit 0 (the repo's own `tsconfig.json` fails at HEAD with TS5107 on `target=ES5`/`moduleResolution=node10`, unrelated to M4; not touched). `pnpm run typecheck:api` exit 0.
- `REDIS_TEST_REQUIRED=1 pnpm run test:api` still green (Phase A numbers).

#### B10: Final verification and enforcement summary
depends on: B8, B9. Owner x-tester, 5-step gate with quoted output: all commands of the Sprint Contract; Redis container up on 6390 and **stopped** at the end (`docker ps --filter name=fifty-min-test-redis` empty); `git diff --stat 6c5b0ae..HEAD` equals Critical Files; no attribution lines.

### Forced changes to existing tests (each listed; anything else is Stop Condition 3)

| Test | Change | Why |
|---|---|---|
| `reserve-flow.test.ts` pre-check cases (email cap via `+tag`/`googlemail`, domain cap, "byte-identical bodies", "precheck refusals leave no cooldown" for the cap cases) | Rewritten to the new behaviour: `200` + 1 mail + cooldown set; `full` cases keep their assertions | D1 |
| `reserve-flow.test.ts` / `guard.test.ts` started-show case | Expect `409 {code:'closed', error: MSG.SHOW_STARTED}` instead of `400` + old text | D5 |
| `guard.test.ts` `validateReserveFields(...).value` `deepEqual` | gains `show`, `venue` | A4 |
| `redis-reads.test.ts` `readClaimState` cases | replaced by `readBooked` cases | A1 |
| `email.test.ts` request-mail cases that assert `Bonjour <name>` | now assert `Bonjour,` and absence of the name | D2 |
| `handlers-smoke.test.ts` | real show -> synthetic show | A5 |
| `src/App.test.tsx` | none (must pass unmodified once B1 lands) | pin |

## Critical Files

| File | Change | Task | Exists |
|---|---|---|---|
| `api/_lib/reserve-flow.ts` | Modify (drop pre-check, dead branch, local TTL; pass `code`) | A1, A3, A4 | yes |
| `api/_lib/redis.ts` | Modify (`readClaimState` -> `readBooked`) | A1 | yes |
| `api/_lib/email.ts` | Modify (`Bonjour,`, drop `name` param) | A2 | yes |
| `api/_lib/link.ts` | Modify (export `MIN_SECRET_LENGTH`, rename/export `LINK_TTL_SECONDS`) | A3 | yes |
| `api/reservations.ts` | Modify (length check) | A3 | yes |
| `api/_lib/guard.ts` | Modify (`show`/`venue` in `ReserveFields`, `code` on failure, 409 closed) | A4 | yes |
| `api/_lib/reservation-flow.ts` | Modify (`emailDomain`) | A4 | yes |
| `src/config/shows.ts` | Modify (delete `CONFIRMATION_DELAY_HOURS`) | A4 | yes |
| `api/__tests__/{reserve-flow,reservation-flow,guard,email,redis-reads,admin-export,handlers-smoke}.test.ts` | Modify per Forced changes and A1-A5 | A1-A5 | yes |
| `documentation/reference/billetterie-api-contract.md` | Modify in place | A6, B8 | yes |
| `package.json` | Modify (`jest` block, `test:ui` script) | B1 | yes |
| `src/setupTests.ts` | Modify (polyfills, stubs) | B1 | yes |
| `src/config/features.ts`, `src/config/billetterieCopy.ts` | New | B2 | no |
| `src/lib/billetterieApi.ts`, `src/lib/turnstile.ts` | New | B2 | no |
| `src/components/sections/TurnstileWidget.tsx` | New | B3 | no |
| `src/components/sections/TicketingSection.tsx` | Rewrite (form states, notice, Turnstile, `fail()`) | B4 | yes |
| `src/components/sections/ReservationAction.tsx` | Rewrite (state machine) | B5 | yes |
| `src/pages/BilletteriePage.tsx` | Modify (half-link routing) | B5 | yes |
| `src/config/seo.ts`, `src/components/sections/TeasersSection.tsx`, `src/components/seo/StructuredData.tsx` | Modify (flag-gated copy) | B6 | yes |
| `src/__tests__/{billetterieApi,features,turnstileLoader,TurnstileWidget,TicketingSection,ReservationAction,BilletteriePage,featureFlagCopy,emailTypos}.test.ts(x)`, `src/__tests__/helpers/turnstile.ts` | New | B2-B7 | no |
| `documentation/runbooks/ui-tests.md` | New | B8 | no |
| `src/lib/formatDateTime.ts`, `src/lib/emailTypos.ts`, `src/lib/utils.ts`, `src/components/layout/**`, `src/components/ui/**`, `src/App.tsx`, `src/App.test.tsx`, `tailwind.config.js`, `vercel.json`, `tsconfig.json`, `api/tsconfig.json`, `scripts/test-api.mjs`, `.env`, `pnpm-lock.yaml` | Read-only (must stay unchanged) | - | yes |

## Codebase Conventions

| Touchpoint | Convention to follow | Source | Required by |
|---|---|---|---|
| Components | functional, `export default function Name()`, `.tsx`; helpers `.ts`; relative imports only (no `@/`) | `CLAUDE.md`, `ARCHITECTURE.md` Active Constraints | V-INT-03 |
| UI primitives | reuse `src/components/ui/button` (`variant="dark"`, `size="lg"`, `rounded-full`), `cn()` from `src/lib/utils`; no new shadcn component needed | `TicketingSection.tsx:3,6` | V-INT-02, V-DRY-01 |
| Design tokens | teal `#7BB7AA`, purple `#B8A0BB`, bg `#FAF8F6`; Tailwind classes already used (`text-teal-deep`, `bg-purple/10`, `border-black/6`, `shadow-card`, `font-display`); Playfair/Inter via fonts already loaded. No new colour or font. `DESIGN.md` absent | `tailwind.config.js`, `CLAUDE.md` | V-UX, V-ADA-03/04 |
| Animation | Framer Motion `motion.div` + `AnimatePresence mode="wait"` as in the current panel | `TicketingSection.tsx:300` | V-PAT-05 |
| Date display | `src/lib/formatDateTime.ts` only (`fr-CH`, `Europe/Zurich`) | M3 D19 | V-DRY-01 |
| Shared config | `src/config/shows.ts` is shared with `api/`: keep it free of React/browser imports | `shows.ts:1-2` | V-ARCH |
| API client | one module owns paths, shapes, `NETWORK_ERROR`; components never parse raw JSON | new `billetterieApi.ts`, replaces 2 literals | V-DRY-01 |
| Errors in UI | server `error` text shown as a React text node; never `dangerouslySetInnerHTML` | D6 | V-SEC |
| Tests (UI) | `src/__tests__/*.test.ts(x)`, helpers in `src/__tests__/helpers/`, `@testing-library/react` + `user-event` v13 (installed), no new dependency; one `process.env` value per render, no `jest.isolateModules` | B1 | V-TEST-01..03 |
| Tests (API) | `api/__tests__/`, `node:test`, `import './helpers/redis-env'` first, `registerTestShow`, synthetic far-future time | M3 conventions | V-TEST |
| Project rules | pnpm only, TypeScript strict (no `any`), no TODO comments, no `package-lock.json`, commits `{type}({scope}): {description}` with no `Co-Authored-By` / AI attribution | `CLAUDE.md`, user rules | V-GIT |

## Owner-review text

All user-facing French below is a proposal. The association must confirm the wording before launch; the plan invents no policy URL and makes no legal claim. Source file: `src/config/billetterieCopy.ts` (notice and states) and `src/config/seo.ts` (meta).

| Where | Proposed text |
|---|---|
| Privacy notice (form) | "Vos données. Nous collectons votre nom, votre adresse email et le nombre de places demandées, uniquement pour gérer votre réservation et vous écrire à son sujet (confirmation, récapitulatif, annulation). Elles sont conservées jusqu'à 30 jours après la représentation, puis effacées. Le service d'envoi d'emails (Resend) et la vérification anti-robot (Cloudflare Turnstile) traitent techniquement ces échanges. Pour accéder à vos données ou demander leur effacement : infomelangesdegenres@gmail.com." (the "30" is `RECORD_RETENTION_DAYS`) |
| Success | "Vérifiez votre boîte mail. Un email vient d'être envoyé à {email}. Vos places ne sont pas garanties tant que vous n'avez pas ouvert le lien qu'il contient : confirmez avant le {date}. Les places sont attribuées dans l'ordre des confirmations. Pensez à vérifier vos spams." |
| Unavailable (no site key / script blocked) | "Réservation momentanément indisponible. Merci de réessayer plus tard ou de nous écrire à {CONTACT_EMAIL}." |
| Closed | "Les réservations ne sont pas ouvertes pour le moment." |
| Neutral invalid link | "Ce lien n'est plus valable : il a expiré, a déjà été utilisé ou la représentation n'est plus ouverte à la réservation. Vous pouvez faire une nouvelle demande sur la billetterie ou nous écrire." |
| Full (confirm page) | "Complet : il ne reste que {n} place(s). Cette demande de {q} places ne peut plus être acceptée. Essayez avec moins de places." / "Cette représentation est complète." |
| Confirmed, recap mail failed | "Vos places sont réservées (réservation n° {id}), mais l'email récapitulatif n'a pas pu vous être envoyé. Conservez ce numéro ou écrivez-nous : {mailto}." |
| Off-state meta (billetterie / agenda) | see B6 |

## Threat Model / STRIDE (new client-side surface)

| Threat | Category | Severity | Mitigation | Test |
|---|---|---|---|---|
| Turnstile token replay, or token kept after an error and sent again | Spoofing | MEDIUM | Single-use tokens: epoch remount after **every** reserve round trip (D8); token only in React state, never in URL, storage, DOM attribute or console; server verifier already rejects spent tokens | B4 table-driven error test, B3 grep |
| Third-party script compromise (`challenges.cloudflare.com/turnstile/v0/api.js`) runs in the site origin | Tampering / EoP | MEDIUM | Official Cloudflare URL only, no other third-party script added; SRI impossible (Cloudflare serves a rolling script and forbids pinning); residual accepted; M5: add a CSP with `script-src` / `frame-src` limited to `challenges.cloudflare.com` | B9 grep of the built bundle for the URL; M5 hand-off |
| XSS through API strings (server `error`, `name` from the signed link, `showId`) | Tampering | HIGH | Only React text nodes; no `dangerouslySetInnerHTML`; error text length-capped (300); show/venue labels come from the shared static config, never from the server | B4 item 11, B5 name test, Sprint Contract grep |
| Open redirect / link injection | Spoofing | MEDIUM | No client redirect from query data; internal navigation via constant `<Link to="/billetterie">`; `mailto:` built from a constant address plus an encoded subject whose only dynamic part is an id matching `^[A-F0-9]{8}$`; the token is never put in a link | B5 mailto tests |
| Token (name, email, quantity in the URL) leaks | Information Disclosure | MEDIUM | Not logged or rendered; default `strict-origin-when-cross-origin` already strips path/query on cross-origin requests (D14); `Referrer-Policy: no-referrer` header is an M5 item; link valid 48 h; neutral wording for all failures so the page does not confirm which links exist | B5 invalid-state tests; grep `console.` |
| Holdings oracle (probing an address) | Information Disclosure | MEDIUM | D1: the reserve answer no longer depends on holdings | A1 oracle test |
| Phishing from the association's domain via attacker-chosen text | Spoofing | HIGH | D2: no user text in the unsolicited mail | A2 test |
| Weak admin token accepted | Spoofing | MEDIUM | D3: 503 below 32 chars | A3 tests |
| Bot submits without the widget (missing site key in production) | Elevation of Privilege | HIGH | D11: no key = no form and no POST; the server fails closed independently (`captcha`/503) | B4 group 3 |
| Honeypot dropped by a refactor | Tampering | LOW | Field kept, hidden, `tabIndex -1`, included in the body; asserted | B4 item 5 |
| DoS of the user (error loop re-fetching availability) | Denial of Service | LOW | Exactly one refetch per failure, none on render; availability is CDN-cached 10 s; no polling | B4 counter test |
| Repudiation | Repudiation | LOW | Not applicable to this surface (server stores `confirmedAt`/`cancelledAt`) | - |

## Performance Budget

| Metric | Target | Check |
|---|---|---|
| Added JS to the main bundle | 0 kB: Turnstile is a remote script loaded only in the ticketing chunk; new modules are small (< 4 kB gzipped total) | compare `main.*.js` size of the probe build (134 kB) with the M4 build: delta <= 2 kB; ticketing chunk (8.62 kB at base) <= 14 kB |
| Requests on `/billetterie` (flag on) | 1 `GET /api/availability` on mount, +1 per error, 0 polling; Cloudflare script loaded only after a show is selected | B4 counters; browser flow F2 network tab |
| Flag off | 0 requests to `/api/*` and to Cloudflare from the ticketing page | B4 group 1; build grep |
| Redis (Phase A) | `/reserve` success: 1 `GET` + quota `EVAL` (was `EVAL` of 3 reads + quota); confirm and cancel unchanged | A1 call-count test |

## Dependency Blast-Radius

| Changed file | Downstream consumers | Radius |
|---|---|---|
| `api/_lib/guard.ts` (`ReserveFields.show/venue`, `Failure.code`) | `reserve-flow.ts`, `guard.test.ts`, `handlers-smoke` | LOW, compile-checked |
| `api/_lib/link.ts` (2 exports) | `reserve-flow.ts`, `reservations.ts`, `link.test.ts` (unchanged) | LOW |
| `api/_lib/redis.ts` (`readClaimState` -> `readBooked`) | `reserve-flow.ts`, `redis-reads.test.ts` | LOW |
| `api/_lib/email.ts` (`RequestMailParams.name` removed) | 1 caller | LOW |
| `src/config/shows.ts` | 7 importers; only a deleted constant that has 0 readers | LOW |
| `TicketingSection.tsx`, `ReservationAction.tsx` | `BilletteriePage.tsx` only (lazy route); prerender via react-snap | MEDIUM (user-facing, fully tested) |
| `seo.ts` getters | every page spreads `PAGE_META.*`; only two keys became getters | LOW |
| `StructuredData.tsx` | `BilletteriePage` (`TheaterEventLD`); `EventLD`, `BreadcrumbLD`, `OrganizationLD` untouched | LOW |
| `package.json` `jest` key | only `react-scripts test`; `build` and `start` ignore it | LOW |

**Overall**: MEDIUM, bounded by the single final deploy.

## Blast Radius

| Surface | Outside the diff | How it keeps working |
|---|---|---|
| Callers/consumers | `readClaimState` (1 caller), `ReserveFields` (1 consumer), `CONFIRMATION_DELAY_HOURS` (0 readers), `RequestMailParams.name` (1 caller) | `pnpm run typecheck:api` and the root typecheck are the gate; `git grep` lines in the Sprint Contract |
| Prerender | `postbuild` runs `react-snap || true` over `/billetterie`: with the flag on, the prerendered page contains the ticketing section | The probe invoked `react-scripts build` directly and did **not** run react-snap; B9 runs `pnpm run build` once locally only if Chrome is available (`postbuild:local`), otherwise records it as unverified and puts it on the M5 checklist |
| Env | New build-time `REACT_APP_TURNSTILE_SITE_KEY` (public value); `.env` (untracked, gitignored) holds `REACT_APP_SHOW_TICKETING=false`; build-time flag vs runtime `RESERVATIONS_OPEN` are two different switches | M5 env matrix; the missing key state is user-visible, not silent (D11) |
| Data | none (Phase A removes a read-only Redis call) | A1 call-count test |
| Operators | `ADMIN_TOKEN` shorter than 32 chars stops working (503) | contract doc (A6), M5 launch checklist |
| Third parties | `challenges.cloudflare.com` script + iframe; no CSP exists today so nothing blocks them; M5 must allow them if it adds a CSP | M5 hand-off |

**Safety facts** (executed 2026-10-27 at `6c5b0ae` by a delegated probe; experiments only in a copy under the scratchpad with the real `node_modules` symlinked; real repo `git status --short` identical before and after: only the pre-existing `.claude/initiatives/*.json` change; throwaway Redis 7 on 127.0.0.1:6390, container removed):
- `CI=true pnpm test --watchAll=false` -> `FAIL src/App.test.tsx ... Cannot find module 'react-router-dom' from 'src/App.tsx'` (`Test Suites: 1 failed`). Cause: `react-router-dom@7.14.2` `main` is `./dist/main.js`, which does not exist; Jest 27.5.1 ignores `exports`.
- The literal `CI=true pnpm test -- --watchAll=false` additionally breaks CRA's config injection (pnpm 10.12.4 forwards `--`), so Jest runs `api/__tests__/*` untransformed and reports `SyntaxError` in ~25 suites.
- With the 3-entry `moduleNameMapper` and the `setupTests.ts` additions of B1, in the copy: `Test Suites: 2 passed, 2 total, Tests: 4 passed` (App.test plus a probe rendering a `MemoryRouter` + `Link`, `ReservationAction` with a stubbed `fetch`, and `TicketingSection` with the flag set), 1.1 s. Removing the TextEncoder polyfill makes both suites fail (`TextEncoder is not defined`); without the IntersectionObserver stub `TicketingSection` cannot render. `jest.isolateModules` produced `Invalid hook call` (two React copies): tests must not use it.
- `REACT_APP_SHOW_TICKETING=true pnpm exec react-scripts build` and `env -u REACT_APP_SHOW_TICKETING pnpm exec react-scripts build`: both exit 0, `Compiled successfully.`, no ESLint warnings; `main` chunk 134 kB; TicketingSection chunk 8.62 kB; the on build contains `api/availability`, the off build contains the "ouvrira" teaser text: the flag is compiled in with dead-code elimination.
- Root `pnpm exec tsc -p tsconfig.json --noEmit` already **fails at HEAD** (exit 2) with `TS5107` on `target=ES5` and `moduleResolution=node10` (TypeScript 6); `--ignoreDeprecations 6.0` makes it exit 0 including a Jest test file. `pnpm run typecheck:api` exit 0.
- `REDIS_TEST_REQUIRED=1 pnpm run test:api` -> `tests 495 / suites 53 / pass 495 / fail 0 / cancelled 0 / skipped 0`, 4.2 s.

## Edge Cases & Boundary Conditions

| Boundary | Scenario | Acceptance |
|---|---|---|
| Availability | fetch fails; `open` missing; `availability` has an unknown/NaN value; remaining 0, 1, 4, 5 | B4 groups 2, 7: form kept when unknown; quantity options `min(4, remaining)`; NaN treated as unknown |
| Quantity | selected 4, availability drops to 2 after an error | quantity clamps to 2 (existing effect kept), test |
| Time | `linkExpiresAt` invalid / far past; show start passes while the page is open | deadline sentence omitted; `closed` code -> closed panel |
| Turnstile | script blocked (ad blocker), widget error, token expires after 300 s idle, user submits twice quickly | `onUnavailable` panel + retry; expired callback disables submit; double submit sends 1 request |
| Links | token empty, id lower-case, id 9 chars, cancel token on the confirm page, signed token on the cancel page | invalid state, 0 requests (shape) or server 400 -> neutral invalid |
| Replay | confirm opened twice, cancel then confirm, concurrent tabs | already / invalid states; no duplicate-mail claim |
| Text | names with `<`, `&`, emoji, 100 chars; server text 400 chars; empty `error` | text nodes; cap/fallback |
| Env | flag `'TRUE'`, `' true'`, unset; site key whitespace | strict `'true'` only; key trimmed |
| Network | offline during preview, during POST, JSON error HTML (502 from the platform) | `NETWORK_ERROR`, retry buttons, fallback texts |
| Viewport/a11y | 360 px width; keyboard-only; honeypot not tabbable; error banner announced | `role="alert"` on error banners, labels kept, `aria-invalid` kept; browser flow F13 |

## Browser verification flows (for the orchestrator, against a local harness serving the M4 build and the API with Redis on 6390/DB 15 and a Resend stub that records mails)

Setup: build A = `REACT_APP_SHOW_TICKETING=true REACT_APP_TURNSTILE_SITE_KEY=1x00000000000000000000AA`; build B = flag off; build C = flag on, no site key. API env: `RESERVATIONS_OPEN=true`, `TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA`, `LINK_SECRET` >= 32 chars, `ADMIN_TOKEN` >= 32 chars, `PUBLIC_SITE_URL` = the harness origin, a clock that is before 2027-02-20.

| # | Flow (build) | Pass criteria |
|---|---|---|
| F1 | `/` and `/billetterie`, `/agenda` (B) | Teaser says the billetterie "ouvrira prochainement"; `/billetterie` shows "Bientôt disponible"; page source meta description has no "Réservez"; JSON-LD has no `offers`; no request to `/api/*` or Cloudflare |
| F2 | `/billetterie` (A): pick a date | Availability labels appear; one `GET /api/availability`; the form shows the privacy notice (fields, purpose, 30 jours, contact address) above the button; the Turnstile widget renders; submit disabled until the widget passes |
| F3 | F2 then fill name, email, confirm email, 2 places, submit | `POST /api/reserve` body has `turnstileToken` and `website:""`; success panel says places are not guaranteed, shows the deadline in Geneva time, the address; stub outbox holds exactly 1 mail with `Bonjour,` and a confirm link; response has `linkExpiresAt`, no `reservationId` |
| F4 | Type `x@gmial.com`, blur | "Vouliez-vous dire gmail.com ?" suggestion; clicking it fixes both fields; mismatching confirm email shows the error and sends nothing |
| F5 | Submit twice with the same address | 2nd answer is the cooldown text with minutes; widget re-rendered (new token), second `GET /api/availability` in the network tab, button usable |
| F6 | Server env `TURNSTILE_SECRET_KEY` = failing secret `2x0000000000000000000000000000000AA` | "vérification anti-robot" text, widget reset, availability refetched |
| F7 | Resend stub returns 500, then 200 | `email-failed` text, immediate retry succeeds, 1 mail total |
| F8 | `RESERVATIONS_OPEN=false` | Closed panel replaces the form, show buttons disabled; direct POST (curl) returns 403 `closed` |
| F9 | (C) select a show | "Réservation momentanément indisponible" with mailto; network tab shows no `POST /api/reserve` and no Cloudflare request |
| F10 | Open the mailed confirm link (A) | Preview shows name, places, show, venue, "Il reste N places" (no spinner stuck); click Confirm: "Réservation confirmée", recap mail in the outbox with a cancel link; reload the link: "déjà confirmée" and no second mail |
| F11 | Resend stub fails the recap mail | Confirmed page shows the reservation number and the "email non envoyé" warning; seats stay booked |
| F12 | Request 4 places, fill the show to leave 1, open the link | "Complet / il ne reste que 1 place", no confirm button, link to `/billetterie` and a mailto with the reservation number |
| F13 | Open the cancel link, cancel; reopen it; reopen the old confirm link | cancel done + mail; reopening shows "déjà annulée"; the confirm link shows the neutral invalid text |
| F14 | Tamper one character of the token; delete the token; use lower-case id | Neutral invalid text each time; 0 requests for the last two |
| F15 | Move the harness clock to the show start, open a link | Neutral invalid/closed text, no claim |
| F16 | Stop the API (network error) on submit and on preview | `NETWORK_ERROR` text; preview offers "Réessayer"; confirm POST failure keeps the button and a retry succeeds |
| F17 | 360 px viewport and keyboard only | Form and notice readable, no horizontal scroll, honeypot not reachable by Tab, focus order sane |
| F18 | Any flow | Browser console has no errors or warnings from the app; the token never appears in console output or in any request URL except the confirm/cancel link itself |

## Risk Assessment

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Reused or stale Turnstile token after a failure makes every retry fail | HIGH | Single `fail()` path + epoch remount (D8), table-driven test over all contract codes (B4 item 8) |
| R2 | Honest-state gap: a confirm shows "confirmed" while the recap failed, or a network error on POST strands the user | HIGH | Explicit `emailSent:false` row, D13 retry, tests for both |
| R3 | The `jest` block depends on pnpm's hoisted path `node_modules/.pnpm/node_modules/react-router` | MEDIUM | Failure is loud (module not found at resolve time); runbook gives the one-line fix (`pnpm add react-router@<installed>`); B1 re-runs from a clean `pnpm install --frozen-lockfile` equivalent check only if cheap, else documented |
| R4 | Dropping the cap pre-check lets an address at its cap get mails it cannot use | MEDIUM | Cooldown and budget still apply; confirm refuses neutrally; follow-up (c) in D1; owner told in the commit body |
| R5 | `testMatch` override accidentally excludes `src/App.test.tsx` or collects helpers | MEDIUM | `--listTests` check in B1 acceptance; `App.test.tsx` must pass unmodified |
| R6 | Flag-gated getters evaluated once and cached by a bundler/prerender, leaking reservation copy into the off build | MEDIUM | B6 grep of the off build output; test that the getter re-evaluates |
| R7 | Owner never reviews the privacy notice and it ships | MEDIUM | Owner-review table, M5 launch-checklist item, no policy URL invented |
| R8 | Turnstile script blocked or Cloudflare outage hides booking | MEDIUM | `onUnavailable` panel with contact mailto; server unaffected |
| R9 | React 19 / jsdom 16 act warnings or flaky async tests | LOW | `findBy*` and `waitFor`, no timers, fake Turnstile is synchronous; 3 identical runs |
| R10 | Scope widens into design work (new tokens, new shadcn components) or contact-address refactor | MEDIUM | Critical Files list, `git diff --stat` gate, Stop Condition 1 |
| R11 | `react-snap` prerender of the flag-on page not verified in this milestone | LOW | Recorded as unverified; M5 checklist |
| R12 | Phase A test rewrites weaken coverage | MEDIUM | Forced-changes table, mutants A5-m1..m3, oracle test red first |

## Stop Conditions

> On encountering any condition below, halt and report (structured "halted" status in headless mode) rather than improvising.

1. **Scope drift**: making a task pass needs an edit outside the Critical Files table (`vercel.json`, `tsconfig.json`, `api/tsconfig.json`, `scripts/test-api.mjs`, `.env`, `src/components/layout|ui`, Navbar, `DESIGN.md`).
2. **New dependency**: any `pnpm add` or lockfile change. The brief forbids it; use the hoisted-path mapper or halt.
3. **Existing test weakened**: a test outside the Forced-changes table needs editing; halt, do not alter expectations to fit.
4. **Shared Redis**: `REDIS_TEST_URL` resolves to port 6379 or a container other than `fifty-min-test-redis`; never FLUSH anything.
5. **Network in tests**: a test reaches Cloudflare, Resend or Upstash. Fix the injection (fake `window.turnstile`, stubbed `fetch`).
6. **Token or PII in output**: a log line, DOM attribute, URL or console output shows a Turnstile token, a signed token or an address outside the intended text. Halt (V-SEC defect).
7. **Cannot make the UI runner pass without editing `src/App.test.tsx`**: halt; fall back is a stated failure of D10, not a silent switch to pure-function tests.
8. **Deploy or merge** requested before M5 completes.
9. **Docker unavailable**: finish everything that does not need Redis, report Redis-gated results as unverified, do not report the milestone done.

## Agent-Asset Ripple

| Asset | Update | Why |
|---|---|---|
| `documentation/reference/billetterie-api-contract.md` | in place (A6, B8) | contract deltas consumed by the UI |
| `documentation/runbooks/ui-tests.md` | new (B8) | UI test runner, pitfalls, local keys; search-before-write done: `api-tests.md` covers `api/` only |
| `documentation/billetterie.md`, `CLAUDE.md`, `ARCHITECTURE.md`, `documentation/decisions/INDEX.md` | none in M4 | single docs pass in M5 (ADR-002 stays `proposed`) |
| `DESIGN.md` (V-ADA-03/04, MEDIUM) | **not created** (brief). Follow-up: create from the tokens in `tailwind.config.js` after launch; this milestone only reuses existing tokens | UI files change (`*.tsx`) |
| `documentation/reference/product-principles.md` | absent; not a plan-time HIGH, not created | V-ADA-09 note |

## M5 Hand-off (facts M5 must act on)

- `Referrer-Policy: no-referrer` for `/billetterie` in `vercel.json` (M5 owns it); the default policy already strips path and query cross-origin (D14), so this is hardening.
- If M5 adds a CSP: allow `https://challenges.cloudflare.com` for `script-src` and `frame-src`.
- Env matrix: build-time `REACT_APP_SHOW_TICKETING` and `REACT_APP_TURNSTILE_SITE_KEY` (a missing key shows "indisponible"), runtime `RESERVATIONS_OPEN` (redeploy needed), `TURNSTILE_SECRET_KEY`, `ADMIN_TOKEN` >= 32; dev test keys are in `documentation/runbooks/ui-tests.md`.
- Launch checklist: owner review of the privacy notice and other French text (Owner-review text table); decide D1 follow-up (c) only if the association reports confusion; react-snap prerender check of `/billetterie` with the flag on.
- Existing M3 items still open: Vercel WAF rate-limit rule on `/api/*` and budget alerting; `documentation/billetterie.md:18` `?token=` rewrite; runbook clock years; `SITE_URL` `.ch` vs `.vercel.app` disagreement in `ARCHITECTURE.md`.
- De-duplicate the contact address (`Footer`, `ContactSection`, `SupportSection`) onto `CONTACT_EMAIL`; root `tsconfig.json` needs `"ignoreDeprecations": "6.0"` (TS5107) to be typecheckable: both out of M4 scope.

## Sprint Contract

### Machine-verifiable
- [ ] `pnpm run typecheck:api` exit 0, empty output; `pnpm exec tsc -p tsconfig.json --noEmit --ignoreDeprecations 6.0` exit 0.
- [ ] With Redis up: `REDIS_TEST_REQUIRED=1 pnpm run test:api` exit 0, 0 failed, 0 skipped, 0 cancelled, total >= 495, identical on 3 consecutive runs; container stopped at the end.
- [ ] `CI=true pnpm test` and `pnpm run test:ui` exit 0, 0 failed, total >= 120 (App 1 + features/api/turnstile >= 36 + widget >= 8 + TicketingSection >= 32 + ReservationAction >= 34 + BilletteriePage >= 4 + flag copy >= 14 + emailTypos >= 10 = 139 planned, floor 120), identical on 3 runs; `pnpm exec react-scripts test --listTests` lists nothing under `helpers/`.
- [ ] `REACT_APP_SHOW_TICKETING=true REACT_APP_TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm exec react-scripts build` exit 0, `Compiled successfully.`; `env -u REACT_APP_SHOW_TICKETING pnpm exec react-scripts build` exit 0, `Compiled successfully.`; no ESLint warning text in either log.
- [ ] Off build: `grep -rl "api/availability" build/static/js` empty and `grep -rl "challenges.cloudflare.com" build/static/js` empty; on build: both non-empty.
- [ ] `git grep -nE "CONFIRMATION_DELAY_HOURS|expiresAt|reservationId|formatDeadline|'pending'" -- src api ':!api/__tests__'` is empty; `git grep -n "Impossible de contacter" -- src ':!src/__tests__'` lists exactly 1 line.
- [ ] `git grep -nE "dangerouslySetInnerHTML|localStorage|sessionStorage" -- src` empty; `git grep -nE "console\.(log|info|warn|error)" -- src ':!src/__tests__'` empty.
- [ ] `git grep -nE "not-possible|NOT_POSSIBLE|domainSeatCap" -- api/_lib/reserve-flow.ts` empty; `git grep -nE "48 \* 3600" -- api` lists only `link.ts`; `git grep -n "readClaimState" -- api` empty or a justified consumer.
- [ ] `git grep -nE "2027" -- api/__tests__/handlers-smoke.test.ts` empty (synthetic show).
- [ ] Mutants: A5-m1..m3 and (oracle) "re-add the cap pre-check" killed, each by at least 1 named test; tree clean after each restore (targeted Edit only).
- [ ] `git diff 6c5b0ae..HEAD -- pnpm-lock.yaml vercel.json tsconfig.json api/tsconfig.json scripts src/components/layout src/components/ui src/App.tsx src/App.test.tsx .env` is empty; `git diff -U0 6c5b0ae..HEAD | grep -E '^\+.*(TODO|Co-Authored-By)'` empty; `git log 6c5b0ae..HEAD --format=%B | grep -ci "co-authored-by"` prints `0`.
- [ ] `git diff --stat 6c5b0ae..HEAD` lists exactly the Critical Files; `docker ps --filter name=fifty-min-test-redis` empty.

### Human-verifiable
- [ ] The owner reads the Owner-review text table (privacy notice, success, unavailable, closed, invalid, full, recap-failed, off-state meta) and confirms or edits it.
- [ ] The orchestrator completes browser flows F1-F18 against the M4 builds.
- [ ] Visual check at desktop and 360 px: the new panels use the existing colours and fonts.

## Execution Strategy

**Pattern**: Phase A (server, TDD) and B1 (runner) in parallel on disjoint files, then Phase B sequentially with tests first, bounded parallelism (<= 3 agents per phase). Estimate ~9-11 h (A ~3 h, B1 ~1 h, B2-B6 ~5 h, docs/verification ~1.5 h).

| Agent | Task(s) | Model | Delegation Contract |
|-------|---------|-------|---------------------|
| x-tester | tests of A1-A5, B1 verification, B2-B7, B9, B10 | sonnet | **Objective**: write the listed tests red first, run mutants and the final gate. **Output format**: files + per-file pass/fail table with quoted runner output. **Scope**: `api/__tests__/**`, `src/__tests__/**`, `src/setupTests.ts` (B1 only); production code read-only except targeted restored mutations. **Tool guidance**: `node:test` for `api/`, CRA Jest 27 + Testing Library + user-event v13 for `src/`; `CI=true pnpm test`, never `pnpm test -- ...`; Redis only via `pnpm run test:api:redis` on 6390, never 6379; fake `window.turnstile`, stubbed `fetch`; no `jest.isolateModules`. **Stop condition**: every listed test exists and results match the acceptance; container stopped after B10. |
| general-purpose | code of A1-A4, B1 (`package.json` only), B2-B6 | sonnet | **Objective**: implement exactly each task's contract after its red tests exist. **Output format**: changed files + quoted green output + `git diff --stat`. **Scope**: Critical Files rows of the task only; never edit `*.test.*` or `helpers/`. **Tool guidance**: Edit, Bash for `pnpm run typecheck:api`, `CI=true pnpm test`, `pnpm exec react-scripts build`; strict TS, relative imports, `export default function`, existing Tailwind tokens, no TODO comments, no new dependency, no attribution lines. **Stop condition**: task acceptance met, or a Stop Condition is hit. |
| x-doc-writer | A6, B8 | sonnet | **Objective**: correct the contract doc in place and create the UI-tests runbook. **Output format**: the two files within the line limits. **Scope**: those two files only; grep `documentation/` first (search-before-write). **Tool guidance**: copy deltas from this plan; cross-check every command against `package.json`. **Stop condition**: every command cross-checked. |

**Phases**:
- P1: A1 || A2 || A3 (disjoint: `reserve-flow.ts`+`redis.ts` / `email.ts` / `link.ts`+`reservations.ts`) and B1 (`package.json`, `setupTests.ts`). Tests first for each.
- P2: A4 then A5, then A6 (docs) || start B7 (typo tests, no dependency on A). Phase A gate and commits (`fix(api): ...`, `refactor(api): ...`, `test(api): ...`, `docs(api): ...`).
- P3: B2 then B3 (tests first), commit `feat(ui): add api client, flags and turnstile loader`.
- P4: B4 || B5 (disjoint files; both depend on B2/B3), commits `feat(ui): reserve with turnstile, privacy notice and honest states`, `feat(ui): honest confirm and cancel states`.
- P5: B6 || B8 (docs), commits `feat(ui): do not advertise reservations while ticketing is off`, `docs(ui): add the UI test runbook`.
- P6: B9, B10, then hand back to the orchestrator for F1-F18. No attribution lines in any commit.

## Plan Quality Gate (self-check, 8 checks)

- [x] 1 Acceptance criteria: every task A1-A6, B1-B10 carries measurable criteria (commands, counts, greps).
- [x] 2 Critical file existence: every "Modify"/"Read-only" row was read or located this session (`reserve-flow.ts`, `reservation-flow.ts`, `email.ts`, `http.ts`, `guard.ts`, `link.ts` (constants), `reservations.ts`, `deps.ts`, `shows.ts`, `TicketingSection.tsx`, `ReservationAction.tsx`, `TeasersSection.tsx`, `BilletteriePage.tsx`, `StructuredData.tsx`, `seo.ts`, `emailTypos.ts`, `formatDateTime.ts`, `setupTests.ts`, `App.test.tsx`, `package.json`, `vercel.json`, `ARCHITECTURE.md`, the test files at the cited lines); new files are marked "no".
- [x] 3 Dependencies: acyclic (A1,A2,A3,B1 independent; A4 needs A1; A5 needs A1-A4; A6 needs A1-A4; B2 needs B1 and the Phase A gate; B3 needs B2; B4 needs B2,B3; B5,B6 need B2; B7 needs B1; B8 needs B4,B5; B9 needs B4-B7; B10 needs B8,B9).
- [x] 4 Risk concreteness: each mitigation names a test group, mutant, grep or command.
- [x] 5 Success criteria: Sprint Contract machine items are commands or file-state checks; human items are owner review, browser flows and a visual check.
- [x] 6 Boundary conditions: dedicated section plus per-task cases.
- [x] 7 Stop conditions: present (HIGH risks R1, R2).
- [x] 8 Codebase Conventions and Blast Radius: both present; one safety fact set proven by executed commands (the `pnpm test` reproduction, the working Jest config probe, both builds, root typecheck, API suite baseline), consumers and env names listed.
- Sections included for enterprise track: Threat Model, Performance Budget, Dependency Blast-Radius, Blast Radius, Execution Strategy, Sprint Contract, Stop Conditions (HIGH risks present). `ARCHITECTURE.md` exists (V-ADA-01 satisfied). `DESIGN.md` absent (V-ADA-03/04 noted, not created per brief). Owner-ruling ledger `product-principles.md` absent (not a plan-time HIGH, not created). No `[NEEDS CLARIFICATION]` markers emitted: the owner-review text is listed in its own table so `x-implement` is not blocked by it, and must be confirmed before launch (M5 checklist). Open assumptions to verify inside the tasks: the hoisted react-router path (B1/R3), the `testMatch` override (B1/R5), and that `readClaimState` has no consumer besides `reserve-flow.ts` (A1 grep: 28 occurrences across 5 files at planning time).
