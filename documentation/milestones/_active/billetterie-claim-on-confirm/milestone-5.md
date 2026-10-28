---
type: plan
status: current
review_trigger: "on milestone completion"
created: 2026-10-27
last_updated: 2026-10-27
related: [documentation/decisions/ADR-002-billetterie-claim-on-confirm.md, documentation/milestones/_active/billetterie-claim-on-confirm/README.md, documentation/milestones/_active/billetterie-claim-on-confirm/discovery.md, documentation/milestones/_active/billetterie-claim-on-confirm/outcomes.md, documentation/milestones/_active/billetterie-claim-on-confirm/milestone-4.md, documentation/reference/billetterie-api-contract.md, documentation/audits/analysis-billetterie.md]
plan_base_commit: 49c7b24
track: enterprise
mode: milestone-batch
milestone: M5
initiative: billetterie-claim-on-confirm
---

# M5 Plan: Config, docs and pre-launch checklist

Initiative `billetterie-claim-on-confirm`, branch `initiative/billetterie-claim-on-confirm`, base `49c7b24` (M4 checkpoint). Sources: ADR-002, README M5 section, outcome log M1-M4 (every "Constraint hit" line is consumed below), audit `analysis-billetterie.md` (Open verification + launch blockers), `documentation/billetterie.md`, the API contract, the two test runbooks, `CLAUDE.md`, `ARCHITECTURE.md`, `vercel.json`, `package.json`, `api/tsconfig.json`, and the current code under `api/` and `src/`.

## Objective

Make configuration and documentation match the code, fix the last M3/M4 findings that change behaviour, and hand the humans an ordered go-live checklist for everything the loop cannot do (dashboards, DNS, accounts, real keys). M5 is the **last** milestone: after it the branch is deployable in one deploy (README). Nothing is deployed, pushed or merged by the loop.

- **Phase A (code, test first)**: `show-started` error code so a started show no longer closes the form for every show (T1); availability cache without `stale-while-revalidate` (T2); `vercel.json` security headers and frozen-lockfile install (T3); replace the Le Monique `TODO` comment (T4). The flag-off teaser string is **recorded as accepted** (D3), no code.
- **Phase B (docs)**: rewrite `documentation/billetterie.md` (T6), update `CLAUDE.md` and `ARCHITECTURE.md` (T7), index/frontmatter/README/audit hygiene (T8), new `documentation/runbooks/billetterie-launch-checklist.md` (T9), a doc-accuracy gate (T10), and ADR-002 acceptance as the explicit last step (T11).

Out of scope: any new npm dependency, `DESIGN.md` and `product-principles.md` (absent, see Agent-Asset Ripple), `documentation/INDEX.md` (D12), react-snap repair, attendee broadcast / door check-in / admin cancel / waitlist / budget alerting (listed as follow-ups in the checklist), anything in the Vercel/Upstash/Resend/Cloudflare dashboards.

## Decision Record

| # | Decision | Easy path | Hard path | Choice | Rationale | Confidence |
|---|---|---|---|---|---|---|
| D1 | Started-show answer vs the global gate (M4 finding 1) | Distinguish by HTTP status (403 gate / 409 show) in the UI only | A distinct code: `show-started` (409) on `/reserve`, confirm and cancel; `closed` (403) stays the `RESERVATIONS_OPEN` gate only | **Distinct code** | The contract says `code` is additive and the only consumer is our own UI shipped in the same deploy, so nothing external breaks. Relying on status couples UI behaviour to a number two endpoints must keep in sync; a code is explicit and testable. UI rule becomes: `closed` = whole service closed, `show-started` = this show only (disable it, keep others bookable). Confirm/cancel on a started show now render the neutral invalid text instead of the "reservations closed" panel (more honest: reservations are open, the show is not) | High |
| D2 | `/api/availability` cache (M4 finding 2) | Keep `s-maxage=10, stale-while-revalidate=30` and document "wait a minute" | **Drop `stale-while-revalidate`**: `public, s-maxage=10` | **Drop swr** | Executed probe (Chrome 156, § Safety facts): with swr the browser HTTP cache served a body up to 25 s old while revalidating in the background (freshness is 0 because only `s-maxage` is set, so swr alone makes the browser serve stale); without swr every fetch returned the fresh body. The Upstash cost is bounded by `s-maxage`, not by swr: with continuous traffic the origin is hit at most once per 10 s per CDN region (<= 259,200 `MGET`/30 days per region in the absolute worst case of someone requesting the page every 10 s around the clock; real traffic is far lower, S9 measures it) against 500K/month free. Closing delay drops from ~40 s to ~10 s. Raising `s-maxage` to 30 would cut the ceiling threefold but triples the closing delay; not needed at this audience size. Cache-busting query strings bypass the cache entirely: that risk belongs to the WAF rule (checklist), not to swr | Medium (Vercel may rewrite the header seen by browsers; S3 reads the real value) |
| D3 | Flag-off bundle still contains the teaser string (M4 finding 6) | Change `buildTeasers(ticketingEnabled)` to take the description string and fix the call site | **Accept and record** | **Accept** | Executed: the off bundle contains `"F\xe9vrier et mars 2027 — r\xe9servez votre place pour les repr\xe9sentations."` (escaped form) inside `buildTeasers`, because the ternary lives on a runtime parameter of an exported function. Nothing renders it: the API paths, the Turnstile URL and `PreOrder` are all absent from the off bundle (executed), and the rendered teaser, meta and JSON-LD are covered by 14 flag-copy tests. A fix changes the signature of a tested pure function and its tests, and M4 already burned a cycle on cross-chunk helpers (outcome M4 "Diverged"). Not trivially safe, no user or crawler impact: recorded in `billetterie.md` known limits and as a follow-up with the one-line fix | High |
| D4 | CSP: enforcing vs report-only | Enforce now | Ship `Content-Security-Policy-Report-Only`, flip to enforcing as a checklist gate after the Preview smoke with the real Turnstile pair | **Report-only in the commit; flip is checklist step S7** | A wrong CSP silently breaks the only booking widget in some browsers (Safari/Firefox not exercised here) while the app has no `dangerouslySetInnerHTML` and no user HTML, so the marginal protection is modest and the outage risk is the one that matters. Evidence so far (probe 3): the policy below produced zero violations in headless Chrome 156 with the real Turnstile script and Cloudflare's always-pass key, `frame-src` and `script-src` entries are each required, `connect-src` for Cloudflare is not, `style-src 'unsafe-inline'` is required (framer-motion style attributes: 30-35 per prerendered page). Not covered: react-snap output (it failed locally), the interactive challenge, Firefox/Safari, real Vercel serving. Report-only protects nobody by itself: if the flip is not done before go-live the site launches with report-only and the other four headers, recorded as accepted | Medium |
| D5 | Header set | Referrer-Policy only (README) | Referrer-Policy + nosniff + `X-Frame-Options: DENY` + CSP-Report-Only | **All four** on `/(.*)` | `Referrer-Policy: no-referrer` because confirm/cancel URLs carry a signed token with name and email (D14 of M4 noted the default policy already strips path and query cross-origin, so this is hardening). `X-Frame-Options` instead of CSP `frame-ancestors` because `frame-ancestors` is ignored in report-only mode (and logs a console warning). No `Permissions-Policy` (unverified against Turnstile, no gain for this app) | High |
| D6 | `installCommand` | Keep `--no-frozen-lockfile` | Switch to `--frozen-lockfile` only if proven | **Switch** | Executed in a copy: `CI=true pnpm install --frozen-lockfile` exit 0 twice ("Lockfile is up to date", `+1352` packages, 10 s then 650 ms), `pnpm-lock.yaml` and `package.json` byte-identical afterwards. Residual: Vercel picks its own pnpm major from `lockfileVersion: '9.0'` (no `packageManager` field; local is 10.12.4), so S1 confirms on the real builder; rollback is the one-line revert | Medium |
| D7 | Le Monique `TODO` at `src/config/shows.ts:85` | Leave it for the owner | Replace the comment with a neutral note and put the open question on the checklist | **Replace + checklist** | The comment breaks the project's no-TODO rule. Capacity stays 100 (the conservative figure): raising it later is safe, lowering it below the booked count silently overbooks (audit), so the note says exactly that. The decision (100 vs 120) is the owner's, asked in checklist step 0 | High |
| D8 | `api/tsconfig.json` node16 and the Vercel build | Declare it fine because `typecheck:api` passes | State precisely what local evidence does and does not prove; put the rest on the Preview smoke list | **State + smoke tests** (T5) | See § Verification limits. Local evidence: TypeScript 6.0.2 exit 0, 4 top-level handlers, 41 tracked files under `api/`, no `@vercel/node` installed. Vercel's compiler, its handling of `api/tsconfig.json`, and the "underscore and `__tests__` are not functions" rule are Vercel-side and unverifiable here. Note the audit says production answers unknown paths with the SPA shell, so "not a function" is proven by the **Functions list** (exactly 4), not by a 404 | High |
| D9 | `documentation/INDEX.md` | Create it as part of M5 | Do not create | **Do not create** (D12 follow-up) | `mercure-doc-governance.md` says to read INDEX.md "if present" and have `x-docs` upsert rows; it does not oblige a feature milestone to bootstrap a tree-wide index. Creating it properly means indexing the 6 pre-existing plans/brainstorms/ADR-001 too, a separate `x-docs restructure --bootstrap` pass. What the rule does require of this initiative: lifecycle frontmatter (T6, T8) and `documentation/decisions/INDEX.md` (T8/T11, V-ADA-02) | High |
| D10 | Turnstile for previews | Allow `vercel.app` in the production widget's hostnames | A second widget limited to the one stable preview host | **Second widget** | A site key is public; if the production widget accepts `vercel.app`, anyone can solve challenges on their own page with our key and send valid tokens to our API, defeating the captcha. Preview uses its own widget (hostname = the branch preview host) or Cloudflare's test pair; the production widget lists only the production domain(s) | High |
| D11 | Rate-limit rule | Several rules | **One** rule on `/api/*` (Hobby allows 1 rate-limit rule, 3 custom rules) | **One rule, proposed values 60 requests / 60 s / IP, default 429** | One legitimate booking is ~6 API calls; 60/min tolerates shared NATs (school, office) while stopping a cache-busting loop. Values are a proposal: the dashboard's allowed windows and actions are not verifiable here (Preview shows the real options). The rule does **not** stop a distributed solver exhausting the daily budget of 60 (M3 lockout risk): that is covered by the manual daily budget check and the follow-up alerting | Medium |
| D12 | Rollback / "close bookings" | "Set `RESERVATIONS_OPEN=false`, wait a minute" | Env change **plus redeploy** | **Redeploy required** | The contract already states a `RESERVATIONS_OPEN` change needs a redeploy on Vercel (env vars bind at deploy time). So closing = change variable, Redeploy, then ~10 s CDN window (D2). Fastest alternative is the dashboard's Instant Rollback to the previous (pre-launch, ticketing-off) production deployment; Hobby limits are not verifiable here, so the checklist makes the owner rehearse it on Preview before relying on it | Medium |
| D13 | Doc language | All English | `billetterie.md` stays French (existing, operator-facing); runbooks stay English | **As today** | Matches the existing files; user-facing strings are not touched | High |
| D14 | ADR-002 acceptance | Accept at plan time | Accept as the plan's last step, flagged for owner veto | **Last step (T11)** | Acceptance asserts "the design shipped as decided" only after every gate is green; it is reversible by editing one status line | High |

