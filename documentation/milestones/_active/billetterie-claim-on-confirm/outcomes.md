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
