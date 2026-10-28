---
type: review
skill: x-review
status: final
review_trigger: "on milestone completion"
created: 2026-10-27
last_updated: 2026-10-27
target: "initiative/billetterie-claim-on-confirm, milestone M1, diff 81bb033...HEAD (content commit 9afe097)"
related: [documentation/milestones/_active/billetterie-claim-on-confirm/milestone-1.md, documentation/decisions/ADR-002-billetterie-claim-on-confirm.md]
---

# Readiness report: billetterie-claim-on-confirm M1

## Verdict: APPROVED (0 CRITICAL, 0 HIGH, 5 MEDIUM, 4 LOW)

Review ran as `base=81bb033 scopePolicy=auto`. The diff is 19 files (more than 5 changed, no `security-sensitive-surfaces.md` §1 path such as `app/api/**`, `middleware.ts`, `.github/workflows/**`), so scope is `full`. The review was done by one foreground reviewer reading every changed source and test file, rather than a 6-agent swarm. `.claude/initiatives/*` and `documentation/milestones/**` were treated as bookkeeping and not reviewed.

## Enforcement summary

| Practice | Result |
|----------|--------|
| V-SEC (link signing, guard, shim) | PASS, no CRITICAL/HIGH |
| V-TEST-01/02/12 | PASS, evidence below |
| V-SOLID / V-DRY / V-KISS | PASS |
| V-YAGNI | WARN, M-4 |
| V-DOC-06 (no archaeology in comments), no TODO | PASS (`grep TODO\|FIXME\|XXX` over `api/`, `scripts/`, runbook: no hit) |
| V-INT-02 (reuse of existing utilities) | PASS |
| V-DOC-GOV-02/03 (runbook frontmatter, canonical name) | PASS |
| Commit messages: no AI attribution | PASS (`9afe097`, `cb8aaf0`) |
| Handler behaviour unchanged | PASS, see below |

## Observed Artifact

```
$ pnpm run typecheck:api            -> exit 0
$ REDIS_TEST_REQUIRED=1 pnpm run test:api   (throwaway redis:7-alpine on 127.0.0.1:6390)
ℹ tests 184
ℹ suites 25
ℹ pass 184
ℹ fail 0
ℹ skipped 0
```

Independent mutation drill, run on a compiled copy outside the tree (source untouched):

| Mutation | Tests failing |
|----------|---------------|
| `timingSafeEqual` replaced by `false` (signature check disabled) | 13 of 43 |
| purpose check removed | 1 |
| signature length pre-check removed | 1 |
| MAC purpose prefix removed | 3 |
| expiry check weakened | 2 |
| minimum secret length check removed | 3 |
| key-id lookup accepts any kid | 4 |
| guard: reservations-open gate inverted | 7 |
| guard: `+tag` stripping removed | 3 |
| guard: gmail domain folding removed | 1 |
| guard: body-size cap loosened | 2 |
| guard: origin `!== null` check removed | 0 (equivalent mutant: `allowed.includes(null)` is already false) |

Baseline restored after each run: link 43/43, guard 91/91.

## Focus-area findings

- **`api/_lib/link.ts`**: constant-time compare with length pre-check, `confirm:v1\n` MAC prefix, `exp` enforced (`>=`), `kid` selects current or previous key, fail-closed on null secrets and on secrets under 32 chars. Only `kid` is read from the unverified payload; the full payload shape is parsed after the signature check. Token length capped at 2048 and strictly base64url. No CRITICAL/HIGH.
- **`api/_lib/guard.ts`**: runtime gate fails closed (`RESERVATIONS_OPEN` must be exactly `true`). Body cap enforced by `content-length` and while streaming. Email validated by explicit local/domain grammar. Findings M-1, M-2 below.
- **Redis shim**: refuses port 6379 (including the implicit default) and non-loopback hosts, forces DB 15, refuses to flush a DB 15 that has keys without the marker key, blocks `FLUSHALL`/`SELECT`/`CONFIG` and similar, and throws on any non-shim host. Findings M-3 and L-1 below.
- **Handlers**: `reserve.ts` and `reservation.ts` diffs are limited to swapping the private `error()` and the string constants for `api/_lib/http`. `error()` is the same `Response.json({ error }, { status })`, and the strings are byte-identical to the originals. `availability.ts`, `reservations.ts`, `redis.ts`, `email.ts` are untouched.

## Findings

### MEDIUM (WARN, flag to user)

1. **M-1** `api/_lib/guard.ts` `canonicalEmail` / `validateReserveFields`: a valid email whose local part starts with `+` (e.g. `+a@x.com`) passes validation but yields `canonicalEmail: ''` (reproduced). When M2/M3 key the per-email quota on `canonicalEmail`, all such addresses share an empty key. Fix in M3 wiring or now: reject when `canonicalEmail` is empty.
2. **M-2** `api/_lib/guard.ts` `CONTROL_CHARS` does not cover zero-width and bidi-override characters (U+200B-U+200F, U+202A-U+202E, U+2066-U+2069, U+FEFF). `validateName('Jean‮evil')` and `validateName('A​B')` return ok (reproduced). Names are rendered in emails and the reservation list, so a bidi override can reorder displayed text. Extend the class.
3. **M-3** The shim's safety rails have no tests: the marker-key flush refusal, the `FORBIDDEN` command set and the foreign-host throw are only exercised implicitly. A regression that removes one would not turn the suite red. `redis-rest-shim.test.ts` covers only `assertSafeRedisUrl`.
4. **M-4** `api/_lib/http.ts`: `json()` is exported but has no consumer in the diff (V-YAGNI-02). Remove, or use it where M3 needs it.
5. **M-5** `guard.ts` `validateReserveFields` rejects at `now >= showStart` while the current `reserve.ts` rejects at `Date.now() > start`. One-millisecond drift, harmless today because `guard.ts` is not wired in, but M3 changes behaviour at the boundary. Align or record the decision.

### LOW (INFO)

- **L-1** Shim `FORBIDDEN` omits `SWAPDB`, `MOVE`, `COPY ... DB`, `FUNCTION`, `DEBUG`, and a Lua `EVAL` can still call `SELECT`/`FLUSHALL`. Only test code reaches it; DB 15 plus marker remain the primary rail.
- **L-2** `verifyLink` accepts non-canonical base64url signature spellings (trailing bits). The identifier is derived from the MAC, not the token string, so there is no security effect.
- **L-3** `scripts/test-api.mjs` exits 0 with Redis suites skipped when Redis is unreachable and `REDIS_TEST_REQUIRED` is unset. Documented in the runbook; no CI exists yet, so make sure CI sets `REDIS_TEST_REQUIRED=1` when added.
- **L-4** Turnstile token is length-checked only; emptiness is left to the verification step in a later milestone.

## Plan-vs-diff cross-check (advisory)

Every `Modify`/`New` path in milestone-1.md `## Critical Files` appears in `git diff --name-only 81bb033...HEAD`. The two `Read-only reference` rows (`api/_lib/redis.ts`, `src/config/shows.ts`) are correctly absent: they must stay unchanged. No missing file.