## Verification limits (T5, stated precisely)

| Item | Proven locally (executed) | Cannot be proven locally | Where it is verified |
|---|---|---|---|
| `api/tsconfig.json` node16 | TypeScript 6.0.2 `pnpm run typecheck:api` exit 0; package has no `"type"` field so extensionless relative imports are CommonJS-valid | That Vercel compiles with the same TypeScript version and honours `api/tsconfig.json` (a project-root `tsconfig.json` exists and fails TS5107 at HEAD, root typecheck needs `--ignoreDeprecations 6.0`) | Preview S1 (build log has no TypeScript error) |
| `_lib/` and `__tests__/` not routed | `git ls-files api` = 41 files; 4 top-level handlers (`availability`, `reserve`, `reservation`, `reservations`); `node_modules/@vercel/` holds only `analytics` | Vercel's routing of underscore-prefixed folders and of `*.test.ts` (if routed, 41 functions would break the Hobby 12-function limit and `node:test` files would run as endpoints) | Preview S2: Functions list shows exactly 4; `/api/_lib/guard` and `/api/__tests__/guard.test` are **not a function** (SPA shell or 404 both pass; a JSON/function response fails) |
| Node runtime | Code uses `Response.json`, `AbortSignal.timeout`, `node:crypto`; local Node 24 | The project's Node.js setting on Vercel (no `engines` field) | Checklist 1.4 (Settings > General: Node 20 or newer) + S5 end to end |
| `react-snap` | Fails locally: 4 of 4 runs exit 1 (hidden by `\|\| true`), wrote `/`, `/spectacle`, `/association` only; page error `Unexpected token '<'` (the `/_vercel/insights/script.js` request is answered with HTML by its static server); bundled Chromium 77 also fails (`Unexpected token '?'`) | Whether Vercel's builder prerenders `/billetterie` | Preview S1: look for the react-snap result in the build log and `curl` the raw HTML. Decision rule in the checklist: not prerendered = SEO follow-up, not a launch blocker (the page works client-side) |
| Headers on Vercel | Pin test on `vercel.json`; headless Chrome with the exact policy served statically | That `vercel.json` headers apply to the SPA shell and to function responses, and what `Cache-Control` the browser really receives | Preview S3 |

## Task Breakdown

Baseline at `49c7b24` (outcome log M4, executed by the M4 reviewer): `pnpm run typecheck:api` exit 0; `REDIS_TEST_REQUIRED=1 pnpm run test:api` = 511 tests, 0 fail; `CI=true pnpm run test:ui` = 308 tests, 0 fail. The executor re-runs both first and records the real numbers as the floor. Tests are written red first by x-tester; code by general-purpose. Redis only via `pnpm run test:api:redis` (127.0.0.1:6390, DB 15, container `fifty-min-test-redis`), stopped at the end.

### Phase A: code

#### T1: `show-started` code, other shows stay bookable
depends on: none. Tests first.
- Server: `api/_lib/http.ts` exports `CODE_SHOW_STARTED = 'show-started'` (separate export; `MSG` is pinned by `http.test.ts:78` and stays unchanged). Replace `code: 'closed'` by it at `guard.ts:140`, `reservation-flow.ts:142`, `:165` (`claimAtomic` status `closed`) and `:185` (cancel). The 403 `closed` at `reserve-flow.ts:40` and `reservation-flow.ts:141` is the gate and stays.
- Client: `src/lib/billetterieApi.ts` adds `isShowStarted(f)` (`code === 'show-started'`); `isClosed` is unchanged and now means the global gate only. `ReservationAction.tsx` lines ~94 and ~120: `show-started` returns the neutral invalid state for confirm GET/POST and cancel; `closed` keeps today's handling. `TicketingSection.tsx` `fail()`: `isClosed` calls `onClosed()` (global), `isShowStarted` calls `onShowStarted()`; `TicketingPanel` keeps a `startedIds` set, disables the matching show button (`disabled={soldOut || closed || started}`), shows `STARTED_LABEL` ("Représentation commencée", new owner-review string in `billetterieCopy.ts`) in place of the remaining-seats label, keeps the server message visible in the form, disables that form's submit, and leaves every other show selectable.
- Tests (red first): API: guard started -> `{status:409, code:'show-started'}`; reserve, confirm and cancel on a started show -> 409 `show-started` with `MSG.SHOW_STARTED`; the `claimAtomic` `closed` branch maps to `show-started`; the gate is still 403 `closed` on reserve and confirm; net new >= 4. UI: `isShowStarted` true only for that code and `isClosed` false for it; **after a 409 `show-started` the closed panel is not shown, the other show can be selected and its POST succeeds (second request in the request log), the started show's button is disabled, availability is refetched exactly once, the widget epoch advanced**; 403 `closed` still closes everything; ReservationAction rows for `show-started` on confirm GET, confirm POST, cancel GET, cancel POST -> neutral invalid; net new >= 8.
- Forced changes (each listed; anything else is Stop Condition 3): `guard.test.ts:288`, `reserve-flow.test.ts:230`, `reservation-flow.test.ts:232` and `:618`, `handlers-smoke.test.ts:90` and `:112` (code `'closed'` -> `'show-started'`); `TicketingSection.test.tsx:544` (case "closed 409 (show started)" moves to the new group); `ReservationAction.test.tsx:192`, `:339`, `:486` (409 rows now `show-started`, the 403 rows stay); `billetterieApi.test.ts:97` (the 409/`closed` line becomes an `isShowStarted` case).
- Acceptance: `git grep -nE "code: 'closed'" -- api ':!api/__tests__'` lists exactly the two 403 gate sites; `git grep -n "show-started" -- api src ':!api/__tests__' ':!src/__tests__'` lists `http.ts` (1 definition), `billetterieApi.ts`, and no raw literal elsewhere in production code (consumers import the constant on the server; the client holds its own single literal); typecheck 0; both suites green; mutants T1-m1 (revert `guard.ts:140` to `'closed'`) and T1-m2 (remove `onShowStarted()` call) each killed by a named test, restored by targeted Edit.

