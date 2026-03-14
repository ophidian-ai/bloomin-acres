# Bloomin' Acres Website Optimization -- Design Doc

**Date:** 2026-03-07
**Approach:** B (Moderate Refactor)
**Status:** Approved

## Problem

The Bloomin' Acres website has accumulated technical debt that impacts load times and maintainability:

- 42 MB of unoptimized brand assets (PNGs up to 8 MB each)
- Navigation JS, Supabase init, and Tailwind config duplicated across all 6 HTML pages
- 3 different Google Fonts requests with inconsistent weight sets
- Tailwind CDN loaded unpinned on every page (no caching)

## Scope

### In Scope

1. **Image optimization** -- compress, convert to WebP, relocate source-only files
2. **Shared JS extraction** -- `js/shared.js` and `js/tailwind-config.js`
3. **Font consolidation** -- single unified Google Fonts request
4. **Tailwind CDN pinning** -- version-lock for caching

### Out of Scope (Deferred)

- Tailwind compilation / build step
- Component/template system for HTML deduplication (nav, footer)
- CSS consolidation or migration away from Tailwind+custom hybrid

## Section 1: Image Optimization

**Goal:** Reduce brand-assets from ~42 MB to under 5 MB served.

- Compress all PNGs used on the site to < 150 KB (hero images < 300 KB)
- Convert to WebP where possible; keep PNG for favicon
- Move source/template files to `brand-assets/source/`:
  - `basket-template.png` (8.0 MB)
  - `basket-background.png` (7.7 MB)
  - `blank-menu-template.png` (1.5 MB)
- Compress remaining assets:
  - `sourdough-pastries.png` (3.1 MB) -> WebP
  - `bread-box-club.png` (3.6 MB) -> WebP
  - `fresh-produce.png` (3.1 MB) -> WebP
  - `sourdough-loaves.png` (2.8 MB) -> WebP
  - `farm-background.png` (2.4 MB) -> WebP
  - `Gemini_Generated_Image_ma9csema9csema9c.png` (3.0 MB) -> WebP
  - `black-white-logo.png` (1.4 MB) -> WebP
  - `color-logo.png` (872 KB) -> compressed PNG (favicon use)
  - `club-plaque.png` (980 KB) -> WebP
  - `sprout.png` (828 KB) -> compressed PNG
  - `welcome-banner.png` (504 KB) -> WebP

## Section 2: Shared JavaScript Extraction

**Goal:** Eliminate duplicated JS across 6 pages.

### js/shared.js

Contains:
- Navigation sidebar toggle logic (~35 lines)
- Supabase client initialization (fetch config, create client, expose `sb` globally)
- `pageshow` handler for re-enabling buttons on back/forward cache restore

Each HTML file removes its inline copies and adds:
```html
<script src="/js/shared.js" defer></script>
```

Page-specific JS remains inline in each file.

### js/tailwind-config.js

Contains the shared `tailwind.config` block (colors, fonts, extensions).

Loaded before Tailwind processes classes:
```html
<script src="https://cdn.tailwindcss.com/3.4.17"></script>
<script src="/js/tailwind-config.js"></script>
```

## Section 3: Font Consolidation

**Goal:** 1 Google Fonts request instead of 3, consistent across all pages.

Unified URL:
```
https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400;1,600&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&family=Lora:ital,wght@0,400;0,500;1,400&display=swap
```

All 6 pages use this same link. Browser cache is shared across page navigations.

Add `<link rel="preload">` for the font CSS.

## Section 4: Tailwind CDN Pinning

**Goal:** Make Tailwind CDN cacheable between visits.

- Pin to specific version: `https://cdn.tailwindcss.com/3.4.17`
- Extract config to `js/tailwind-config.js` (see Section 2)
- Future: compile Tailwind at build time to eliminate CDN entirely

## Pages Affected

All 6 HTML files:
- `index.html`
- `account.html`
- `admin.html`
- `menu.html`
- `club.html`
- `product.html`

## Risk

- Extracting shared JS requires testing all 6 pages (nav, auth, cart)
- Image compression must be verified visually for quality
- Font changes could cause subtle layout shifts if weights don't match exactly

## Success Criteria

- No single served image over 300 KB
- Zero duplicated JS blocks across pages
- Single Google Fonts request
- All 6 pages function correctly (nav, auth, cart, checkout)
