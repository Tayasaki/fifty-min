---
type: plan
skill: x-plan
created: 2026-04-03
target: "Modern single-page website for the musical comedy '15 minutes' by Mélange de Genres"
status: draft
---

# Plan: "15 minutes" — Site Web Mélange de Genres

## Context

The association Mélange de Genres is producing its first original musical comedy, **"15 minutes"** (season 2026-2027), inspired by Andy Warhol's quote on ephemeral celebrity in the age of social media. They need a presentable website to introduce the show, the association, collect donations (Leetchi + IBAN), and handle future ticketing.

**Starting point**: Default Create React App boilerplate (React 19, effectively empty).
**Goal**: A polished, animated, single-page website with a "Digital Stage" aesthetic — dark theatrical atmosphere meets social media UI — using Tailwind CSS, shadcn/ui components, and Framer Motion animations.

---

## Complexity

- **Track**: Standard+ (19 files total: 15 new, 4 modified)
- **Layers**: Configuration → UI primitives → Layout → Content sections → Integration
- **Dependencies**: 7 new npm packages required

---

## Tasks

- [ ] **Task 1 — Asset prep**: Copy `WhatsApp Image 2026-04-03 at 14.39.06.jpeg` → `src/assets/logo.jpg`
- [ ] **Task 2 — npm installs**: Install all missing dependencies in one command
- [ ] **Task 3 — Tailwind config**: Create `tailwind.config.js` (activates Tailwind in CRA webpack)
- [ ] **Task 4 — Global styles**: Rewrite `src/index.css` with Tailwind directives + CSS custom properties
- [ ] **Task 5 — HTML shell**: Update `public/index.html` with Google Fonts, title, SEO meta
- [ ] **Task 6 — cn() utility**: Create `src/lib/utils.js`
- [ ] **Task 7 — shadcn Button**: Create `src/components/ui/button.jsx`
- [ ] **Task 8 — shadcn Card**: Create `src/components/ui/card.jsx`
- [ ] **Task 9 — shadcn Badge**: Create `src/components/ui/badge.jsx`
- [ ] **Task 10 — Navbar**: Create `src/components/layout/Navbar.jsx`
- [ ] **Task 11 — Footer**: Create `src/components/layout/Footer.jsx`
- [ ] **Task 12 — HeroSection**: Create `src/components/sections/HeroSection.jsx`
- [ ] **Task 13 — ShowSection**: Create `src/components/sections/ShowSection.jsx`
- [ ] **Task 14 — AssociationSection**: Create `src/components/sections/AssociationSection.jsx`
- [ ] **Task 15 — EventsSection**: Create `src/components/sections/EventsSection.jsx` (coming soon)
- [ ] **Task 16 — SupportSection**: Create `src/components/sections/SupportSection.jsx`
- [ ] **Task 17 — TicketingSection**: Create `src/components/sections/TicketingSection.jsx` (coming soon)
- [ ] **Task 18 — ContactSection**: Create `src/components/sections/ContactSection.jsx`
- [ ] **Task 19 — App integration**: Rewrite `src/App.js` to assemble all sections

---

## Critical Files

| Path | Role | Action |
|------|------|--------|
| `tailwind.config.js` | CRA Tailwind activation + custom theme tokens (colors, fonts, shadows) | **CREATE** |
| `src/index.css` | `@tailwind` directives + CSS custom properties + font definitions | **MODIFY** |
| `public/index.html` | Google Fonts (Playfair Display, Inter), title "15 minutes — Mélange de Genres", meta description | **MODIFY** |
| `src/lib/utils.js` | `cn()` = `twMerge(clsx(...inputs))` — used by all shadcn components | **CREATE** |
| `src/assets/logo.jpg` | Logo file (teal/purple loops) | **CREATE** (copy) |
| `src/App.js` | Root assembly: `<Navbar>` + all sections + `<Footer>` | **MODIFY** |
| `src/components/ui/button.jsx` | shadcn Button with CVA variants (default, outline, ghost) | **CREATE** |
| `src/components/ui/card.jsx` | shadcn Card family (Card, CardHeader, CardContent, CardTitle, CardDescription) | **CREATE** |
| `src/components/ui/badge.jsx` | shadcn Badge with CVA variants | **CREATE** |
| `src/components/layout/Navbar.jsx` | Sticky navbar with logo, smooth-scroll links, mobile-responsive | **CREATE** |
| `src/components/layout/Footer.jsx` | Footer with association name, email, copyright | **CREATE** |
| `src/components/sections/HeroSection.jsx` | Full-viewport hero: spotlight gradient, show title, Warhol quote, animated musical notes | **CREATE** |
| `src/components/sections/ShowSection.jsx` | Show details: director, 6 characters, themes, Romy/Silicon Valley guide | **CREATE** |
| `src/components/sections/AssociationSection.jsx` | Association history (2019→2025), mission, values | **CREATE** |
| `src/components/sections/EventsSection.jsx` | Coming soon placeholder | **CREATE** |
| `src/components/sections/SupportSection.jsx` | Leetchi CTA button, IBAN display, volunteer roles grid (8 roles) | **CREATE** |
| `src/components/sections/TicketingSection.jsx` | Coming soon placeholder | **CREATE** |
| `src/components/sections/ContactSection.jsx` | Contact card: Nora Spycher, phone, email mailto link | **CREATE** |