#### T2: availability without `stale-while-revalidate`
depends on: none. Test first.
- `api/availability.ts:7` -> `'public, s-maxage=10'`; the comment above it states that staleness is bounded by `s-maxage` and why swr is absent (browser serves stale when only `s-maxage` is set).
- Tests: `availability.test.ts:64` is the one forced change (new exact value); add: header contains neither `stale-while-revalidate` nor `max-age=` and the 503 stays `no-store`.
- Contract doc line 23 and the cache rule in `billetterie.md` follow in T6 (one doc pass).
- Acceptance: `git grep -n "stale-while-revalidate" -- api src` is empty (tests assert absence by `doesNotMatch`, written without the literal pair on one line only if the grep must stay empty: use `assert.doesNotMatch(value, /stale-while/)`); `git grep -n "stale-while-revalidate" -- documentation/reference documentation/billetterie.md documentation/runbooks` is empty (milestone-3.md, the M4 review and the audit are historical and keep it).

#### T3: `vercel.json` headers and install command
depends on: none. Pin test first (`api/__tests__/vercel-config.test.ts`, pure `node:test`, reads `path.join(process.cwd(), 'vercel.json')` because `test:api` runs from the repo root; no Redis).
- `vercel.json` becomes (CSP value is the probe-verified minimal policy, `frame-ancestors` omitted per D5):
```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "installCommand": "CI=true pnpm install --frozen-lockfile",
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Referrer-Policy", "value": "no-referrer" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "Content-Security-Policy-Report-Only", "value": "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self'; frame-src https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'; form-action 'self'" }
      ]
    }
  ]
}
```
- Pin test asserts: valid JSON; `installCommand` contains `--frozen-lockfile` and not `--no-frozen-lockfile`; all four headers present with the exact Referrer-Policy/nosniff/DENY values; the CSP has `script-src` and `frame-src` each containing `https://challenges.cloudflare.com`, `font-src` containing `https://fonts.gstatic.com`, `style-src` containing `https://fonts.googleapis.com`, `object-src 'none'`, no `'unsafe-eval'`, and `script-src` without `'unsafe-inline'`. >= 7 tests. Failure message tells the next editor which launch dependency a removed source breaks.
- Browser re-verification by x-tester (not committed): serve the flag-on build (`REACT_APP_SHOW_TICKETING=true REACT_APP_TURNSTILE_SITE_KEY=1x00000000000000000000AA`) from a throwaway static server with the headers **parsed from `vercel.json`** as `Content-Security-Policy` (enforcing, for the check only) in headless Chrome, open `/billetterie`, pick a show, require: `window.turnstile` loaded, dummy token issued, `securitypolicyviolation` list empty, fonts 200. Same run with `frame-src` removed must show the violation (proves the check can fail).
- Acceptance: pin tests green; `pnpm install --frozen-lockfile` result from the safety facts is re-run in a copy on the final tree (exit 0, lockfile unchanged); browser check output quoted.

#### T4: Le Monique note
depends on: none. Edit `src/config/shows.ts:85`: replace the `TODO` line by `// Le Monique capacity: 100 is the conservative figure (the venue may have 120 seats). Raising it is safe; lowering it below the booked count overbooks. Open question: launch checklist, step 0.`
- Acceptance: `git grep -nE "TODO|FIXME" -- src api scripts ':!src/__tests__' ':!api/__tests__'` is empty; capacities unchanged (`git diff` shows the comment line only); `src/__tests__/TicketingSection.test.tsx:767` (no-TODO test) still green.

### Phase B: documentation (x-doc-writer; search-before-write done: `billetterie.md`, `api-tests.md`, `ui-tests.md`, the contract and the decisions folder already exist and are updated in place; the only new files are the launch checklist and `decisions/INDEX.md`)

#### T6: Rewrite `documentation/billetterie.md` (French)
depends on: T1-T4. Frontmatter: `type: reference`, `status: current`, `review_trigger: "on file change"`, `created: 2026-10-27`, `last_updated: 2026-10-27`, `related: [ADR-002, contract, api-tests.md, ui-tests.md, launch checklist]`. Replaces the old pending-hold text (`confirm` after 48 h hold, `reservations:pending`, `CONFIRMATION_DELAY_HOURS`, `?token=<ADMIN_TOKEN>`). Stays <= 300 lines. Sections:
1. **Fonctionnement**: mermaid or numbered flow (form + Turnstile -> `POST /api/reserve` -> signed link by email, **no seat written** -> click opens a read-only preview -> button POST confirm claims the seats atomically -> recap mail with cancel link -> cancel releases and blocks replay); endpoints in one table linking to `documentation/reference/billetterie-api-contract.md` (codes are **not** duplicated); the two switches (`REACT_APP_SHOW_TICKETING` build-time, `RESERVATIONS_OPEN` runtime) and their difference.
2. **Variables d'environnement**: one table with every variable, kind (build/runtime/system), required, default, effect when missing, then a per-environment matrix (Production / Preview / Development): `KV_REST_API_URL` and `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`; one database per environment), `RESEND_API_KEY`, `RESERVATION_FROM_EMAIL` (default `Mélange de Genres <billetterie@melangedegenres.ch>`), `RESERVATION_REPLY_TO` (default `infomelangesdegenres@gmail.com`), `ADMIN_TOKEN` (>= 32 chars, below that the export answers 503), `LINK_SECRET` (>= 32 chars), `LINK_SECRET_KID` (default `1`), `LINK_SECRET_PREVIOUS`, `LINK_SECRET_PREVIOUS_KID` (default `0`), `TURNSTILE_SECRET_KEY`, `REACT_APP_TURNSTILE_SITE_KEY` (build-time, missing = "indisponible" panel), `REACT_APP_SHOW_TICKETING` (build-time, exactly `true`), `RESERVATIONS_OPEN` (runtime, `true` trimmed case-insensitive, **unset = closed**, change needs a redeploy), `PUBLIC_SITE_URL` (optional; production defaults to `SITE_URL` in `src/config/seo.ts` = `https://melangedegenres.ch`; previews derive from `VERCEL_URL`), system variables read by `api/_lib/site.ts` (`VERCEL_ENV`, `VERCEL_URL`, `VERCEL_BRANCH_URL`, `VERCEL_PROJECT_PRODUCTION_URL`) and what each environment's Origin allow-list and email base URL become. Also the test Turnstile pair pointer to `ui-tests.md`.
3. **Export organisateur**: `curl -H "Authorization: Bearer $ADMIN_TOKEN" "https://<site>/api/reservations?show=<showId>" -o liste.csv` (omitted `show` = all shows); `?token=` is **not read**; columns `date;reservation;statut;nom;email;places;reserve_le`; statuses `confirmée / annulée / inconnu`; spreadsheet formula protection; the token must be >= 32 chars.
4. **Fermer rapidement les réservations**: change `RESERVATIONS_OPEN` to `false`, Redeploy, wait ~10 s (CDN `s-maxage=10`, D2); the UI shows the closed panel, the API answers 403 `closed`, links already mailed keep previewing but cannot confirm; fastest option (Instant Rollback) with the "rehearse first" caveat; reopening is the reverse.
5. **Données personnelles**: what is stored (`reservation:<id>` name and email, the per-email and per-domain counters keyed by address/domain, `quota:cooldown:<address>` for 600 s), retention = `RECORD_RETENTION_DAYS` (30) days after the show start via `EXPIREAT` on every key (no cron), what a cancel keeps (the record as `cancelled` until the same expiry), and the **erasure procedure** for a written request: find the id with the CSV export, then in the Upstash console CLI for that environment's database: read `reservation:<id>`, decrement `show:<showId>:booked`, the `show:<showId>:emails` field (canonical email) and the `show:<showId>:domains` field by the quantity if the status is `confirmed`, `LREM show:<showId>:reservations 0 <id>`, drop the hash fields that reach 0, `DEL reservation:<id>`, then write `tombstone:<id>` so a still-valid confirm link cannot re-claim (copy the exact commands from `releaseAtomic` in `api/_lib/redis.ts`, do not invent them). Mark it as a rare manual operation and name the follow-up "admin cancel / erase action".
6. **Modifier une capacité ou ajouter une date**: edit `src/config/shows.ts` and redeploy; counters live in Redis under the show id, so **never rename a show id** (it is the Redis key); raising capacity is safe, lowering below the booked count overbooks; add a show = one `SHOWS` row, the key set appears on first claim; the Le Monique 100/120 note.
7. **Développement local**: `pnpm start` does not serve `/api`; `vercel dev` (after `vercel link` and `vercel env pull .env.local`) runs the handlers against a real database (use the Preview database, never Production); without Vercel: the test harness (`pnpm run test:api:redis`, `pnpm run test:api`, `pnpm run typecheck:api`, `CI=true pnpm run test:ui`) with links to `api-tests.md` and `ui-tests.md`; Turnstile test keys by pointer.
8. **Limites connues**: flag-off bundle keeps the unrendered teaser string (D3, one-line fix), react-snap does not prerender `/billetterie` locally (see Verification limits), a started show stays listed until its click error (`show-started`), `UTC` day for the send budget, no CI workflow, no alerting, no attendee broadcast.
- Acceptance: the doc-accuracy gate (T10) passes on this file; `git grep -nE "?token=<ADMIN_TOKEN>|CONFIRMATION_DELAY_HOURS|reservations:pending|en attente" -- documentation/billetterie.md` is empty except inside an explicit "n'est plus lu" sentence for `?token=`; <= 300 lines; frontmatter has all five required fields.

