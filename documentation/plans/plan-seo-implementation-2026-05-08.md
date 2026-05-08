---
type: plan
skill: x-plan
created: 2026-05-08
target: "SEO implementation — react-helmet-async + react-snap prerender for CRA SPA"
status: approved
adr: documentation/decisions/ADR-001-seo-strategy-cra-spa.md
---

# Plan: SEO Implementation

## Context

Per ADR-001, the 15-minutes CRA SPA needs: per-page `<title>`/meta via `react-helmet-async`,
Open Graph + Twitter Card tags, JSON-LD structured data, a `sitemap.xml`, canonical URLs, and
build-time prerendering via `react-snap` so social crawlers see real HTML.

SITE_URL: `https://melangedegenres.vercel.app`

## Complexity

Track: **Standard** | Files: 16 | Layers: 2 | Breaking changes: none

## Tasks

### Phase A — quick wins (parallel)

- [x] T1 Fix `public/manifest.json` — real app name, theme/background colors
- [x] T2 Update `public/robots.txt` — add Sitemap directive
- [x] T3 Create `src/config/seo.ts` — SITE_URL, SITE_NAME, DEFAULT_OG_IMAGE, PAGE_META map

### Phase B — components (parallel, after T3)

- [x] T4 Install deps: `pnpm add react-helmet-async` + `pnpm add -D react-snap`; add postbuild script
- [x] T5 Create `src/components/seo/SEO.tsx` — Helmet wrapper with all tags
- [x] T6 Create `src/components/seo/StructuredData.tsx` — OrganizationLD + TheaterEventLD

### Phase C — wiring (sequential)

- [x] T7 Update `src/index.tsx` — HelmetProvider + react-snap hydration
- [x] T8 Add `<SEO>` to all 7 page components

### Phase D — static assets

- [x] T9 Create `public/sitemap.xml` — 7 routes
- [x] T10 Create `ARCHITECTURE.md` — V-ADA-01 remedy
- [ ] T11 OG image — manual step (designer sources 1200×630 asset)

### Phase E — verification

- [ ] T12 `pnpm run build` → check build/ has ≥8 HTML files with route-specific titles

## Critical Files

| File | Change | Role |
|------|--------|------|
| `src/index.tsx` | MODIFY | HelmetProvider + hydration |
| `src/config/seo.ts` | CREATE | Site constants + per-route metadata |
| `src/components/seo/SEO.tsx` | CREATE | Per-page meta component |
| `src/components/seo/StructuredData.tsx` | CREATE | JSON-LD components |
| `src/pages/HomePage.tsx` | MODIFY | + SEO + OrganizationLD |
| `src/pages/SpectaclePage.tsx` | MODIFY | + SEO + TheaterEventLD |
| `src/pages/{Association,Agenda,Billetterie,Soutenir,Contact}Page.tsx` | MODIFY | + SEO |
| `package.json` | MODIFY | + deps + postbuild |
| `public/manifest.json` | MODIFY | Fix CRA defaults |
| `public/robots.txt` | MODIFY | Add Sitemap directive |
| `public/sitemap.xml` | CREATE | 7 routes |
| `ARCHITECTURE.md` | CREATE | V-ADA-01 |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| react-snap + React 19 incompatibility | HIGH | Fallback: custom Puppeteer script (ADR-001 Risks) |
| OG image missing | MEDIUM | SVG placeholder committed; real image added later |
| SITE_URL change to custom domain | LOW | Single constant in seo.ts |

## Success Criteria

- [ ] `pnpm run build` exits 0 with react-snap postbuild
- [ ] `build/` contains ≥ 8 HTML files
- [ ] Each route's HTML has route-specific `<title>` and `<meta description>`
- [ ] `<meta property="og:image">` and `<meta name="twitter:card">` in every route
- [ ] `public/sitemap.xml` valid XML, 7 `<url>` entries
- [ ] `public/manifest.json` no CRA defaults
- [ ] TypeScript strict: 0 errors
- [ ] `pnpm start`: no console errors, `<title>` updates on navigation
