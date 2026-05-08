---
type: adr
id: ADR-001
title: SEO strategy for the CRA SPA — react-helmet-async + react-snap prerender
status: accepted
created: 2026-05-08
deciders: kevin.gillieron
supersedes: null
superseded_by: null
related: []
---

# ADR-001 — SEO strategy for the CRA SPA

## Status

Accepted (2026-05-08)

## Context

The "15 minutes" website is a Create React App + React Router v7 single-page application
hosted on Vercel. The audit (`documentation/audits/` — pending Phase 4a write-up of the
analysis run on 2026-05-08) identified the following SEO gaps:

1. All 7 routes share the same static `<title>` and `<meta description>` from `public/index.html`.
2. Open Graph tags are incomplete (no `og:image`, `og:type`, `og:url`, `og:locale`).
3. No Twitter Card tags.
4. No JSON-LD structured data (no `Organization`, no `TheaterEvent`).
5. No `sitemap.xml`.
6. No `<link rel="canonical">` per route.
7. `manifest.json` still has CRA template defaults (`"React App"`, `"Create React App Sample"`).
8. `robots.txt` does not reference a sitemap.
9. **SPA crawlability**: Googlebot JS-renders pages but social crawlers
   (Facebook, WhatsApp, LinkedIn, Discord, Slack, iMessage) **do not execute JS** —
   they only see the static `index.html`. Every share link gets the same generic preview.

The goal is to maximize discoverability (search engines) and shareability (social previews)
without ejecting CRA, switching to Next.js/Remix, or introducing runtime SSR infrastructure.

## Decision

Adopt a two-layer strategy:

1. **In-app meta management** via `react-helmet-async` — each page renders a `<SEO>` component
   that declares its title, description, canonical, Open Graph, and Twitter Card tags.
2. **Build-time prerender** via `react-snap` (or equivalent: `@prerenderer/rollup-plugin`,
   custom Puppeteer script) — after `pnpm run build`, a headless Chrome process visits each
   route on the local build server and writes static HTML so social crawlers and search engines
   see fully-rendered markup instantly.

Augmented by static assets in `public/`:
- `og-image.jpg` (1200×630)
- `sitemap.xml` listing all 7 routes
- updated `robots.txt` with `Sitemap:` directive
- fixed `manifest.json`

## Components

| Component | Path | Responsibility |
|-----------|------|----------------|
| `HelmetProvider` | `src/index.tsx` (root wrapper) | Provide Helmet context |
| `<SEO>` | `src/components/seo/SEO.tsx` | Render `<title>`, `<meta description>`, canonical, OG, Twitter Card from props |
| `<OrganizationLD>` | `src/components/seo/StructuredData.tsx` | Emit `Organization` JSON-LD (sitewide identity) |
| `<TheaterEventLD>` | `src/components/seo/StructuredData.tsx` | Emit `TheaterEvent` JSON-LD (the show) |
| `seo.ts` | `src/config/seo.ts` | Site constants: `SITE_URL`, `SITE_NAME`, `DEFAULT_OG_IMAGE`, `ORGANIZATION` |
| `og-image.jpg` | `public/og-image.jpg` | 1200×630 default OG/Twitter share image |
| `sitemap.xml` | `public/sitemap.xml` | Static enumeration of 7 routes with `<lastmod>` |
| `robots.txt` | `public/robots.txt` (modified) | Allow-all + `Sitemap:` directive |
| `manifest.json` | `public/manifest.json` (modified) | PWA manifest with real app name, icons, theme |
| `react-snap` postbuild | `package.json` script | Crawl built app and write static HTML per route |

## Alternatives Considered

### Approach A1 — `react-helmet-async` only (no prerender)

- **Steelmanned case**: Brochure sites for small associations rarely need rich social previews —
  most traffic comes via Google or direct links. A build-time prerender pipeline has long-tail
  costs (CI breakage, headless-Chrome flakiness). Ship the simplest thing.
