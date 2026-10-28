---
type: review
status: current
review_trigger: "on M4/M5 start"
created: 2026-10-27
last_updated: 2026-10-27
related: [documentation/milestones/_active/billetterie-claim-on-confirm/milestone-3.md, documentation/decisions/ADR-002-billetterie-claim-on-confirm.md, documentation/reference/billetterie-api-contract.md]
---

# Readiness report: billetterie-claim-on-confirm M3 (API flow, email, admin hardening)

Diff reviewed: `cea6e4f...HEAD` (content commit `d5cd503`, bookkeeping commit `4f0631f` ignored). Scope: security-touching (public unauthenticated endpoints that send email and store personal data), full swarm.

## Verdict: APPROVED (zero CRITICAL, zero unexempted HIGH), 11 MEDIUM and several LOW carried forward

### Enforcement summary

| Gate | Result |
|---|---|
| Typecheck (`pnpm run typecheck:api`) | pass |
| `REDIS_TEST_REQUIRED=1 pnpm run test:api` (throwaway Redis on 6390) | 495 pass, 0 fail |
| V-SEC-13 authz tests (401, wrong-token 403/404, forged id, kind confusion) | present (A1-A10, X1-X5, C1-C3, admin A1-A10) and mutation-verified |
| TODO comments / AI attribution in commits / stray files | none |
| Read-only paths untouched (`link.ts`, `shows.ts`, `package.json`, `vercel.json`, `src/components/**`, tsconfig, `scripts/test-api.mjs`) | unchanged |

### Observed Artifact

```
$ REDIS_TEST_REQUIRED=1 pnpm run test:api
ℹ tests 495
ℹ pass 495
ℹ fail 0
$ pnpm run typecheck:api   -> tsc -p api/tsconfig.json --noEmit (no output, exit 0)
```

### Mutation drill (run by this review, each mutant applied to the working tree, suite run, file restored)

| Mutant | File | Suite result | Verdict |
|---|---|---|---|
| M1 drop `checkOrigin` | reserve-flow.ts | 4 fail | killed |
| M2 drop confirm/cancel token-kind mismatch check | reservation-flow.ts | 2 fail | killed |
| M3 daily budget `>=` to `>` | quota.ts | 6 fail | killed |
| M4 link expiry `>=` to `>` | link.ts | 2 fail | killed |
| M5 cancel token compare replaced by `false` | reservation-flow.ts | 2 fail | killed |
| M6 CSV guard drops `@` | reservations.ts | 1 fail | killed |
| M7 drop quota refund on provider failure | reserve-flow.ts | 4 fail | killed |
| M8 drop RESERVATIONS_OPEN gate on confirm | reservation-flow.ts | 1 fail | killed |
| M9 refund also on timeout | reserve-flow.ts | 1 fail | killed |
| M10 admin `safeEqual` always true | reservations.ts | 5 fail | killed |
| M11 Turnstile unset secret passes | turnstile.ts | 3 fail | killed |
| M12 name unescaped in HTML mail | email.ts | 1 fail | killed |

All 12 mutants killed. All files restored from byte copies after each mutant; `git diff --stat -- api src` is empty at the end of the drill.

## Findings

No CRITICAL. No HIGH. The one HIGH raised by a sub-reviewer (V-INT-02, inline `slice(lastIndexOf('@')+1)` instead of `guard.ts emailDomain`) is recorded as MEDIUM: `emailDomain` had no caller before M3, it is a one-line substring, and no logic is duplicated. Reclassification is a judgement call; downgrade is flagged here so the human can overrule it.

### MEDIUM (M4 = frontend, M5 = config/docs/launch checklist, API = needs an API change decision before launch)

