# Bloomin' Acres Optimization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce page weight by ~40 MB, eliminate duplicated JS across 6 pages, and consolidate font loading.

**Architecture:** Static site with no build step. Shared JS extracted to external files. Images compressed and converted to WebP. Tailwind CDN pinned to versioned URL.

**Tech Stack:** HTML, CSS, Tailwind CDN, Supabase JS CDN, Google Fonts, sharp (for image conversion)

---

## Task 1: Install sharp and create image optimization script

**Files:**
- Create: `revenue/projects/active/bloomin-acres/scripts/optimize-images.mjs`

**Step 1: Install sharp**

```bash
cd revenue/projects/active/bloomin-acres
npm install sharp --save-dev
```

**Step 2: Create the optimization script**

Create `scripts/optimize-images.mjs`:

```javascript
import sharp from 'sharp';
import { readdir, mkdir, rename } from 'fs/promises';
import { join } from 'path';

const BRAND = 'brand-assets';
const SOURCE = join(BRAND, 'source');

// Files that are source/template only -- move, don't serve
const SOURCE_ONLY = [
  'basket-template.png',
  'basket-background.png',
  'blank-menu-template.png',
];

// Files that must stay PNG (used as favicon or need transparency at small size)
const KEEP_PNG = [
  'color-logo.png',
  'sprout.png',
  'basket-icon.png',
  'badge.png',
];

// Max dimensions and quality
const MAX_WIDTH = 1200;
const WEBP_QUALITY = 80;
const PNG_QUALITY = 80;

async function run() {
  await mkdir(SOURCE, { recursive: true });

  // Move source-only files
  for (const file of SOURCE_ONLY) {
    try {
      await rename(join(BRAND, file), join(SOURCE, file));
      console.log(`Moved to source/: ${file}`);
    } catch (e) {
      if (e.code !== 'ENOENT') console.warn(`Skip move ${file}: ${e.message}`);
    }
  }

  const files = await readdir(BRAND);
  for (const file of files) {
    if (file === 'source' || !file.match(/\.(png|jpg|jpeg)$/i)) continue;
    const input = join(BRAND, file);
    const base = file.replace(/\.(png|jpg|jpeg)$/i, '');

    const img = sharp(input);
    const meta = await img.metadata();
    const needsResize = meta.width > MAX_WIDTH;

    if (KEEP_PNG.includes(file)) {
      // Compress as PNG in-place
      let pipeline = sharp(input);
      if (needsResize) pipeline = pipeline.resize(MAX_WIDTH);
      await pipeline.png({ quality: PNG_QUALITY, compressionLevel: 9 }).toFile(input + '.tmp');
      await rename(input + '.tmp', input);
      console.log(`Compressed PNG: ${file}`);
    } else {
      // Convert to WebP
      let pipeline = sharp(input);
      if (needsResize) pipeline = pipeline.resize(MAX_WIDTH);
      const webpPath = join(BRAND, base + '.webp');
      await pipeline.webp({ quality: WEBP_QUALITY }).toFile(webpPath);
      console.log(`Converted to WebP: ${file} -> ${base}.webp`);
    }
  }
  console.log('Done.');
}

run().catch(console.error);
```

**Step 3: Run the script**

```bash
node scripts/optimize-images.mjs
```

Expected: source-only files moved to `brand-assets/source/`, PNGs compressed, WebP versions created.

**Step 4: Verify image sizes**

```bash
ls -lhS brand-assets/*.webp brand-assets/*.png
```

Expected: all files under 300 KB, most under 150 KB.

**Step 5: Commit**

```bash
git add -A brand-assets/ scripts/optimize-images.mjs package.json package-lock.json
git commit -m "feat: optimize brand assets -- compress PNGs, convert to WebP, relocate source files"
```

---

## Task 2: Update HTML/CSS image references to use WebP

**Files:**
- Modify: `index.html`, `account.html`, `admin.html`, `menu.html`, `club.html`, `product.html`
- Modify: `css/menu.css`, `css/index.css`, `css/account.css`, `css/admin.css` (any CSS referencing brand-assets PNGs)
- Modify: `js/topright-icons.js` (if it references PNGs)

**Step 1: Update all `.png` references to `.webp` for converted files**

For every image that was converted to WebP (NOT the KEEP_PNG files), update references in HTML and CSS.

Files that stay as `.png` (do NOT change these references):
- `color-logo.png` (favicon, OG image)
- `sprout.png`
- `basket-icon.png`
- `badge.png`

