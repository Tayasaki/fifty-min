---
type: review
skill: x-review
status: final
review_trigger: "on milestone completion"
created: 2026-10-27
last_updated: 2026-10-27
target: "initiative/billetterie-claim-on-confirm, milestone M2, diff 7ecd0e8...HEAD (content commit e74562c)"
related: [documentation/milestones/_active/billetterie-claim-on-confirm/milestone-2.md, documentation/decisions/ADR-002-billetterie-claim-on-confirm.md]
---

# Readiness report: billetterie-claim-on-confirm M2

## Verdict: APPROVED (0 CRITICAL, 0 HIGH, 6 MEDIUM, 5 LOW)

Review ran as `base=7ecd0e8 scopePolicy=auto`. The diff is 22 files with no `security-sensitive-surfaces.md` section 1 path, so scope is `full`. It was done by one foreground reviewer reading every changed source and test file plus independent mutation runs, not a 6-agent swarm. `.claude/initiatives/*` and `documentation/milestones/**` were treated as bookkeeping.

## Enforcement summary

| Practice | Result |
|----------|--------|
| V-SEC (Lua scripts, quota, guard, handlers) | PASS, no CRITICAL/HIGH |
| V-TEST-01/02/12 | PASS, evidence below |
| V-SOLID / V-DRY / V-KISS / V-YAGNI | PASS |
| V-DOC-06, no TODO | PASS (only pre-existing `src/config/shows.ts:88`, not in diff) |
| V-INT-02 | PASS |
| AI attribution in diff | PASS (none) |
| Plan-vs-diff Critical Files | PASS, every listed path present; read-only paths unchanged |

## Security analysis

- claimAtomic: refusal order tombstone, then record status (confirmed returns the stored record, any other status is blocked), then email cap, domain cap, capacity. EXPIREAT is applied to the record, counter, both hashes and the list. Every key name is passed in KEYS; no key is built inside a script. User data only appears as ARGV hash fields and values.
- releaseAtomic: CAS on the raw value, idempotent (already-cancelled checked first), keeps the record as cancelled, writes the tombstone, re-applies EXPIREAT after each SET, removes the id from the list. DECRBY/HINCRBY/LREM preserve TTL.
- quota.ts: cooldown and budget in one EVAL, so a refused request leaves no cooldown. Fail-closed on Redis error (`unavailable`). Empty or malformed key is refused before any Redis call. Day key uses UTC and expires at the next UTC midnight.
- reserve.ts returns 503 after validation and before any Redis or email call, so it cannot accept a request (fails closed).
- reservation.ts: confirm is an idempotent no-op on a confirmed record and 404 otherwise; cancel maps released and already-cancelled to the same 200, not-found to 404, and sends the email only on `released`.

## Observed Artifact

```
$ pnpm run typecheck:api            -> exit 0
$ REDIS_TEST_REQUIRED=1 pnpm run test:api   (throwaway redis:7-alpine on 127.0.0.1:6390)
ℹ tests 274
ℹ pass 274
ℹ fail 0
Independent mutations (each reverted, git diff on redis.ts/quota.ts empty):
  drop list EXPIREAT -> R14 fails | drop LREM -> R1,R6,R16 fail | drop tombstone SET -> R1,R11 fail
  capacity > to >=  -> C3,C8,R9 fail | drop cooldown SET -> Q1,Q2,Q3,Q5 fail
  budget >= to >    -> Q6,Q8,Q9,Q12 fail | drop day EXPIREAT -> Q1,Q9,Q18 fail
```

## Findings

### MEDIUM
1. `guard.ts` CONTROL_CHARS does not cover U+2060-2064 (word joiner, invisible operators), U+061C, U+00AD, U+180E. Zero-width names can still pass. Add them.
2. M3: quota/claim ordering. If `checkSendQuota` runs before `claimAtomic` and the claim then fails (full, limit), cooldown and budget are burned for no reservation; if after, a refused quota needs a compensating `releaseAtomic`. Same for a failed email send after a quota hit (10 min cooldown stuck). M3 must pick and test one order.
3. M3: `api/reservations.ts` labels every non-confirmed record "en attente", but records are now `confirmed` or `cancelled`. Show "annulée" and drop the pending wording.
4. M3: `api/reservations.ts` CSV has no formula-injection guard (cells starting with `=`, `+`, `-`, `@`), uses a non-constant-time `provided !== adminToken`, and accepts the admin token in the query string.
5. M3: front end still reads `expiresAt` and `CONFIRMATION_DELAY_HOURS` (`TicketingSection.tsx:17,86,317`, `shows.ts:27`) and `ReservationAction.tsx:15` still types `'pending'`. Remove with the endpoint rewire.
6. M3: `reserve.ts` still carries its own `EMAIL_RE`/name check instead of `guard.ts` (`canonicalEmail`, `validateName`); the 503 bridge hides this until M3 wires it.

### LOW
1. Release scripts can recreate a missing counter key (negative, no TTL) if a key is deleted by hand; all keys share one expiry, so only reachable through manual intervention.
2. A cancelled record keeps name and email until retention expiry (show start plus 30 days), by design in the ADR; hash fields at 0 keep the canonical email until the same TTL.
3. `releaseAtomic` with a past `expireAt` deletes the record and tombstone; harmless because `claimAtomic` returns `closed` after that.
4. `releaseAtomic` returns `not-found` for both a missing and a changed record.
5. The shim's EVAL body check is a regex on the script text and can be bypassed by string concatenation in a script; test-only, scoped to DB 15 with SELECT forbidden.

## Plan-vs-diff (advisory)

All paths under milestone-2.md `## Critical Files` appear in `git diff --name-only 7ecd0e8...HEAD`. `link.ts`, `scripts/test-api.mjs`, `package.json`, `api/tsconfig.json` are absent from the diff, as required. No absent writes to explain.
