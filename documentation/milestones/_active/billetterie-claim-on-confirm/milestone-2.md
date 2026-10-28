---
type: plan
status: current
review_trigger: "on milestone completion"
created: 2026-10-27
last_updated: 2026-10-27
related: [documentation/decisions/ADR-002-billetterie-claim-on-confirm.md, documentation/milestones/_active/billetterie-claim-on-confirm/README.md, documentation/milestones/_active/billetterie-claim-on-confirm/discovery.md, documentation/milestones/_active/billetterie-claim-on-confirm/outcomes.md, documentation/milestones/_active/billetterie-claim-on-confirm/milestone-1.md]
plan_base_commit: 7ecd0e889cdc8d17fdd0c704b8ddb3bf560655a1
track: enterprise
mode: milestone-batch
milestone: M2
initiative: billetterie-claim-on-confirm
---

# M2 Plan: Redis lifecycle and send quota

Initiative `billetterie-claim-on-confirm`, branch `initiative/billetterie-claim-on-confirm`, base `7ecd0e8`. Source: ADR-002 § Implementation Order steps 3-4 (data layer and `quota.ts` only), outcome log M1 "Constraint hit".

## Objective

Move the data layer to the claim model: `claimAtomic` and a reworked `releaseAtomic` in `api/_lib/redis.ts`, the send-quota module `api/_lib/quota.ts`, and the five M1 carry-over defects fixed **before** anything is wired. Remove the pending list, the confirm script and the sweep.

M2 is **not deployable** (README). HTTP handlers are touched only as far as needed to keep `api/` compiling and the suite green (Decision D6); M3 owns the real flow. Order is fixed by risk: carry-over defects and shim safety first, handler behaviour pinned before the data-layer swap, tests red before each Lua script, mutation drill last.

Out of scope: `link.ts` / `guard.ts` wiring, Turnstile, `email.ts` rewrite, `reserve.ts` real flow, `availability.ts` cache/`open` flag, `reservations.ts` hardening, any `src/components` change (all M3-M4), docs other than the runbook (M5).

## Decision Record

| # | Decision | Easy path | Hard path | Choice | Rationale | Confidence |
|---|---|---|---|---|---|---|
| D1 | `canonicalEmail('+a@x.com')` returned `''` (shared quota/cap key) | Reject such addresses in `validateReserveFields` only | Make `canonicalEmail` total: when stripping `+tag` empties the local part, fall back to the full normalized address; plus data-layer refusal of an empty key | Fallback + data-layer refusal | The key can never be shared by unrelated people, whatever the caller forgets. `+a@x.com` and `+b@x.com` stay distinct keys; neither is a deliverable mailbox on mainstream providers, so no abuse gain. Returns `''` only for input without `@` or domain (not an email). `claimAtomic` and `checkSendQuota` throw / refuse on `''` | High |
| D2 | Show-start boundary: guard `now >= start` vs handler `Date.now() > start` | Keep both | One rule: reservations are **closed at the instant the show starts** (`now >= start`) | `>=`, in `reserve.ts` too | Same inclusive convention as `link.ts` expiry (`now >= exp`) and fail-closed. `guard.test.ts` already pins it (`START` closed, `START - 1` open). `reserve.ts:32` changes `>` to `>=` now so no window exists between M2 and M3 | High |
| D3 | `http.ts json()` has no consumer | Keep for M3 | Remove | Remove | One-line alias of `Response.json`; V-YAGNI. `git grep -n "json(" -- api ':!api/__tests__'` shows no import. M3 uses `Response.json` directly | High |
| D4 | What `releaseAtomic` leaves behind | `DEL` (today) | Keep the record as `status: 'cancelled'` + `cancelledAt`, `LREM` from the show list, write `tombstone:<id>`, both with `EXPIREAT` | Keep record + tombstone | The record gives idempotent cancel and an honest "already cancelled" page; the tombstone (no PII) outlives a manual record deletion. The show list holds live (confirmed) reservations only, so the door CSV needs no filter. A plain `SET` clears a TTL (Probe B), so `release` re-applies `EXPIREAT` | High |
| D5 | Domain accounting | Count only non-major domains | Always count seats per domain in `show:<id>:domains`; enforce only when `maxPerDomain > 0` | Always count | Release can decrement unconditionally (no negative counters if the major-provider list is tuned between claim and release); gives the organizer visibility | Medium |
| D6 | How callers compile after the exports disappear | Rewrite handlers (M3 work) | Smallest edit per caller; `reserve.ts` refuses every valid request with the existing 503 `ERR.UNAVAILABLE` (fail closed) until M3; `reservation.ts` confirm becomes an idempotent no-op on an existing record | Smallest edit (table in Blast Radius) | Keeps M2 reviewable, never fakes a flow, and fails closed if someone deploys by mistake. This is the one bounded exception to "no partial features": milestone is flagged non-deployable, the comment states the state of the code and carries no marker word | Medium |
| D7 | Quota atomicity | `SET NX` then `INCR`, compensate on budget refusal | One Lua script: check cooldown, check budget, then set cooldown and count | One `EVAL` | A refused request never leaves a cooldown behind (no lock-out for an email never sent); 1 command per call. Day = **UTC** day (Resend resets at 00:00 UTC; assumption, M5 checklist) | High |
| D8 | Where limits live | New `api/_lib/limits.ts` | Extend `src/config/shows.ts` (already holds `MAX_TICKETS_PER_EMAIL`, 7 importers) | `shows.ts` limits block | ADR-002 DRY: "limits live in one config block". Shared with the frontend, none is secret. File already in `api/tsconfig.json` `include` | High |
| D9 | Refusal precedence in `claimAtomic` | Capacity first | blocked (tombstone/cancelled) > already-confirmed > email cap > domain cap > capacity | Keep M1's "email before capacity" and insert domain between | Preserves the pinned M1 precedence; an already-confirmed id never consumes or re-checks capacity (a full show still answers "already confirmed") | Medium |
| D10 | `EXPIREAT` in the past silently deletes the key (Probe A) | Trust the caller | `claimAtomic` returns `closed` without any Redis call when `expireAt <= now()` | Pre-check in TypeScript | Otherwise counters would be incremented and the record deleted in the same script (phantom seats). The real "show started" rule stays in the M3 handler | High |
| D11 | Time-bomb tests (real shows are in 2027, Redis uses the real clock) | Use real show dates for `EXPIREAT` | Tests use synthetic far-future values (`4102444800` = 2100-01-01 UTC; injected clocks in 2030+) and assert with `EXPIRETIME`; only pure helper tests use real shows | Synthetic | A suite that fails on 2027-02-21 is a defect. A past `EXPIREAT` would delete counters mid-test | High |
| D12 | Shim only inspects the first token | Accept | Also reject `EVAL`/`EVALSHA` bodies naming a forbidden command | Reject by body | `redis.call('FLUSHALL')` inside a script bypasses the first-token check today (found while reading `redis-rest-shim.ts:135-139`) | Medium |

## Task Breakdown

Notation: `depends on` lists task ids. Baseline at `7ecd0e8` (executed 2026-10-27): `typecheck:api` exit 0; `test:api` 184 pass, 0 fail, 0 skipped, 25 suites, Redis 7.4.11.