Files that change to `.webp`:
- `welcome-banner.png` -> `welcome-banner.webp`
- `farm-background.png` -> `farm-background.webp`
- `club-plaque.png` -> `club-plaque.webp`
- `bread-box-club.png` -> `bread-box-club.webp`
- `sourdough-pastries.png` -> `sourdough-pastries.webp`
- `sourdough-loaves.png` -> `sourdough-loaves.webp`
- `fresh-produce.png` -> `fresh-produce.webp`
- `black-white-logo.png` -> `black-white-logo.webp`
- `Gemini_Generated_Image_ma9csema9csema9c.png` -> `Gemini_Generated_Image_ma9csema9csema9c.webp`
- `menu-template-header.png` -> `menu-template-header.webp`
- `menu-template-footer.png` -> `menu-template-footer.webp`
- `menu-template-middle.png` -> `menu-template-middle.webp`
- `wheat-seperater.png` -> `wheat-seperater.webp`
- `brushstroke-left.png` -> `brushstroke-left.webp`
- `brushstroke-right.png` -> `brushstroke-right.webp`
- `footer.png` -> `footer.webp`
- `basket-background.png` -> moved to source/ (remove reference or keep if needed)
- `basket-header.png` -> `basket-header.webp`

Search all HTML and CSS files for each `.png` filename and replace with `.webp`.

**Step 2: Remove old PNG files that now have WebP versions**

```bash
cd brand-assets
# Remove original PNGs that have been converted to WebP (keep the KEEP_PNG ones)
rm -f welcome-banner.png farm-background.png club-plaque.png bread-box-club.png \
  sourdough-pastries.png sourdough-loaves.png fresh-produce.png black-white-logo.png \
  Gemini_Generated_Image_ma9csema9csema9c.png menu-template-header.png \
  menu-template-footer.png menu-template-middle.png wheat-seperater.png \
  brushstroke-left.png brushstroke-right.png footer.png basket-header.png
```

**Step 3: Test locally**

```bash
node serve.mjs &
# Visit each page and verify images load correctly
node screenshot.mjs http://localhost:3000 post-webp
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: update image references from PNG to WebP"
```

---

## Task 3: Create js/tailwind-config.js

**Files:**
- Create: `revenue/projects/active/bloomin-acres/js/tailwind-config.js`
- Modify: all 6 HTML files (remove inline config, add script tag)

**Step 1: Create the unified config file**

Create `js/tailwind-config.js` with BOTH color naming schemes so all existing classes work:

```javascript
tailwind.config = {
  theme: {
    extend: {
      colors: {
        // Scheme A (index, account, club)
        wheat: '#EDA339',
        sage: '#7A9B8E',
        'sage-dark': '#4E6E64',
        'sage-light': '#A8C4BB',
        rust: '#C85A3A',
        berry: '#8B3A3A',
        earth: '#4A3322',
        'earth-mid': '#6B4C35',
        cream: '#FAF0E6',
        'cream-dark': '#F0E4D0',
        'cream-warm': '#EDD9B8',
        // Scheme B aliases (admin, menu, product)
        'wheat-gold': '#EDA339',
        'sage-green': '#7A9B8E',
        'burnt-orange': '#C85A3A',
        'earth-brown': '#4A3322',
        'farm-cream': '#FAF0E6',
      },
      fontFamily: {
        display: ['"Playfair Display"', 'Georgia', 'serif'],
        playfair: ['"Playfair Display"', 'Georgia', 'serif'],
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
        lora: ['"Lora"', 'Georgia', 'serif'],
      },
    },
  },
};
```

**Step 2: In each HTML file, replace the inline Tailwind config + CDN script**

Replace:
```html
<script src="https://cdn.tailwindcss.com"></script>
<script>
  tailwind.config = { ... }
</script>
```

With:
```html
<script src="https://cdn.tailwindcss.com/3.4.17"></script>
<script src="/js/tailwind-config.js"></script>
```

Do this in all 6 files: `index.html`, `account.html`, `admin.html`, `menu.html`, `club.html`, `product.html`.

**Step 3: Verify pages render correctly**

```bash
node screenshot.mjs http://localhost:3000 post-tw-config
```

Check that colors and fonts render the same as before.

**Step 4: Commit**

```bash
git add js/tailwind-config.js index.html account.html admin.html menu.html club.html product.html
git commit -m "refactor: extract shared Tailwind config to js/tailwind-config.js, pin CDN to 3.4.17"
```

---

## Task 4: Create js/shared.js (nav toggle + pageshow handler)

**Files:**
- Create: `revenue/projects/active/bloomin-acres/js/shared.js`
- Modify: all 6 HTML files (remove inline nav toggle, add shared.js script tag)

**Step 1: Create shared.js**

