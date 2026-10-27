---
type: runbook
status: current
review_trigger: "on release"
created: 2026-10-27
last_updated: 2026-10-27
related: [documentation/billetterie.md, documentation/reference/billetterie-api-contract.md, documentation/decisions/ADR-002-billetterie-claim-on-confirm.md, documentation/audits/analysis-billetterie.md, documentation/runbooks/api-tests.md, documentation/runbooks/ui-tests.md]
---

# Billetterie launch checklist

Everything the code cannot do for you: accounts, DNS, dashboards, real keys, and the tests that only a real Vercel deployment can prove. The branch `initiative/billetterie-claim-on-confirm` is deployable in one deploy once these are done. Nothing here is automated, and nothing has been deployed, pushed or merged.

Legend: **Owner** = association member with account access. **Dev** = whoever holds the repository. H = hands-on minutes, W = waiting time. Tick each box and paste the evidence named in the step.

**Start first** (long waits): step 1.2 (Resend DNS, up to a day) and step 0(c) (venue reply, days).

## Effort

| Step | Who | H (min) | W |
|---|---|---|---|
| 0 Decisions | Owner | 45 | venue reply: days |
| 1.1 Upstash | Owner | 20 | none |
| 1.2 Resend | Owner | 45 | DNS up to a day |
| 1.3 Turnstile | Owner | 20 | none |
| 1.4 Vercel | Dev + Owner | 45 | none |
| 2 Preview smoke tests | Dev + Owner | 150 | none |
| 3 Flip the CSP | Dev | 20 | none |
| 4 Go-live | Dev + Owner | 30 | none |
| **Total hands-on** | | **375 min (about 6 h 15)** | |

Add about 40 minutes of day-1 monitoring (step 6): about 7 hours in all. Realistic calendar time: 2 working days, 3 if the Resend verification or the venue answer lags.

## 0. Decisions (Owner, 45 min)

- [ ] (a) **Accept or veto ADR-002.** It is `status: proposed`. To accept it, make exactly two edits: set `status: accepted` in `documentation/decisions/ADR-002-billetterie-claim-on-confirm.md`, and add a row for ADR-002 to the table in `documentation/decisions/INDEX.md` (that index lists accepted ADRs only). Until then it stays proposed.
- [ ] (b) **Review the French strings** flagged for owner review in `src/config/billetterieCopy.ts`: the privacy notice (`PRIVACY_NOTICE`), `successText`, `INVALID_LINK_COPY`, `UNAVAILABLE_COPY`, `recapFailedText`, `STARTED_LABEL`, and the on/off descriptions in `src/config/seo.ts`. Do not turn the flag on before this box is ticked.
- [ ] (c) **Ask the Théâtre Le Monique**: 100 or 120 seats? Capacity is 100 in `src/config/shows.ts` (the conservative figure). Raising it later is safe; lowering it below the booked count overbooks.
- [ ] (d) **Who holds `ADMIN_TOKEN`** (the door list export)? Write the name down.
- [ ] (e) **Resend plan**: see step 1.2.

## 1. Accounts and dashboards

### 1.1 Upstash (Owner, 20 min)

- [ ] Create two databases in the same region near Geneva: `fifty-min-prod` and `fifty-min-preview`.
- [ ] Connect the production database to **Production only**; connect the preview database to **Preview and Development**.
- [ ] In Vercel, Settings, Environment Variables: confirm that no `KV_REST_API_URL` or `KV_REST_API_TOKEN` value is shared between Production and Preview. Evidence: a screenshot of the scoping.
- [ ] Production database: `DBSIZE` is 0. After the smoke tests, clear the preview database (`FLUSHDB` in its own console).

### 1.2 Resend (Owner, 45 min, DNS up to a day: start first)

