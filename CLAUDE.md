# 15 minutes — Mélange de Genres

Website for the original musical comedy **"15 minutes"** by the association **Mélange de Genres** (season 2026-2027).

## Tech Stack

- **Framework**: React 19 (Create React App)
- **Language**: TypeScript (strict)
- **Styling**: Tailwind CSS v3 (CRA native support via `tailwind.config.js`)
- **UI Components**: shadcn/ui (manually installed — CLI is incompatible with CRA)
- **Animations**: Framer Motion 12
- **Icons**: Lucide React
- **Package Manager**: pnpm

## Project Rules

- **ALWAYS use TypeScript** — no `.js` or `.jsx` files in `src/`. Use `.ts` for utilities and `.tsx` for components.
- **ALWAYS use pnpm** — never `npm install` or `yarn`. Use `pnpm add`, `pnpm remove`, `pnpm run`.
- **No `package-lock.json`** — only `pnpm-lock.yaml` is valid.
- **Component pattern**: functional components with `export default function ComponentName()`.
- **Imports**: use relative paths (no `@/` aliases — CRA does not support them without ejecting).
- **shadcn components**: installed manually in `src/components/ui/`. Do NOT use the shadcn CLI.

## Project Structure

```
src/
├── assets/          # Logo, reference images
├── components/
│   ├── ui/          # shadcn: Button, Card, Badge
│   ├── layout/      # Navbar, Footer
│   └── sections/    # Hero, Show, Association, Events, Support, Ticketing, Contact
├── lib/
│   └── utils.ts     # cn() helper (clsx + tailwind-merge)
├── App.tsx          # Root component assembling all sections
└── index.tsx        # Entry point
```

## Commands

```bash
pnpm start           # Dev server (http://localhost:3000)
pnpm run build       # Production build
pnpm test            # Run tests
```

## Design System

- **Colors**: teal `#7BB7AA`, purple `#B8A0BB`, background `#FAF8F6` (light theme)
- **Fonts**: Playfair Display (headings), Inter (body) — loaded via Google Fonts
- **Theme config**: `tailwind.config.js`
