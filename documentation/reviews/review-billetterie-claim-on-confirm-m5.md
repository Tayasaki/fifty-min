---
type: review
status: current
review_trigger: "on release"
created: 2026-10-27
last_updated: 2026-10-27
related: [documentation/milestones/_active/billetterie-claim-on-confirm/milestone-5.md, documentation/decisions/ADR-002-billetterie-claim-on-confirm.md, documentation/runbooks/billetterie-launch-checklist.md]
---

# Review M5 and initiative readiness: billetterie-claim-on-confirm

Scope: committed diff `49c7b24...92882f6` (31 files). Bookkeeping under `.claude/initiatives/` and `documentation/milestones/**` excluded.

## Verdict: OK (0 CRITICAL, 0 HIGH, 6 MEDIUM)

The initiative is ready for the owner to work through the launch checklist.

## Evidence (fresh, this session)

| Check | Result |
|---|---|
| `pnpm run typecheck:api` | clean |
| `REDIS_TEST_REQUIRED=1 pnpm run test:api` (throwaway Redis, port 6390) | 523 pass, 0 fail |
| `CI=true pnpm run test:ui` | 317 pass, 11 suites |
| `react-scripts build` (BUILD_PATH outside repo, removed) | OK; `index.html` has zero inline scripts, so the CSP `script-src` without `unsafe-inline` fits |
| `pnpm install --frozen-lockfile --lockfile-only` on HEAD `package.json` + `pnpm-lock.yaml` (scratch copy) | succeeds: lockfile (v9) is committed and consistent |
| Mutant 1: `guard.ts` code back to `closed` | 5 api tests fail |
| Mutant 2: `reservation-flow.ts` cancel without started check | 1 fails |
| Mutant 3: `reservation-flow.ts` claim `closed` result mapped to `closed` | 1 fails |
| Mutant 4: `TicketingSection.tsx` submit button without `started` | 1 UI test fails |
| Mutant 5: `ReservationAction.tsx` POST without `isShowStarted` | 4 UI tests fail |
| Restore | `git diff HEAD -- api src` empty after every mutant |
| Stray files / TODO / attribution | none tracked (`build/` is gitignored); no TODO in `api`/`src` delivered code; no AI attribution in commit messages |

## Code

- `show-started` 409 is applied on reserve (`guard.ts`), confirm (pre-check and `claimAtomic` `closed` result) and cancel; `closed` 403 stays the `RESERVATIONS_OPEN` gate. Ordering (gate first on confirm, fields before gate on reserve) is pinned by tests F4b and the reserve test, and documented in the API contract line 39.
- Forced test changes are legitimate: `closed`->`show-started` for the 409 cases; the removed `409 closed` rows are replaced by stronger dedicated cases. No assertion weakened. Availability header test is stricter (no `stale-while`, no `max-age`).
- `availability.ts`: `s-maxage=10` kept, `stale-while-revalidate` removed, rationale commented once. `shows.ts` TODO replaced by a rationale comment pointing at checklist step 0.
- Frontend: only the started show is disabled and labelled; other shows stay bookable; 403 `closed` still closes everything.

## Config

- `vercel.json` is valid JSON; four headers present on `/(.*)`; pinned by `vercel-config.test.ts`.
- CSP report-only matches what the built app loads: Turnstile script/frame on `challenges.cloudflare.com`, Google Fonts (`fonts.googleapis.com` styles, `fonts.gstatic.com` fonts), Vercel analytics same-origin (`/_vercel/insights`), no inline scripts. Inline styles (framer-motion) are covered by `style-src 'unsafe-inline'`. Report-only is the right default. `frame-ancestors` is deferred to the flip step.
- `--frozen-lockfile` is safe given the committed, consistent lockfile; revert path is documented (S1).
- Rollback claim verified: env is read from `process.env` at request time, and Vercel binds variables to a deployment, so a redeploy is required. Docs say so.

## Docs (spot-verified against code)

Verified by grep or reading: every env var name (all read in `api/`), endpoints and statuses (401 without Bearer, 403 wrong, 503 short token), CSV columns and statuses, Redis keys (`reservation:`, `tombstone:`, `show:<id>:booked|emails|domains|reservations`, `quota:cooldown:`, `quota:sent:<UTC date>`), 600 s cooldown, 60 daily budget, 30-day retention via `EXPIREAT`, erasure steps mirror `RELEASE_SCRIPT`. Cloudflare test key labelled as test; no real secrets. ADR-002 remains `proposed`, acceptance step listed; `decisions/INDEX.md` lists ADR-001 only (Accepted-only). CLAUDE.md and ARCHITECTURE.md describe `api/`, commands and SITE_URL. Initiative README statuses updated.

## MEDIUM findings

1. CSP has no `connect-src` for `challenges.cloudflare.com`; Turnstile may need it (report-only will show it, checklist S7 covers it). Adjust before flipping to enforcing if S7 reports a violation.
2. `Referrer-Policy: no-referrer` could affect Turnstile hostname validation or Google Fonts requests; not provable offline. Checklist S11 covers the widget.
3. Test F4c (`reservation-flow.test.ts`) detects `claimAtomic` by inspecting `new Error().stack`: brittle against renames or inlining.
4. Third-party limits in the docs (Resend 100/day and 3,000/month, Upstash 500K commands, Vercel Hobby one rate-limit rule, Instant Rollback on Hobby) cannot be verified from the repository; the docs hedge them and the checklist asks to confirm in the dashboards.
5. `react-snap` prerender of `/billetterie` is unverified (masked by `|| true`); SEO follow-up, not a launch blocker.
6. All owner-review French strings (`PRIVACY_NOTICE`, `successText`, `INVALID_LINK_COPY`, `UNAVAILABLE_COPY`, `recapFailedText`, `STARTED_LABEL`, SEO on/off texts) are unreviewed by the owner.

## Plan-vs-diff cross-check (advisory)

Critical Files in `milestone-5.md` absent from the diff are context or unchanged-by-design entries: `api/tsconfig.json`, `package.json`, `pnpm-lock.yaml`, `scripts/test-api.mjs`, `tsconfig.json`, `src/App.tsx`, `.env`, `documentation/INDEX.md` (not created, listed as a follow-up), ADR-002 (stays proposed, unchanged on purpose), runbooks `api-tests`/`ui-tests` and the brace-grouped test entries (individual files partly changed). No missing deliverable.

## Owner to-do (prioritized)

1. Review the French strings (checklist 0b) before turning the flag on.
2. Ask the venue: 100 or 120 seats (0c).
3. Accept or veto ADR-002: set `status: accepted` and add its row to `decisions/INDEX.md` (0a).
4. Resend: verify domain (SPF, DKIM, DMARC) now, choose plan (1.2).
5. Upstash prod and preview databases; Turnstile prod and preview widgets without `vercel.app` (1.1, 1.3).
6. Vercel env per environment, WAF rate-limit rule, then preview smoke tests S1-S14 (1.4, 2).
7. Flip CSP to enforcing only after S7 is clean (3); then go-live in order (4).