```javascript
/**
 * shared.js -- Common functionality across all Bloomin' Acres pages.
 * - Navigation sidebar toggle
 * - Pageshow handler (re-enable buttons after back/forward cache)
 */

// ── Navigation sidebar toggle ──
(() => {
  const toggle  = document.getElementById('nav-toggle');
  const sidebar = document.getElementById('nav-sidebar');
  const overlay = document.getElementById('nav-overlay');
  if (!toggle || !sidebar || !overlay) return;

  function openNav() {
    sidebar.classList.add('open');
    overlay.classList.add('open');
    toggle.classList.add('open');
    toggle.setAttribute('aria-expanded', 'true');
  }
  function closeNav() {
    sidebar.classList.remove('open');
    overlay.classList.remove('open');
    toggle.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
  }

  toggle.addEventListener('click', () => sidebar.classList.contains('open') ? closeNav() : openNav());
  overlay.addEventListener('click', closeNav);

  sidebar.querySelectorAll('.nav-sidebar-link').forEach(link => {
    link.addEventListener('click', closeNav);
  });

  // My Account submenu toggle (not present on admin page)
  const acctToggle = document.getElementById('sidebar-account-toggle');
  const acctItem   = document.getElementById('sidebar-account-item');
  if (acctToggle && acctItem) {
    acctToggle.addEventListener('click', () => {
      const open = acctItem.classList.toggle('open');
      acctToggle.setAttribute('aria-expanded', open);
    });
  }

  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeNav(); });
})();

// ── Pageshow: re-enable buttons after back/forward cache ──
window.addEventListener('pageshow', function(e) {
  if (!e.persisted) return;

  // Cart checkout button (account.html)
  const ckBtn = document.getElementById('checkout-btn');
  if (ckBtn) { ckBtn.disabled = false; ckBtn.textContent = 'Checkout'; }

  // Club join button (account.html)
  const clubBtn = document.getElementById('join-club-btn');
  if (clubBtn) { clubBtn.disabled = false; clubBtn.textContent = 'Join the Club'; }

  // Club join buttons (club.html)
  var joinTexts = { 'join-btn': 'Join the Club', 'join-btn-2': 'Join the Club', 'join-btn-3': 'Join to Get Your Code' };
  Object.keys(joinTexts).forEach(function(id) {
    var btn = document.getElementById(id);
    if (btn) { btn.disabled = false; btn.textContent = joinTexts[id]; }
  });
});
```

**Step 2: Remove inline nav toggle scripts from all 6 HTML files**

In each file, find and remove the `<script>` block containing the nav toggle IIFE (the block starting with `(() => { const toggle = document.getElementById('nav-toggle');` and ending with `})();`).

Also remove the separate pageshow handlers from account.html and club.html (they're now in shared.js).

**Step 3: Add shared.js to all 6 HTML files**

Add this after the nav HTML, before page-specific scripts:

```html
<script src="/js/shared.js" defer></script>
```

**Step 4: Test navigation on all pages**

Start server and test that hamburger menu opens/closes on each page. Test back button behavior on account and club checkout flows.

**Step 5: Commit**

```bash
git add js/shared.js index.html account.html admin.html menu.html club.html product.html
git commit -m "refactor: extract nav toggle and pageshow handler to js/shared.js"
```

---

## Task 5: Consolidate Google Fonts

**Files:**
- Modify: all 6 HTML files

**Step 1: Replace font links in all 6 files**

Replace each page's font `<link>` tags (the preconnect + stylesheet lines) with this unified set:

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,500;1,400&family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400;1,600&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap" rel="stylesheet" />
```

This covers all three families (Playfair Display, DM Sans, Lora) with all weights used anywhere.

**Step 2: Verify fonts render correctly**

Screenshot each page and compare to pre-optimization screenshots.

**Step 3: Commit**

```bash
git add index.html account.html admin.html menu.html club.html product.html
git commit -m "refactor: consolidate Google Fonts to single unified request"
```

---

## Task 6: Full visual verification and push

**Step 1: Start dev server and screenshot all pages**

```bash
cd revenue/projects/active/bloomin-acres
node serve.mjs &
node screenshot.mjs http://localhost:3000 final-index
node screenshot.mjs http://localhost:3000/menu.html final-menu
node screenshot.mjs http://localhost:3000/club.html final-club
node screenshot.mjs http://localhost:3000/product.html final-product
node screenshot.mjs http://localhost:3000/account.html final-account
node screenshot.mjs http://localhost:3000/admin.html final-admin
```

**Step 2: Review all screenshots**

Read each screenshot and verify:
- Images load correctly (no broken images)
- Colors match (Tailwind config working)
- Fonts render properly (no fallback fonts visible)
- Navigation opens/closes
- Page layouts intact

**Step 3: Check served asset sizes**

```bash
ls -lhS brand-assets/*.webp brand-assets/*.png
```

Verify no served image over 300 KB.

**Step 4: Push to deploy**

```bash
git push
```

Expected: Vercel auto-deploys.

---

## Summary

| Task | What | Commit |
|------|------|--------|
| 1 | Image optimization script + run | compress/convert/relocate |
| 2 | Update image refs to WebP | swap .png -> .webp in HTML/CSS |
| 3 | Extract Tailwind config | js/tailwind-config.js, pin CDN |
| 4 | Extract shared JS | js/shared.js (nav + pageshow) |
| 5 | Consolidate fonts | single Google Fonts URL |
| 6 | Verify + push | screenshots, size check, deploy |
