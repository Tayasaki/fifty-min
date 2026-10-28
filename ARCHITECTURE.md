# Architecture — 15 minutes / Mélange de Genres

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 19 (Create React App) |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS v3 |
| UI components | shadcn/ui (manually installed) |
| Animations | Framer Motion 12 |
| Routing | React Router v7 (BrowserRouter, client-side) |
| API | Vercel serverless functions in `api/` (Web-standard handlers) |
| Data | Upstash Redis over REST (billetterie only) |
| Email / captcha | Resend, Cloudflare Turnstile (plain `fetch`) |
| Hosting | Vercel |
| Package manager | pnpm |

## Application Structure

```
api/                  # Vercel functions: availability, reserve, reservation, reservations
├── _lib/             # modules shared by the handlers (not routes)
└── __tests__/        # node:test suites (not routes)
src/
├── assets/           # Logo, reference images
├── components/
│   ├── seo/          # SEO.tsx (per-page meta), StructuredData.tsx (JSON-LD)
│   ├── ui/           # shadcn: Button, Card, Badge
│   ├── layout/       # Navbar, Footer
│   └── sections/     # Hero, Show, Association, Events, Teasers, Ticketing, ReservationAction, TurnstileWidget, Support, Contact
├── config/
│   ├── shows.ts          # Dates, venues, capacities, reservation limits (browser- and React-free, imported by api/)
│   ├── seo.ts            # Site-wide SEO constants + per-route metadata
│   ├── features.ts       # Turnstile site key accessor (ticketing flag is inlined where it gates code)
│   └── billetterieCopy.ts # User-facing ticketing strings
├── pages/            # 7 route components (thin shells)
│   ├── HomePage.tsx          → /
│   ├── SpectaclePage.tsx     → /spectacle
│   ├── AssociationPage.tsx   → /association
│   ├── AgendaPage.tsx        → /agenda
│   ├── BilletteriePage.tsx   → /billetterie
│   ├── SoutenirPage.tsx      → /soutenir
│   └── ContactPage.tsx       → /contact
├── lib/
│   ├── utils.ts          # cn() (clsx + tailwind-merge)
│   ├── billetterieApi.ts # fetch client and response guards for /api
│   ├── turnstile.ts      # Turnstile script loader
│   ├── formatDateTime.ts # shared date formatting (UI and emails)
│   └── emailTypos.ts     # email typo suggestions
└── __tests__/        # UI tests
```

## Reservation layer

Claim-on-confirm (ADR-002, status proposed): the request mails a signed link and holds no seat; the confirm button claims the seats atomically in Redis; cancel frees them and blocks the link.

| Module (`api/_lib/`) | Responsibility |
|---|---|
| `guard.ts` | field validation, canonical email, origin and content-type checks, opening date and `RESERVATIONS_OPEN` gate |
| `link.ts` | signed confirm links (HMAC, 48 h, key rotation by id) and cancel tokens |
| `quota.ts` | per-address send cooldown and daily send budget, fail-closed |
| `http.ts` | `error()`, shared messages and codes (`MSG`, `ERR`, `CODE_SHOW_STARTED`), constant-time compare |
| `redis.ts` | Upstash REST client, key names, `claimAtomic` and `releaseAtomic` Lua scripts |
| `email.ts` | Resend mails (request, recap with `.ics`, cancellation) with timeouts and honest `emailSent` |
| `turnstile.ts` | Cloudflare Turnstile server verification |
| `site.ts` | per-environment base URL and allowed origins |
| `reserve-flow.ts`, `reservation-flow.ts` | the handlers' logic: `POST /api/reserve`; `GET/POST /api/reservation` |

Details: `documentation/decisions/ADR-002-billetterie-claim-on-confirm.md`, `documentation/billetterie.md`.

## SEO Architecture

Per-page meta tags are managed declaratively via `react-helmet-async` (`<SEO>` component in each page).
Build-time prerendering via `react-snap` (`postbuild` script) generates static HTML per route so social
crawlers and search bots receive fully-rendered content without executing JavaScript.

SITE_URL: `https://melangedegenres.ch`

## Key Decisions Index

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [ADR-001](documentation/decisions/ADR-001-seo-strategy-cra-spa.md) | SEO strategy — react-helmet-async + react-snap | Accepted | 2026-05-08 |

## Active Constraints

- No CRA ejection
- pnpm only (`pnpm add`, `pnpm remove`) — no npm/yarn
- Relative imports only (no `@/` aliases)
- `.tsx` for components, `.ts` for utilities
- No SSR — pure client-side SPA with build-time prerender
- shadcn CLI incompatible with CRA — install components manually into `src/components/ui/`
- API runs as Web-standard handlers on Vercel functions; `api/tsconfig.json` uses node16 resolution and is typechecked by `pnpm run typecheck:api`
- `src/config/shows.ts` stays browser- and React-free because `api/` imports it
- Show ids are Redis keys: never rename one
