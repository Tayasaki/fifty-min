---
type: reference
status: current
initiative: billetterie-claim-on-confirm
review_trigger: "on milestone completion"
created: 2026-10-27
last_updated: 2026-10-27
---

# billetterie-claim-on-confirm — Outcome Log

Append-only. One `##` block per completed milestone, newest last. Do not edit or reorder
prior entries — only append.

## M1 — Test harness and pure modules (2026-10-27T13:57:34Z)
**Shipped**: `pnpm run test:api` (node:test + REST-to-RESP shim for a local Redis, refuses port 6379, DB 15 only), `typecheck:api` fixed with node16 resolution, characterization tests of the existing Lua scripts, and the pure modules `guard.ts`, `http.ts`, `link.ts` (not wired into handlers yet); 184/184 tests, review approved with 0 critical / 0 high.
**Diverged from plan**: Implemented directly without invoking x-implement; runner uses `--test-concurrency=1` (shared DB 15); `verifyLink` reads only `kid` before the signature check; `link.ts` exp is epoch seconds while `now()` is ms; the `test:api:redis` script names its container `fifty-min-test-redis`.
**Constraint hit**: Fix before wiring in M2/M3: `canonicalEmail('+a@x.com')` returns '' (shared empty quota key); `validateName` misses zero-width and bidi-override characters (U+200B-200F, U+202A-202E, U+2066-2069, U+FEFF); the shim's marker-key flush refusal, forbidden-command set and foreign-host throw are untested; `http.ts json()` has no consumer yet; guard rejects at `now >= showStart` while reserve.ts uses `Date.now() > start` (align). Host load from other projects saturated the resource gate for 600s once before review; a resume cleared it.

## M2 — Redis lifecycle and send quota (2026-10-27T14:20:52Z)
**Shipped**: `claimAtomic` (idempotent, tombstone-checked, canonical-email and per-domain caps, capacity, EXPIREAT on every key) and `releaseAtomic` (record kept as 'cancelled' with TTL, tombstone, idempotent) in `redis.ts`; pending list, confirm script and `releaseExpired` removed; `quota.ts` (send cooldown + daily budget, fail-closed); limits block in `shows.ts`; M1 carry-over defects fixed; 274/274 real-Redis tests, 20/20 mutants killed, review approved with 0 critical / 0 high.
**Diverged from plan**: x-implement not invoked (tasks done directly); tests written alongside code, not strictly red-first; `reserve.ts` deliberately returns the existing 503 for every valid request until M3 wires the new flow (branch not deployable until then).
**Constraint hit**: For M3: decide quota-vs-claim order (quota-first burns cooldown/budget on a failed email, claim-first needs releaseAtomic compensation); `reservations.ts` still labels non-confirmed rows 'en attente' and needs the admin hardening (CSV formula escaping, constant-time header-only token, try/catch); `reserve.ts` still has its own EMAIL_RE/name validation instead of `guard.ts`; the frontend still uses `expiresAt`/`CONFIRMATION_DELAY_HOURS` and types 'pending' (M4); `guard.ts` CONTROL_CHARS still misses U+2060-2064, U+061C, U+00AD, U+180E.
