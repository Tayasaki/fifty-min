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
| Hosting | Vercel |
| Package manager | pnpm |

## Application Structure

```
src/
├── assets/           # Logo, reference images
├── components/
│   ├── seo/          # SEO.tsx (per-page meta), StructuredData.tsx (JSON-LD)
│   ├── ui/           # shadcn: Button, Card, Badge
│   ├── layout/       # Navbar, Footer
│   └── sections/     # Hero, Show, Association, Events, Support, Ticketing, Contact
├── config/
│   └── seo.ts        # Site-wide SEO constants + per-route metadata
├── pages/            # 7 route components (thin shells)
│   ├── HomePage.tsx          → /
│   ├── SpectaclePage.tsx     → /spectacle
│   ├── AssociationPage.tsx   → /association
│   ├── AgendaPage.tsx        → /agenda
│   ├── BilletteriePage.tsx   → /billetterie
│   ├── SoutenirPage.tsx      → /soutenir
│   └── ContactPage.tsx       → /contact
└── lib/
    └── utils.ts       # cn() (clsx + tailwind-merge)
```

## SEO Architecture

Per-page meta tags are managed declaratively via `react-helmet-async` (`<SEO>` component in each page).
Build-time prerendering via `react-snap` (`postbuild` script) generates static HTML per route so social
crawlers and search bots receive fully-rendered content without executing JavaScript.

SITE_URL: `https://melangedegenres.vercel.app`

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
