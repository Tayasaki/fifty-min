---
type: brainstorm
skill: x-brainstorm
created: 2026-05-05
target: "Multi-page navigation + AI text cleanup"
status: draft
---

# Brainstorm: Multi-page navigation & text rewrite

## Problem Statement

Two independent improvements requested by the app owner:

1. **Navigation clarity**: The current SPA with scroll + anchor links makes it unclear where you are
   and what page you're on. Moving to distinct routes (React Router) would give each section its
   own URL, allow shareable links, and improve perceived structure.

2. **AI-sounding text**: Several phrases across `ShowSection.tsx` and `AssociationSection.tsx`
   have AI-generation markers (French formulas like "s'inscrire dans une démarche", "ancré dans
   les réalités contemporaines", "à travers un prisme"). These undermine the authentic human voice
   that the rest of the content establishes well.

---

## Requirements

### Must Have

#### Multi-page migration
- [ ] Install `react-router-dom` v6
- [ ] Define 7 routes: `/`, `/spectacle`, `/association`, `/agenda`, `/billetterie`, `/soutenir`, `/contact`
- [ ] Navbar links updated from scroll anchors to `<Link>` components
- [ ] Hero CTA buttons ("Découvrir le spectacle" → `/spectacle`, "Nous soutenir" → `/soutenir`) updated to route links
- [ ] `ScrollToTop` utility: scroll to top on every route change
- [ ] 404 fallback: redirect unknown routes to `/`

#### Text rewrite (8 specific phrases)
All in `ShowSection.tsx` and `AssociationSection.tsx`:

| # | File | Current | Proposed replacement |
|---|------|---------|----------------------|
| 1 | ShowSection — Mise en scène (back) | "Un processus de création collaboratif qui implique les interprètes tout au long du projet." | "Les interprètes participent activement à la création — pas seulement en répétition." |
| 2 | ShowSection — Mise en scène (back) | "Le spectacle s'inscrit dans une démarche pédagogique : ateliers de réflexion sur les réseaux sociaux et collaborations avec des institutions éducatives." | "Au-delà de la scène : des ateliers dans les écoles, des discussions ouvertes, pour que 15 minutes devienne aussi un outil de conversation." |
| 3 | ShowSection — Distribution (back) | "Une équipe de jeunes interprètes favorisant une forte identification du public." | "De jeunes interprètes — des têtes que le public reconnaît dans ses propres cercles." |
| 4 | ShowSection — Musiques (back) | "Un choix musical accessible, dynamique et ancré dans les codes culturels contemporains." | "Des titres que vous connaissez — revisités pour servir l'histoire." |
| 5 | ShowSection — Thèmes subtitle | "Un outil artistique et pédagogique ancré dans les réalités contemporaines." | "Les questions que 15 minutes pose sur scène." |
| 6 | AssociationSection — Créer des ponts (detail) | "S'inscrire dans une démarche de transmission durable, au-delà de chaque projet." | "Transmettre quelque chose qui dépasse la durée d'une représentation." |
| 7 | AssociationSection — Encourager l'esprit critique (detail) | "Aborder des thèmes de société — réseaux sociaux, identité numérique, célébrité éphémère — à travers un prisme artistique et accessible." | "Mettre des mots sur ce qu'on vit avec les réseaux sociaux, l'identité numérique, la célébrité éphémère — grâce à l'art." |
| 8 | AssociationSection — main paragraph | "...en proposant des formes artistiques populaires comme la comédie musicale en tant qu'outils de dialogue et d'expression collective." | "...en choisissant des formes artistiques que tout le monde peut s'approprier — comme la comédie musicale." |

### Should Have
- [ ] Active route highlighting in Navbar (current section indicated)
- [ ] `document.title` updated per page (e.g. "Billetterie — 15 minutes")

### Could Have
- [ ] Framer Motion page transitions (AnimatePresence on route change)
- [ ] Deployment `_redirects` or `vercel.json` config for SPA fallback on static hosting

### Won't Have (this iteration)
- Code-splitting per route (app is too small to benefit)
- Server-side rendering (CRA constraint)
- i18n / language switching

---

## Constraints
- CRA (Create React App) — no ejecting, no Vite migration
- No `@/` path aliases
- pnpm only
- Existing section components must be preserved as-is (routing wraps them, doesn't replace them)

---

## Recommended sequencing
1. **Text rewrite first** — surgical, zero risk, immediate quality improvement
2. **Multi-page migration** — slightly more structural, ~5 files affected

---

## Success Metrics
- All 7 sections accessible via direct URL
- Browser back/forward works correctly between sections
- No AI-sounding phrases remaining in ShowSection or AssociationSection
- Navbar clearly indicates which page is active
