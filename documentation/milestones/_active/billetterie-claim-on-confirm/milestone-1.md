---
type: plan
status: current
review_trigger: "on milestone completion"
created: 2026-10-27
last_updated: 2026-10-27
related: [documentation/decisions/ADR-002-billetterie-claim-on-confirm.md, documentation/milestones/_active/billetterie-claim-on-confirm/README.md, documentation/milestones/_active/billetterie-claim-on-confirm/discovery.md, documentation/audits/analysis-billetterie.md]
plan_base_commit: 81bb03347151dcc2bc06fa519ec25ab3e080428a
track: enterprise
mode: milestone-batch
milestone: M1
initiative: billetterie-claim-on-confirm
---

# M1 Plan: Test harness and pure modules

Initiative `billetterie-claim-on-confirm`, branch `initiative/billetterie-claim-on-confirm`, base `81bb033`. Source: ADR-002 § Implementation Order steps 1-2.

## Objective

Give `api/` a runnable, dependency-free test setup and the three pure modules (`guard.ts`, `http.ts`, `link.ts`) that M2-M4 build on, **without changing runtime behaviour** of `reserve`, `reservation`, `availability` or `reservations` (the only edit to a handler is replacing its private `error()` helper with the shared one, byte-identical responses).

Order is fixed by risk: the existing Lua scripts are characterized first (M2 rewrites them), handler behaviour is pinned before the `error()` swap, tests precede each pure module.

Out of scope for M1 (explicit): touching `api/_lib/redis.ts`, `email.ts`, `availability.ts`, `reservations.ts`; wiring `guard.ts`/`link.ts` into any handler (M3); `quota.ts` (M2); fixing `pnpm test` (CRA jest fails on `main` with `Cannot find module react-router-dom`; CRA jest only sees `src/`, so it stays untouched); characterizing `releaseExpired` (deleted in M2 together with the sweep); CI (no `.github/workflows` exists).

## Decision Record

| Decision | Easy path | Hard path | Choice | Rationale | Confidence |
|---|---|---|---|---|---|
| How tests reach `redis.ts` (Upstash REST client) from a local `redis:7-alpine` | Add a second REST emulator container (third-party image) or add a `redis` npm dependency and a dual transport in `redis.ts` | Test-side `fetch` shim that translates the Upstash REST body (JSON command array) into RESP over `node:net` | Test-side shim, ~80 lines in `api/__tests__/helpers/` | Production `redis.ts` stays byte-identical, so the characterization tests describe the code that really ships; no new dependency or image. Cost: we own a small RESP codec (covered by its own test) | High |
| `api/tsconfig.json` TS5107 fix | `"ignoreDeprecations": "6.0"` | `"module": "node16", "moduleResolution": "node16"` (no deprecated option, valid on TS 5/6/7) | Try `node16` first; fall back to `ignoreDeprecations` (already proven to exit 0 on this tree) | `@vercel/node` may compile with its own TypeScript where `"6.0"` is an invalid `ignoreDeprecations` value; `node16` avoids the unknown. Fallback keeps M1 unblocked | Medium |
| Where `RESERVATIONS_OPEN` is closed | Default open | Open only when env equals `true` (case-insensitive, trimmed); absent or anything else = closed | Fail closed | Matches ADR-002 "fail closed"; harmless in M1 because nothing calls it yet; M5 checklist sets the variable | Medium |
| Test runner | Shell one-liner in `package.json` | `scripts/test-api.mjs` (mkdtemp, tsc, Redis probe, test file list, cleanup) | Node runner script | Needs a temp dir shared between compile and run, a reachability probe that sets a skip reason, and guaranteed cleanup | High |

## Task Breakdown

Notation: `depends on` lists task ids. Every task carries measurable acceptance criteria and a stated verification command.

### T1: Fix `api/tsconfig.json` and add `typecheck:api`
depends on: none.
- Edit `api/tsconfig.json` per the Decision Record (primary `node16/node16`; fallback `ignoreDeprecations: "6.0"`). Keep `strict`, `types: ["node"]`, `include` (tests are picked up by `./**/*.ts`).
- Add `package.json` script `"typecheck:api": "tsc -p api/tsconfig.json --noEmit"`.
- Acceptance:
  - `pnpm run typecheck:api` exits 0 with empty output (baseline today: exactly one error, `TS5107 ... moduleResolution=node10 is deprecated`).
  - `pnpm exec tsc -p api/tsconfig.json --noEmit false --outDir <tmp>` exits 0 and `<tmp>/api/reserve.js` begins CommonJS (`"use strict"` + `require(`), proving emit stays CJS under the chosen settings.
  - Root `pnpm exec tsc -p tsconfig.json --noEmit` result is unchanged from before the edit (record both results in the commit body).
  - Diff touches only `api/tsconfig.json` and `package.json`.