- [ ] Add and verify the domain `melangedegenres.ch` (SPF and DKIM records).
- [ ] Add a DMARC TXT record at `_dmarc` (start with `p=none` and a reporting mailbox, tighten later).
- [ ] Pick the plan. The free tier is 100 emails per day and 3,000 per month. The send budget (`DAILY_REQUEST_EMAIL_BUDGET`, 60 per UTC day) counts request, recap and cancellation mails in one counter but refuses only new **requests**, so a day can exceed 60 with the recap and cancellation tail of earlier requests. Sixty bookings with a recap each is already 120 mails. Upgrade for the launch period, or accept that heavy days hit the 100 cap.
- [ ] Create separate API keys for Production and Preview. The reply-to defaults to `infomelangesdegenres@gmail.com` (`RESERVATION_REPLY_TO`).

### 1.3 Cloudflare Turnstile (Owner, 20 min)

- [ ] Widget "prod": hostnames are the production domain(s) only. **Never add `vercel.app` to it**: a site key is public, so a production widget that accepts `vercel.app` lets anyone solve challenges on their own page with our key and send valid tokens to our API.
- [ ] Widget "preview": the single stable branch preview host, or use Cloudflare's always-pass test pair in Preview (published in `documentation/runbooks/ui-tests.md`).
- [ ] Evidence: the production widget's hostname list.

### 1.4 Vercel (Dev + Owner, 45 min)

- [ ] Set the environment variables per environment from the matrix in `documentation/billetterie.md`. Production gets the production database, the production Resend key and the production Turnstile pair. `LINK_SECRET` and `ADMIN_TOKEN` are each at least 32 random characters and different in every environment. `REACT_APP_SHOW_TICKETING` and `REACT_APP_TURNSTILE_SITE_KEY` are build-time values. `RESERVATIONS_OPEN` stays unset or `false` until go-live.
- [ ] Verify the Production Turnstile site key is **not** the test key `1x00000000000000000000AA`.
- [ ] Leave `PUBLIC_SITE_URL` unset in Production and in Preview.
- [ ] Settings, General: Node.js 20 or newer.
- [ ] Confirm the production domain points at this project.
- [ ] Add **one** WAF rate-limit rule on `/api/*`. Proposed values: 60 requests per 60 seconds per IP, default action 429. The Hobby plan allows one rate-limit rule and three custom rules; the options the dashboard offers are the real limits. One booking is about 6 API calls, so 60 per minute tolerates a shared school or office network while stopping a cache-busting loop. Write down that the rule cannot stop a distributed run of solved captchas from using up the daily budget of 60.
- [ ] Keep Deployment Protection on for previews. Preview links work only for logged-in team members, so the owner who tests must be a project member.

## 2. Preview smoke tests (Dev + Owner, 150 min)

Run on a Preview deployment of the branch with the ticketing flag on. Paste the evidence next to each test.

- [ ] **S1 Build log.** Install with `--frozen-lockfile` succeeds (Vercel picks its own pnpm major from `lockfileVersion: '9.0'`). No TypeScript error. Note the `react-snap` result and `curl` the raw HTML of `/billetterie`: if the page content is missing, it is an SEO follow-up, not a launch blocker (the page works in the browser). If the frozen install fails, set `installCommand` in `vercel.json` back to `CI=true pnpm install --no-frozen-lockfile` (one-line revert) and note it.
- [ ] **S2 Functions.** The Functions list shows exactly 4 (`availability`, `reserve`, `reservation`, `reservations`). `/api/_lib/guard` and `/api/__tests__/guard.test` are **not** functions: a page shell or 404 passes, a JSON or function response fails. If more than 4 appear, stop the launch.
- [ ] **S3 Headers.** `curl -sI` on `/billetterie` shows `Referrer-Policy`, `X-Content-Type-Options`, `X-Frame-Options` and `Content-Security-Policy-Report-Only`. On `/api/availability` record the `Cache-Control` the browser receives and `x-vercel-cache`.
- [ ] **S4 Origin.** A request from the preview origin reaches the captcha check (400 `captcha`); a foreign `Origin` gets 403.
- [ ] **S5 Real booking** to a mailbox you own. The request mail says `Bonjour,` and links to the **preview** host. Confirm, check the recap (cancel link and `.ics`), cancel, check the cancellation mail.
- [ ] **S6 CSV export.** Bearer works, a wrong token answers 403, `?token=` answers 401, a short `ADMIN_TOKEN` answers 503.
- [ ] **S7 CSP report-only.** Zero violations in the console with the real Turnstile pair, in Chrome and in one of Firefox or Safari.
- [ ] **S8 Gate.** Set `RESERVATIONS_OPEN=false`, Redeploy, and time how long until the page shows the closed panel and `POST /api/reserve` answers 403.
- [ ] **S9 Upstash cost.** Command count before and after 20 page loads and one booking; record the cost per load and per booking against the free tier (500K commands per month).
- [ ] **S10 Production-shaped check** on the Production URL before go-live: ticketing is off.
- [ ] **S11 Turnstile.** The widget renders on the allowed host only.
- [ ] **S12 Deliverability.** Gmail, Outlook, Proton and a Swiss provider: inbox or spam.
- [ ] **S13 Layout** at 360 px, and the `.ics` imports into a calendar.
- [ ] **S14 Retention.** `EXPIRETIME reservation:<id>` equals the show start plus 30 days. Then clear the preview database.

