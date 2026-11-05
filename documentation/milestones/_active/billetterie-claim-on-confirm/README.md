---
type: plan
status: current
review_trigger: "on milestone completion"
created: 2026-10-27
last_updated: 2026-10-27
related: [documentation/decisions/ADR-002-billetterie-claim-on-confirm.md, documentation/audits/analysis-billetterie.md, documentation/milestones/_active/billetterie-claim-on-confirm/discovery.md]
---

# Initiative: billetterie-claim-on-confirm

Implement ADR-002: seats are claimed when the attendee clicks the confirm button in a signed email link, not held on
submit. Closes the six launch blockers in `documentation/audits/analysis-billetterie.md` (abuse protection, email
failure handling, preview/production separation, retention and privacy, runtime open/closed gate, expiry sweep).

Source: ADR-002 (proposed), audit `analysis-billetterie.md`. Type: Feature. Estimate: 25-30h. One deploy at the end
(production has no `/api` yet, so no live links break).

## Milestones

| # | Name | Value | Status | Deployable |
|---|------|-------|--------|------------|
| M1 | Test harness and pure modules | 25% | complete | Yes (no behaviour change) |
| M2 | Redis lifecycle and send quota | 25% | complete | No |
| M3 | API flow, email and admin hardening | 30% | complete | No |
| M4 | Frontend: Turnstile, notice, honest states | 15% | complete | After M4 (with M1-M3) |
| M5 | Config, docs and pre-launch checklist | 5% | in review | After M5 |

### M1: Test harness and pure modules
Objective: a runnable test setup for `api/` and the three pure modules everything else depends on.
Scope: `package.json` (`test:api` script: `tsc` to a temp dir + `node --test`, local Redis via `redis:7-alpine`, no new
dependency), `api/tsconfig.json` (fix TS5107 and typecheck script), `api/_lib/guard.ts`, `http.ts`, `link.ts`,
`api/__tests__/`. Tests for the existing Lua scripts (last-seat race, release, confirm) are written first.
Dependencies: none.

### M2: Redis lifecycle and send quota
Objective: the claim model in the data layer.
Scope: `api/_lib/redis.ts` (`claimAtomic`, `releaseAtomic` with status, tombstone, `EXPIREAT`; remove pending list,
confirm script, `releaseExpired`), `api/_lib/quota.ts` (send cooldown, daily send budget), Redis integration tests.
Dependencies: M1.

### M3: API flow, email and admin hardening
Objective: the new request flow end to end on the server.
Scope: `api/reserve.ts`, `api/reservation.ts`, `api/availability.ts` (no sweep, `s-maxage`, `open` flag),
`api/reservations.ts` (header-only token, `timingSafeEqual`, CSV escaping, try/catch), `api/_lib/email.ts` (timeouts,
error classes, honest `emailSent`, derived `BASE_URL`), shared `formatDateTime` in `src/lib`, handler tests.
Dependencies: M2.

### M4: Frontend
Objective: the user-facing half of the new flow.
Scope: `TicketingSection.tsx` (Turnstile widget, privacy notice, availability refetch on every error, honest errors),
`ReservationAction.tsx` (preview, full, already-confirmed, email-not-sent states), `BilletteriePage.tsx`,
flag-gated copy (`src/config/seo.ts`, `TeasersSection.tsx`, `StructuredData.tsx`), shared `NETWORK_ERROR`.
Dependencies: M3.

### M5: Config, docs and pre-launch checklist
Objective: configuration and documentation match the code; a launch checklist exists for the manual steps.
Scope as shipped: `vercel.json` (frozen-lockfile install, `Referrer-Policy`, `X-Content-Type-Options`,
`X-Frame-Options`, report-only CSP), `show-started` error code, availability cache without background revalidation,
`documentation/billetterie.md` rewrite with env matrix and erasure procedure, `CLAUDE.md` and `ARCHITECTURE.md`
(`api/` entries, test commands), `documentation/decisions/INDEX.md` (accepted ADRs only), and
`documentation/runbooks/billetterie-launch-checklist.md` for the dashboard tasks the loop cannot do (Upstash database per
environment, Resend plan and domain, Turnstile keys, Vercel rate-limit rule, `RESERVATIONS_OPEN`, clearing test data).
ADR-002 acceptance is the owner's decision: see the checklist, step 0.
Dependencies: M4.

## Dependency graph

M1 -> M2 -> M3 -> M4 -> M5 (linear; validated: no cycle, every dependency precedes its dependent).

## Branch model

`shared`: all milestones commit to `initiative/billetterie-claim-on-confirm`, cut from `billeterie` (PR 2), **not
`main`**: the billetterie feature is not on `main`, and merging it first would put an API without abuse protection
into production. Consequences for the loop:

- First commit after `billeterie` is `docs(billetterie): add production-readiness audit and ADR-002`; the scaffold
  commit follows it. Milestone 1's review base is the scaffold commit (passed as `scaffoldSha` at launch).
- On `/x-initiative continue`, derive the scaffold commit as `git rev-list initiative/billetterie-claim-on-confirm
  ^billeterie | tail -2 | head -1` (the list is newest first, so the scaffold commit is the second line from the end,
  right after the audit commit), not `^main | tail -1`, which would resolve to the first billetterie commit and pull
  the whole feature into milestone 1's review.
- Nothing is pushed by the loop. Open the PR against `billeterie` (or retarget after PR 2 merges).

Constraints for every stage: pnpm only, TypeScript strict, relative imports, no TODO comments, tests in `__tests__/`
or `tests/`, and **no AI attribution lines in commit messages** (no `Co-Authored-By`).

## Current focus

M5 (implemented, in review). After the loop's gate passes M5 becomes `complete`; then the owner works through
`documentation/runbooks/billetterie-launch-checklist.md`.