- **Trade-offs**: + Lowest effort, + small bundle (~5 KB). – Social crawlers see only generic
  `index.html` tags. ⚠ Google indexes JS-rendered content with delay.

### Approach A3 — Custom `useDocumentHead` hook (zero deps)

- **Steelmanned case**: 60 LOC beats a 5 KB dependency for a brochure site touched once a year.
  `react-helmet-async` last shipped in 2022; the whole helmet ecosystem has stalled.
- **Trade-offs**: + Zero deps. – Same social-crawler blindness as A1. – Writing your own
  canonical/OG/Twitter management is more error-prone than it sounds.

### Trade-off matrix

| Criterion | Weight | A1 | **A2 (chosen)** | A3 |
|-----------|--------|----|----|----|
| SEO effectiveness (Google + social) | 30% | 3 | **5** | 3 |
| Implementation effort | 20% | 5 | **3** | 3 |
| Maintenance burden | 15% | 5 | **3** | 3 |
| Bundle / build impact | 10% | 4 | **4** | 5 |
| Social sharing quality | 15% | 2 | **5** | 2 |
| Future flexibility | 10% | 4 | **4** | 3 |
| **Weighted score** | | 3.75 | **4.10** | 3.05 |

A2 wins by ~9% — close enough that adversarial subagent fan-out was deemed not cost-justified
for a brochure site with low blast radius. Decision made on the qualitative argument that
social-share previews matter for a musical comedy promoted via Facebook events, Instagram,
and WhatsApp.

## Design Principles Validation

| Principle | Status | Notes |
|-----------|--------|-------|
| **SRP** | ✅ Pass | `<SEO>` only renders meta. `<*LD>` only renders JSON-LD. `seo.ts` only stores constants. |
| **OCP** | ✅ Pass | New page = new `<SEO>` call; no modification to existing components. |
| **LSP** | ✅ N/A | No inheritance hierarchy. |
| **ISP** | ✅ Pass | `<SEO>` props are minimal — required (`title`, `description`, `path`) clearly separated from optional (`image`, `type`). |
| **DIP** | ✅ Pass | Pages depend on the `<SEO>` abstraction, not on `react-helmet-async` directly. Swapping libraries later only touches `<SEO>`. |
| **DRY** | ✅ Pass | Centralized site constants in `seo.ts` prevent SITE_URL/SITE_NAME duplication across 7 pages. |
| **KISS** | ✅ Pass | One `<SEO>` component, one config file, two thin JSON-LD wrappers — no factory/strategy patterns. |
| **YAGNI** | ✅ Pass | No multilingual support, no breadcrumb schema, no dynamic sitemap generator — only what is needed today. |
| **Separation of Concerns** | ✅ Pass | All SEO concerns under `src/components/seo/` and `src/config/seo.ts`, isolated from layout/sections. |
| **Composition over Inheritance** | ✅ Pass | Pages compose `<SEO>` + section components. No class hierarchies. |
| **Law of Demeter** | ✅ Pass | `<SEO>` only collaborates with `<Helmet>` directly. |
| **Fail Fast** | ✅ Pass | Required `<SEO>` props enforced at compile time via TypeScript strict mode. |
| **Design Patterns** | ✅ Pass | *Creational*: N/A. *Structural*: light Facade (`<SEO>` wraps `<Helmet>`). *Behavioral*: N/A. No forced patterns. |

## Refactoring Impact

All changes are **additive** — no existing component interfaces change.