#### T6b: Contract and UI-runbook deltas (same agent, same pass)
- `billetterie-api-contract.md`: `show-started` (409) on reserve/confirm/cancel vs `closed` (403) gate; availability `Cache-Control: public, s-maxage=10`; the gate rule line says a change needs a redeploy; stays <= 150 lines; `last_updated: 2026-10-27`.
- `ui-tests.md`: add the `show-started` row to the code table; document the Jest `moduleNameMapper` dependency on pnpm's hoisted path (M4 finding 3: `node_modules/.pnpm/node_modules/react-router/...`) and the re-check on dependency bumps. Fix `api-tests.md` stale text: `readClaimState` -> `readBooked` in the test-file table, "pnpm test currently fails on main" -> points to `ui-tests.md`, and the "clocks in 2030" wording to what the tests really use (`grep` the helpers for `2031`/`2099`/`4102444800` and write what is there).
- Acceptance: each edited statement greps in the code (e.g. `git grep -n "show-started" -- api src`); `git grep -n "readClaimState" -- documentation/runbooks` empty.

#### T7: `CLAUDE.md` and `ARCHITECTURE.md`
depends on: T6. 
- `CLAUDE.md`: Tech Stack adds Serverless API (Vercel functions, `api/`), Upstash Redis (REST, no client dependency), Resend (email, plain `fetch`), Cloudflare Turnstile; Project Structure gains `api/` (`availability.ts`, `reserve.ts`, `reservation.ts`, `reservations.ts`, `_lib/`, `__tests__/`), `src/config/`, `src/lib/`, `src/__tests__/`, `scripts/test-api.mjs`, `vercel.json`; the `sections/` list is regenerated from `ls src/components/sections` (set equality, the current line is stale); Commands adds `pnpm run test:ui`, `pnpm run test:api`, `pnpm run test:api:redis`, `pnpm run typecheck:api` and the note that `pnpm test` is the CRA runner; a short "Billetterie" pointer to `documentation/billetterie.md`; Project Rules adds "no new dependency in `api/`" and "never rename a show id".
- `ARCHITECTURE.md`: fix `SITE_URL` to `https://melangedegenres.ch` (`src/config/seo.ts:3`); Stack adds the API layer; Application Structure adds `api/`, `src/config/` (`shows.ts`, `seo.ts`, `features.ts`, `billetterieCopy.ts`), `src/lib/` (`utils.ts`, `billetterieApi.ts`, `turnstile.ts`, `formatDateTime.ts`, `emailTypos.ts`), `src/__tests__/`; a "Reservation layer" section (claim-on-confirm in 6 lines, modules `guard`, `link`, `quota`, `http`, `redis`, `email`, `turnstile`, `site`, `reserve-flow`, `reservation-flow` with one-line responsibilities taken from their header comments) with the data-flow pointer to ADR-002; Active Constraints adds: API runs as Web-standard handlers on Vercel functions, `api/tsconfig.json` is node16 and is typechecked by `typecheck:api`, `src/config/shows.ts` stays browser- and React-free, show ids are Redis keys. The Key Decisions row for ADR-002 is added in T11, not here.
- Acceptance: every file/dir named exists (`test -e`); `sections/` set equals the directory listing; no sentence contradicts `package.json` scripts (gate T10).