### T1: Shim safety tests and rails
depends on: none. Owner x-tester (test helper edits are in scope).
- `api/__tests__/helpers/redis-rest-shim.ts`: export `checkDatabase(target)` (the uncached marker check `ensureTestDatabase` wraps) and make `runCommand` reject `EVAL`/`EVALSHA` whose body matches `/\b(flushall|config|shutdown|slaveof|replicaof|migrate|select)\b/i` with the same "not allowed in the test shim" error (D12). No other behaviour change.
- Add to `api/__tests__/redis-rest-shim.test.ts` (≥ 9 new tests):
  1. Forbidden commands `FLUSHALL`, `SELECT`, `CONFIG`, `SHUTDOWN`, `SLAVEOF`, `REPLICAOF`, `MIGRATE`, in lower case too, reject through `redis()` with `/not allowed in the test shim/` (table of 7 + 1 lower-case). Runs **without Redis** because the check precedes any connection.
  2. `EVAL "return redis.call('FLUSHALL')" 0` and an `EVALSHA` form are rejected; a benign `EVAL "return 1" 0` still passes (Redis-gated).
  3. Foreign host: after `installRedisShim`, `fetch('https://api.resend.com/emails')` rejects with `/Network access is disabled in tests/`; `globalThis.fetch` is restored in `afterEach`. Runs without Redis.
  4. Marker refusal (Redis-gated): `FLUSHDB`, `DEL __fifty_min_test_db__`, `SET foreign 1`, then `checkDatabase(target)` rejects `/Refusing to flush a non-test database/`; `finally` restores marker and `FLUSHDB`.
  5. `checkDatabase` accepts an empty DB and a DB that holds the marker.
- Acceptance: ≥ 9 new tests green with Redis up; the rail tests (1, 3) also pass with the container stopped (`pnpm run test:api` prints SKIPPED but these still run); mutation: deleting `FORBIDDEN` entry `FLUSHALL` fails ≥ 1 test; removing the `marker !== 1` condition fails the marker test; `git diff --stat` shows only the two files above.

### T2: Limits block in `src/config/shows.ts`
depends on: none. Tests first (x-tester `api/__tests__/limits.test.ts`, ≥ 6 pure tests), then general-purpose edits `shows.ts`.
- Add, in one delimited block "Reservation limits (server enforced)": `MAX_TICKETS_PER_DOMAIN = 12`, `MAJOR_EMAIL_DOMAINS: readonly string[]` (lower-case: gmail.com, googlemail.com, outlook.com, outlook.fr, hotmail.com, hotmail.fr, live.com, live.fr, msn.com, yahoo.com, yahoo.fr, icloud.com, me.com, proton.me, protonmail.com, protonmail.ch, bluewin.ch, gmx.ch, gmx.com, gmx.net, hispeed.ch, sunrise.ch, orange.fr, free.fr, sfr.fr, laposte.net, wanadoo.fr), `SEND_COOLDOWN_SECONDS = 600`, `DAILY_REQUEST_EMAIL_BUDGET = 60`, `RECORD_RETENTION_DAYS = 30`, `retentionExpiry(show: Show): number` (epoch **seconds** = `floor(showStart(show)/1000) + RECORD_RETENTION_DAYS * 86400`), `domainSeatCap(domain: string): number` (0 for a major domain, case-insensitive; `MAX_TICKETS_PER_DOMAIN` otherwise). `MAX_TICKETS_PER_EMAIL`, `CONFIRMATION_DELAY_HOURS` and the pre-existing comment at the capacity line stay untouched.
- Tests: `retentionExpiry` of `2027-02-20-monique` equals `Date.UTC(2027, 1, 20, 18, 0, 0) / 1000 + 30 * 86400` (computed in the test, 19:00 CET = 18:00 UTC); is an integer; `domainSeatCap('GMAIL.com') === 0`, `('example.ch') === 12`, `('') === 12`; every `MAJOR_EMAIL_DOMAINS` entry is lower-case, unique and contains no `@`; constants equal 12 / 600 / 60 / 30.
- Acceptance: `pnpm run typecheck:api` exits 0; `git diff -- src/config/shows.ts` only adds lines (no deletion); `pnpm exec tsc -p tsconfig.json --noEmit` result identical to the pre-M2 result; `git diff -U0 7ecd0e8..HEAD -- src | grep -c '^+.*TODO'` prints `0`.

### T3: M1 carry-over defects in `guard.ts` and `http.ts`
depends on: none. Tests first (x-tester edits `guard.test.ts`, `http.test.ts`; red), then general-purpose edits the two modules.
- `canonicalEmail` (D1): after `+tag` stripping, if the local part is empty use the full normalized (trimmed, lower-cased) address; Gmail dot/alias rules still apply to a non-empty local part. Returns `''` only when the input has no `@` or an empty domain.
- `validateName`: extend `CONTROL_CHARS` with `​-‏`, `‪-‮`, `⁦-⁩`, `﻿`. Remove `json` from `http.ts` (D3).
- Test changes to existing cases, listed: `guard.test.ts` `['+x@example.ch', '']` becomes `['+x@example.ch', '+x@example.ch']`; `http.test.ts` loses the `json` import and the `json sets the JSON content type` test.
- New tests (≥ 14): name rejects (table) U+200B, U+200C, U+200D, U+200E, U+200F, U+202A, U+202B, U+202C, U+202D, U+202E, U+2066, U+2067, U+2068, U+2069, U+FEFF **inside** the name (`Je${c}an`), and a leading U+200B (not trimmed by `String.prototype.trim`); accepts the neighbours U+200A (hair space), U+2010 (hyphen), U+202F, U+206A; a leading/trailing U+FEFF is removed by `trim()` and accepted as the clean name (documented behaviour); `canonicalEmail('+a@x.com') === '+a@x.com'`, `('+a+b@x.com') === '+a+b@x.com'`, `('+a@gmail.com') === '+a@gmail.com'`, `('+a@x.com') !== ('+b@x.com')`, `('@x.com')` is `''`, `('a@')` is `''`; `validateReserveFields` with email `+a@x.com` returns `ok: true` with a non-empty `canonicalEmail`.
- Acceptance: all `guard`/`http` suites green; `git grep -nE "export function json|\bjson\(" -- api ':!api/__tests__'` is empty; `git grep -nE "redis|fetch\(" api/_lib/guard.ts` still empty (purity); mutation: reverting the new character class fails ≥ 15 tests; reverting the fallback fails ≥ 3.

### T4: Handler smoke tests, red first
depends on: none (runs before T5). Owner x-tester, file `api/__tests__/handlers-smoke.test.ts` (additions only, no existing test edited).
- `reserve` closes at the exact start: `mock.method(Date, 'now', () => showStart)` gives 400 `Les réservations pour cette date sont closes` (red today: `>`).
- `reserve` one millisecond before start is **not** rejected as closed: the body is a valid request, the status is 503 `Service indisponible, merci de réessayer plus tard`, and a counting `globalThis.fetch` replacement records **0 calls** (no Redis, no Resend). Red today (handler calls `releaseExpired`).
- `reservation` POST `confirm` and `cancel` with a well-formed id and token still reach Redis today; out of scope here (needs Redis). Covered in T7.
- Acceptance: the two new tests fail on the unchanged handlers for the stated reasons, then pass after T5; the 13 existing tests in the file stay green and unedited.

### T5: Data-layer skeleton and caller compile bridge
depends on: T2, T4. Owner general-purpose. Goal: `api/` compiles with the new surface, every old export gone, bodies of the new functions `throw new Error('not implemented')`.
- `api/_lib/redis.ts`: new `ReservationRecord` (`id, showId, name, email, canonicalEmail, domain, quantity, createdAt, status: 'confirmed' | 'cancelled', confirmedAt, cancelledAt?, token`; `expiresAt` removed); `keys` gains `perDomain` and `tombstone`, loses `pending`; exported signatures below (stub bodies); `confirmAtomic`, `reserveAtomic`, `releaseExpired`, `CONFIRM_SCRIPT`, `RESERVE_SCRIPT` deleted; `redis()` and `getReservation` unchanged.
- Callers (exact edits; anything beyond this list is Stop Condition 1):