---

## Dependencies

**Single install command:**
```bash
npm install framer-motion clsx tailwind-merge tailwindcss-animate class-variance-authority lucide-react @radix-ui/react-slot
```

| Package | Purpose |
|---------|---------|
| `framer-motion` | Section entrance animations, hero effects, hover animations |
| `clsx` | Conditional className utility |
| `tailwind-merge` | Merge Tailwind classes without conflicts (used in `cn()`) |
| `tailwindcss-animate` | Adds `animate-*` Tailwind utilities used by shadcn |
| `class-variance-authority` | `cva()` for shadcn component variant system |
| `lucide-react` | Icons (Mail, Phone, ExternalLink, Music, etc.) |
| `@radix-ui/react-slot` | shadcn Button `asChild` prop support (React 19 compatible: use `^1.1.0`) |

> **Note**: `tailwindcss`, `postcss`, `autoprefixer` are already in `node_modules` (bundled by `react-scripts@5.0.1`). CRA automatically activates Tailwind when `tailwind.config.js` exists — no `postcss.config.js` needed, no CRACO needed.

---

## Design System

### Colors
```js
background:  '#0A0A0A'   // stage black
surface:     '#141414'   // card panels
teal:        '#4ECDC4'   // primary accent (from logo)
purple:      '#B8A9C9'   // secondary accent (from logo)
gold:        '#FFD700'   // highlight accent
```

### Typography
- **Display headings**: Playfair Display (serif, theatrical) via Google Fonts
- **Body**: Inter (clean sans-serif) via Google Fonts

### Key Animations (Framer Motion)
- Hero title: `fadeInUp` on load
- Sections: `whileInView` slide-up fade-in (each section triggers when scrolled into view)
- Navbar: subtle backdrop blur on scroll
- Buttons: `whileHover` scale + shadow glow
- Musical notes in hero: `float` keyframe (CSS animation)

### Logo rendering
Use `mix-blend-mode: screen` on the logo `<img>` tag — makes the white background transparent on dark surfaces, keeping teal/purple colors visible. No image editing needed.

---

## Sprint Contract

### Machine-verifiable
- [ ] `npm start` launches with no compile errors
- [ ] `npm run build` completes with no errors
- [ ] No TypeScript/ESLint errors in build output

### Human-verifiable
- [ ] Dark background visible (confirms Tailwind is active)
- [ ] Navbar has 7 links: Accueil, Le spectacle, L'association, Ateliers, Soutenir, Billetterie, Contact
- [ ] All 7 nav links smooth-scroll to correct sections (each section has matching `id`)
- [ ] Logo renders correctly (no white box on dark background due to `mix-blend-mode: screen`)
- [ ] Hero displays "15 minutes" title + Warhol quote in Playfair Display font
- [ ] ShowSection lists characters: Riley, Sacha, Noah, Morgan, Andy, Camille
- [ ] Director credit: Nora "Pâris" Spycher
- [ ] Leetchi link opens `https://www.leetchi.com/fr/c/creation-du-projet-15-minutes-2844830` in new tab
- [ ] IBAN displayed: `CH08 0900 0000 1685 1713 2`
- [ ] Contact email `infomelangesdegenres@gmail.com` works as `mailto:` link
- [ ] Section entrance animations trigger on scroll
- [ ] Mobile-responsive at 375px (no horizontal overflow)

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| shadcn CLI incompatible with CRA | MEDIUM — CLI aborts or produces broken config | Use manual installation (copy component source, use relative imports) |
| Logo white background on dark theme | LOW — visual artifact | `mix-blend-mode: screen` on `<img>` (one CSS property) |
| React 19 + framer-motion | LOW — double-render in StrictMode | Use `framer-motion@^11.x` which has React 19 support |
| No path aliases (`@/`) in CRA | LOW — verbosity | Use relative imports throughout; establish clear depth convention |
| Tailwind not in project `package.json` | LOW — future npm install might restructure | Acceptable for now; version tied to react-scripts@5.0.1 |

---

## Execution Strategy

**Pattern**: Sequential phases, single implementer (no parallelization needed — this is a greenfield build with no existing code to protect).

**Phase order**: Config → UI primitives → Layout → Sections → Integration

**Sections can be built in any order** (they are independent of each other). Suggested order: Hero → Show → Association → Support → Contact → Events (coming soon) → Ticketing (coming soon).

---

## Success Criteria

- [ ] Website renders end-to-end with all 7 sections visible
- [ ] All content from the DOCX is present and correctly attributed
- [ ] Framer Motion animations work (entrance, hover)
- [ ] shadcn Button, Card, Badge components used in at least 3 sections each
- [ ] Mobile-responsive layout (375px width)
- [ ] Production build passes (`npm run build`)
- [ ] Logo renders cleanly on dark background