### T2: Test runner, Redis REST shim and helpers
depends on: T1.
- `scripts/test-api.mjs`: (1) `mkdtemp` under `os.tmpdir()`; (2) compile with `node <resolved typescript/bin/tsc> -p api/tsconfig.json --noEmit false --outDir <tmp>`; abort with tsc output if compile fails; (3) `REDIS_TEST_URL` default `redis://127.0.0.1:6390`, TCP-probe it with a 1 s timeout; unreachable sets `REDIS_TEST_SKIP_REASON` and prints `Redis integration tests SKIPPED: cannot reach 127.0.0.1:6390 (start it with: pnpm run test:api:redis)`; `REDIS_TEST_REQUIRED=1` turns unreachable into exit 1; (4) enumerate `*.test.js` recursively under `<tmp>/api/__tests__` (explicit file list, helpers are never executed as tests) and run `node --test <files>`; (5) always remove the temp dir; exit with the test process code.
- `package.json` scripts: `"test:api": "node scripts/test-api.mjs"` and `"test:api:redis": "docker run -d --rm --name fifty-min-test-redis -p 127.0.0.1:6390:6379 redis:7-alpine"`. No new `dependencies`/`devDependencies` (`git diff package.json` shows only `scripts` lines).
- `api/__tests__/helpers/redis-env.ts`: first import of every Redis test file. Sets `KV_REST_API_URL=http://upstash-shim.test`, `KV_REST_API_TOKEN=test-token` **before** `redis.ts` loads (it reads env at module load, `redis.ts:4-5`), exports `redisSkipReason: string | false`.
- `api/__tests__/helpers/redis-rest-shim.ts`: installs a `globalThis.fetch` replacement. For requests to the shim host it checks `Authorization: Bearer test-token`, opens a fresh `node:net` socket per call (so concurrent calls are truly concurrent), sends `SELECT 15` then the command as RESP, decodes integer, simple string, bulk string, nil, array (nested) and error replies, and returns `Response.json({ result })` or `{ error }` exactly like Upstash. Requests to any other host throw (no real network in tests).
- Safety rails in the shim (see Risk R1): refuses any `REDIS_TEST_URL` whose host is not `127.0.0.1`/`localhost` or whose port is `6379`; on first use, if DB 15 is non-empty and lacks the marker key `__fifty_min_test_db__`, aborts with "refusing to flush a non-test database"; `FLUSHDB` is only ever sent to DB 15 and re-sets the marker.
- Acceptance:
  - `pnpm run test:api` with Redis down: exit 0, output contains `SKIPPED` and the start command; with `REDIS_TEST_REQUIRED=1`: exit 1.
  - `docker ps` shows nothing is started by the runner; runner leaves no `/tmp/fifty-min-*` dir behind (`ls` after run shows none).
  - A shim self-test `api/__tests__/redis-rest-shim.test.ts` (runs only with Redis up) round-trips: `SET`/`GET` string, `INCR` integer, `GET` missing key to `null`, `RPUSH`+`LRANGE` array, `EVAL` returning `{1, 7}` to `[1, 7]`, and a Redis error (`EVAL` with bad script) to a thrown `Error` through `redis()`. And rejects port 6379 and a non-loopback host (these two cases run without Redis).
  - Same test run twice in a row passes both times (FLUSHDB isolation).

### T3: Skeletons for `http.ts`, `guard.ts`, `link.ts`
depends on: T1.
- `api/_lib/http.ts` is implemented in full (trivial): `error(message, status = 400): Response` (identical body shape `{ error }`), `json(body, init?)`, constants `ERR` for the strings duplicated today with their exact text: `INVALID_REQUEST` `Requête invalide`, `UNKNOWN_SHOW` `Représentation inconnue`, `UNKNOWN_ACTION` `Action inconnue`, `INVALID_LINK` `Lien invalide`, `UNAVAILABLE` `Service indisponible, merci de réessayer plus tard`, `NOT_FOUND` (the long text of `reservation.ts:12-13`, character for character).
- `guard.ts` and `link.ts`: exported types and function signatures from T7/T9 below, bodies `throw new Error('not implemented')`, so tests compile and fail red for the right reason.
- Acceptance: `pnpm run typecheck:api` exits 0; `git grep -n "not implemented" -- api/_lib` lists only `guard.ts` and `link.ts`; no handler imports the skeletons yet (`git grep -nE "_lib/(guard|link)" -- api ':!api/__tests__'` is empty).

### T4: Characterization tests for the existing Lua scripts
depends on: T2. Written against unchanged `api/_lib/redis.ts` (`git diff --stat -- api/_lib/redis.ts` empty at the end).
File `api/__tests__/redis-scripts.test.ts`, `describe` skipped via `redisSkipReason`; `beforeEach` FLUSHDB. Minimum 18 tests:
1. `reserveAtomic` success: returns `{status: 1, remaining: capacity - qty}`; `GET show:{id}:booked` = qty; `HGET show:{id}:emails <email>` = qty; list `show:{id}:reservations` = [id]; `reservation:{id}` equals `JSON.stringify(record)` byte for byte; `ZSCORE reservations:pending id` = `expiresAt`.
2. Capacity: cap 5, A takes 3, B asks 3 returns `{-2, 2}`; B leaves no key (`EXISTS reservation:B` = 0, booked still 3).
3. Capacity boundaries: exactly filling (qty = remaining) returns `{1, 0}`; next ask of 1 returns `{-2, 0}`.
4. Per-email limit (max 4): 3 then 2 returns `{-1, 1}`; 4 then 1 returns `{-1, 0}`; limit checked per show (same email on another show succeeds).
5. Precedence pin: when both limits are violated the result is `-1` (email check runs first).
6. Pin of current weakness: `A@x.ch` and `a@x.ch` count separately (M2 replaces with the canonical key).
7. Pin: re-reserving the same record id twice double-counts booked (no idempotency today; `claimAtomic` fixes it in M2).
8. Last-seat race: cap 10, booked 9, two concurrent `reserveAtomic` (qty 1, distinct emails) give exactly one `1` and one `-2`; booked ends at 10.
9. Stress race: cap 5, 20 concurrent single-seat requests, distinct emails: exactly 5 `status 1`, 15 `status -2`, booked = 5, `LLEN reservations` = 5.
10. Per-email race: same email, max 4, 10 concurrent single-seat requests: exactly 4 succeed, `HGET` = 4.
11. `confirmAtomic` success: returns true, stored JSON equals the confirmed record, `ZSCORE pending` is nil afterwards, booked and emails counters untouched.
12. `confirmAtomic` CAS failure (raw differs): returns false, record and pending entry unchanged.
13. `confirmAtomic` on a missing key: returns false (pin).
14. `releaseAtomic` success: returns true, `reservation:{id}` deleted, booked decremented by qty, email field decremented (field remains with `0`, pin), id removed from list and pending set.
15. `releaseAtomic` CAS failure: returns false, counters untouched.
16. `releaseAtomic` twice: second call false, counters not decremented twice (booked never negative).
17. `releaseAtomic` on a confirmed record frees seats (the cancel path).
18. `getReservation`: returns `raw` identical to the stored string; unknown id returns `null`.
- Acceptance:
  - `pnpm run test:api` with Redis up: this file reports ≥ 18 passing, 0 failing, 0 skipped.
  - Mutation drill (recorded in the commit body, then reverted, `git diff -- api/_lib/redis.ts` empty): changing `mine + qty > maxPerEmail` to `>=` (`redis.ts:52`) makes ≥ 2 tests fail; changing `booked + qty > capacity` to `>=` (`redis.ts:53`) makes ≥ 2 tests fail; removing the `DECRBY` line in `RELEASE_SCRIPT` makes ≥ 2 tests fail.
  - Run ×3 consecutively: identical pass counts (no flakiness in the race tests).