| File | Edit |
|---|---|
| `api/availability.ts` | delete `releaseExpired` import and its call (1 line each); response unchanged |
| `api/reservations.ts` | delete `releaseExpired` import and call; CSV code untouched (status label `en attente` becomes unreachable, M3 renames) |
| `api/reserve.ts` | `Date.now() > start` becomes `>=` (D2); after the validations, `return error(ERR.UNAVAILABLE, 503)` replaces record creation, `releaseExpired`, `reserveAtomic`, email and success response; remove `newReservationId`, `CONFIRMATION_DELAY_HOURS`, `getVenue`, redis/email imports; validation lines untouched |
| `api/reservation.ts` | `findReservation`: drop the pending-expiry branch and its `releaseAtomic` call; GET: drop `expiresAt` from the destructuring and response; POST confirm: `record.status === 'confirmed'` returns `{ok:true,status:'confirmed'}`, any other status returns `error(ERR.NOT_FOUND, 404)` (no `confirmAtomic`); POST cancel: `releaseAtomic(raw, record, retentionExpiry(show))`, `'not-found'` gives `error(ERR.NOT_FOUND, 404)`, `'released'` sends the cancellation email as today, `'already-cancelled'` skips the email; all three answer `{ok:true,status:'cancelled'}` except not-found |
| `api/_lib/email.ts` | delete `sendConfirmationRequest` and `formatDateTime` (dead, referenced `record.expiresAt`; M3 re-adds with a signed link and the shared `src/lib` formatter); `sendConfirmed` and `sendCancellation` untouched |

- Exported surface (contract the tests use):

```ts
export interface ClaimInput { id: string; showId: string; name: string; email: string; canonicalEmail: string; quantity: number; capacity: number; maxPerEmail: number; maxPerDomain: number /* 0 = not enforced */; expireAt: number /* epoch s */ }
export type ClaimResult =
  | { status: 'claimed'; record: ReservationRecord; remaining: number }
  | { status: 'already-confirmed'; record: ReservationRecord }
  | { status: 'blocked' }                       // tombstone, cancelled record or unknown status
  | { status: 'email-limit' | 'domain-limit' | 'full'; remaining: number }
  | { status: 'closed' };                       // expireAt <= now(), nothing written
export function claimAtomic(input: ClaimInput, deps?: { now?: () => number; token?: () => string }): Promise<ClaimResult>;
export type ReleaseResult = 'released' | 'already-cancelled' | 'not-found';
export function releaseAtomic(raw: string, record: ReservationRecord, expireAt: number, deps?: { now?: () => number }): Promise<ReleaseResult>;
```

