# 15 minutes — Mélange de Genres

Website for the original musical comedy **"15 minutes"** by the association **Mélange de Genres** (season 2026-2027).

## Tech Stack

- **Framework**: React 19 (Create React App)
- **Language**: TypeScript (strict)
- **Styling**: Tailwind CSS v3 (CRA native support via `tailwind.config.js`)
- **UI Components**: shadcn/ui (manually installed — CLI is incompatible with CRA)
- **Animations**: Framer Motion 12
- **Icons**: Lucide React
- **Serverless API**: Vercel functions in `api/` (Web-standard handlers, TypeScript)
- **Database**: Upstash Redis over REST (no client dependency)
- **Email**: Resend, plain `fetch` (no dependency)
- **Captcha**: Cloudflare Turnstile
- **Package Manager**: pnpm

## Project Rules

- **ALWAYS use TypeScript** — no `.js` or `.jsx` files in `src/`. Use `.ts` for utilities and `.tsx` for components.
- **ALWAYS use pnpm** — never `npm install` or `yarn`. Use `pnpm add`, `pnpm remove`, `pnpm run`.
- **No `package-lock.json`** — only `pnpm-lock.yaml` is valid.
- **Component pattern**: functional components with `export default function ComponentName()`.
- **Imports**: use relative paths (no `@/` aliases — CRA does not support them without ejecting).
- **shadcn components**: installed manually in `src/components/ui/`. Do NOT use the shadcn CLI.
- **No new dependency in `api/`**: Redis, Resend and Turnstile are called with `fetch`; tests use `node:test`.
- **Never rename a show id** in `src/config/shows.ts`: it is the Redis key of that show's counters.

## Project Structure

```
api/                 # Vercel serverless functions (billetterie)
├── availability.ts  # GET  places restantes + open
├── reserve.ts       # POST demande : envoie le lien signé
├── reservation.ts   # GET/POST aperçu, confirmation, annulation
├── reservations.ts  # GET  export CSV organisateur
├── _lib/            # logic modules (not routes): guard, link, quota, http, redis, email, turnstile, site, flows
└── __tests__/       # node:test suites (not routes)
scripts/
└── test-api.mjs     # compiles api/ and runs the API tests
src/
├── assets/          # Logo, reference images
├── components/
│   ├── ui/          # shadcn: Button, Card, Badge
│   ├── layout/      # Navbar, Footer
│   └── sections/    # AssociationSection, ContactSection, EventsSection, HeroSection, ReservationAction, ShowSection, SupportSection, TeasersSection, TicketingSection, TurnstileWidget
├── config/          # shows.ts (dates, capacities, limits), seo.ts, features.ts, billetterieCopy.ts
├── lib/             # utils.ts (cn), billetterieApi.ts, turnstile.ts, formatDateTime.ts, emailTypos.ts
├── __tests__/       # UI tests (Jest, Testing Library)
├── App.tsx          # Root component assembling all sections
└── index.tsx        # Entry point
vercel.json          # install command + security headers
```

## Commands

```bash
pnpm start           # Dev server (http://localhost:3000)
pnpm run build       # Production build
pnpm test            # CRA test runner (watch mode)
pnpm run test:ui     # UI tests once (set CI=true to avoid watch)
pnpm run test:api    # API tests (needs the throwaway Redis below)
pnpm run test:api:redis  # start Redis on 127.0.0.1:6390 for the API tests
pnpm run typecheck:api   # typecheck api/ only
```

## Billetterie

Free ticketing with claim-on-confirm (seats are claimed when the emailed link is confirmed). Operations, environment variables and erasure procedure: `documentation/billetterie.md`. API contract: `documentation/reference/billetterie-api-contract.md`. Go-live steps: `documentation/runbooks/billetterie-launch-checklist.md`.

## Design System

- **Colors**: teal `#7BB7AA`, purple `#B8A0BB`, background `#FAF8F6` (light theme)
- **Fonts**: Playfair Display (headings), Inter (body) — loaded via Google Fonts
- **Theme config**: `tailwind.config.js`