### T5: Handler smoke tests that pin pre-swap behaviour
depends on: T2. Written and run green against the **unchanged** `reserve.ts` and `reservation.ts`, before T6.
File `api/__tests__/handlers-smoke.test.ts` (no Redis needed; paths that return before Redis). Calls the exported `POST`/`GET` with `new Request(...)`:
- reserve: invalid JSON gives 400 `{error:'Requête invalide'}`; honeypot `website` filled gives 200 `{ok:true}`; unknown show gives 400 `Représentation inconnue`; name 1 char gives 400 `Merci d’indiquer votre nom`; bad email gives 400 `Adresse email invalide`; quantity 0 and 5 give 400 with the `entre 1 et 4` message; past show start (inject via a show whose date is past is not possible, so use `Date.now` stubbed with `mock.timers`/`mock.method(Date, 'now')`) gives 400 `Les réservations pour cette date sont closes`.
- reservation: POST invalid JSON gives 400; POST action `x` gives 400 `Action inconnue`; GET without id gives 400 `Lien invalide`; GET with id `zzzzzzzz` gives 400 `Lien invalide`.
- Each assertion checks status code, `content-type` starts with `application/json`, and the exact `error` string.
- Acceptance: ≥ 11 tests green on the unchanged handlers (`git stash`-free proof: `git diff --stat -- api/reserve.ts api/reservation.ts` is empty when this task's tests first pass); none of them touches the network (fetch is replaced by a function that throws).

### T6: Swap the duplicate `error()` helpers for `http.ts`
depends on: T3, T5.
- `api/reserve.ts` and `api/reservation.ts`: delete the local `function error`, import `{ error, ERR }` from `./_lib/http`, replace the identical literals (`Requête invalide`, `Représentation inconnue`, `Action inconnue`, `Lien invalide`, service-unavailable, `NOT_FOUND`) with `ERR.*`. Messages that exist in one place only stay inline. No other edit.
- `api/__tests__/http.test.ts` (x-tester, in P4 with T7/T9): `error('x')` is status 400 `{error:'x'}`; `error('x', 503)` is 503; `json` sets `content-type: application/json`; every `ERR` value equals its original literal pinned as a string in the test (guards against drift); `ERR.NOT_FOUND` has the same text as the old `reservation.ts` constant (copied into the test).
- Acceptance:
  - T5 suite still green with no edit to `handlers-smoke.test.ts`.
  - `git grep -n "function error" -- api` returns only `api/_lib/http.ts`.
  - `git diff -- api/reserve.ts api/reservation.ts` contains only the import line, the removed helper and `ERR.*` replacements (reviewed by x-tester, count of changed non-import lines ≤ 14).
  - `pnpm run typecheck:api` exits 0.

### T7: `guard.ts` tests (red)
depends on: T3. Written by x-tester in `api/__tests__/guard.test.ts` against the signatures below; run shows them failing with `not implemented` (red), then T8 turns them green. Minimum 28 tests, table-driven. Clock is injected (`now: () => number`); no env or network access.

### T8: Implement `guard.ts`
depends on: T7.
Signatures (the contract the tests use; all pure, no Redis, no network):

```ts
export type GuardResult = { ok: true } | { ok: false; status: number; message: string };
export function checkMethod(request: Request, allowed: string): GuardResult;           // 405 + http.ts text
export function checkContentType(request: Request): GuardResult;                        // application/json[; charset=utf-8] else 415
export function checkOrigin(request: Request, allowed: readonly string[]): GuardResult; // missing/unlisted Origin => 403
export function readJsonBody(request: Request, maxBytes?: number): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; status: number; message: string }>; // default 4096; 413 / 400
export function isHoneypotFilled(body: Record<string, unknown>): boolean;               // body.website truthy
export function isReservationsOpen(env: Record<string, string | undefined>): boolean;   // only 'true' (trim, case-insensitive)
export function validateName(raw: unknown): { ok: true; value: string } | { ok: false; message: string };
export function canonicalEmail(email: string): string;                                   // see below
export function emailDomain(email: string): string;
export function validateReserveFields(body: Record<string, unknown>, now: () => number): { ok: true; value: ReserveFields } | { ok: false; status: number; message: string };
export interface ReserveFields { showId: string; name: string; email: string; quantity: number; canonicalEmail: string; turnstileToken: string }
```

Rules:
- `canonicalEmail`: trim, lowercase, split at the last `@`; local part: drop everything from the first `+`; for `gmail.com`/`googlemail.com` remove dots and map the domain to `gmail.com`. Returns `''` when the local part is empty after stripping.
- `validateName`: trim, NFC-normalize, length 2-100 (code points), reject any control character (`\u0000-\u001F`, `\u007F`, ` `, ` `, so CR/LF), reject `://`, `www.`, `@` and `\b[a-z0-9-]+\.(com|net|org|ch|fr|io|ru|xyz|top|info|biz|link|click)\b`; accepts accents, apostrophes (`’` and `'`), hyphens, spaces, dots in initials (`J.-P. Martin`).
- Email: ASCII-only pattern, total ≤ 254, local ≤ 64, TLD ≥ 2 letters, no consecutive dots; the stored/validated `email` is trimmed and lowercased (same normalization the handler applies today), `canonicalEmail` is the counter key.
- `validateReserveFields`: `showId` must resolve via `getShow` (`../../src/config/shows`) and `now() < showStart(show)`; `quantity` integer in `1..MAX_TICKETS_PER_EMAIL`; error texts reuse `ERR` from `http.ts` and the current French messages from `reserve.ts:33-39` verbatim; `turnstileToken` string, trimmed, max 2048, may be empty (verified in M3).
- Acceptance (test cases that must exist and pass):
  - Method/Content-Type/Origin: GET on POST-only gives 405; `text/plain` and missing header give 415; `application/json; charset=utf-8` passes; Origin absent, `null`, `https://evil.example`, prefix-spoof `https://melangedegenres.ch.evil.example` all give 403; exact listed origin passes.
  - Body size: 4096 bytes passes, 4097 gives 413 (both via `Content-Length` and via a stream with no `Content-Length`); invalid JSON gives 400; JSON array or `null` body gives 400.
  - Honeypot: `website: 'x'` true; absent, `''`, `0` false.
  - Open gate: `'true'`, `' TRUE '` open; `undefined`, `''`, `'1'`, `'false'`, `'yes'` closed.
  - Name: `''`, `' a '`, 101 chars, `"Jean\nBcc: x@y.z"`, `"A\rB"`, `"Bob "`, `https://spam.example`, `www.spam.ch`, `buy at spam.com`, `a@b.ch` rejected; `Élodie`, `Jean-Pierre O’Neil`, `J.-P. Martin`, exactly 2 and exactly 100 chars accepted; unicode counts by code point.
  - `canonicalEmail`: `A.B+x@Gmail.com` and `ab@googlemail.com` both give `ab@gmail.com`; `a.b+x@example.ch` gives `a.b@example.ch` (dots kept off Gmail); `+x@example.ch` gives `''`; surrounding spaces trimmed.
  - Fields: quantity `0`, `5`, `1.5`, `'2'` (string), `NaN` rejected; `1` and `4` accepted; unknown show; show started (injected clock at `showStart`, `showStart - 1 ms` accepted); email 255 chars rejected, 254 accepted when otherwise valid.
  - `git grep -nE "redis|fetch\(" api/_lib/guard.ts` is empty (purity), and `guard.ts` imports only `../../src/config/shows` and `./http`.

### T9: `link.ts` tests (red)
depends on: T3. `api/__tests__/link.test.ts` by x-tester, minimum 20 tests; secrets and clock injected (no env). Red first, then T10.

### T10: Implement `link.ts`
depends on: T9.
Format: `token = b64url(JSON payload) + '.' + b64url(HMAC-SHA256(secret, 'confirm:v1\n' + b64url(JSON payload)))`.
Payload: `{ v: 1, purpose: 'confirm:v1', showId, name, email, quantity, exp (epoch seconds), nonce (16 random bytes, b64url), kid }`. Id = first 8 hex characters of the signature, uppercased (`^[A-F0-9]{8}$`).

```ts
export interface LinkSecret { kid: string; secret: string }
export interface LinkSecrets { current: LinkSecret; previous?: LinkSecret }
export function loadLinkSecrets(env: Record<string, string | undefined>): LinkSecrets | null; // LINK_SECRET(+_KID default '1'), LINK_SECRET_PREVIOUS(+_KID default '0'); secret < 32 chars => null
export function signLink(input: { showId: string; name: string; email: string; quantity: number }, opts: { secrets: LinkSecrets | null; now?: () => number; ttlSeconds?: number; nonce?: string }): { token: string; id: string; exp: number }; // throws LinkSecretError when secrets null; default ttl 48 h
export function verifyLink(token: string, opts: { secrets: LinkSecrets | null; now?: () => number }): { ok: true; payload: LinkPayload; id: string } | { ok: false; reason: 'no-secret' | 'malformed' | 'unknown-kid' | 'bad-signature' | 'wrong-purpose' | 'expired' };
```

Rules: tokens longer than 2048 characters are rejected as `malformed` before any parsing; `kid` selects `current` or `previous` (unknown kid is rejected); the signature comparison uses `crypto.timingSafeEqual` after a length check; the payload is parsed only after the signature verifies; field types are validated after parsing (`v === 1`, `purpose === 'confirm:v1'`, integer `quantity`, string fields, integer `exp`); expired when `now >= exp`; `verifyLink` never throws, `signLink` throws `LinkSecretError` (fail closed: missing secret never yields an unsigned or default-keyed token). No default secret anywhere.
- Acceptance (test cases that must exist and pass):
  - Round trip returns identical payload fields, including a non-ASCII name; `id` matches `^[A-F0-9]{8}$`; verifying the same token twice yields the same id; two tokens with different nonce yield different ids.
  - Tamper: changing any single payload field (showId, name, email, quantity, exp, nonce, kid, v, purpose), re-encoding without re-signing, gives `bad-signature` (or `unknown-kid` for kid); flipping one signature character, truncating the signature, an empty signature, no dot, two dots, non-base64url characters give `bad-signature`/`malformed`; token of 2049 chars gives `malformed`.
  - Domain separation: a MAC computed with a different purpose prefix, or the same payload signed without the prefix, gives `bad-signature`; payload with `purpose: 'cancel:v1'` correctly signed by the test gives `wrong-purpose`.
  - Expiry with injected clock: valid at `exp - 1`, `expired` at `exp` and `exp + 1`.
  - Rotation: token signed with secret A (kid `1`) verifies with `{current: B(kid 2), previous: A(kid 1)}`; fails with `unknown-kid` once `previous` is dropped; a token signed with B does not verify under `{current: A}`.
  - Fail closed: `secrets: null` gives `verifyLink` `{ok:false, reason:'no-secret'}` and `signLink` throws `LinkSecretError`; `loadLinkSecrets({})`, a 31-character secret and an empty string return `null`; 32 characters is accepted.
  - Static checks (commands, run in T12): `git grep -n "timingSafeEqual" api/_lib/link.ts` has ≥ 1 hit; `git grep -nE "(sig|signature|mac)[A-Za-z]* *(===|!==|==|!=)" api/_lib/link.ts` is empty; no `Math.random`; no secret or token value appears in any `console.*` call (`git grep -n "console\." api/_lib/link.ts` empty).

### T11: Runbook for the API test setup
depends on: T2, T4, T8, T10. Owner x-doc-writer.
- New `documentation/runbooks/api-tests.md` (search-before-write done: `documentation/runbooks/` does not exist, no INDEX.md exists, `billetterie.md` is the feature doc rewritten in M5). Frontmatter per governance (`type: runbook`, `status: current`, `review_trigger: "on file change"`, dates). Content: purpose; commands (`pnpm run test:api:redis`, `pnpm run test:api`, `pnpm run typecheck:api`, `REDIS_TEST_URL`, `REDIS_TEST_REQUIRED`); what the runner does; the safety rails (port 6379 refused, DB 15, marker key); how to add a Redis test (import `helpers/redis-env` first); stop the container (`docker stop fifty-min-test-redis`); known limit (`pnpm test` CRA suite is separate and currently broken on `main`).
- Acceptance: every command in the file is copy-pasteable and was executed by x-tester in T12 with the documented outcome; file ≤ 120 lines; no emoji; no date in the filename; `CLAUDE.md`/`ARCHITECTURE.md` untouched (M5).

### T12: Final verification and enforcement summary
depends on: T4, T6, T8, T10, T11. Owner x-tester (sonnet, full).
- Run, quoting output (5-step verification gate): `pnpm run typecheck:api`; `docker ps --filter name=fifty-min-test-redis`; `pnpm run test:api` ×3 with Redis up; once with the container stopped (skip path); once with `REDIS_TEST_REQUIRED=1` and container stopped (exit 1); `pnpm exec tsc -p tsconfig.json --noEmit`; static checks from T8/T10; `git diff --stat 81bb033..HEAD`.
- Acceptance: all green as specified; changed-file list equals the Critical Files table (nothing else); no `TODO`, no `Co-Authored-By` in `git log 81bb033..HEAD`; container `fifty-min-test-redis` stopped at the end.

## Critical Files

| File | Change | Task | Exists |
|---|---|---|---|
| `package.json` | Modify (scripts only: `typecheck:api`, `test:api`, `test:api:redis`) | T1, T2 | yes |
| `api/tsconfig.json` | Modify (TS5107 fix) | T1 | yes |
| `scripts/test-api.mjs` | New | T2 | no |
| `api/__tests__/helpers/redis-env.ts` | New | T2 | no |
| `api/__tests__/helpers/redis-rest-shim.ts` | New | T2 | no |
| `api/__tests__/redis-rest-shim.test.ts` | New | T2 | no |
| `api/__tests__/redis-scripts.test.ts` | New | T4 | no |
| `api/__tests__/handlers-smoke.test.ts` | New | T5 | no |
| `api/__tests__/http.test.ts` | New | T6 | no |
| `api/__tests__/guard.test.ts` | New | T7 | no |
| `api/__tests__/link.test.ts` | New | T9 | no |
| `api/_lib/http.ts` | New | T3 | no |
| `api/_lib/guard.ts` | New | T3, T8 | no |
| `api/_lib/link.ts` | New | T3, T10 | no |
| `api/reserve.ts` | Modify (helper swap only) | T6 | yes |
| `api/reservation.ts` | Modify (helper swap only) | T6 | yes |
| `documentation/runbooks/api-tests.md` | New | T11 | no |
| `api/_lib/redis.ts` | Read-only reference (must stay unchanged) | T4 | yes |
| `src/config/shows.ts` | Read-only reference (imported by `guard.ts`) | T8 | yes |

## Codebase Conventions

| Touchpoint | Convention to follow | Source | Required by |
|---|---|---|---|
| Server errors | Shared `error(message, status)` returning `Response.json({ error })`, French messages, generic 503 text | `api/reserve.ts:7-9`, `api/reservation.ts:8-10` (merged into `http.ts`) | V-INT-01..03, V-DRY-01 |
| Validation | Early-return guards, French messages verbatim, silent honeypot (`body.website`) | `api/reserve.ts:23-40`, `api/reservation.ts:19` | V-INT-01..03 |
| Handlers | Web-standard named `GET`/`POST(request: Request): Promise<Response>`; no framework | `api/reserve.ts:15`, `api/reservation.ts:36,45` | V-INT-01 |
| Config | Limits and shows come from `src/config/shows.ts` (`MAX_TICKETS_PER_EMAIL`, `getShow`, `showStart`, `CONFIRMATION_DELAY_HOURS`); relative imports only (`../src/config/shows`, `../../src/config/shows` from `_lib`) | `src/config/shows.ts:24-68` | V-INT-02, V-DRY-01 |
| Env | Read ad hoc via `process.env` at module scope today; new pure modules take env/clock as parameters instead (testable, injectable per ADR-002 Dependency Inversion) | `api/_lib/redis.ts:4-5`, `api/_lib/email.ts:7-9` | V-SOLID-05 |
| Redis | Hand-rolled Upstash REST client `redis(...command)`, key helpers in `keys`, Lua via `EVAL`; **not modified in M1** | `api/_lib/redis.ts:7-27,46-144` | V-INT-02 |
| Logging | `console.error('<label> error', id, err)`; never log email addresses, tokens or secrets | `api/reserve.ts:59,82` | V-SEC-03 |
| Tests | Live in `api/__tests__/` (never beside sources), TypeScript strict, `node:test` + `node:assert/strict`, no new dependency; the project rule "tests in `tests/` or `__tests__/`" applies | project `CLAUDE.md`, discovery.md | V-TEST-01..03 |
| TypeScript | `.ts` utilities, strict, no `any`, no TODO comments, no `@/` aliases | project `CLAUDE.md` | V-INT-03 |
| Commits | `{type}({scope}): {description}`, e.g. `test(api): characterize Lua reservation scripts`; no `Co-Authored-By`, no AI attribution | user rules | V-GIT |

## Threat Model / STRIDE

Scope: the pure modules introduced here (`link.ts` signing and verification, `guard.ts` input rejection) and the test tooling. Nothing is wired into a handler in M1, so exposure is latent until M3; the model fixes the requirements those modules must meet.

| Threat | Category | Severity | Mitigation | Status |
|---|---|---|---|---|
| Forged confirm link for another person or show | Spoofing | HIGH | HMAC-SHA256 with a server secret of ≥ 32 chars; payload parsed only after the signature verifies; purpose `confirm:v1` inside both payload and MAC input; tests T9 tamper matrix | Mitigated in T10 |
| Payload field edited after signing (quantity, email, exp) | Tampering | HIGH | Every field covered by the MAC; any edit gives `bad-signature` (tested per field) | Mitigated in T10 |
| Attendee denies having requested or confirmed | Repudiation | LOW | Signed payload carries nonce and exp; the derived id ties request to record; audit trail is M2/M3 (record timestamps). No further control in M1 | Open (M2/M3) |
| Name, email and signed link leak through logs or error messages | Information Disclosure | MEDIUM | Modules never log; error results return a reason code only; static check forbids `console.*` in `link.ts`; link-in-URL risk and `Referrer-Policy` are handled in M5 | Mitigated for M1, M5 completes |
| Oversized or malformed body/token exhausts memory or CPU | Denial of Service | MEDIUM | `readJsonBody` byte cap 4096 enforced on stream and header; tokens > 2048 chars rejected before parsing; tests T8/T10 | Mitigated in T8/T10 |
| Header injection through the name (CR/LF) in later emails; URL smuggling in names | Elevation of Privilege (injection into mail headers/body) | HIGH | `validateName` rejects control characters and URLs; table tests T8 | Mitigated in T8 |
| Test tooling flushes a real database (shared Redis on 127.0.0.1:6379 belongs to another project) | Tampering / DoS (self-inflicted) | HIGH | Port 6379 and non-loopback hosts refused; DB 15 only; marker-key check before any FLUSHDB; shim throws for unknown hosts (no real network) | Mitigated in T2 |
| Secret committed or defaulted in code | Information Disclosure | HIGH | No default secret anywhere; `loadLinkSecrets` returns `null` below 32 chars; tests use obvious fixture strings only inside `__tests__` | Mitigated in T10 |

## Dependency Blast-Radius

| Changed file | Downstream consumers | Blast radius |
|---|---|---|
| `package.json` (scripts only) | pnpm users; Vercel `installCommand` ignores scripts | LOW |
| `api/tsconfig.json` | `typecheck:api`, test runner, possibly `@vercel/node` when it reads the nearest tsconfig | MEDIUM |
| `api/reserve.ts` | Vercel route `/api/reserve`; `TicketingSection.tsx` (HTTP client) | LOW (helper swap, strings identical, pinned by T5) |
| `api/reservation.ts` | Vercel route `/api/reservation`; `ReservationAction.tsx`, `BilletteriePage.tsx` | LOW (same) |
| `api/_lib/http.ts`, `guard.ts`, `link.ts` | `reserve.ts`, `reservation.ts` (http only); guard and link have no consumers until M3 | LOW |
| `scripts/test-api.mjs`, `api/__tests__/**`, runbook | developers only | LOW |

**Overall blast radius**: LOW-MEDIUM (MEDIUM only because of the Vercel builder's use of `api/tsconfig.json`, which cannot be verified locally; see R2).

## Blast Radius

| Surface | Outside the diff | Why it matters |
|---|---|---|
| Callers | `error()` helpers in `reserve.ts` and `reservation.ts` have no importers (private functions); `redis.ts` exports (`reserveAtomic`, `confirmAtomic`, `releaseAtomic`, `releaseExpired`, `getReservation`) are used only by `availability.ts`, `reservation.ts`, `reservations.ts`, `reserve.ts` and are not modified | `availability.ts` and `reservations.ts` stay untouched and keep working |
| Consumers | HTTP clients `src/components/sections/TicketingSection.tsx`, `ReservationAction.tsx`, `BilletteriePage.tsx` rely on response bodies; unchanged because strings are pinned | A changed `error` string would silently change UI text |
| Config | New optional env names `LINK_SECRET`, `LINK_SECRET_KID`, `LINK_SECRET_PREVIOUS(_KID)`, `RESERVATIONS_OPEN`, `REDIS_TEST_URL`, `REDIS_TEST_REQUIRED`, `REDIS_TEST_SKIP_REASON`: not read by any handler in M1, so no deployment env change is needed; `vercel.json` has only `installCommand`; root `tsconfig.json` has `"include": ["src"]`, so CRA build/ESLint never see `api/` or `scripts/` | Env matrix is documented in M5 |
| Data | Tests use local Redis DB 15 on `127.0.0.1:6390` only. The Redis already listening on `127.0.0.1:6379` (container `sslcert-infra-redis-1`, another project) must never be touched. Upstash production/preview data untouched | Rails in T2 enforce this |
| CI | None: `.github/workflows` does not exist | `test:api` is local-only; `REDIS_TEST_REQUIRED=1` is ready for a future CI job |
| Deploy | Vercel treats files under `api/` as functions except `_`-prefixed paths. `api/__tests__/` and `api/_lib/` share the `_` prefix. Not verifiable locally (no `@vercel/node` or Vercel CLI in `node_modules`) | See R3: verified on the Preview deploy in M5 |

**Safety fact** (required): the current `api/` sources plus `src/config/shows.ts` and `src/config/seo.ts` typecheck cleanly, so the only blocker to `typecheck:api` is the deprecation error and T1 cannot surface latent type errors. Proven by `pnpm exec tsc -p api/tsconfig.json --noEmit` (TypeScript 6.0.2) printing exactly `api/tsconfig.json(6,25): error TS5107: Option 'moduleResolution=node10' is deprecated and will stop functioning in TypeScript 7.0. Specify compilerOption '"ignoreDeprecations": "6.0"' to silence this error.`, and by `pnpm exec tsc -p api/tsconfig.json --noEmit --ignoreDeprecations 6.0` printing nothing with exit 0 (both executed 2026-10-27 at base `81bb033`). Companion fact: `git grep -nE "function error" -- api src` hits only `api/reserve.ts:7` and `api/reservation.ts:8`, and `git grep -nE "confirmAtomic|releaseAtomic|reserveAtomic|releaseExpired|getReservation" -- . ':!documentation'` hits only `api/_lib/redis.ts` and the four handlers (executed the same day).

## Edge Cases & Boundary Conditions

| Boundary Type | Scenario | Acceptance Criterion |
|---|---|---|
| Empty input | `{}` body, empty name, empty token string | guard returns `ok:false` with the French message; `verifyLink('')` is `malformed` |
| Max length | name 100 vs 101 code points; email 254 vs 255; body 4096 vs 4097 bytes; token 2048 vs 2049 | first accepted, second rejected (tests T8/T10) |
| Type confusion | quantity `'2'`, `1.5`, `NaN`; body array; `website: 0` | rejected / false as listed in T8 |
| Time | `exp` equality; show start equality; clock moves backwards | `now >= exp` is expired; `now >= showStart` is closed; only injected clock used |
| Concurrency | 20 parallel single-seat reservations; 2 parallel for the last seat | exactly capacity successes, booked never above capacity (T4) |
| State transition | confirm twice; release twice; release after confirm | second call false, counters not double-decremented (T4) |
| Encoding | Non-ASCII names in signed payload; ` ` in names | round trip exact; control chars rejected |
| Environment | Redis down; port 6379 configured; non-empty foreign DB 15 | skip with message / abort with explicit refusal (T2) |

## Risk Assessment

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Test helper flushes the wrong Redis (a second instance listens on 6379 on the dev machine) | HIGH | Shim refuses port 6379 and non-loopback hosts, uses DB 15 only, aborts when DB 15 is non-empty without the marker key; unit tests for the refusals run without Redis (T2); runbook states it (T11) |
| R2 | Changed `api/tsconfig.json` breaks the Vercel function build (the builder may use its own TypeScript, where `ignoreDeprecations: "6.0"` is invalid, or may not honour `node16`) | HIGH | Primary option `node16/node16` is valid on TS 5, 6 and 7 and not deprecated; fallback proven to exit 0; T1 records emit output is CJS; the Vercel build of the Preview deploy is an M5 launch-checklist item and gates the merge (M1 is not deployed alone: `billeterie` has no production API yet) |
| R3 | `api/__tests__/` deployed as a serverless function | MEDIUM | Same `_` prefix convention as the already used `_lib/`; test files export no `GET`/`POST`; M5 checklist: on Preview, `GET /api/__tests__/guard.test` must return 404 and the function list must not contain it |
| R4 | Tests pass but do not catch a regression in the Lua scripts M2 will rewrite | MEDIUM | Mutation drill in T4 (three mutations, ≥ 2 failing tests each); race tests run ×3 |
| R5 | RESP shim differs from Upstash REST result typing (for example integer vs string) and hides a real incompatibility | MEDIUM | Shim self-test T2 pins the mapping (integers as numbers, bulk as strings, nil as null, nested arrays); real Upstash behaviour is re-checked once against Preview in M5 launch checklist |
| R6 | Handler behaviour drifts during the `error()` swap | MEDIUM | T5 pins statuses and exact strings before the swap; T6 diff limited to ≤ 14 non-import lines; strings pinned in `http.test.ts` |
| R7 | Skipped Redis tests give false confidence | MEDIUM | Loud `SKIPPED` banner with the start command; `REDIS_TEST_REQUIRED=1` fails instead of skipping; T12 runs the suite with Redis up three times |
| R8 | Name URL filter rejects a real attendee (for example `Jean.Dupont`) | LOW | Block-list limited to scheme/`www.`/`@`/common TLD words; list is a constant covered by table tests so M3 can tune it |
| R9 | Signed-link comparison or purpose-reuse bug | MEDIUM | `timingSafeEqual` after length check, purpose in MAC input and payload, tamper matrix in T9, static greps in T12 |

## Stop Conditions

> On encountering any condition below, halt and report (AskUserQuestion in interactive mode, structured "halted" status in headless mode) rather than improvising.

1. **Scope drift**: if making a test pass requires editing `api/_lib/redis.ts`, `email.ts`, `availability.ts`, `reservations.ts` or any `src/` file, halt and report. M1 does not change them.
2. **Shared Redis**: if `REDIS_TEST_URL` resolves to port 6379, the container name `sslcert-infra-redis-1`, or DB 15 holds foreign keys, halt; never FLUSH anything to "make the tests run".
3. **Vercel/tsconfig**: if neither `node16/node16` nor `ignoreDeprecations: "6.0"` makes `typecheck:api` exit 0 and emit CommonJS, halt and report instead of loosening `strict` or excluding files.
4. **Characterization disagrees with the code**: if a T4 expectation contradicts what `redis.ts` actually returns, pin the actual behaviour and note it; do not change `redis.ts`. If the actual behaviour looks like a bug, record it in the commit body for M2 and continue.
5. **Behaviour drift in handlers**: if any T5 test fails after T6, revert T6 and report; do not edit T5 expectations to match.
6. **Docker unavailable**: if the Redis container cannot start, complete everything that does not need Redis, report the Redis-gated tests as unverified, and do not return the milestone as done.

## Agent-Asset Ripple

| Asset file | Type of update | Why |
|---|---|---|
| `CLAUDE.md` Commands | add `test:api`, `typecheck:api`, `test:api:redis` | new commands; deferred to M5 (single docs pass) |
| `ARCHITECTURE.md` | add `api/` and test layout | deferred to M5; M1 adds no ADR and no `INDEX.md` row |

V-ASSET-03 note: no rule/agent assets are renamed or removed in M1; the two rows above are recorded here so M5 does not miss them.

## Sprint Contract

### Machine-verifiable
- [ ] `pnpm run typecheck:api` exits 0 with empty output.
- [ ] `pnpm exec tsc -p tsconfig.json --noEmit` result identical to the pre-M1 result (CRA side untouched).
- [ ] `pnpm run test:api:redis` starts the container; `pnpm run test:api` exits 0 with 0 failed, 0 skipped; totals at least 18 (redis-scripts) + 11 (handlers-smoke) + 5 (http) + 28 (guard) + 20 (link) + shim self-tests; identical on three consecutive runs.
- [ ] With the container stopped, `pnpm run test:api` exits 0, prints `SKIPPED`, still runs the unit and smoke suites; with `REDIS_TEST_REQUIRED=1` it exits 1.
- [ ] Mutation drill from T4 fails the expected tests and the tree is clean afterwards (`git diff -- api/_lib/redis.ts` empty).
- [ ] `git diff 81bb033..HEAD --stat` lists exactly the Critical Files modified/new and nothing else; `git diff 81bb033..HEAD -- api/_lib/redis.ts api/_lib/email.ts api/availability.ts api/reservations.ts src` is empty.
- [ ] `git grep -n "function error" -- api` returns only `api/_lib/http.ts`; `git grep -nE "TODO|Co-Authored-By" -- api scripts documentation/runbooks` is empty; `git log 81bb033..HEAD --format=%B | grep -ci "co-authored-by"` prints `0`.
- [ ] `git diff 81bb033..HEAD -- package.json` contains only `scripts` additions (no dependency change); `pnpm-lock.yaml` unchanged.
- [ ] Static checks from T8 and T10 hold (purity of `guard.ts`, `timingSafeEqual` present, no `console.*` in `link.ts`).

### Human-verifiable
- [ ] The `SKIPPED` banner and the runbook make the next step obvious to someone who has never run the tests (read once, start container, run).
- [ ] The characterization test names read as a specification of the current Lua behaviour that M2 can diff against.
- [ ] The French messages in `guard.ts` read naturally and match the current handler wording.

## Execution Strategy

**Pattern**: Mixed. Strictly sequential until the runner exists, then bounded parallelism on disjoint files (≤ 3 agents per phase; sequence follows ADR-002 order and TDD: tests are written by x-tester before the implementation they cover).

| Agent | Task(s) | Model | Delegation Contract |
|-------|---------|-------|---------------------|
| general-purpose | T1 | sonnet | **Objective**: fix TS5107 in `api/tsconfig.json` and add `typecheck:api`. **Output format**: diff summary plus quoted `tsc` outputs (typecheck, emit module format, root tsconfig). **Scope**: `api/tsconfig.json`, `package.json` scripts only. **Tool guidance**: Edit, Bash for `pnpm exec tsc`; try `node16/node16` first, fall back per the Decision Record. **Stop condition**: `pnpm run typecheck:api` exits 0 and emit is CJS, or Stop Condition 3 reached. |
| general-purpose | T2 | sonnet | **Objective**: build `scripts/test-api.mjs`, the RESP-over-fetch shim, helpers and package scripts with the safety rails. **Output format**: files plus the quoted outputs of the T2 acceptance runs. **Scope**: `scripts/`, `api/__tests__/helpers/`, `package.json` scripts; no production code. **Tool guidance**: Write/Edit; Bash for `docker run` of `redis:7-alpine` on 127.0.0.1:6390 only; never contact port 6379. **Stop condition**: T2 acceptance met, container left running for later phases. |
| general-purpose | T3, T6, T8, T10 | sonnet | **Objective**: T3 skeletons and `http.ts`; T6 helper swap; T8 `guard.ts`; T10 `link.ts`, each only after its red tests exist. **Output format**: changed files, green test output quoted. **Scope**: `api/_lib/{http,guard,link}.ts`, `api/reserve.ts`, `api/reservation.ts` (helper swap only); never edit test files written by x-tester and never `redis.ts`. **Tool guidance**: Edit, Bash `pnpm run test:api` and `typecheck:api`; no TODO comments, relative imports, strict TS, no new dependencies. **Stop condition**: the task's acceptance criteria pass and `pnpm run typecheck:api` is 0; or a Stop Condition is hit. |
| x-tester | T4, T5, T7, T9, T6 (`http.test.ts`) | sonnet | **Objective**: write the characterization, smoke, http, guard and link tests first and run them red/green as specified, plus the mutation drill. **Output format**: test files and a table of pass/fail counts per file with quoted runner output. **Scope**: `api/__tests__/*.test.ts` only; production code read-only (revert any mutation exactly with a targeted Edit, never `git checkout --`/`restore`/`stash`). **Tool guidance**: node:test + node:assert/strict, Bash `pnpm run test:api`. **Stop condition**: every test listed in the task exists, results match the acceptance, mutation drill restored. |
| x-doc-writer | T11 | sonnet | **Objective**: write `documentation/runbooks/api-tests.md`. **Output format**: one Markdown file with lifecycle frontmatter, ≤ 120 lines. **Scope**: that single file; do not edit `CLAUDE.md`, `ARCHITECTURE.md` or any index. **Tool guidance**: Read the runner and helpers; copy commands exactly. **Stop condition**: file written and every command cross-checked against `package.json`. |
| x-tester | T12 | sonnet | **Objective**: run the final verification gate and produce the enforcement summary. **Output format**: IDENTIFY/RUN/READ/VERIFY/CLAIM per Sprint Contract item with quoted output. **Scope**: read-only plus running the commands in the contract; stops the test container at the end. **Tool guidance**: Bash, Grep. **Stop condition**: all Sprint Contract machine items evaluated. |

**Parallelization**:
- P1: T1. P2: T2 (after T1; container started here).
- P3 (3 agents, disjoint files): T3 (general-purpose) ‖ T4 (x-tester) ‖ T5 (x-tester).
- P4 (3 agents): T6 swap (general-purpose; needs T3 and green T5) ‖ T7 + `http.test.ts` (x-tester) ‖ T9 (x-tester).
- P5 (2 agents): T8 ‖ T10 (general-purpose, independent files; both serialize on one agent if the runtime caps parallelism).
- P6: T11 (x-doc-writer) then T12 (x-tester).
- Suggested commits, one per phase boundary, format `{type}({scope}): {description}` with no attribution lines: `build(api): fix tsconfig and add typecheck script`, `test(api): add runner and Redis REST shim`, `test(api): characterize Lua reservation scripts and handler errors`, `refactor(api): share error helper via http.ts`, `feat(api): add guard module`, `feat(api): add signed confirm link module`, `docs(api): add API test runbook`.

## Plan Quality Gate (self-check, 8 checks)

- [x] 1 Task acceptance criteria: 12/12 tasks carry measurable criteria with commands.
- [x] 2 Critical file existence: files marked "Modify"/"Read-only" exist (`package.json`, `api/tsconfig.json`, `api/reserve.ts`, `api/reservation.ts`, `api/_lib/redis.ts`, `src/config/shows.ts`); the rest are "New".
- [x] 3 Dependencies: every task lists `depends on`; order T1 to T12 acyclic.
- [x] 4 Risk concreteness: every mitigation names a concrete control or test.
- [x] 5 Success criteria: Sprint Contract items are commands or file-state checks.
- [x] 6 Boundary conditions: dedicated section plus per-task cases.
- [x] 7 Stop conditions: present (HIGH risks R1, R2 exist).
- [x] 8 Codebase Conventions and Blast Radius: both sections present; safety fact backed by executed commands (delegated run, quoted above).
- Performance Budget: omitted by design (no prior audit baseline in discovery.md; the `<=2 Redis commands per availability call` target belongs to M3).
- Executable by the sonnet agents above; owner-ruling ledger `documentation/reference/product-principles.md` absent (not a plan-time HIGH); `ARCHITECTURE.md` exists (V-ADA-01 satisfied).
