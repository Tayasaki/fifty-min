---
type: reference
status: current
initiative: billetterie-claim-on-confirm
review_trigger: "on milestone completion"
created: 2026-10-27
last_updated: 2026-10-27
---

## Shared Discovery Block

### Upstream ADR Summary
- ADR-002 (proposed): claim seats on email-confirm click; submit writes nothing to Redis, emails an HMAC-signed link.
- New modules api/_lib/guard.ts, link.ts, quota.ts, http.ts; redis.ts loses pending list, confirm script, releaseExpired; gains claimAtomic (idempotent, tombstone check, capacity, per-email cap on canonical key, per-domain cap) and releaseAtomic (status=cancelled + tombstone).
- Records get EXPIREAT = show start + 30 days; no cron. Cancel keeps a random per-record token.
- Turnstile verified server-side with plain fetch (injectable verifier); Vercel Hobby WAF allows ONE rate-limit rule (dashboard config, not repo).
- One deploy for API + frontend (production has no /api yet, so no live links break).

### Upstream Audit Findings
- HIGH: no abuse protection on POST /api/reserve (pending holds fill a show; email relay).
- HIGH: Resend free = 100 emails/day (3 per booking); provider failure shows "check your email"; no fetch timeouts.
- HIGH: preview emails link to production (PUBLIC_SITE_URL unset); Upstash scoping per environment unverified.
- HIGH: names/emails kept forever, no privacy notice; no server-side open/closed gate.
- MEDIUM: CSV formula injection; admin token via ?token=; no tests for api/; api/ not typechecked (TS5107 on tsc -p api).

### Architecture Constraints
- No ADR INDEX exists (documentation/decisions/INDEX.md absent); ADR-001 = SEO strategy (CRA SPA + react-snap).
- ARCHITECTURE.md Active Constraints: no CRA ejection; pnpm only; relative imports only; .tsx components/.ts utilities; no SSR; shadcn components installed manually.
- Project rules: no TODO comments; tests in tests/ or __tests__/; no AI attribution lines in commits (no Co-Authored-By).

### Codebase Conventions
| Touchpoint | Pattern | Source | Usage |
|---|---|---|---|
| Validation | hand-rolled inline guards, early returns, French messages, silent honeypot | api/reserve.ts:5,23-40; api/reservation.ts:19 | 2 handlers, no shared validator |
| Server errors | per-file error(message,status) -> Response.json({error}); generic 503 catches | api/reserve.ts:7, api/reservation.ts:8 | duplicated; ~20 call sites |
| Client errors | data.error fallback; NETWORK_ERROR literal duplicated | ReservationAction.tsx:45, TicketingSection.tsx:88 | 2 copies |
| Handlers | Web-standard named GET/POST(request: Request): Promise<Response> | api/*.ts | 5 handlers |
| Config | shared src/config/shows.ts (limits, shows, helpers); env read ad hoc via process.env | shows.ts:24-68; redis.ts:4-5; email.ts:7-9 | shows.ts has 7 importers |
| Cache | none; no-store headers; sweep on read (releaseExpired x3) | availability.ts:6,13 | to be removed |
| Database | hand-rolled Upstash REST client; keys object; Lua EVAL with CAS on raw JSON | api/_lib/redis.ts:7-157 | 3 Lua scripts |
| Email | plain fetch to Resend in send(); reserve compensates, later mails swallowed | email.ts:113-122; reservation.ts:78-81 | 3 callers |
| Logging | console.error('<label> error', id, err); no emails logged | api/*.ts | 10 sites |
Duplicates to merge: error() x2, formatDateTime x2 (email.ts:35, TicketingSection.tsx:23), NETWORK_ERROR x2.
Tooling: CRA jest only sees src/ and `pnpm test` already fails on main (Cannot find module react-router-dom); API tests = tsc compile + node --test, local Redis via docker (redis:7-alpine), no new test dependency. api/tsconfig.json needs ignoreDeprecations/moduleResolution fix. Node 24 locally.

### Performance Baselines
(no prior audit baseline available) — design target: <=2 Redis commands per availability call; Upstash free = 500K commands/month.

### Failed Approaches (Do Not Repeat)
(none on record). Note: Jest/CRA cannot run api/ tests; do not try to add api/ to CRA roots.