| File | Change | Impact | Migration |
|------|--------|--------|-----------|
| `src/index.tsx` | Wrap `<App>` in `<HelmetProvider>`; switch render to react-snap-compatible hydration (`hydrateRoot` if `rootElement.hasChildNodes()` else `createRoot`) | TRANSPARENT to consumers | None |
| `src/App.tsx` | None | — | — |
| `src/pages/HomePage.tsx` | Add `<SEO>` + `<OrganizationLD>` | TRANSPARENT (additive) | None |
| `src/pages/SpectaclePage.tsx` | Add `<SEO>` + `<TheaterEventLD>` | TRANSPARENT | None |
| `src/pages/{Association,Agenda,Billetterie,Soutenir,Contact}Page.tsx` | Add `<SEO>` | TRANSPARENT | None |
| `package.json` | + `react-helmet-async` dep, + `react-snap` devDep, + `postbuild` script, + `reactSnap` config block | Build-time only | None |
| `public/manifest.json` | Replace CRA defaults with real values | None | None |
| `public/robots.txt` | Add `Sitemap:` directive | None | None |
| `public/sitemap.xml` | NEW | None | None |
| `public/og-image.jpg` | NEW (asset) | None | None |
| `src/components/seo/SEO.tsx` | NEW | None (only consumed by pages we control) | None |
| `src/components/seo/StructuredData.tsx` | NEW | None | None |
| `src/config/seo.ts` | NEW | None | None |

**Consumer count**: 0 existing consumers affected. All new `<SEO>` callers are added by this change itself.
**Classification**: 7 TRANSPARENT (page additions), 1 BUILD-TIME (`index.tsx` hydration switch — required by react-snap). Zero BREAKING, zero DEPRECATION.

## Key Assumptions

| Marker | Assumption | Notes |
|--------|------------|-------|
| ✓ Validated | Hosting is Vercel | Confirmed by `@vercel/analytics/react` import in `src/App.tsx` |
| ✓ Validated | Content is French | `lang="fr"` in `public/index.html`; `og:locale="fr_FR"` will be added |
| ✓ Validated | Static routes (no dynamic IDs) | All 7 routes are fixed paths in `App.tsx` |
| ~ Contestable | `react-snap` is the right prerender tool | Maintenance has stalled. Alternatives: `@prerenderer/rollup-plugin`, custom Puppeteer script, Vercel-native prerender. Re-evaluate at `/x-plan` if friction emerges. |
| ~ Contestable | Static `sitemap.xml` is sufficient | True today (7 fixed routes). If routes become data-driven later (e.g., per-performance pages), regenerate at build time. |
| ◐ Blind spot | `TheaterEvent` schema requires real performance dates, venue, ticket URL — currently unknown | Use placeholders in implementation, replace before deploying to production. **Action**: confirm dates/venue with the association before merge. |
| ◐ Blind spot | OG image source — does the project already have a hero/promo image suitable for 1200×630 crop? | If not, will need to commission or generate during `/x-implement`. |

## Risks

| Risk | Mitigation |
|------|------------|
| `react-snap` breaks on a future React/CRA upgrade (it is unmaintained) | Pin version; have `@prerenderer/rollup-plugin` as fallback documented in this ADR |
| Hydration mismatch between prerendered HTML and client React tree (causes flicker / console warnings) | Use `hydrateRoot` only when `rootElement.hasChildNodes()` is true — pattern documented in react-snap README |
| Per-page `<SEO>` props drift from sitemap.xml (e.g., new route forgotten in sitemap) | Static sitemap is hand-maintained; in `/x-plan` add a checklist item for sitemap updates when routes change |
| Headless Chrome fails in Vercel build | If prerender fails, build still produces a working SPA — react-snap failures are non-fatal by default; configure `inlineCss: false` to reduce surface area |
| OG image cached aggressively by social platforms | Use a versioned filename (`og-image-v1.jpg`) when image content changes |

## References

- Audit: `documentation/audits/analysis-seo-2026-05-08.md` (executive summary delivered in conversation; full audit pending Phase 4a write-up)
- `react-helmet-async`: https://github.com/staylor/react-helmet-async
- `react-snap`: https://github.com/stereobooster/react-snap
- Schema.org `TheaterEvent`: https://schema.org/TheaterEvent
- Schema.org `Organization`: https://schema.org/Organization
- Open Graph protocol: https://ogp.me/
- Twitter Card docs: https://developer.twitter.com/en/docs/twitter-for-websites/cards