- Acceptance: `pnpm run typecheck:api` exits 0; `pnpm run test:api` compiles (the old Lua tests are replaced in T6, until then T6's red state is the only failure); `git grep -nE "confirmAtomic|reserveAtomic|releaseExpired|keys\.pending|CONFIRM_SCRIPT|RESERVE_SCRIPT" -- api ':!api/__tests__/redis-scripts.test.ts'` is empty; the two T4 tests are green; the 13 old smoke tests are green; `git diff --stat` touches exactly the five caller files, `redis.ts`, plus `redis-scripts.test.ts` neutralised by T6 (see T6).

### T6: `claimAtomic` / `releaseAtomic` tests (red)
depends on: T1, T5. Owner x-tester. Replaces `api/__tests__/redis-scripts.test.ts` and adds `api/__tests__/redis-lifecycle.test.ts`. Defaults for every test: `capacity 100, maxPerEmail 4, maxPerDomain 0, expireAt 4102444800`, injected `now`/`token`, `beforeEach` FLUSHDB, `describe` skipped via `redisSkipReason`, fetch call counting by wrapping `globalThis.fetch`.

**Forced changes to M1 characterization tests (each listed):**
1. `reserveAtomic` suite (12 tests) deleted; each behaviour re-expressed on `claimAtomic` (C1-C6, C8, C15-C17). The two weakness pins are **inverted**: "case-differing addresses count separately" becomes C7 (aliases share one counter); "re-reserving the same id double-counts" becomes C12 (idempotent).
2. `confirmAtomic` suite (3 tests) deleted with the function.
3. `releaseAtomic` suite (4 tests) rewritten as R1-R12 (DEL becomes status `cancelled`; second call `false` becomes `'already-cancelled'`).
4. `getReservation` suite kept (2 tests); setup uses `claimAtomic`; the second test also asserts `status: 'cancelled'` after a release.
5. Import line updated; `EXPIRES`, `pending` assertions removed.

`redis-scripts.test.ts` (≥ 26 tests):
- C1 claimed: record has `status confirmed`, `confirmedAt === createdAt ===` injected iso, 32-hex `token`, stored `canonicalEmail` and `domain`; `remaining = capacity - qty`; `GET booked`, `HGET emails <canonical>`, `HGET domains <domain>`, `LRANGE` = [id]; stored JSON equals `JSON.stringify(result.record)`.
- C2 over capacity returns `full` with `remaining`, no `reservation:<id>` key, counters and list unchanged. C3 exact fill then `full` with 0. C4 email cap returns remaining allowance; C5 zero allowance; C6 cap is per show.
- C7 alias sharing: `canonicalEmail()` of `A.B+x@Gmail.com` (qty 2), `ab@googlemail.com` (qty 2), `a.b+y@gmail.com` (qty 1) uses one counter, third is `email-limit`; `+a@x.com` and `+b@x.com` keep separate counters; `canonicalEmail: ''` and `'noat'` throw before any fetch.
- C8 precedence: email cap beats domain cap beats capacity (three scenarios).
- C9 domain cap (`maxPerDomain 12`): users 4+4+4 from `corp.example` fill it, next is `domain-limit` with `remaining 0`; with `maxPerDomain 0` twenty gmail users all claim. C10 domain cap per show. C11 domain seats counted even when not enforced.
- C12 re-claim of an existing id returns `already-confirmed` with the **same** record and token, booked, hashes and list length unchanged. C13 five concurrent claims of one id: exactly 1 `claimed`, 4 `already-confirmed`, booked = qty. C14 on a full show an existing id is still `already-confirmed`.
- C15 last seat (cap 10, 9 booked, two concurrent distinct ids): one `claimed`, one `full`, booked 10. C16 cap 5, 20 concurrent: 5 claimed, 15 full, `LLEN` 5. C17 same canonical email, 10 concurrent: 4 claimed. C18 non-major domain cap 12, 20 concurrent distinct emails: exactly 12 claimed.
- C19 `closed`: `expireAt <= now()` returns `closed`, **0 fetch calls**, no key exists. C20 `token` generator injected: two claims give different tokens, default generator yields 32 hex.
- C21 single round trip: for claimed, already-confirmed, full, email-limit, domain-limit, blocked the counting fetch sees **exactly 1** call.
- `getReservation`: 2 kept tests (see above).

`redis-lifecycle.test.ts` (≥ 18 tests):
- R1 `releaseAtomic` success: `'released'`; stored record is `{...record, status:'cancelled', cancelledAt}` with the same `token`; booked decremented by qty; canonical-email and domain hash fields back to `'0'`; id removed from the list; `tombstone:<id>` exists; `EXPIRETIME` of record **and** tombstone equals `expireAt` (proves the re-applied `EXPIREAT`, Probe B).
- R2 stale `raw` on a confirmed record: `'not-found'`, no counter change, no tombstone. R3 missing record: `'not-found'`, no tombstone written.
- R4 second release: `'already-cancelled'`, counters decremented once (two other confirmed records keep their counts). R5 five concurrent releases: 1 `'released'`, 4 `'already-cancelled'`, booked correct.
- R6 counter integrity: claim qty 1, 2, 3, release the middle: booked 4, hashes correct, list order `[first, third]`. R7 releasing everything in a shuffled order leaves booked `'0'` and never a negative value. R8 a cancel in show A leaves show B counters untouched. R9 freed seats are claimable again and a freed per-email / per-domain allowance is usable again.
- R10 replay after cancel: `claimAtomic` with the same id returns `blocked`, booked unchanged. R11 tombstone alone (record `DEL`eted) blocks. R12 cancelled record alone (tombstone `DEL`eted) blocks. R13 a record with an unknown status (`pending` JSON written by the test) is `blocked` and not overwritten.
- R14 `EXPIRETIME` of record, booked, emails, domains and list all equal `expireAt` after a claim; the tombstone is absent after a claim.
- R15 single round trip for `released`, `already-cancelled`, `not-found`: exactly 1 fetch each.
- R16 invariant test, seeded LCG (seed constant in the file), 300 random claim / release operations over 3 shows: at the end, per show, `booked` = sum of quantities of confirmed records = sum of the email hash = sum of the domain hash = sum of quantities of the records in the list; no hash value is negative.
- Acceptance: `pnpm run test:api` shows the new tests **red for the right reason** (`not implemented`), not as compile errors; names read as a specification; counts per file as above (≥ 26 and ≥ 18).

### T7: Implement `claimAtomic` and `releaseAtomic`
depends on: T6. Owner general-purpose. Scripts below are the contract (variable names free; behaviour and return codes fixed). Probes: `cjson.decode` works in `EVAL`; `SET NX EX` then `TTL` returns 600 (Redis 7.4.11).

```lua
-- CLAIM  KEYS: reservation, tombstone, booked, perEmail, perDomain, list
--        ARGV: qty, capacity, maxPerEmail, maxPerDomain, canonical, domain, recordJson, id, expireAt
if redis.call('EXISTS', KEYS[2]) == 1 then return {-3, ''} end
local existing = redis.call('GET', KEYS[1])
if existing then
  if cjson.decode(existing).status == 'confirmed' then return {2, existing} end
  return {-3, ''}
end
local qty = tonumber(ARGV[1])
local booked = tonumber(redis.call('GET', KEYS[3]) or '0')
local mine = tonumber(redis.call('HGET', KEYS[4], ARGV[5]) or '0')
if mine + qty > tonumber(ARGV[3]) then return {-1, tonumber(ARGV[3]) - mine} end
local cap = tonumber(ARGV[4])
if cap > 0 then
  local theirs = tonumber(redis.call('HGET', KEYS[5], ARGV[6]) or '0')
  if theirs + qty > cap then return {-4, cap - theirs} end
end
if booked + qty > tonumber(ARGV[2]) then return {-2, tonumber(ARGV[2]) - booked} end
redis.call('INCRBY', KEYS[3], qty)
redis.call('HINCRBY', KEYS[4], ARGV[5], qty)
redis.call('HINCRBY', KEYS[5], ARGV[6], qty)
redis.call('RPUSH', KEYS[6], ARGV[8])
redis.call('SET', KEYS[1], ARGV[7])
for _, i in ipairs({1, 3, 4, 5, 6}) do redis.call('EXPIREAT', KEYS[i], ARGV[9]) end
return {1, tonumber(ARGV[2]) - booked - qty}

-- RELEASE  KEYS: reservation, tombstone, booked, perEmail, perDomain, list
--          ARGV: rawExpected, cancelledJson, qty, canonical, domain, id, expireAt
local cur = redis.call('GET', KEYS[1])
if not cur then return 0 end
if cjson.decode(cur).status == 'cancelled' then return 2 end
if cur ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2]);  redis.call('EXPIREAT', KEYS[1], ARGV[7])
redis.call('SET', KEYS[2], '1');      redis.call('EXPIREAT', KEYS[2], ARGV[7])
redis.call('DECRBY', KEYS[3], tonumber(ARGV[3]))
redis.call('HINCRBY', KEYS[4], ARGV[4], -tonumber(ARGV[3]))
redis.call('HINCRBY', KEYS[5], ARGV[5], -tonumber(ARGV[3]))
redis.call('LREM', KEYS[6], 0, ARGV[6])
return 1
```

- TypeScript side: validate `canonicalEmail` (contains `@`, non-empty local and domain), `quantity` integer ≥ 1 and `expireAt` integer **before** any Redis call; `domain` = part after the last `@` of `canonicalEmail`; `closed` check (D10); token via `crypto.randomBytes(16).toString('hex')` unless injected; `createdAt = confirmedAt = new Date(now()).toISOString()`; on code `2` parse the returned string into `record`. `releaseAtomic` builds the cancelled record from the passed record (`cancelledAt` from `now`), uses `record.canonicalEmail` and `record.domain` for the counters (never recomputed).
- Acceptance: all T6 tests green (≥ 44), 0 failing, 0 skipped, identical on 3 consecutive runs (race tests); `git grep -nE "Math.random|console\." api/_lib/redis.ts` empty; no email address appears in any thrown message (test: error message of an invalid claim does not contain the email); `pnpm run typecheck:api` exits 0.

### T8: `quota.ts` skeleton
depends on: T2. Owner general-purpose. `api/_lib/quota.ts` with exports below, bodies `throw new Error('not implemented')`; constants `QUOTA_MESSAGES` exported with the final French strings.

```ts
export type SendKind = 'request' | 'recap' | 'cancellation';
export interface QuotaDeps { now?: () => number; cooldownSeconds?: number; requestBudget?: number }
export type QuotaResult =
  | { ok: true; used: number }
  | { ok: false; reason: 'cooldown' | 'budget' | 'unavailable' | 'invalid'; message: string; retryAfterSeconds?: number };
export function checkSendQuota(kind: SendKind, canonicalEmail: string, deps?: QuotaDeps): Promise<QuotaResult>;
export const QUOTA_MESSAGES: { cooldown: string; budget: string; invalid: string };
```
Messages: cooldown `Un email vous a déjà été envoyé. Patientez quelques minutes avant de refaire une demande et vérifiez vos courriers indésirables.`; budget `Le service d’envoi d’emails est saturé pour aujourd’hui. Merci de réessayer demain.`; invalid `Adresse email invalide`; unavailable reuses `ERR.UNAVAILABLE`.
- Acceptance: `pnpm run typecheck:api` exits 0; `git grep -n "not implemented" -- api/_lib` lists only `quota.ts`.

### T9: `quota.ts` tests (red)
depends on: T8. Owner x-tester, `api/__tests__/quota.test.ts`, ≥ 18 tests. Clock injected in 2030+ (D11); `beforeEach` FLUSHDB; fetch counter.
- Q1 first request: `ok`, `used 1`; cooldown key `TTL` is 599-600; day key `EXPIRETIME` = next UTC midnight (epoch s). Q2 same address again: `cooldown`, `retryAfterSeconds` 1-600, message equals `QUOTA_MESSAGES.cooldown`, counter still 1. Q3 aliases share the cooldown (callers pass canonical keys; test uses `canonicalEmail()` of `a.b+x@gmail.com` / `ab@googlemail.com`). Q4 different addresses independent. Q5 the only keys created are `quota:*` (cooldown + day), none contains a show id.
- Q6 budget 3: four distinct addresses, 3 ok, the 4th `budget`; the 4th address has **no** cooldown key afterwards. Q7 `recap` and `cancellation` succeed past the budget, increment the counter, create no cooldown. Q8 counted recaps push total to the budget, so the next `request` is refused. Q9 day rollover: budget filled at 23:59:59.000Z, a request at 00:00:00.000Z next day succeeds on a new key while the old key's `EXPIRETIME` is that midnight. Q10 boundaries 23:59:59.999 (old day) and 00:00:00.000 (new day).
- Q11 10 concurrent requests, same address: 1 ok, 9 `cooldown`, counter 1. Q12 budget 5, 20 concurrent distinct addresses: 5 ok, 15 `budget`, counter 5. Q13 fail closed: a `fetch` returning HTTP 500 gives `{ok:false, reason:'unavailable', message: ERR.UNAVAILABLE}`, never `ok:true`; the `console.error` mock receives no argument containing the address. Q14 empty / address-less key gives `invalid` with **0 fetch calls**. Q15 messages equal pinned literals. Q16 each of ok / cooldown / budget / recap makes exactly **1** fetch. Q17 defaults equal `SEND_COOLDOWN_SECONDS` (600) and `DAILY_REQUEST_EMAIL_BUDGET` (60). Q18 the day key `EXPIRETIME` does not change on the second and third call. Q19 `Date.now` mocked to throw while a clock is injected: still works (no hidden wall clock).
- Acceptance: red for `not implemented`; ≥ 18 tests.

### T10: Implement `quota.ts`
depends on: T9. Owner general-purpose. One `EVAL`:

```lua
-- KEYS: cooldown, day.  ARGV: cooldownSeconds, requestBudget, dayExpireAt, kind ('request' | 'counted')
if ARGV[4] == 'request' then
  local ttl = redis.call('TTL', KEYS[1])
  if ttl > 0 then return {-1, ttl} end
  local used = tonumber(redis.call('GET', KEYS[2]) or '0')
  if used >= tonumber(ARGV[2]) then return {-2, used} end
  redis.call('SET', KEYS[1], '1', 'EX', ARGV[1])
end
local used = redis.call('INCR', KEYS[2])
if used == 1 then redis.call('EXPIREAT', KEYS[2], ARGV[3]) end
return {1, used}
```
Keys `quota:cooldown:<canonicalEmail>` and `quota:sent:<YYYY-MM-DD>` (UTC, from the injected clock); `dayExpireAt` = next UTC midnight in epoch seconds; `recap` and `cancellation` map to `counted`. Redis error: `console.error('send quota error', err)` (no address), return `unavailable`. Defaults from `shows.ts` limits (T2).
- Acceptance: T9 green (≥ 18), 3 identical runs; `git grep -nE "Date\.now|Math\.random" api/_lib/quota.ts` empty; typecheck exit 0.

### T11: Mutation drill for every Lua guard
depends on: T7, T10, **after the phase commit** so the restore proof is `git diff` empty. Owner x-tester. One mutation at a time via targeted Edit, run `pnpm run test:api`, record failing test names, restore with a targeted Edit (never `git checkout --`, `restore`, `stash`).

| # | Mutation | Must fail |
|---|---|---|
| M1 | drop the tombstone `EXISTS` check in CLAIM | R10, R11 |
| M2 | drop the cancelled/unknown-status refusal (`return {-3,''}` after `existing`) | R12, R13 |
| M3 | drop `return {2, existing}` (idempotent branch) | C12, C13, C14 |
| M4 | `mine + qty > max` to `>=` | C4, C5 |
| M5 | `theirs + qty > cap` to `>=` | C9, C18 |
| M6 | `booked + qty > capacity` to `>=` | C3, C16 |
| M7 | `ARGV[5]` (canonical) replaced by raw email in the email hash | C7, C17 |
| M8 | remove `EXPIREAT` for the list key | R14 |
| M9 | remove `HINCRBY` on `perDomain` | C11, R16 |
| M10 | RELEASE: drop `status == 'cancelled'` early return | R4, R5 |
| M11 | RELEASE: drop `DECRBY` | R1, R4, R6 |
| M12 | RELEASE: drop the `EXPIREAT` after `SET` of the record | R1 |
| M13 | RELEASE: drop tombstone `SET` | R10 |
| M14 | RELEASE: drop `LREM` | R1, R6, R16 |
| M15 | QUOTA: drop the `TTL > 0` cooldown check | Q2, Q11 |
| M16 | QUOTA: `used >= budget` to `>` | Q6, Q12 |
| M17 | QUOTA: move `SET` cooldown above the budget check | Q6 |
| M18 | QUOTA: drop `EXPIREAT` on first `INCR` | Q1, Q9, Q18 |
| M19 | `guard.ts` new character class removed | name rejects (≥ 15) |
| M20 | `claimAtomic` TypeScript `closed` pre-check removed | C19 |
- Acceptance: all 20 mutants fail at least the listed tests (≥ 2 for M1-M7, M10-M11); after each restore `git diff --stat` is empty; the table of results is quoted in the commit body.

### T12: Runbook update
depends on: T7, T10. Owner x-doc-writer. Edit `documentation/runbooks/api-tests.md` (exists since M1; update in place, no new file): list the new test files, the time-bomb rule (D11: synthetic `expireAt`, injected clocks in 2030+, assert TTL with `EXPIRETIME`), the shim EVAL-body rail, the fetch-count technique. Acceptance: ≤ 120 lines, frontmatter `last_updated` bumped, every command executed by T13, no emoji.

### T13: Final verification and enforcement summary
depends on: T11, T12. Owner x-tester (full), 5-step gate with quoted output: `pnpm run typecheck:api`; `docker ps --filter name=fifty-min-test-redis`; `pnpm run test:api` ×3 with Redis up; container stopped run (SKIPPED path still runs unit suites and the rail tests); `REDIS_TEST_REQUIRED=1` stopped (exit 1); `pnpm exec tsc -p tsconfig.json --noEmit` unchanged; static greps from the Sprint Contract; `git diff --stat 7ecd0e8..HEAD`. Container stopped at the end.
- Acceptance: Sprint Contract machine items all green; changed-file list equals Critical Files.

## Critical Files

| File | Change | Task | Exists |
|---|---|---|---|
| `api/_lib/redis.ts` | Rewrite (record type, keys, `claimAtomic`, `releaseAtomic`; remove pending, confirm, reserve, sweep) | T5, T7 | yes |
| `api/_lib/quota.ts` | New | T8, T10 | no |
| `src/config/shows.ts` | Add limits block (additions only) | T2 | yes |
| `api/_lib/guard.ts` | Modify (`canonicalEmail` fallback, name characters) | T3 | yes |
| `api/_lib/http.ts` | Modify (remove `json`) | T3 | yes |
| `api/reserve.ts` | Modify (`>=`, 503 bridge, imports) | T5 | yes |
| `api/reservation.ts` | Modify (confirm no-op, cancel result mapping, no expiry branch) | T5 | yes |
| `api/availability.ts` | Modify (remove sweep call) | T5 | yes |
| `api/reservations.ts` | Modify (remove sweep call) | T5 | yes |
| `api/_lib/email.ts` | Modify (delete `sendConfirmationRequest`, `formatDateTime`) | T5 | yes |
| `api/__tests__/redis-scripts.test.ts` | Rewrite | T6 | yes |
| `api/__tests__/redis-lifecycle.test.ts` | New | T6 | no |
| `api/__tests__/quota.test.ts` | New | T9 | no |
| `api/__tests__/limits.test.ts` | New | T2 | no |
| `api/__tests__/guard.test.ts`, `http.test.ts` | Modify (listed cases) | T3 | yes |
| `api/__tests__/handlers-smoke.test.ts` | Modify (two tests added) | T4 | yes |
| `api/__tests__/redis-rest-shim.test.ts`, `helpers/redis-rest-shim.ts` | Modify | T1 | yes |
| `documentation/runbooks/api-tests.md` | Modify (in place) | T12 | yes |
| `api/_lib/link.ts`, `scripts/test-api.mjs`, `package.json`, `api/tsconfig.json` | Read-only (must stay unchanged) | - | yes |

## Codebase Conventions

| Touchpoint | Convention to follow | Source | Required by |
|---|---|---|---|
| Redis | Hand-rolled Upstash REST `redis(...command)`, `keys` helpers, Lua via `EVAL` with numbered KEYS/ARGV and `{code, value}` replies; one `EVAL` per operation | `api/_lib/redis.ts:7-27,46-86` | V-INT-02, V-DRY-01 |
| Config | Limits and shows from `src/config/shows.ts`, relative imports (`../../src/config/shows` from `_lib`); no env reads in new pure logic (clock, limits injected) | `src/config/shows.ts:24-30`, M1 plan | V-SOLID-05, V-DRY-01 |
| Errors | French messages, shared `ERR`/`error()` from `http.ts`; quota returns structured results, handlers decide the HTTP status | `api/_lib/http.ts` | V-INT-01..03 |
| Logging | `console.error('<label> error', err)`; never log email addresses, tokens, secrets | `api/reserve.ts:56` | V-SEC-03 |
| Tests | `api/__tests__/`, `node:test` + `node:assert/strict`, `import './helpers/redis-env'` first, Redis suites skipped via `redisSkipReason`, no new dependency; synthetic far-future times (D11) | M1 plan, `redis-scripts.test.ts:1-2` | V-TEST-01..03 |
| TypeScript | strict, no `any`, `.ts`, no TODO comments, no `@/` aliases | project `CLAUDE.md` | V-INT-03 |
| Commits | `{type}({scope}): {description}`, no `Co-Authored-By`, no AI attribution | user rules | V-GIT |

## Threat Model / STRIDE

| Threat | Category | Severity | Mitigation | Status |
|---|---|---|---|---|
| Replay of a confirm link after cancel re-books the seats | Spoofing / Tampering | HIGH | Tombstone key + retained `cancelled` record; both checked by `claimAtomic`; unknown status also refused; tests R10-R13, mutants M1-M2 | Mitigated in T7 |
| Double click / two devices book twice | Tampering | HIGH | Idempotent by derived id inside the script; concurrent test C13; mutant M3 | Mitigated in T7 |
| One address (aliases `+tag`, dots, `googlemail`, `+a@x.com`) fills a show | Elevation of Privilege | HIGH | Counter on the canonical key; D1 removes the shared `''` key; data layer throws on an empty key; tests C7, Q14 | Mitigated in T3, T7 |
| Catch-all domain attacker fills a show with many addresses | Denial of Service | MEDIUM | Per-domain cap 12 for non-major domains; accepted residual for real addresses (ADR) | Mitigated, residual accepted |
| Email bombing a victim address, Resend budget exhausted | Denial of Service | HIGH | Cooldown across shows + daily budget, atomic, fail closed; recap/cancel mails still flow (budget 60 of 100) | Mitigated in T10 |
| Redis outage lets requests through unthrottled | Elevation of Privilege | HIGH | `checkSendQuota` returns `unavailable` on any error; test Q13 | Mitigated in T10 |
| Names and emails retained indefinitely | Information Disclosure | MEDIUM | `EXPIREAT` show start + 30 days on record and per-show keys; tombstone holds no PII; quota keys expire in 10 min / at end of day; log lines never carry addresses | Mitigated in T7, T10 |
| Invisible characters in names spoof or reorder text in emails and CSV | Spoofing | MEDIUM | Zero-width and bidi-override characters rejected (T3) | Mitigated in T3 |
| Cancel/claim denied by a record deleted by hand | Repudiation | LOW | Cancelled record retained with `cancelledAt`; claim/confirm timestamps stored | Mitigated |
| Test run flushes a foreign database | Tampering (self-inflicted) | HIGH | M1 rails + T1 tests and EVAL-body rejection | Mitigated in T1 |

## Performance Budget

Source: ADR-002 design target (Upstash free = 500K commands/month, no earlier audit baseline). HTTP round trips are exactly 1 per operation (tested: C21, R15, Q16). Worst case assumes Upstash counts the commands inside a script (not verified; M5 checklist).

| Operation | HTTP calls | Inner commands (success path) | Test |
|---|---|---|---|
| `claimAtomic` claimed | 1 | 16 (EXISTS, GET, GET, HGET ×2, INCRBY, HINCRBY ×2, RPUSH, SET, EXPIREAT ×5) | C21 |
| `claimAtomic` already-confirmed / blocked | 1 | 2 | C21 |
| `releaseAtomic` released | 1 | 10 | R15 |
| `checkSendQuota` request | 1 | ≤ 5 (TTL, GET, SET EX, INCR, EXPIREAT first time) | Q16 |
| `getReservation` | 1 | 1 | G |

Monthly ceiling: 600 seats (6 shows × 100) = at most 600 claims × 16 + 400 releases × 10 + 600 requests × 5 ≈ 16.6K inner commands, 3.3% of 500K even when counted individually; sweep commands (3 per availability call plus one per request) disappear in this milestone.

## Dependency Blast-Radius

| Changed file | Downstream consumers | Radius |
|---|---|---|
| `api/_lib/redis.ts` | `reserve.ts`, `reservation.ts`, `availability.ts`, `reservations.ts`, `email.ts` (type), 2 test files | HIGH (exports removed), contained: every consumer edited in T5 |
| `src/config/shows.ts` | 7 importers incl. frontend components; additions only | LOW |
| `api/_lib/guard.ts` | tests only (no handler imports it until M3); `canonicalEmail` result changes only for tag-only local parts | LOW |
| `api/_lib/http.ts` | `reserve.ts`, `reservation.ts` import `error`, `ERR` only | LOW |
| `api/_lib/email.ts` | `reservation.ts` (`sendConfirmed`, `sendCancellation`); `sendConfirmationRequest` has no caller after T5 | LOW |
| `api/_lib/quota.ts` | none until M3 | LOW |
| `api/reserve.ts` | `TicketingSection.tsx` (HTTP client): a valid submit now gets 503 until M3 | MEDIUM, branch not deployable |

**Overall**: MEDIUM. Contained by D6 and the non-deployable flag.

## Blast Radius

| Surface | Outside the diff | How it keeps working in M2 |
|---|---|---|
| Callers of `redis.ts` | `reserve.ts` imports `releaseAtomic, releaseExpired, reserveAtomic`; `reservation.ts` imports `confirmAtomic, getReservation, releaseAtomic`; `availability.ts` and `reservations.ts` import `releaseExpired`; `email.ts` imports the `ReservationRecord` type (found by `git grep` over `api/`, 7 hits incl. 2 tests) | Exact edits in the T5 table; `typecheck:api` exit 0 is the gate. Imports that remain valid: `keys`, `redis`, `getReservation`, `ReservationRecord` |
| Consumers (HTTP clients) | `TicketingSection.tsx:86,317` read `reservationId` / `expiresAt` from the `/api/reserve` reply; `ReservationAction.tsx:57` reads `status` | Not compiled by `api/tsconfig.json`; CRA build unaffected. Runtime: submit returns the 503 bridge, GET `/api/reservation` drops `expiresAt`. Intended, fixed in M3-M4 |
| Config | New constants only; no env change (`KV_REST_API_*`, `RESEND_API_KEY` unchanged); root `tsconfig.json` `include: ["src"]` so `shows.ts` additions are compiled by CRA too | `pnpm exec tsc -p tsconfig.json --noEmit` before/after identical (T2) |
| Data | Existing Upstash data written by the old model (`status: pending`, `reservations:pending`, per-email hash keyed by raw email) is incompatible; ADR migration step 1 already flushes the database before launch. Local tests use DB 15 on 6390 only | Stop Condition 2; M5 launch checklist |
| CI / deploy | No CI exists; `api/_lib/quota.ts` and `__tests__` share the `_` prefix (not routes). A deploy of this branch refuses reservations | README: M2 not deployable |

**Safety facts** (executed 2026-10-27 at base `7ecd0e8`, throwaway Redis 7.4.11 on 6390, DB 15, keys `m2probe:*` removed afterwards; tree unchanged afterwards, `git status --short` showed only the pre-existing `.claude/initiatives/*.json` change):
- Baseline: `pnpm run typecheck:api` exit 0; `pnpm run test:api` exit 0 with `tests 184 / pass 184 / fail 0 / skipped 0`.
- `SET k 1; EXPIREAT k 1000000000; EXISTS k` printed `OK, 1, 0`: an `EXPIREAT` in the past deletes the key at once. This is why D10 exists and why tests must not use real 2027 show dates (D11).
- `SET k 1; EXPIREAT k 4102444800; EXPIRETIME k; SET k 2; EXPIRETIME k` printed `4102444800` then `-1`: a plain `SET` clears the TTL, so `releaseAtomic` must re-apply `EXPIREAT` (R1 asserts it, mutant M12). `SET k 3 KEEPTTL` after re-applying kept `4102444800`.
- `EVAL "local t = cjson.decode(ARGV[1]); return t.status" 0 '{"status":"cancelled","quantity":2}'` printed `cancelled`, and `SET ... NX EX 600` then `TTL` printed `600`: the scripts above use only primitives proven on this server. Upstash parity is not locally provable (R6).

## Edge Cases & Boundary Conditions

| Boundary | Scenario | Acceptance |
|---|---|---|
| Empty input | `canonicalEmail ''`, `'noat'`, `'@x.com'`, `'a@'`; quantity 0 / 1.5; non-integer `expireAt` | `claimAtomic` / `checkSendQuota` refuse with 0 fetch calls (C7, Q14) |
| Time | `expireAt == now` and `now+1`; show start equality; UTC midnight ± 1 ms; claim at show start | `closed` at `<=` (C19); quota Q10; start rule `>=` (T4) |
| Concurrency | same id ×5, last seat ×2, 20 claims for 5 seats, 10 same-email, 20 same-domain, 5 concurrent cancels, 10 same-address quota, 20 budget | exact counts, counters never exceed or go negative (C13, C15-C18, R5, Q11-Q12) |
| State | claim after cancel; cancel after cancel; release of unknown or stale record; unknown stored status | `blocked`, `already-cancelled`, `not-found`, `blocked` (R2-R4, R10-R13) |
| Encoding | non-ASCII names round trip through JSON in the script reply; invisible characters | `deepEqual` on `record` (C1); T3 table |
| Environment | Redis down; HTTP 500 from Redis | skip banner; quota `unavailable` (Q13) |
| TTL | cancel re-applies TTL; first `INCR` only sets day TTL | R1, Q18 |

## Risk Assessment

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Lua bug oversells or corrupts counters | HIGH | Tests written red before the scripts; race tests ×3; invariant test R16; 20-mutant drill (T11) |
| R2 | Replay of a cancelled confirm link | HIGH | Three independent blocks (tombstone, cancelled record, unknown status) each with its own test and mutant |
| R3 | `EXPIREAT` mistakes: past value deletes a record while counters stay incremented; `SET` drops the TTL | HIGH | D10 pre-check (C19), re-applied `EXPIREAT` in release (R1, M12), `EXPIRETIME` assertions, probes A-B |
| R4 | A reservation flow silently missing: `reserve.ts` refuses every valid request | MEDIUM | Bridge returns the existing 503 text (fail closed), test T4 pins it, M2 flagged non-deployable in README, Sprint Contract item; M3 first task removes it |
| R5 | Suite breaks on a calendar date (real 2027 show dates, Redis real clock) | MEDIUM | D11: synthetic times; only pure helper tests use real shows; static check below |
| R6 | Upstash differs from local Redis (`cjson`, `EXPIRETIME`, `SET ... EX` inside scripts, command counting) | MEDIUM | Scripts use only commands common to Redis 6/7 (no `EXAT`, `KEEPTTL`); `EXPIRETIME` appears in tests only; one-time check on the Preview database and command count before launch recorded for the M5 checklist |
| R7 | Zero-width rejection blocks a legitimate name (ZWNJ/ZWJ in some scripts) | LOW | Audience is Geneva French; list fixed by the owner brief; constant is one regex, tunable in M3 |
| R8 | `canonicalEmail` fallback changes a key already used by M1 tests / future callers | LOW | Only tag-only local parts change; table test; no handler uses it yet |
| R9 | Quota budget consumed by emails that then fail to send | LOW | Conservative by design (fail closed); M3 decides whether to refund |
| R10 | Day boundary: app clock vs Redis clock for absolute `EXPIREAT` | LOW | Seconds of skew only; budget counter keyed by UTC date so a few seconds early expiry loses at most a few counts; accepted |
| R11 | Test helper edit (T1) weakens a rail | MEDIUM | Mutations on `FORBIDDEN` and the marker condition must fail tests (T1 acceptance) |
| R12 | Sonnet agent widens handler edits into M3 | MEDIUM | T5 table is exhaustive; `git diff --stat` and Stop Condition 1 |

## Stop Conditions

> On encountering any condition below, halt and report (structured "halted" status in headless mode) rather than improvising.

1. **Scope drift**: making the suite pass needs an edit outside the Critical Files table (any `src/components`, `link.ts`, `package.json`, `api/tsconfig.json`, `scripts/test-api.mjs`, or more handler lines than the T5 table). Halt.
2. **Shared or foreign Redis**: `REDIS_TEST_URL` resolves to port 6379 or container `sslcert-infra-redis-1`, DB 15 holds foreign keys, or a direct `redis-cli` is pointed at anything but `fifty-min-test-redis`. Never FLUSH anything to "make it run".
3. **Existing test weakened**: a test outside the forced-change list (T6 items 1-5, T3 list, T1/T4 additions) needs editing to pass. Halt; do not alter expectations to match.
4. **Script semantics unverifiable**: a Lua primitive used by the contract (`cjson.decode`, `SET NX EX`, `TTL`) behaves differently on the local server than in the probes. Halt and report.
5. **Real clock dependency**: any test fails or passes depending on today's date. Fix the test (D11) before continuing.
6. **Deploy**: if asked to deploy or merge this branch before M3 completes, halt; reservations are refused by design.
7. **Docker unavailable**: complete everything not needing Redis, report the Redis-gated tests as unverified, do not return the milestone as done.

## Agent-Asset Ripple

| Asset | Update | Why |
|---|---|---|
| `documentation/runbooks/api-tests.md` | in place (T12) | new test files, time-bomb rule |
| `CLAUDE.md`, `ARCHITECTURE.md` | none in M2 | `api/` entries and test commands land in M5 (single docs pass) |
| `documentation/decisions/INDEX.md` | none | ADR-002 stays `proposed`; acceptance is M5. D1-D12 are recorded here and appended to `outcomes.md` by the loop |

No rule or agent asset is renamed or removed (V-ASSET-03 satisfied).

## M3 Handoff (facts M3 must act on)

- Call `claimAtomic` with `maxPerDomain: domainSeatCap(domain)` and `expireAt: retentionExpiry(show)`; the data layer enforces only `closed` (expiry already past), so the handler must refuse a confirm at `now >= showStart(show)` itself.
- Replace the 503 bridge in `reserve.ts`; call `checkSendQuota('request', canonicalEmail)` before sending, `'recap'` / `'cancellation'` before those mails.
- Rename the CSV status label (`en attente` is unreachable), re-add `sendConfirmationRequest` with a signed link and the shared `formatDateTime`, change the `/api/reserve` reply shape (`TicketingSection.tsx:86,317`).
- The GET preview for a not-yet-claimed link reads availability (no record exists yet); `reservation.ts` confirm path must verify the signed link, then call `claimAtomic`.

## Sprint Contract

### Machine-verifiable
- [ ] `pnpm run typecheck:api` exits 0 with empty output; `pnpm exec tsc -p tsconfig.json --noEmit` result identical to the pre-M2 result.
- [ ] With Redis up, `pnpm run test:api` exits 0 with 0 failed, 0 skipped, 0 cancelled; total ≥ 250 (baseline 184 − 20 removed + new: shim ≥ 9, limits ≥ 6, guard/http ≥ 14, smoke 2, redis-scripts ≥ 26, lifecycle ≥ 18, quota ≥ 18); identical on three consecutive runs.
- [ ] With the container stopped: exit 0, prints `SKIPPED`, still runs pure suites and the shim rail tests; with `REDIS_TEST_REQUIRED=1` exit 1.
- [ ] `git grep -nE "confirmAtomic|reserveAtomic|releaseExpired|keys\.pending|reservations:pending|CONFIRM_SCRIPT|RESERVE_SCRIPT" -- api src` is empty.
- [ ] Each `claimAtomic`, `releaseAtomic`, `checkSendQuota` call issues exactly one HTTP request (C21, R15, Q16 green).
- [ ] Mutation drill T11: 20/20 mutants killed; tree clean after (`git diff --stat` empty before the final commit).
- [ ] `git grep -nE "Date\.UTC\(2027|showStart\(" -- api/__tests__/redis-scripts.test.ts api/__tests__/redis-lifecycle.test.ts api/__tests__/quota.test.ts` is empty (no real show dates in Redis tests, D11).
- [ ] `git diff -U0 7ecd0e8..HEAD | grep -E '^\+.*(TODO|Co-Authored-By)'` empty; `git log 7ecd0e8..HEAD --format=%B | grep -ci "co-authored-by"` prints `0`; `git diff 7ecd0e8..HEAD -- package.json pnpm-lock.yaml api/tsconfig.json scripts api/_lib/link.ts` empty.
- [ ] `git grep -nE "redis|fetch\(" api/_lib/guard.ts` empty; `git grep -nE "console\." api/_lib/quota.ts api/_lib/redis.ts` shows only `console.error` lines whose arguments contain no email variable (reviewed by x-tester).
- [ ] `git diff --stat 7ecd0e8..HEAD` lists exactly the Critical Files; `git diff 7ecd0e8..HEAD -- src` shows only additions in `src/config/shows.ts`.
- [ ] Container `fifty-min-test-redis` stopped at the end.

### Human-verifiable
- [ ] Test names in `redis-scripts.test.ts` and `redis-lifecycle.test.ts` read as the specification of the claim lifecycle M3 builds on.
- [ ] The two French quota messages read naturally to an attendee and tell them what to do next.
- [ ] The bridge comment in `reserve.ts` states the state of the code, contains no marker word, and the diff is small enough to read in one sitting.

## Execution Strategy

**Pattern**: sequential spine with bounded parallelism on disjoint files (≤ 3 agents per phase). TDD: x-tester writes each red test file before the code it covers. Estimate ~6-7 h total.

| Agent | Task(s) | Model | Delegation Contract |
|-------|---------|-------|---------------------|
| x-tester | T1, T2 tests, T3 tests, T4, T6, T9, T11, T13 | sonnet | **Objective**: write the listed tests red first, run the drill and the final gate. **Output format**: files + per-file pass/fail table with quoted runner output. **Scope**: `api/__tests__/**` only (incl. `helpers/`); production code read-only except the targeted, restored mutations of T11 (never `git checkout --`, `restore`, `stash`, `reset`, `clean`). **Tool guidance**: node:test + `node:assert/strict`; `pnpm run test:api`; Redis only via `pnpm run test:api:redis` on 6390, never 6379. **Stop condition**: every test listed for the task exists and results match the acceptance; container stopped after T13. |
| general-purpose | T2 code, T3 code, T5, T7, T8, T10 | sonnet | **Objective**: implement exactly the contract of each task after its red tests exist. **Output format**: changed files + quoted green test output + `git diff --stat`. **Scope**: files in the task's Critical Files rows only; T5 caller edits limited to the T5 table; never edit `*.test.ts` or `helpers/`. **Tool guidance**: Edit, Bash for `pnpm run typecheck:api` and `pnpm run test:api`; strict TS, relative imports, no TODO comments, no new dependency. **Stop condition**: task acceptance met and typecheck 0, or a Stop Condition is hit. |
| x-doc-writer | T12 | sonnet | **Objective**: update `api-tests.md` in place. **Output format**: the edited file, ≤ 120 lines. **Scope**: that single file. **Tool guidance**: Read tests and runner; copy commands exactly. **Stop condition**: every command cross-checked against `package.json`. |

**Phases**:
- P1 (3 agents, disjoint files): T1 (x-tester) ‖ T2 tests then code (x-tester → general-purpose) ‖ T3 tests then code (x-tester → general-purpose).
- P2: T4 (x-tester, red) then T5 (general-purpose, green for T4). Commit `refactor(api): drop the pending list and keep callers compiling`.
- P3: T6 (x-tester, red) then T7 (general-purpose). Commit `feat(api): claim and release seats atomically with tombstone and retention`.
- P4: T8 (general-purpose skeleton) → T9 (x-tester red) → T10 (general-purpose). Commit `feat(api): add send cooldown and daily email budget`. T8-T10 may overlap P3 once T2 is done (disjoint files: `quota.ts`, `quota.test.ts`).
- P5: T11 (after the P4 commit) ‖ T12; then T13. Commits: `test(api): add shim safety and carry-over regression tests` (P1), `docs(api): update API test runbook` (P5). No attribution lines anywhere.

## Plan Quality Gate (self-check, 8 checks)

- [x] 1 Acceptance criteria: 13/13 tasks carry measurable criteria with commands or counts.
- [x] 2 Critical file existence: every "Modify"/"Read-only" row exists on disk (verified by Read/Glob this session); the rest are marked "New".
- [x] 3 Dependencies: each task lists `depends on`; order T1-T13 acyclic (T5 needs T2/T4, T7 needs T6, T10 needs T9, T11 needs T7/T10, T13 needs T11/T12).
- [x] 4 Risk concreteness: every mitigation names a test, mutant, constant or command.
- [x] 5 Success criteria: Sprint Contract items are commands or file-state checks.
- [x] 6 Boundary conditions: dedicated section plus per-task cases.
- [x] 7 Stop conditions: present (HIGH risks R1-R3).
- [x] 8 Codebase Conventions and Blast Radius: both present; callers and exact compile edits stated; safety facts backed by executed commands (delegated run, quoted above).
- Sections: Threat Model and Performance Budget included (enterprise track). Owner-ruling ledger `documentation/reference/product-principles.md` not consulted (absence is not a plan-time HIGH). `ARCHITECTURE.md` presence per discovery (V-ADA-01 satisfied by M1). Markers: none needed.