#### T8: Index, frontmatter, README, audit hygiene
depends on: T6, T7.
- `documentation/decisions/INDEX.md` (new, frontmatter `type: reference`): columns `ADR | Title | Status | Date | Supersedes`; **Accepted-only**: row for ADR-001 now (status/date copied from its frontmatter, the same as `ARCHITECTURE.md`: Accepted, 2026-05-08); the ADR-002 row is added by T11.
- Frontmatter audit: `git grep -L "^type:" -- documentation ':!documentation/**/.evidence/**'` is empty (executed at planning time: all 20 existing docs carry `type`/`status`; `billetterie.md` was the only file without frontmatter, fixed by T6). Statuses must be in the allowed vocabulary: the audit `analysis-billetterie.md` has `status: draft` (invalid): set `current` and append a "Resolution" table (6 must-fix rows -> ADR-002 / milestone that closed them, 2 lines each) so a reader does not see open blockers that are closed; the note lists the items still open on the checklist (Resend plan, Upstash scoping, WAF rule).
- Initiative README: status table (M1-M4 `complete`; M5 `in review` until the loop's gate passes, then `complete`), "Current focus" updated, **scaffold-commit hint corrected**: `git rev-list initiative/billetterie-claim-on-confirm ^billeterie | tail -2 | head -1` (the list is newest-first, so the scaffold commit is the second line from the end, right after the `docs(billetterie): add production-readiness audit and ADR-002` commit); the old `sed -n 2p` text and its "second commit" wording are removed. M5 scope paragraph updated to what shipped (security headers, install command, launch checklist).
- Acceptance: executed `git rev-list initiative/billetterie-claim-on-confirm ^billeterie | tail -2 | head -1` prints a SHA whose `git log -1 --format=%s` is the scaffold commit and whose parent's subject is `docs(billetterie): add production-readiness audit and ADR-002` (if the local branch `billeterie` is absent, the executor reports it and verifies with the hash of that docs commit instead); `git grep -n "sed -n 2p" -- documentation` is empty; the audit frontmatter `status:` is `current`.

#### T9: `documentation/runbooks/billetterie-launch-checklist.md` (English)
depends on: T3, T6. Frontmatter `type: runbook`, `status: current`, `review_trigger: "on release"`, dates, `related`. Every step is a tick box with who/where/how long/evidence to capture. Content is specified in § Launch checklist content below (the executor copies it, checks each command and name against the code via T10, and may tighten wording but not drop steps).
- Acceptance: all 9 sections present in order; every step has a box; the effort totals match the table below; every env var/command/path passes the T10 gate; no real key, token or address appears (only Cloudflare's published test keys and `infomelangesdegenres@gmail.com` already in the code); <= 400 lines (doc-tree health ceiling).

#### T10: Doc-accuracy gate and final verification (x-tester)
depends on: T1-T9. 5-step gate with quoted output. The doc-accuracy gate (no committed script; commands run and quoted) over `documentation/billetterie.md`, `documentation/runbooks/billetterie-launch-checklist.md`, `CLAUDE.md`, `ARCHITECTURE.md`, the contract and both test runbooks:
1. every backticked `[A-Z][A-Z0-9_]{3,}` token: `git grep -nw -- NAME -- api src scripts package.json vercel.json` must hit, or the token is in the allow-list of **external** names (Vercel system variables not read by code, product names such as `DMARC`, `SPF`, `DKIM`, `UTC`, `CSV`, `ICS`, `HTTP`, `JSON`, `WAF`, `CDN`, `TTL`) listed in the output;
2. every `pnpm run X` / `pnpm X` command: `X` exists in `package.json` `scripts` (or is a pnpm built-in);
3. every backticked path with a `/` or a file extension: `test -e`; every `/api/...` endpoint: the handler file exists; every `code` named: `git grep -n "'<code>'" -- api/_lib api/*.ts`;
4. every Redis key pattern (`show:<id>:booked`, `:emails`, `:domains`, `:reservations`, `reservation:<id>`, `tombstone:<id>`, `quota:cooldown:`, `quota:sent:`): present in `redis.ts` `keys` or `quota.ts`;
5. every number: 48 h = `LINK_TTL_SECONDS/3600`, 30 days = `RECORD_RETENTION_DAYS`, 600 s = `SEND_COOLDOWN_SECONDS`, 60 = `DAILY_REQUEST_EMAIL_BUDGET`, 4 = `MAX_TICKETS_PER_EMAIL`, 12 = `MAX_TICKETS_PER_DOMAIN`, 32 = `MIN_SECRET_LENGTH`, 10 s = the `s-maxage` literal; each compared with the source line, quoted.
- Erasure procedure test: executed against the throwaway Redis (6390/DB 15): create two confirmed reservations via the flow helpers, run the documented commands for one, assert `booked` equals the other's quantity, the id is absent from the CSV export and the tombstone blocks a replayed confirm. Container stopped afterwards (`docker ps --filter name=fifty-min-test-redis` empty).
- Final gate: all commands of the Sprint Contract; `git diff --stat 49c7b24..HEAD` equals Critical Files; no attribution lines; working tree clean except intended files.

#### T11: ADR-002 acceptance (explicit last step; flag for owner veto)
depends on: T10 green. 
- `ADR-002-...md`: `status: accepted`, `tracking_initiative: billetterie-claim-on-confirm`, `last_updated`; add a short "Acceptance" paragraph and a "Deviations in implementation" list (5 bullets, each grep-verifiable): `show-started` code; `/api/reserve` checks only public availability (no address-holdings pre-check, step 4 of the data flow); the request mail carries no user-chosen text; `/api/availability` has no `stale-while-revalidate`; `ADMIN_TOKEN` minimum 32. [NEEDS CLARIFICATION: the ADR records no reference to the x-design approval gates; the acceptance note must cite the gates at which the owner approved the design, copied from the initiative's session record (not reconstructed), and say in one sentence that the owner may veto by reverting this status line.]
- Add the ADR-002 row to `documentation/decisions/INDEX.md` (Accepted-only rule) and to the Key Decisions table in `ARCHITECTURE.md`; README status M5 -> `complete`.
- Acceptance: `grep -n "^status:" documentation/decisions/ADR-002-*.md` prints `status: accepted`; the INDEX and ARCHITECTURE rows resolve to the file path (`test -e`); commit `docs(decisions): accept ADR-002 and add the decision index`.

## Launch checklist content (T9 source)

Legend: H = hands-on minutes, W = waiting time. Owner = association member with account access; Dev = whoever holds the repo.

| # | Step | Who | H | W |
|---|---|---|---|---|
| 0 | **Decisions**: (a) ADR-002 accepted, veto window; (b) review the French strings flagged in `src/config/billetterieCopy.ts` (privacy notice, `successText`, `INVALID_LINK_COPY`, `UNAVAILABLE_COPY`, `recapFailedText`, `STARTED_LABEL`) and the off/on descriptions in `src/config/seo.ts`; (c) ask Le Monique: 100 or 120 seats (`src/config/shows.ts`); (d) who holds `ADMIN_TOKEN`; (e) Resend plan (below) | Owner | 45 | venue reply: days |
| 1.1 | **Upstash**: create two databases, `fifty-min-prod` and `fifty-min-preview` (same region near Geneva); connect prod to **Production only**, preview to **Preview + Development**; confirm in Vercel > Settings > Environment Variables that no `KV_*` value is shared; Production DB `DBSIZE` = 0; clear the Preview DB (`FLUSHDB` in its console) after the smoke tests | Owner | 20 | - |
| 1.2 | **Resend**: add and verify `melangedegenres.ch` (SPF, DKIM records); add a DMARC TXT (`_dmarc`, start `p=none` with a reporting mailbox, tighten later); pick the plan: free tier is 100 emails/day and 3,000/month; the send budget (`DAILY_REQUEST_EMAIL_BUDGET` = 60 per UTC day) counts request, recap and cancellation mails in one counter but only refuses new **requests**, so a day can exceed 60 by the recap/cancellation tail of earlier requests, and 60 bookings with a recap each is already 120 mails: upgrade for the launch period or accept that heavy days hit the 100 cap; separate API keys for Production and Preview; reply-to `infomelangesdegenres@gmail.com` is the default | Owner | 45 | DNS up to a day: **start first** |
| 1.3 | **Cloudflare Turnstile**: widget "prod" with hostnames = production domain(s) only; widget "preview" with the single stable branch preview host (D10) or use the always-pass test pair in Preview; never add `vercel.app` to the production widget | Owner | 20 | - |
| 1.4 | **Vercel**: env vars per environment from the `billetterie.md` matrix (Production gets prod DB, prod Resend key, prod Turnstile pair, `LINK_SECRET` and `ADMIN_TOKEN` each >= 32 random chars, different per environment; `REACT_APP_SHOW_TICKETING` and `REACT_APP_TURNSTILE_SITE_KEY` as build-time values; `RESERVATIONS_OPEN` unset or `false` until go-live); `PUBLIC_SITE_URL` left unset in Production, unset in Preview; Settings > General: Node.js 20 or newer; confirm the production domain points at the project; **one** WAF rate-limit rule on `/api/*` (proposed 60 requests / 60 s / IP, default 429; the Hobby plan allows 1 rate-limit rule and 3 custom rules) and write down that it cannot stop a distributed captcha-solving run exhausting the 60-per-day budget; keep Deployment Protection on for previews (preview links work only for logged-in team members, so the owner who tests must be a project member) | Dev + Owner | 45 | - |
| 2 | **Preview smoke tests** S1-S14 below, on a Preview deployment of the initiative branch with the flag on | Dev + Owner | 150 | - |
| 3 | **Flip CSP to enforcing** (S7 clean in Chrome and one of Firefox/Safari): rename `Content-Security-Policy-Report-Only` to `Content-Security-Policy` in `vercel.json`, add `; frame-ancestors 'none'`, redeploy Preview, re-run S5 | Dev | 20 | - |
| 4 | **Go-live order**: (1) merge/PR per README (PR against `billeterie`, not `main`, until PR 2 lands); (2) Production env final check; (3) deploy with `RESERVATIONS_OPEN=false`; (4) verify `/api/availability` answers `open:false` and `POST /api/reserve` 403 `closed`; (5) set `RESERVATIONS_OPEN=true`, Redeploy; (6) one real booking with an owned address, confirm, cancel, export; (7) announce | Dev + Owner | 30 | - |
| 5 | **Rollback**: `RESERVATIONS_OPEN=false` + Redeploy, then ~10 s; fastest: Instant Rollback to the previous production deployment (rehearsed on Preview first). Existing confirmed seats stay; mailed links keep previewing but cannot confirm | Dev | 5 | ~10 s + build time |
| 6 | **Monitoring** (manual, no alerting exists): Resend dashboard (daily count, bounces), Upstash console (command usage, `GET quota:sent:<UTC date>` against 60), Vercel logs for `request email error`, `claim error`, `availability error`; check hourly on day 1, then daily | Dev | 4 x 10 day 1, 5/day after | - |
| 7 | **Key rotation** (`LINK_SECRET`): set `LINK_SECRET_PREVIOUS` = current secret and `LINK_SECRET_PREVIOUS_KID` = current kid, set a new `LINK_SECRET` and a new `LINK_SECRET_KID`, Redeploy, keep for >= 48 h (`LINK_TTL_SECONDS`), then remove the PREVIOUS pair. Cancel tokens are per-record and unaffected. `ADMIN_TOKEN`: replace and redeploy, update whoever runs the export | Dev | 15 | 48 h |
| 8 | **Not done by this initiative** (follow-ups): attendee broadcast (the 21 Feb time change is the example); door check-in, manual cancel, walk-ins, admin bulk cancel by domain; waitlist; alerting on the daily budget and on 5xx; `DESIGN.md` and `product-principles.md` companion files; `documentation/INDEX.md` governance (`x-docs restructure --bootstrap`); list started shows as past instead of an error click; react-snap repair; de-duplicate the contact address onto `CONTACT_EMAIL`; flag-off teaser string (one-line fix: pass the description string into `buildTeasers`); root `tsconfig.json` `ignoreDeprecations`; erase action | - | - | - |

**Preview smoke tests** (step 2, each with the evidence to paste into the checklist):
S1 build log: install with `--frozen-lockfile` succeeds, no TypeScript error, react-snap result and whether `curl` of `/billetterie` raw HTML contains the page (not prerendered = follow-up, not a blocker). S2 Functions list = exactly 4; `/api/_lib/guard` and `/api/__tests__/guard.test` are not functions. S3 `curl -sI` on `/billetterie` shows the four headers; on `/api/availability` record the `Cache-Control` the browser receives and `x-vercel-cache`. S4 Origin allow-list: preview Origin reaches the captcha check (400 `captcha`), a foreign Origin gets 403. S5 real booking to an owned mailbox: request mail says `Bonjour,` and links to the **preview** host, confirm, recap with cancel link and `.ics`, cancel, cancellation mail. S6 CSV export: Bearer works, wrong token 403, `?token=` 401, short `ADMIN_TOKEN` 503. S7 CSP report-only: zero violations in the console with the real Turnstile pair (Chrome plus one of Firefox/Safari). S8 gate: `RESERVATIONS_OPEN=false` + Redeploy, time until the page shows the closed panel and `POST` answers 403. S9 Upstash command count before/after 20 page loads and one booking (record per-load and per-booking cost against 500K/month). S10 production-shaped check on the Production URL before go-live: ticketing off. S11 Turnstile: widget renders on the allowed host only. S12 deliverability: Gmail, Outlook, Proton and a Swiss ISP inbox vs spam. S13 360 px layout and `.ics` import. S14 retention: `EXPIRETIME reservation:<id>` equals show start + 30 days; clear the Preview DB afterwards.

**Effort of the human steps** (state in the checklist): hands-on 0: 45 min, 1.1: 20, 1.2: 45, 1.3: 20, 1.4: 45, 2: 150, 3: 20, 4: 30 = **375 min (~6 h 15)**, plus day-1 monitoring ~40 min = ~7 h; waiting: Resend DNS up to 1 day, venue reply days; realistic calendar time **2 working days**, 3 if the Resend verification or the venue answer lags.

## API contract deltas

| Endpoint | Before M5 | After |
|---|---|---|
| `POST /api/reserve`, `POST /api/reservation` confirm and cancel on a started show | 409 `code: closed` | 409 `code: show-started` (same text `MSG.SHOW_STARTED`) |
| `closed` | 403 gate and 409 show start | 403 gate only |
| `GET /api/availability` | `Cache-Control: public, s-maxage=10, stale-while-revalidate=30` | `public, s-maxage=10` |
| Everything else | unchanged | unchanged |

## Critical Files

| File | Change | Task | Exists |
|---|---|---|---|
| `api/_lib/http.ts` | Modify (`CODE_SHOW_STARTED`) | T1 | yes |
| `api/_lib/guard.ts`, `api/_lib/reservation-flow.ts` | Modify (code) | T1 | yes |
| `api/availability.ts` | Modify (header) | T2 | yes |
| `src/lib/billetterieApi.ts`, `src/components/sections/ReservationAction.tsx`, `src/components/sections/TicketingSection.tsx`, `src/config/billetterieCopy.ts` | Modify | T1 | yes |
| `src/config/shows.ts` | Modify (comment line only) | T4 | yes |
| `vercel.json` | Modify | T3 | yes |
| `api/__tests__/{guard,reserve-flow,reservation-flow,handlers-smoke,availability}.test.ts`, `src/__tests__/{TicketingSection,ReservationAction,billetterieApi}.test.tsx/.ts` | Modify per Forced changes | T1, T2 | yes |
| `api/__tests__/vercel-config.test.ts` | New | T3 | no |
| `documentation/billetterie.md` | Rewrite | T6 | yes |
| `documentation/reference/billetterie-api-contract.md`, `documentation/runbooks/{api-tests,ui-tests}.md` | Modify in place | T6b | yes |
| `CLAUDE.md`, `ARCHITECTURE.md` | Modify | T7, T11 | yes |
| `documentation/decisions/INDEX.md` | New | T8, T11 | no |
| `documentation/runbooks/billetterie-launch-checklist.md` | New | T9 | no |
| `documentation/audits/analysis-billetterie.md`, `documentation/milestones/_active/billetterie-claim-on-confirm/README.md` | Modify | T8 | yes |
| `documentation/decisions/ADR-002-billetterie-claim-on-confirm.md` | Modify (status, acceptance, deviations) | T11 | yes |
| `package.json`, `pnpm-lock.yaml`, `api/tsconfig.json`, `tsconfig.json`, `scripts/test-api.mjs`, `.env`, `src/components/layout/**`, `src/components/ui/**`, `src/App.tsx`, `src/components/sections/TeasersSection.tsx`, `documentation/INDEX.md` (must stay absent) | Read-only | - | yes (INDEX: no) |

## Codebase Conventions

| Touchpoint | Convention | Source | Required by |
|---|---|---|---|
| Server error codes | `error(message, status, {code})`; messages in `MSG`/`ERR`; one definition per code constant | `api/_lib/http.ts` | V-DRY-01 |
| Handlers/tests | Web-standard handlers, `node:test`, `import './helpers/redis-env'` first, synthetic far-future show (`registerTestShow`), Redis only on 6390/DB 15 | `api-tests.md` | V-TEST |
| UI | functional `export default function`, relative imports, existing Tailwind tokens, server text as React text node, flag literal `process.env.REACT_APP_SHOW_TICKETING === 'true'` where it gates code | `CLAUDE.md`, `ui-tests.md`, M4 D9 | V-INT-03 |
| UI tests | CRA Jest 27, `src/__tests__/`, helpers in `src/__tests__/helpers/`, `CI=true pnpm run test:ui`, one env value per render, no `jest.isolateModules` | `ui-tests.md` | V-TEST |
| Docs | canonical filename `{topic}.md`, lifecycle frontmatter, search-before-write, update in place, <= 400 lines; ADR status vocabulary `proposed/accepted/...`; `decisions/INDEX.md` Accepted-only | `mercure-doc-governance.md` | V-DOC-GOV-01..04, V-ADA-02 |
| Comments | rationale once at the definition; no issue numbers or history in source comments | `mercure-implementation-rules.md` | V-DOC-05/06 |
| Project rules | pnpm only, strict TS, no TODO, no new dependency, commits `{type}({scope}): {description}` with no `Co-Authored-By` | `CLAUDE.md` | V-GIT |

## Threat Model / STRIDE (M5 surfaces)

| Threat | Category | Severity | Mitigation | Check |
|---|---|---|---|---|
| Production Turnstile key usable from any `vercel.app` page, tokens replayed to our API | Spoofing | HIGH | D10: production widget lists production domains only; separate preview widget | checklist 1.3, S11 |
| Weak or shared `ADMIN_TOKEN`/`LINK_SECRET`, same value in Preview and Production | Spoofing / EoP | HIGH | >= 32 chars enforced by code (503), different value per environment, rotation procedure | checklist 1.4, 7; A3 tests (M4) |
| Preview deployment mailing real attendees from production keys or writing to the production DB | EoP / Tampering | HIGH | One Upstash DB and one Resend key per environment; Preview base URL derived from `VERCEL_URL` (never the production site); Deployment Protection | checklist 1.1, 1.2, S5 |
| Signed token (name, email) leaks through `Referer` | Information Disclosure | MEDIUM | `Referrer-Policy: no-referrer`; link valid 48 h; no token in logs | T3 pin test, S3 |
| Clickjacking of the booking form | Tampering | LOW | `X-Frame-Options: DENY` | T3, S3 |
| Third-party script supply chain (Cloudflare, Google Fonts) | Tampering | MEDIUM | CSP restricts script/frame/font origins; Turnstile SRI impossible (accepted); report-only first | D4, S7 |
| Lockout of real users: daily budget of 60 exhausted by ~60 captcha solves; victim cooldown re-armed | Denial of Service | MEDIUM | Not preventable by the single WAF rule; daily manual budget check, follow-up alerting; budget counts only new requests, recaps still flow | checklist 1.4, 6, 8 |
| Upstash quota exhausted by cache-busting `GET /api/availability?x=` | Denial of Service | MEDIUM | Rate-limit rule on `/api/*` (D11); `s-maxage` bounds the cached path; usage measured in S9 | checklist 1.4, S9 |
| Erasure done by hand leaves counters inconsistent or personal data behind | Information Disclosure / Repudiation | MEDIUM | Procedure copied from `releaseAtomic`, executed against the throwaway Redis in T10; admin export has no audit log (accepted, follow-up) | T10 |
| Real keys pasted into docs | Information Disclosure | MEDIUM | Only Cloudflare's published test keys appear; gate greps for key-shaped strings | T10 |

## Performance Budget

| Metric | Target | Check |
|---|---|---|
| `/api/availability` origin commands | 1 `MGET` per CDN miss; ceiling <= 1 per 10 s per cache region while the page is being requested | S9 measured delta; contract header test |
| Closing delay | <= ~10 s after the redeploy lands (was ~40 s) | S8 |
| Bundle size | unchanged (T1 adds one constant and a Set; no dependency) | `main.*.js` delta <= 1 kB vs the 49c7b24 build |
| Added response headers | 4 headers on every response, < 1 kB | S3 |
| Install | `--frozen-lockfile` not slower than `--no-frozen-lockfile` (resolution skipped) | probe: 10 s cold, 650 ms warm |

## Dependency Blast-Radius

| Changed | Consumers | Radius |
|---|---|---|
| `code` of the started-show answer | `ReservationAction.tsx`, `TicketingSection.tsx`, `billetterieApi.ts`, 7 API/UI test sites | MEDIUM, one deploy, compile- and test-checked |
| `Cache-Control` of `/api/availability` | browsers/CDN only | LOW |
| `vercel.json` `headers` | every response from the deployment (SPA, API, CSV) | MEDIUM, report-only CSP cannot block |
| `vercel.json` `installCommand` | build only | LOW, one-line revert |
| `shows.ts` comment | 7 importers, comment only | NONE |
| Docs | none at runtime | NONE |

## Blast Radius

| Surface | Outside the diff | How it keeps working |
|---|---|---|
| Callers/consumers | Every reader of the code `closed`: `isClosed` (3 call sites), the 7 tests above; `docs` quoting `stale-while-revalidate` | `git grep` gates in T1/T2; typecheck and both suites |
| Config | `vercel.json` also governs `/api/*` responses and the CSV download (CSP, DENY, nosniff apply; the CSV already sends nosniff) | S3 `curl -sI` on both paths; CSV download tested in S6 |
| CI jobs | none exist (no workflow); `make`-style gates absent | the Sprint Contract commands are the CI |
| Data | none (no Redis schema change); the erasure procedure only documents existing keys | T10 executed procedure |
| Env | `RESERVATIONS_OPEN` semantics unchanged; new requirement: Redeploy to apply | checklist 5, S8 |
| Third parties | Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`), Cloudflare Turnstile (`challenges.cloudflare.com` script + iframe), `@vercel/analytics` (same-origin `/_vercel/insights/script.js`), outbound links to Leetchi and Google Forms (navigation, not CSP-restricted) | allow-list derived from the executed external-URL inventory |

**Safety facts** (executed 2026-10-27 at `49c7b24` by a delegated probe in a **copy** under the scratchpad; the repo's `git status --short` is unchanged apart from the pre-existing `.claude/initiatives/*.json`; no Redis or Docker used):
- `CI=true pnpm install --frozen-lockfile` -> exit 0 twice (`Lockfile is up to date, resolution step is skipped`, `Packages: +1352`, `Done in 10s using pnpm v10.12.4`, then `650ms`); `pnpm-lock.yaml` and `package.json` identical to the originals (`diff -q`). Node v24.22.1, pnpm 10.12.4, `lockfileVersion: '9.0'`, no `packageManager`/`engines`/`.vercel`.
- Flag-on build `index.html` (2125 bytes): exactly one script, `<script defer src="/static/js/main.*.js">`, **no inline script**, no `<style>`, no `<meta http-equiv>`; external origins: `fonts.googleapis.com`, `fonts.gstatic.com`, and in chunk 5 only `challenges.cloudflare.com/turnstile/v0/api.js?render=explicit`; `@vercel/analytics` injects same-origin `/_vercel/insights/script.js`. Flag-off bundle: `api/availability`, `challenges.cloudflare.com` and `PreOrder` absent; the teaser sentence present (D3).
- Headless Chrome 156 with the D5 policy enforced and the flag-on build: page renders, `window.turnstile` present, challenge iframe document served (200) and dummy token issued, `securitypolicyviolation` list empty, Google Fonts CSS and both woff2 files 200. Variants: no `frame-src` -> violation and no token; script-src without Cloudflare -> violation, no Cloudflare traffic; font-src without `fonts.gstatic.com` -> ~15 fonts blocked; `connect-src 'self'` only -> still a token and zero violations; `style-src` without `'unsafe-inline'` -> `style-src-attr` violations on prerendered pages (30-35 `style=` attributes).
- Browser HTTP cache vs swr (Chrome 156, same page, fetches at 0/3/8/20/45/60 s): `public, s-maxage=10, stale-while-revalidate=30` returned the previous body (age 3.3, 5.3, 12.3, 25.3, 15.3 s) with a background revalidation each time; `public, s-maxage=10` and `public, max-age=0, must-revalidate` returned a fresh body every time (age 0.3 s). After a 40 s gap the swr path refetched synchronously, then went stale again.
- `pnpm run typecheck:api` exit 0 (TypeScript 6.0.2); `git ls-files api` 41 files, 4 top-level handlers; `node_modules/@vercel/` contains only `analytics`.
- `react-snap` (postbuild): 4 of 4 local runs exit 1, only `/`, `/spectacle`, `/association` written; hidden by `|| true`.

## Edge Cases & Boundary Conditions

| Boundary | Scenario | Acceptance |
|---|---|---|
| Started show | 409 `show-started` while another show is selected later; the same show clicked again; availability fetch fails after | other show bookable, started button stays disabled, no global closed panel (T1 tests) |
| Gate and show start together | `RESERVATIONS_OPEN=false` and show started | gate wins (403 `closed`, checked first on reserve and confirm) |
| Cache | browser reload within 10 s; 503 from Redis | fresh body each time; 503 is `no-store` |
| Headers | CSV download, `/api/*` JSON, the SPA shell | all carry the four headers; CSP report-only never blocks |
| Frozen install | lockfile and `package.json` out of sync later | Vercel build fails loudly (desired); revert instruction in the checklist |
| Docs | env var documented but absent from code, or the reverse | T10 gate lists both directions: names in code (`process.env.X`, `env.X`) not documented are reported too |
| Erasure | cancelled record, record already expired, id unknown | procedure says what to check first; executed on confirmed and cancelled cases |
| Checklist | Turnstile test key left in Production | step 1.4 verification: Production value differs from `1x0000...` |

## Risk Assessment

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | CSP enforced too early blocks Turnstile for some browsers | HIGH | Report-only in the commit; flip only after S7 in Chrome plus Firefox or Safari (D4) |
| R2 | Production widget accepts `vercel.app`, captcha bypass | HIGH | D10, checklist 1.3 verification step |
| R3 | Preview shares Production DB or keys | HIGH | Checklist 1.1/1.2 evidence step (screenshot of scoped variables), S5 link host check |
| R4 | Resend free tier hit on launch day | HIGH | Plan decision in step 0/1.2 with the arithmetic above |
| R5 | `--frozen-lockfile` fails on Vercel's pnpm | MEDIUM | S1; one-line revert listed in the checklist |
| R6 | `_lib`/`__tests__` routed as functions on Vercel | MEDIUM | S2 (Functions list = 4); stop launch if not |
| R7 | Rate-limit values lock out shared-NAT users | MEDIUM | Proposed values are tunable; monitor 429s day 1 |
| R8 | Docs drift again (names, numbers) | MEDIUM | T10 gate re-runnable by hand; `review_trigger: on file change` |
| R9 | T1 widens into UI redesign | MEDIUM | Critical Files list, `git diff --stat` gate, Stop Condition 1 |
| R10 | Erasure commands wrong | MEDIUM | executed in T10 against the throwaway Redis |
| R11 | react-snap does not prerender `/billetterie` on Vercel | LOW | S1 decision rule; follow-up, SEO only |
| R12 | Owner never reads the French strings | MEDIUM | Step 0(b) lists them by file; launch order forbids flag-on before it is ticked |

## Stop Conditions

> On encountering any condition below, halt and report (structured "halted" status in headless mode) rather than improvising.

1. **Scope drift**: a task needs an edit outside the Critical Files table (`package.json`, `pnpm-lock.yaml`, `api/tsconfig.json`, `tsconfig.json`, `scripts/test-api.mjs`, `.env`, `TeasersSection.tsx`, layout/ui components, `documentation/INDEX.md`).
2. **New dependency** or lockfile change: halt.
3. **Existing test weakened**: a test outside the Forced-changes list needs editing.
4. **Shared Redis**: `REDIS_TEST_URL` resolves to port 6379 or a container other than `fifty-min-test-redis`; never FLUSH anything outside DB 15.
5. **Network in tests**: a test reaches Cloudflare, Resend or Upstash (the headless CSP check is not a test and may reach Cloudflare and Google Fonts only).
6. **Secret or PII in a doc, log or output**: any key-shaped string, token or real address other than the published test keys and the association contact address.
7. **Frozen-lockfile install fails in the copy**: keep `--no-frozen-lockfile`, record it as a checklist item, do not edit the lockfile.
8. **Deploy, push or merge** requested before the owner has read the checklist.
9. **Docker unavailable**: finish everything that does not need Redis, report Redis-gated results as unverified, do not report the milestone done.
10. **A doc-accuracy mismatch** that needs a code change: fix the doc, or halt if the code looks wrong (do not edit code to match prose).

## Agent-Asset Ripple

| Asset | Update | Why |
|---|---|---|
| `CLAUDE.md`, `ARCHITECTURE.md` (V-ADA-01 satisfied: exists) | T7, T11 | api layer, tests, SITE_URL |
| `documentation/decisions/INDEX.md` (V-ADA-02, MEDIUM) | T8 creates, T11 adds ADR-002 | accepted ADR must have an index row |
| `DESIGN.md` (V-ADA-03/04, MEDIUM) | **not created**; `STARTED_LABEL` adds one string, no token change; follow-up in the checklist | UI files change (`*.tsx`) |
| `documentation/reference/product-principles.md` (V-ADA-09) | absent; not a plan-time HIGH, not created; follow-up listed | no owner rulings recorded |
| `documentation/INDEX.md` | **not created** (D9), follow-up | governance bootstrap is its own pass |

## Sprint Contract

### Machine-verifiable
- [ ] `pnpm run typecheck:api` exit 0, empty output.
- [ ] With Redis up: `REDIS_TEST_REQUIRED=1 pnpm run test:api` exit 0, 0 failed / 0 skipped / 0 cancelled, total >= 511 + new (T1 >= 4, T3 >= 7, T2 >= 2), identical on 3 runs; container stopped at the end.
- [ ] `CI=true pnpm run test:ui` exit 0, 0 failed, total >= 308 + new (T1 >= 8), identical on 3 runs; `pnpm exec react-scripts test --listTests` lists nothing under `helpers/`.
- [ ] Flag-on and flag-off `pnpm exec react-scripts build` exit 0, `Compiled successfully.`, no ESLint warning text; off bundle has no `api/availability`, `challenges.cloudflare.com`, `PreOrder` (D3 sentence expected and documented).
- [ ] `git grep -nE "TODO|FIXME" -- src api scripts ':!src/__tests__' ':!api/__tests__'` empty; `git grep -n "stale-while" -- api src documentation/reference documentation/billetterie.md documentation/runbooks` empty (test files assert absence with a regex that does not contain the full header name).
- [ ] `git grep -nE "code: 'closed'" -- api ':!api/__tests__'` = exactly the two 403 gate sites.
- [ ] `vercel.json` parses (`node -e "JSON.parse(require('fs').readFileSync('vercel.json'))"`), has the four headers and `--frozen-lockfile`; headless Chrome check quoted (zero violations; removing `frame-src` shows one).
- [ ] `CI=true pnpm install --frozen-lockfile` in a copy of the final tree: exit 0; `diff -q pnpm-lock.yaml` identical.
- [ ] T10 doc-accuracy gate: 0 unmatched names/commands/paths/codes/keys/numbers; erasure procedure executed against 6390/DB 15.
- [ ] `git diff 49c7b24..HEAD -- package.json pnpm-lock.yaml api/tsconfig.json tsconfig.json scripts .env src/components/layout src/components/ui src/App.tsx src/components/sections/TeasersSection.tsx` empty; `documentation/INDEX.md` does not exist.
- [ ] `git diff -U0 49c7b24..HEAD | grep -E '^\+.*(TODO|Co-Authored-By)'` empty; `git log 49c7b24..HEAD --format=%B | grep -ci "co-authored-by"` prints `0`.
- [ ] `git diff --stat 49c7b24..HEAD` lists exactly the Critical Files; `docker ps --filter name=fifty-min-test-redis` empty.
- [ ] Last commit: ADR-002 `status: accepted` with INDEX and ARCHITECTURE rows (T11).

### Human-verifiable
- [ ] The owner reads the launch checklist top to bottom and the new `STARTED_LABEL` string; acknowledges the ADR-002 acceptance (veto window).
- [ ] The owner confirms the checklist steps are executable without the developer (accounts, DNS, dashboards).
- [ ] Preview smoke tests S1-S14 are executed by the humans before go-live (not by the loop).

## Execution Strategy

**Pattern**: Phase A tasks T1, T2, T3, T4 are independent (disjoint files) and run in parallel, tests first; Phase B docs run after the Phase A gate; T11 is strictly last. Estimate ~9-10 h agent time (T1 3 h, T2 0.5, T3 1.5, T4 0.1, T6+T6b 2, T7 0.75, T8 0.75, T9 2, T10 1.5, T11 0.25; Phase A and docs partly parallel).

| Agent | Task(s) | Model | Delegation Contract |
|-------|---------|-------|---------------------|
| x-tester | tests of T1-T3, the headless CSP check, T10 gate and erasure test, final gate | sonnet | **Objective**: write the listed tests red first, run the gate, mutants and the doc-accuracy checks. **Output format**: files + per-file pass/fail table with quoted runner output; accuracy table (item, source line, verdict). **Scope**: `api/__tests__/**`, `src/__tests__/**`; production code read-only except targeted restored mutations; throwaway servers/scripts live outside the repo. **Tool guidance**: `node:test` for `api/`, CRA Jest for `src/`; `CI=true pnpm run test:ui`, never `pnpm test -- ...`; Redis only via `pnpm run test:api:redis` on 6390; `pnpm install --frozen-lockfile` only in a copy. **Stop condition**: every listed test exists and results match the acceptance; container stopped. |
| general-purpose | code of T1, T2, T3 (`vercel.json`), T4 | sonnet | **Objective**: implement exactly each task's contract after its red tests exist. **Output format**: changed files + quoted green output + `git diff --stat`. **Scope**: Critical Files rows of the task only; never edit `*.test.*`. **Tool guidance**: Edit, Bash for `pnpm run typecheck:api`, `CI=true pnpm run test:ui`, `pnpm exec react-scripts build`; strict TS, relative imports, no TODO comments, no new dependency, no attribution lines. **Stop condition**: task acceptance met or a Stop Condition hit. |
| x-doc-writer | T6, T6b, T7, T8, T9, T11 | sonnet | **Objective**: write the docs from this plan, every statement checked against the code. **Output format**: the files within the line limits, plus a list of each env var/command/path/number with its grep. **Scope**: the `documentation/` files and `CLAUDE.md`/`ARCHITECTURE.md` named in Critical Files; grep `documentation/` before creating anything. **Tool guidance**: Read `redis.ts` (`releaseAtomic`), `quota.ts`, `site.ts`, `email.ts`, `link.ts`, `package.json` for every claim; French in `billetterie.md`, English elsewhere; no real keys. **Stop condition**: T10 gate passes; T11 only after T10 is green. |

**Phases**: P1 (T1 tests || T2 test || T3 pin test || T4) -> code for each -> Phase A gate (typecheck, suites x3, builds, headless CSP, frozen install in a copy); commits `fix(api): give a started show its own error code`, `feat(ui): keep other shows bookable after a show has started`, `fix(api): serve availability without stale-while-revalidate`, `chore(vercel): add security headers and a frozen-lockfile install`, `chore(config): replace the capacity todo with a note`. P2 (T6+T6b || T9 draft) -> T7 -> T8; commits `docs(billetterie): rewrite for the claim-on-confirm model`, `docs: describe the api layer and the test commands`, `docs(billetterie): add the launch checklist`, `docs: fix index, frontmatter and the scaffold hint`. P3 T10. P4 T11, commit `docs(decisions): accept ADR-002 and add the decision index`. No attribution lines in any commit; nothing pushed.

## Plan Quality Gate (self-check, 8 checks)

- [x] 1 Acceptance criteria: T1-T11 each carry measurable criteria (commands, greps, counts, executed procedures).
- [x] 2 Critical file existence: every "Modify"/"Read-only" row was read or located this session (`vercel.json`, `package.json`, `api/tsconfig.json`, `api/availability.ts`, `api/reserve.ts` flow, `reservation-flow.ts`, `guard.ts` line cited, `http.ts`, `redis.ts`, `quota.ts`, `site.ts`, `reservations.ts`, `billetterieApi.ts`, `TicketingSection.tsx`, `ReservationAction.tsx`, `TeasersSection.tsx`, `shows.ts`, `billetterieCopy.ts`, `CLAUDE.md`, `ARCHITECTURE.md`, both runbooks, the contract, the audit, README, ADR-002); new files are marked "no".
- [x] 3 Dependencies: acyclic (T1-T4 independent; T6 needs T1-T4; T6b with T6; T7 needs T6; T8 needs T6, T7; T9 needs T3, T6; T10 needs T1-T9; T11 needs T10).
- [x] 4 Risk concreteness: each mitigation names a step, test, grep or command.
- [x] 5 Success criteria: machine items are commands or file-state checks; human items are owner review and the Preview smoke tests.
- [x] 6 Boundary conditions: dedicated section plus per-task cases.
- [x] 7 Stop conditions: present (HIGH risks R1-R4).
- [x] 8 Codebase Conventions and Blast Radius: both present; safety facts proven by executed commands (frozen install, builds, external-URL inventory, headless CSP matrix, cache probe, typecheck, react-snap failure). Facts not executable here (Vercel compiler, function routing, header rewriting, dashboard limits) are listed in Verification limits with the Preview step that proves them.
- Enterprise sections included: Threat Model, Performance Budget, Dependency Blast-Radius, Blast Radius, Execution Strategy, Sprint Contract, Stop Conditions. One `[NEEDS CLARIFICATION]` marker (T11): the approval gates to cite are not recorded in the ADR. `ARCHITECTURE.md` exists. `DESIGN.md` and `product-principles.md` absent (not created, follow-ups). Open assumptions verified inside tasks: the hoisted react-router path (unchanged), Vercel's pnpm major (S1), whether Vercel rewrites `Cache-Control` for browsers (S3), the branch `billeterie` existing locally (T8).