| # | Where | Finding | Owner |
|---|---|---|---|
| 1 | `reserve-flow.ts:63-76`, `shows.ts:43-67` | Address-holdings oracle. For major-provider domains (`domainSeatCap` = 0) a 409 `not-possible` at quantity 4 can only mean the address already holds seats; repeating with 3, 2, 1 reads the exact count. The probe spends no quota and sends no mail, only a Turnstile token. D5 / STRIDE claim ("cannot tell holds seats from domain cap") is false for those domains. Fix: drop the email/domain cap pre-check (claimAtomic stays authoritative at confirm) or charge the quota and return the normal success shape. Confirmed by existing tests (holder alias gets 409 with zero mail, fresh address gets a link). | API follow-up, decide before launch |
| 2 | `quota.ts`, `reserve-flow.ts:84-91` | Unauthenticated lockout: 60 requests per UTC day for everyone (about 60 captcha solves exhaust it), and a per-victim cooldown anyone can re-arm every 10 min (victim locked out and mailed up to 144 times per day). No per-IP limit. | M5 (WAF rate-limit rule, alerting), accepted residual in ADR |
| 3 | `guard.ts:24-25,93`, `email.ts` pre-confirmation mail | Attacker-chosen name (up to 100 chars) appears in "Bonjour {name}" of a mail from the association domain; URL blacklist misses `evil.de/x`, `bit.ly/x`, phone numbers. Fix: drop the name from the pre-confirmation mail or whitelist letters. | API follow-up |
| 4 | `availability.ts`, `reservation-flow.ts` GET/cancel lookups | Cache-busting query strings and random id/token pairs cost one Upstash command each with no throttle; can exhaust the 500K/month free tier and 503 every endpoint. | M5 (Vercel WAF rule on `/api/*`, launch checklist) |
| 5 | `reservations.ts:18-27` | `ADMIN_TOKEN` has no minimum length (LINK_SECRET requires 32) and no throttle. Fix: 503 below 32 chars, put the route in the WAF rule. | M5 / API follow-up |
| 6 | `documentation/billetterie.md:18` | Still documents `?token=<ADMIN_TOKEN>`, which the code ignores (401). Stale doc invites secrets in URLs. Plan schedules the rewrite in M5. | M5 |
| 7 | `billetterie-api-contract.md:21-22,40,49,12,18,24` | Contract doc gaps: 413/415 missing for confirm/cancel; "Origin must match" reads global but only `/reserve` checks it; log rule says "name or kind only" while several sites log raw Redis `err` objects; `remaining` missing from the error shape; started-show on reserve is a plain 400 without `code` while confirm/cancel use 409 `closed`; omitted `?show=` exports all shows. M4 reads this document. | M4 must read, M5 to correct |
| 8 | `reserve-flow.ts:63`, `reservation-flow.ts:145` | Domain extraction inlined instead of `emailDomain` (see reclassification above). Also dead `!show` branch (`reserve-flow.ts:59-61`), unused `CONFIRMATION_DELAY_HOURS` with stale JSDoc, 48 h TTL defined three times. | cleanup, any milestone |
| 9 | `reserve-flow.ts`, `reservation-flow.ts`, `http.ts` | Duplicated response builders (`full`/`fewLeft`/`NOT_POSSIBLE`, `no-store` JSON, EmailError log extraction); `ErrorExtras` index signature lets key typos compile. | cleanup |
| 10 | tests: `reserve-flow.test.ts:450-464`, `reservation-flow.test.ts:496-510` | Weak assertions: the "refund itself fails" test passes without a refund attempt; no test proves recap/cancellation `checkSendQuota` counts (deleting the call in `mailAfterCommit` passes every test). | next test pass |
| 11 | tests, 4 files | Duplicated seed helper (hard-coded 100 / 4), `keepAlive` x4, `countFetch` x4; `handlers-smoke.test.ts` depends on the real 2027 show; runbook says clocks in 2030 while code uses 2031/2099. | cleanup |

### LOW (info)

Link id is 32 bits of the HMAC (hardening: widen); logged Redis `err` objects (JSON.parse messages can carry a source snippet); `csvCell` only checks index 0 (unreachable today because name and email are trimmed; defense in depth `^[\s'"]*[=+\-@\t\r]`); refund path makes Resend-rejected addresses unthrottled (needs Turnstile per attempt); POST `/api/reservation` has no Origin check (not exploitable: JSON content type forces a preflight and a 128-bit or signed token is required); name and email travel in the signed URL (Referer: `no-referrer` is an M5 item).

## Attack-scenario results (mandatory checks)

| Check | Result |
|---|---|
| Reserve guard ordering | method, Origin, Content-Type, 4 KB body, honeypot, fields, gate all before the Turnstile call and any Redis call; clean |
| Origin allow-list from env | built per environment in `site.ts`, missing Origin refused; clean |
| Turnstile fail-closed | unset secret refused with 503 in every environment (M11 killed); token single-use by Cloudflare; clean |
| Honeypot | same success shape, no Turnstile, quota or mail; clean |
| Email-cap vs domain-cap wording | byte-identical, but see MEDIUM 1 |
| Quota-first, send, refund | bad-address and provider refund, timeout keeps the slot (M7, M9 killed); refund cannot bypass the real send budget; see MEDIUM 2 for lockout |
| Email content injection | HTML escaped (name, venue, label, link); control, bidi, zero-width characters rejected; see MEDIUM 3 for text-only phishing |
| Signed link | HMAC with purpose prefix, constant-time compare, expiry, kid rotation, derived id equality; clean |
| Token-kind separation | disjoint shapes, action must match shape, 400 before any Redis call (M2 killed); clean |
| GET read-only | only MGET/GET; clean |
| Cancel authz | id plus token via digest compare, uniform 404 for forged id, wrong token, tombstone (M5 killed), 409 after start; clean |
| RESERVATIONS_OPEN | confirm gated, cancel and GET not (M8 killed); clean |
| null / malformed body | 400, 413, 415; never 500; clean |
| Error bodies | uniform neutral 404 and generic 503; no stack, key name or existence oracle for link or reservation lookups |
| Admin export | header-only Bearer, unequal lengths safe, 503 when unset, CSV prefix for `= + - @ TAB CR`, generic 503 on Redis error; see MEDIUM 5 |
| Logs | label, kind, status only at all `console.*` sites; Resend body never logged |
| BASE_URL | env-derived only, no Host header use, no open redirect |

## Plan-vs-diff cross-check (advisory)

Every path under milestone-3.md `## Critical Files` marked New/Modify/Rewrite appears in `git diff --name-only cea6e4f...HEAD`. The Read-only row (`api/tsconfig.json`, `package.json`, `scripts/test-api.mjs`, `api/_lib/link.ts`, `src/config/shows.ts`, `src/components/**`, `vercel.json`) is correctly absent from the diff. No absent paths.
