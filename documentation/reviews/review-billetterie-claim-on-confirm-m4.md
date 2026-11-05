---
type: review
status: current
created: 2026-10-27
last_updated: 2026-10-27
---

# Readiness report: billetterie-claim-on-confirm M4

Range `6c5b0ae...ca612b2` (45 files; bookkeeping excluded). Scope: security-touching. Verdict: **APPROVED** (0 CRITICAL, 0 HIGH, 6 MEDIUM, 3 LOW).

## Observed Artifact

```
pnpm run typecheck:api          -> exit 0
CI=true pnpm run test:ui        -> Test Suites: 11 passed, 11 total / Tests: 308 passed, 308 total
REDIS_TEST_REQUIRED=1 test:api  -> tests 511 / pass 511 / fail 0 (throwaway redis on 6390, stopped)
flag-off build (ASCII greps)    -> challenges.cloudflare.com 0, /api/reserve 0, /api/availability 0, PreOrder 0, "gratuitement" 0, "Vos donn" 0
flag-on build                   -> all of the above present
```

Mutation drill (each mutant applied alone, suite run, file restored, `git diff -- api src` empty after):

| Mutant | Result |
|---|---|
| guard: show-started 409 -> 400 | killed (4 failures) |
| reservations: ADMIN_TOKEN min length -> 1 | killed (2 more failures) |
| link: TTL 48h -> 24h | killed |
| reserve-flow: capacity check off by one | killed |
| email: greeting changed | killed |
| ReservationAction: network failure on confirm -> INVALID | killed (1) |
| TicketingSection: no `resetCaptcha()` in `fail()` | killed (18) |
| TurnstileWidget: expired-callback does not clear token | killed (1) |
| billetterieApi: reservation id pattern loosened | killed (3) |
| TicketingSection: submit enabled without token | killed (21) |
| turnstile loader: no `window.turnstile` short-circuit | killed (1) |

## Security checklist

- Holdings oracle: `/api/reserve` now reads only `readBooked(show)`; the 409 `full` answer is public availability and is returned before the send quota is charged. cooldown/budget depend on the canonical address only, not on seats held. No path left. PASS.
- Greeting `Bonjour,` with no requester text in the unsolicited mail; subject and body only carry show, venue, quantity, link. PASS.
- `ADMIN_TOKEN` < 32 chars -> 503 before the Bearer check; `MIN_SECRET_LENGTH` shared with `LINK_SECRET`; 48h TTL defined once in `link.ts`; `emailDomain` reused; dead branch removed; started show answers 409 `closed` on reserve. PASS.
- Turnstile loader: fixed HTTPS URL, no secret, script removed and cache cleared on failure, token cleared on expire/timeout/error, widget remounted after every round trip, submit disabled without token, missing site key renders the unavailable panel with no request. PASS.
- Client: no `dangerouslySetInnerHTML`, no storage, no console, no navigation from API strings; the only link targets are the constant `mailto:` (subject URL-encoded); server messages are length-capped text nodes; id validated by `^[A-F0-9]{8}$` before any request; token only in the URL query and POST body. PASS.
- ReservationAction: network failure on confirm returns to `ready` with a banner (idempotent retry), double submit guarded by a ref, no `pending`/`expiresAt` leftovers. PASS.
- No new dependency, no TODO in the diff, commit message carries no AI attribution, owner-review strings flagged in the commit and at the top of `billetterieCopy.ts`.

## Findings

| Sev | Finding | Where |
|---|---|---|
| MEDIUM | Flag-off bundle still contains the teaser string "Février et mars 2027 ... réservez votre place" (ternary on a runtime parameter, not dead-code eliminated). Not rendered, so no user-visible leak, but "compiled out" holds for TicketingSection, seo.ts and StructuredData only. Inline the literal inside `buildTeasers` or accept and document. | `TeasersSection.tsx` |
| MEDIUM | A show-started `409 closed` from `/api/reserve` uses the same code as the global gate, so `fail()` sets `closedByServer` and replaces the form for every show until reload. | `TicketingSection.tsx` `fail()` |
| MEDIUM | `/api/availability` cache `s-maxage=10, swr=30`: closing bookings can take ~40 s to reach recent visitors (observed). Put in the launch checklist (close the gate, wait one minute) or lower swr. | `api/availability.ts`, contract |
| MEDIUM | `package.json` jest `moduleNameMapper` points into `node_modules/.pnpm/node_modules/react-router/...` (pnpm layout dependent) and `node_modules/<pkg>/dist/...`; breaks on a react-router or pnpm layout change. Document in `ui-tests.md` and re-check on dependency bumps. | `package.json` |
| MEDIUM | Owner sign-off still required for French strings (privacy notice, successText, INVALID_LINK_COPY, UNAVAILABLE_COPY, recapFailedText, seo.ts descriptions) before the flag is turned on. Launch checklist item. | `billetterieCopy.ts`, `seo.ts` |
| MEDIUM | Launch checklist must cover: `REACT_APP_TURNSTILE_SITE_KEY` set with the flag (missing key shows the unavailable panel), real Turnstile secret/site key pair, `ADMIN_TOKEN` and `LINK_SECRET` >= 32 chars on Vercel, CSP/vercel.json allowing `challenges.cloudflare.com` if a CSP is added. | M5 |
| LOW | UI tests emit React `act(...)` warnings for suspended resources (noise only; 308 pass). | `src/__tests__` |
| LOW | Stray leading blank line at the top of `src/config/seo.ts`. | `seo.ts:1` |
| LOW | `shows.ts` carries a pre-existing TODO (Monique capacity), outside this diff; confirm with the venue before launch. | `shows.ts:85` |

## Plan-vs-diff (advisory)

Every path under milestone-4.md `## Critical Files` appears in the diff. Read-only files (`formatDateTime`, `emailTypos`, `utils`, layout, ui, `App*`, tailwind, vercel.json, tsconfigs, `scripts/test-api.mjs`, `.env`, lockfile) are unchanged, as required. Extras in the diff: `helpers/fetch.ts`, `billetterieCopy.test.ts`, `api/__tests__/flow-integration.test.ts` and `helpers/flow.ts` (test support, forced by the contract changes).