## 3. Flip the CSP to enforcing (Dev, 20 min)

- [ ] Only after S7 is clean in Chrome and one of Firefox or Safari: in `vercel.json` rename `Content-Security-Policy-Report-Only` to `Content-Security-Policy`, append `; frame-ancestors 'none'` to its value, redeploy Preview, re-run S5. If you skip this step the site launches with the report-only policy and the other three headers; record that as accepted.

## 4. Go-live order (Dev + Owner, 30 min)

- [ ] 1. Merge or open the pull request as described in the initiative README (against `billeterie`, not `main`, until that branch lands).
- [ ] 2. Final check of the Production environment variables.
- [ ] 3. Deploy with `RESERVATIONS_OPEN=false`.
- [ ] 4. Verify `/api/availability` answers `open:false` and `POST /api/reserve` answers 403 `closed`.
- [ ] 5. Set `RESERVATIONS_OPEN=true` and Redeploy.
- [ ] 6. Make one real booking with an address you own: confirm, cancel, export.
- [ ] 7. Announce.

## 5. Rollback

- [ ] Rehearsed on Preview first. Set `RESERVATIONS_OPEN=false` and Redeploy; about 10 seconds later the page is closed (CDN `s-maxage=10`). Fastest option: Instant Rollback to the previous production deployment (the one with ticketing off). Existing confirmed seats stay confirmed; mailed links keep opening but cannot confirm.

## 6. Monitoring (manual: no alerting exists)

Hourly on day 1 (4 checks of 10 minutes), then 5 minutes a day.

- Resend dashboard: daily count, bounces.
- Upstash console: command usage; `GET quota:sent:<UTC date>` against 60.
- Vercel logs for `request email error`, `claim error`, `availability error`.

## 7. Key rotation

- [ ] `LINK_SECRET`: set `LINK_SECRET_PREVIOUS` to the current secret and `LINK_SECRET_PREVIOUS_KID` to the current id, set a new `LINK_SECRET` and a new `LINK_SECRET_KID`, Redeploy, keep for at least 48 hours (the link lifetime), then remove the two PREVIOUS variables. Cancel tokens are per reservation and unaffected.
- [ ] `ADMIN_TOKEN`: replace it, redeploy, tell whoever runs the export.

## 8. Not done by this initiative (follow-ups)

- Attendee broadcast (the 21 February time change is the example).
- Door check-in, manual cancel, walk-ins, admin bulk cancel by domain, and an erase action in the application (today erasure is manual: `documentation/billetterie.md`).
- Waitlist.
- Alerting on the daily budget and on 5xx responses.
- `DESIGN.md` and `product-principles.md` companion files.
- A tree-wide `documentation/INDEX.md` (`x-docs restructure --bootstrap`).
- List a started show as past instead of an error click.
- Repair `react-snap` prerendering.
- De-duplicate the contact address onto `CONTACT_EMAIL`.
- Flag-off teaser string: pass the description string into `buildTeasers` (one line).
- Root `tsconfig.json`: add `ignoreDeprecations`.
