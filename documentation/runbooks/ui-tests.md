---
type: runbook
status: current
review_trigger: "on file change"
created: 2026-10-27
last_updated: 2026-10-27
related: [documentation/runbooks/api-tests.md, documentation/reference/billetterie-api-contract.md, documentation/milestones/_active/billetterie-claim-on-confirm/milestone-4.md]
---

# UI tests

Tests for `src/` (ticketing form, confirm and cancel page, flag-gated copy, API client). CRA Jest 27, Testing Library, `user-event` v13; no extra dependency. API tests are another concern: see `api-tests.md`.

## Run

```bash
CI=true pnpm test       # all UI suites once
pnpm run test:ui        # same, `react-scripts test --watchAll=false`
CI=true pnpm exec react-scripts test --listTests   # collected files
```

Pitfall: `pnpm test -- --watchAll=false` forwards the `--` to react-scripts, which then drops CRA's config and runs `api/__tests__` untransformed (SyntaxError in ~25 suites). Use the two commands above. To run one file: `CI=true pnpm test TicketingSection`.

## Why the `jest` block exists

Jest 27 ignores package `exports`. Three imports are exports-only or have a broken `main`, so `package.json` maps them to files: `react-router-dom` (its `main` does not exist), `react-router/dom` and `@vercel/analytics/react`. Symptom if a path moves: `Cannot find module 'react-router-dom' from 'src/App.tsx'`. Fix: `pnpm add react-router@<installed version>` and point the mapper at `node_modules/react-router/...`.

`testMatch` limits collection to `*.test.ts(x)`. CRA's default would run every file under `__tests__/` as a suite, including `src/__tests__/helpers/*`.

`src/setupTests.ts` adds what jsdom 16 lacks: `TextEncoder`/`TextDecoder`, an `IntersectionObserver` stub (framer-motion), `window.scrollTo`, `scrollIntoView`.

## Conventions

- Helpers live in `src/__tests__/helpers/`: `turnstile.ts` (fake `window.turnstile`; `installFakeTurnstile`, `uninstallFakeTurnstile`) and `fetch.ts` (`fakeResponse`, `installFetch`, `uninstallFetch`; jsdom has no `Response`).
- No test reaches Cloudflare, Resend or Upstash: `window.turnstile` is faked and `fetch` is stubbed.
- One env value per render. Set `process.env.REACT_APP_*` before rendering and restore it in `afterEach`. Do not use `jest.isolateModules`: it loads a second React and breaks hooks.
- The ticketing flag is the literal `process.env.REACT_APP_SHOW_TICKETING === 'true'` written where it gates code, so the bundler removes disabled branches.

## Build checks

```bash
REACT_APP_SHOW_TICKETING=true REACT_APP_TURNSTILE_SITE_KEY=1x00000000000000000000AA BUILD_PATH=$(mktemp -d) pnpm exec react-scripts build
env -u REACT_APP_SHOW_TICKETING BUILD_PATH=$(mktemp -d) pnpm exec react-scripts build
pnpm exec tsc -p tsconfig.json --noEmit --ignoreDeprecations 6.0
```

Both builds print `Compiled successfully.` without ESLint warnings. In the flag-off build, `grep -l "api/availability\|challenges.cloudflare\|PreOrder" <build>/static/js/*.js` finds nothing; the flag-on build contains them. `.env` sets `REACT_APP_SHOW_TICKETING=false`, so "unset" in the shell is still the off state. `react-snap` (postbuild) is not part of these checks. The root `tsconfig.json` needs `--ignoreDeprecations 6.0` (TS5107, unrelated to the tests).

## Turnstile test keys (Cloudflare published)

| Use | Site key | Secret key |
|-----|----------|------------|
| Always passes | `1x00000000000000000000AA` | `1x0000000000000000000000000000000AA` |
| Always fails | `2x00000000000000000000AB` | `2x0000000000000000000000000000000AA` |

Never put a real key in tests or docs.

## Client behaviour per API `code`

Code decides behaviour; the server `error` text is the wording (shown as a React text node, 1 to 300 characters; otherwise a network, 4xx or 5xx fallback).

| Code | Reserve form | Confirm and cancel page |
|------|--------------|-------------------------|
| `captcha`, `cooldown`, `budget`, `bad-address`, `email-failed`, `email-slow`, field errors | message, widget remounted, availability refetched once | n/a |
| `full` | message, quantity clamped to `remaining`, widget remounted | "complet" or "il ne reste que N place(s)" |
| `closed` | closed panel replaces the form | closed panel (confirm) or neutral invalid text |
| `not-possible` | never returned by `/reserve` | terminal neutral text with the contact address |
| network error or 5xx on confirm | n/a | stays on the preview with a banner, retry is safe (idempotent) |
