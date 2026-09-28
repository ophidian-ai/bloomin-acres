# Website Conversion Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the navigation, discoverability, and conversion gaps from the 2026-09-27 website audit so the Breadbox Club subscription, the referral program, and returning-subscriber reordering are all reachable from every page, without a nav-component refactor or rebuilding the existing Club box-builder feature.

**Architecture:** Each of the 4 static pages (`index.html`, `menu.html`, `club.html`, `account.html`) keeps its own inline nav markup (they already share the same CSS classes and drawer JS in `js/shared.js`, but differ in a few page-specific IDs — e.g. `menu-sidebar-signin` vs `sidebar-signin-link` — so a shared-component refactor is out of scope here and riskier than it's worth). This plan adds the same missing links to each page's existing nav instead. The homepage gets one new promo section. The menu page's already-working "unavailable" state gets a small fix (no stale date banner) and a CTA. The account page's already-existing auth card and Club box-builder get cross-linking copy rather than a new feature.

**Tech Stack:** Static HTML/Tailwind-CDN/vanilla JS, no build step for HTML/CSS/JS changes (Tailwind classes used here already exist in the compiled `css/tailwind.css`; this plan doesn't add new Tailwind utility classes, only existing custom CSS in `css/*.css`). No automated test suite — verification is manual via `npm run serve` and a browser.

**Spec:** `website-audit-2026-09-27.pdf` (Bloomin' Acres website audit, 2026-09-27), provided by the client. This plan implements the audit's findings **as verified against the current codebase** — see the note at the end about three findings that were already fixed before this plan started.

## Global Constraints

- Mobile-first responsive design; every new interactive element needs hover, focus-visible, and active states (existing `.cta-btn`/`.club-cta-btn` classes already do — reuse them).
- Use the brand palette already defined in `css/global.css` `:root` (`--burnt-orange #9E3E3E`, `--sage-green`, `--wheat-gold`, `--earth-brown`, `--farm-cream`, etc.) — do not invent new colors.
- Only animate `transform` and `opacity`, never `transition-all` (existing `.cta-btn` already follows this — match it).
- No new runtime dependencies.
- Work on `design/frontend-developer/conversion-audit-fixes` (already checked out off `main`). Never push directly to `main` — ships as a PR per the project's CLAUDE.md.
- Visual/brand colors are explicitly out of scope per Christina's own audit brief — don't restyle anything beyond what each task calls for.

## Review Focus

- **Nav additions must not duplicate ids.** Each page already uses page-specific ids for its account/signin elements (`sidebar-signin-link` vs `menu-sidebar-signin`) — new links added to a page's nav must not collide with ids already used by that page's own JS (`js/shared.js`, `js/menu.js`, `js/club.js`, `js/account.js`).
- **Homepage anchor links only work on the homepage.** `club.html`/`account.html` nav currently has no "Our Story"/"Market Schedule"/"What We Make"/"Visit Us" links at all; when adding them, they must point to `/#welcome` etc. (the pattern `menu.html` already uses), not bare `#welcome` (which would 404-scroll on a page with no such section).
- **Menu-unavailable state must still work when `menu_schedule.message` is null.** `js/menu.js`'s existing fallback (`sched.message || "Our menu isn't available right now — check back soon!"`) must keep working after this plan's change reorders the unavailable-state rendering.
- **Guest/logged-out account page must not break the existing `?tab=` redirect-after-login flow.** `js/account.js` already reads a target tab from the URL to route into the dashboard post sign-in; the new dynamic auth-card copy must read the same tab value without altering that redirect behavior.
- **Image optimization must not silently drop a file the code still references.** `scripts/optimize-images.mjs` renames processed files (png/jpg → `.webp`, `KEEP_PNG` list stays `.png`); after running it, every `<img src="brand-assets/...">` in the 5 HTML pages must still resolve — non-`KEEP_PNG` files change extension.

---

### Task 1: Fix footer tagline typo

**Files:**
- Modify: `index.html`
- Modify: `club.html`

**Interfaces:** None — text-only change.

- [ ] **Step 1: Fix `index.html`**

```html
<!-- Before (line 556): -->
      <span class="footer-tagline">
        Homeground &nbsp;·&nbsp; Homemade &nbsp;·&nbsp; Heartfelt
      </span>

<!-- After: -->
      <span class="footer-tagline">
        Homegrown &nbsp;·&nbsp; Homemade &nbsp;·&nbsp; Heartfelt
      </span>
```

- [ ] **Step 2: Fix `club.html`**

```html
<!-- Before (line 347): -->
    <p class="footer-tagline">Homeground &nbsp;·&nbsp; Homemade &nbsp;·&nbsp; Heartfelt</p>

<!-- After: -->
    <p class="footer-tagline">Homegrown &nbsp;·&nbsp; Homemade &nbsp;·&nbsp; Heartfelt</p>
```

- [ ] **Step 3: Verify**

Run: `npm run serve`, open `/` and `/club.html`, check the footer tagline reads "Homegrown · Homemade · Heartfelt" on both (matches the hero's "Homegrown · Homemade · Heartfelt" wording).

- [ ] **Step 4: Commit**

```bash
git add index.html club.html
git commit -m "fix: correct 'Homeground' typo to 'Homegrown' in footer tagline"
```

---

### Task 2: Unify navigation — add missing links to every page

**Files:**
- Modify: `menu.html`
- Modify: `club.html`
- Modify: `account.html`
- Modify: `index.html`

**Interfaces:**
- Produces: a `id="referral"` anchor on `club.html`'s referral section, which the new "Refer & Earn" nav links on every page point to (`club.html#referral`).

- [ ] **Step 1: Add an anchor id to the referral section in `club.html`**

```html
<!-- Before: -->
<section class="club-section-outer referral-section">

<!-- After: -->
<section id="referral" class="club-section-outer referral-section">
```

- [ ] **Step 2: `menu.html` — add The Club and Refer & Earn links**

```html
<!-- Before: -->
      <a href="/" class="nav-sidebar-link">Home</a>
      <a href="menu.html" class="nav-sidebar-link accent">Menu</a>
      <a href="/#what-we-make" class="nav-sidebar-link">What We Make</a>
      <a href="/#visit" class="nav-sidebar-link">Visit Us</a>

<!-- After: -->
      <a href="/" class="nav-sidebar-link">Home</a>
      <a href="menu.html" class="nav-sidebar-link accent">Menu</a>
      <a href="/#what-we-make" class="nav-sidebar-link">What We Make</a>
      <a href="club.html" class="nav-sidebar-link">The Club</a>
      <a href="club.html#referral" class="nav-sidebar-link">Refer &amp; Earn</a>
      <a href="/#visit" class="nav-sidebar-link">Visit Us</a>
```

- [ ] **Step 3: `club.html` — add the anchor-based homepage links and Refer & Earn**

```html
<!-- Before: -->
  <nav>
    <a href="/"  class="nav-sidebar-link">Home</a>
    <a href="menu.html"   class="nav-sidebar-link accent">Menu</a>
    <a href="club.html"   class="nav-sidebar-link">The Club</a>

<!-- After: -->
  <nav>
    <a href="/"  class="nav-sidebar-link">Home</a>
    <a href="/#welcome" class="nav-sidebar-link">Our Story</a>
    <a href="/#market-schedule" class="nav-sidebar-link">Market Schedule</a>
    <a href="/#what-we-make" class="nav-sidebar-link">What We Make</a>
    <a href="menu.html"   class="nav-sidebar-link">Menu</a>
    <a href="club.html"   class="nav-sidebar-link accent">The Club</a>
    <a href="club.html#referral" class="nav-sidebar-link">Refer &amp; Earn</a>
    <a href="/#visit" class="nav-sidebar-link">Visit Us</a>
```

Note this also fixes `menu.html`'s accent styling being on `club.html`'s own "Menu" link — moved the `accent` class to "The Club" since that's the current page.

- [ ] **Step 4: `account.html` — same additions as `club.html`**

```html
<!-- Before: -->
  <nav>
    <a href="/"   class="nav-sidebar-link">Home</a>
    <a href="menu.html"    class="nav-sidebar-link accent">Menu</a>
    <a href="club.html"    class="nav-sidebar-link">The Club</a>
    <a href="account.html" class="nav-sidebar-link" id="sidebar-signin-link">Sign In</a>

<!-- After: -->
  <nav>
    <a href="/"   class="nav-sidebar-link">Home</a>
    <a href="/#welcome" class="nav-sidebar-link">Our Story</a>
    <a href="/#market-schedule" class="nav-sidebar-link">Market Schedule</a>
    <a href="/#what-we-make" class="nav-sidebar-link">What We Make</a>
    <a href="menu.html"    class="nav-sidebar-link">Menu</a>
    <a href="club.html"    class="nav-sidebar-link">The Club</a>
    <a href="club.html#referral" class="nav-sidebar-link">Refer &amp; Earn</a>
    <a href="/#visit" class="nav-sidebar-link">Visit Us</a>
    <a href="account.html" class="nav-sidebar-link" id="sidebar-signin-link">Sign In</a>
```

- [ ] **Step 5: `index.html` — add Refer & Earn**

```html
<!-- Before: -->
    <a href="menu.html"      class="nav-sidebar-link accent">Menu</a>
    <a href="club.html"      class="nav-sidebar-link">The Club</a>
    <a href="#visit"         class="nav-sidebar-link">Visit Us</a>

<!-- After: -->
    <a href="menu.html"      class="nav-sidebar-link accent">Menu</a>
    <a href="club.html"      class="nav-sidebar-link">The Club</a>
    <a href="club.html#referral" class="nav-sidebar-link">Refer &amp; Earn</a>
    <a href="#visit"         class="nav-sidebar-link">Visit Us</a>
```

- [ ] **Step 6: Verify each page's drawer**

Run: `npm run serve`. For each of `/`, `/menu.html`, `/club.html`, `/account.html`: open the hamburger drawer and confirm it now shows Home/Our Story/Market Schedule/What We Make/Menu/The Club/Refer & Earn/Visit Us/Sign In (or My Account) in the same order, and that every link navigates correctly (homepage anchors scroll to the right section from a non-homepage page; `club.html#referral` scrolls to the "Earn Rewards" section). Confirm the drawer's existing "close on link click" and "My Account submenu toggle" behavior (`js/shared.js`) still works — no id changes were made to any element that script references.

- [ ] **Step 7: Commit**

```bash
git add menu.html club.html account.html index.html
git commit -m "feat: unify site navigation — add Club and Refer & Earn links to every page"
```

---

### Task 3: Homepage — Club promo section + secondary hero CTA

**Files:**
- Modify: `index.html`
- Modify: `css/index.css`

**Interfaces:** None — new static content, no JS.

- [ ] **Step 1: Add a secondary hero CTA next to "View the Menu"**

```html
<!-- Before: -->
    <div class="hero-cta-wrap hero-in hero-d2">
      <a href="menu.html" class="cta-btn">
        View the Menu
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M3 7h8M7 3l4 4-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </a>
    </div>

<!-- After: -->
    <div class="hero-cta-wrap hero-in hero-d2">
      <a href="menu.html" class="cta-btn">
        View the Menu
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M3 7h8M7 3l4 4-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </a>
      <a href="club.html" class="cta-btn cta-btn-outline">
        Join the Club
      </a>
    </div>
```

- [ ] **Step 2: Add the `.cta-btn-outline` variant and hero-cta-wrap layout to `css/global.css`**

Add immediately after the existing `.cta-btn:active` rule (line 238 in `css/global.css`):

```css
.cta-btn-outline {
  background: transparent; color: var(--farm-cream);
  border: 1.5px solid rgba(250,240,230,.65); box-shadow: none;
}
.cta-btn-outline:hover  { background: rgba(250,240,230,.12); transform: translateY(-2px); box-shadow: none; }
.cta-btn-outline:active { transform: translateY(0); }
```

- [ ] **Step 3: Make `.hero-cta-wrap` lay out two buttons cleanly**

Grep `css/index.css` for `.hero-cta-wrap` and confirm it's a flex container. If it's not already `display: flex` with a `gap`, add:

```css
.hero-cta-wrap { display: flex; flex-wrap: wrap; gap: 1rem; justify-content: center; }
```

(If `.hero-cta-wrap` already has these properties from centering the single existing button, skip this step — check first with `grep -n "hero-cta-wrap" css/index.css`.)

- [ ] **Step 4: Add the Club promo section above Testimonials**

Insert a new section immediately before the existing Testimonials section comment block:

```html
<!-- Before: -->

<!-- ══════════════════════════════════════════════════════════
     5b. TESTIMONIALS — What people are saying
════════════════════════════════════════════════════════════ -->
<section id="testimonials" class="testimonials-section">

<!-- After: -->

<!-- ══════════════════════════════════════════════════════════
     5a. CLUB PROMO — Breadbox Club subscription banner
════════════════════════════════════════════════════════════ -->
<section id="club-promo" class="club-promo-section">
  <div class="club-promo-inner animate-fade-up">
    <span class="overline club-promo-overline">Join the family</span>
    <h2 class="club-promo-heading">The Breadbox Club</h2>
    <p class="club-promo-body">
      $4.99/month gets you free delivery in our zone, 5% off every order, a birthday treat,
      and referral rewards when you share the love. Cancel any time.
    </p>
    <a href="club.html" class="cta-btn">
      Join the Club
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path d="M3 7h8M7 3l4 4-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </a>
    <p class="club-promo-referral">
      Already a member? <a href="club.html#referral">Share your referral link</a> and earn bonus discounts and free items.
    </p>
  </div>
</section>

<!-- ══════════════════════════════════════════════════════════
     5b. TESTIMONIALS — What people are saying
════════════════════════════════════════════════════════════ -->
<section id="testimonials" class="testimonials-section">
```

- [ ] **Step 5: Style the new section in `css/index.css`**

Add at the end of `css/index.css`, matching the existing section pattern (centered content, `--font-display` heading, `--earth-brown`/`--burnt-orange` palette — check `.welcome-section`/`.testimonials-section` in the same file for the exact spacing/font tokens already used and mirror them):

```css
/* ── Club Promo ──────────────────────────────────────────── */
.club-promo-section {
  padding: 4rem 1.5rem;
  text-align: center;
  background: var(--cream-warm);
}
.club-promo-inner { max-width: 640px; margin: 0 auto; }
.club-promo-overline { color: var(--burnt-orange); text-align: center; }
.club-promo-heading {
  font-family: var(--font-display);
  font-size: clamp(1.8rem, 4vw, 2.4rem);
  color: var(--earth-brown);
  margin-bottom: 1rem;
}
.club-promo-body {
  font-family: var(--font-body);
  color: var(--earth-mid);
  line-height: 1.6;
  margin-bottom: 1.75rem;
}
.club-promo-referral {
  font-family: var(--font-body);
  font-size: .85rem;
  color: var(--earth-mid);
  margin-top: 1.25rem;
}
.club-promo-referral a { color: var(--burnt-orange); font-weight: 600; }
```

- [ ] **Step 6: Verify**

Run: `npm run serve`, open `/`. Confirm: the hero shows two CTAs side by side (stacking on narrow viewports since `flex-wrap: wrap`), both keyboard-focusable with a visible focus ring (inherited from `.cta-btn` — confirm one exists; if not, note it as a gap but don't scope-creep a fix here since it'd apply to every `.cta-btn` site-wide). Scroll to the new Club Promo section between "From Seed to Table" and "What People Are Saying" — heading, body copy, Join button, and referral line all render and the Join button links to `/club.html`.

- [ ] **Step 7: Commit**

```bash
git add index.html css/index.css css/global.css
git commit -m "feat: add homepage Club promo section and secondary hero CTA"
```

---

### Task 4: Menu page — fix stale availability banner, add CTAs

**Files:**
- Modify: `menu.html`
- Modify: `js/menu.js`
- Modify: `css/menu.css`

**Interfaces:** None — internal rendering logic change, no new inputs/outputs.

- [ ] **Step 1: Add a static referral teaser to the menu page**

The audit's referral-findability fix asks for the nav link (done in Task 2), a homepage teaser (done in Task 3), and a menu-page teaser. Add this as static HTML so it's always visible regardless of menu availability state — no JS change needed:

```html
<!-- Before (menu.html, inside .template-body, right before #menu-content): -->
      <div class="template-body">
        <div id="menu-content">

<!-- After: -->
      <div class="template-body">
        <p class="menu-referral-teaser">
          Bread Box Club members: <a href="club.html#referral">share your link</a> and earn free items and bonus discounts.
        </p>
        <div id="menu-content">
```

Add matching CSS to `css/menu.css`, near the other small banner-style rules (e.g. next to `.menu-schedule-date`):

```css
.menu-referral-teaser {
  text-align: center;
  font-family: var(--font-body);
  font-size: .78rem;
  color: var(--earth-mid);
  padding: .5rem 1rem 0;
}
.menu-referral-teaser a { color: var(--burnt-orange); font-weight: 600; }
```

- [ ] **Step 2: Don't show the (possibly expired) date-range banner when the menu is unavailable**

The current code always renders `scheduleRangeText` ("Available Sep 1, 2026 – Sep 23, 2026") before checking whether that window has already passed, so an expired date range and the "not available" message show together — confusing and reads as stale. Gate the banner on availability:

```js
// Before:
      // Always show the schedule date range if one is set
      if (scheduleRangeText) {
        const schedEl = document.createElement('div');
        schedEl.className = 'menu-schedule-date';
        schedEl.textContent = scheduleRangeText;
        content.appendChild(schedEl);
      }

      // If today is outside the schedule window, show placeholder and stop rendering
      if (menuUnavailable) {
        const ph = document.createElement('div');
        ph.className = 'menu-unavailable';
        ph.textContent = placeholderMessage;
        content.appendChild(ph);
        return;
      }

// After:
      // Show the schedule date range only while it's still the active window —
      // an expired range next to "not available" reads as stale/contradictory.
      if (scheduleRangeText && !menuUnavailable) {
        const schedEl = document.createElement('div');
        schedEl.className = 'menu-schedule-date';
        schedEl.textContent = scheduleRangeText;
        content.appendChild(schedEl);
      }

      // If today is outside the schedule window, show placeholder + a CTA that
      // keeps the page converting between menu windows, and stop rendering.
      if (menuUnavailable) {
        const ph = document.createElement('div');
        ph.className = 'menu-unavailable';
        ph.textContent = placeholderMessage;
        content.appendChild(ph);

        const ctaWrap = document.createElement('div');
        ctaWrap.className = 'menu-unavailable-cta';
        ctaWrap.innerHTML = `
          <a href="club.html" class="cta-btn">Join the Breadbox Club</a>
          <p class="menu-unavailable-hint">Members get first pick when the next menu opens, plus 5% off every order.</p>
        `;
        content.appendChild(ctaWrap);
        return;
      }
```

- [ ] **Step 3: Style the new CTA block in `css/menu.css`**

Add immediately after the existing `.menu-unavailable` rule:

```css
.menu-unavailable-cta {
  text-align: center;
  padding: 0 1.5rem 2rem;
}
.menu-unavailable-hint {
  font-family: var(--font-body);
  font-size: .8rem;
  color: var(--earth-mid);
  margin-top: .75rem;
}
```

- [ ] **Step 4: Verify with a real "unavailable" window**

In the connected Supabase project's `menu_schedule` table (`id = 1`), temporarily set `start_date`/`end_date` to a past range (or use the admin dashboard's existing Menu Schedule editor at `js/admin.js` if easier), then run `npm run serve` and open `/menu.html`.
Expected: no "Available <past dates>" line shown; the unavailable message appears; below it, a "Join the Breadbox Club" button links to `/club.html`. The referral teaser from Step 1 should still be visible above it regardless. Restore the original schedule dates afterward (or leave as Christina manages them per the audit's own note that she owns this via the dashboard).

- [ ] **Step 5: Verify the normal (available) path is unaffected**

With `menu_schedule` dates covering today (or cleared), reload `/menu.html`.
Expected: menu items render normally; if a schedule range is set and current, the "Available <date> – <date>" banner still shows above the items as before; the referral teaser shows above the menu card content in both states.

- [ ] **Step 6: Commit**

```bash
git add menu.html js/menu.js css/menu.css
git commit -m "fix: don't show stale availability dates when menu is unavailable; add Club/referral CTAs"
```

---

### Task 5: Account page — subscriber-aware copy

**Files:**
- Modify: `account.html`
- Modify: `js/account.js`
- Modify: `css/account.css`

**Interfaces:**
- Consumes: the `tab` URL query param already parsed near the top of `js/account.js` (used today to redirect post-login) — reused here, not reparsed.
- Consumes: `club_members.status` (already queried elsewhere in `js/account.js` for the Club tab) — reused for Step 4's signed-in banner.

- [ ] **Step 1: Give the auth card a tab-aware subhead**

```html
<!-- Before (account.html): -->
      <h1>Welcome Back</h1>
      <p>Sign in to save favorites, track orders, and join the Bread Box Club</p>

<!-- After: -->
      <h1>Welcome Back</h1>
      <p id="auth-subhead">Sign in to save favorites, track orders, and join the Bread Box Club</p>
```

- [ ] **Step 2: Set the subhead text based on `?tab=` in `js/account.js`**

Find where `targetTab` is first read from the URL (near the top of the file, used later in `enterDashboard(session.user, targetTab)`), and update `showAuthCard` to take and use it:

```js
// Before:
  function showAuthCard() {
    document.getElementById('auth-wrap').classList.remove('hidden');
    document.getElementById('dashboard').classList.add('hidden');
  }

// After:
  function showAuthCard(tab) {
    document.getElementById('auth-wrap').classList.remove('hidden');
    document.getElementById('dashboard').classList.add('hidden');
    const subhead = document.getElementById('auth-subhead');
    if (subhead) {
      if (tab === 'cart') {
        subhead.textContent = 'Sign in to view your basket and manage your subscription.';
      } else if (tab === 'club') {
        subhead.textContent = 'Membership is $4.99/month, cancel anytime. Sign in or create an account to join.';
      } else {
        subhead.textContent = 'Sign in to save favorites, track orders, and join the Bread Box Club';
      }
    }
  }
```

Update both call sites to pass the tab:

```js
// Before:
      showAuthCard();
// (first call site, ~line 79)

// After:
      showAuthCard(targetTab);
```

```js
// Before:
        showAuthCard();
// (second call site, inside the SIGNED_OUT branch, ~line 94)

// After:
        showAuthCard(targetTab);
```

- [ ] **Step 3: Confirm `targetTab` is in scope at both call sites**

Read the ~20 lines above the first `showAuthCard()` call to find where `targetTab` is declared (it's already used later for `enterDashboard`, so it must already be parsed before this point in the same function/closure). If it's declared with `const`/`let` inside the same enclosing function as both call sites, no further change is needed — just confirm rather than re-declare it, to avoid a duplicate-declaration error.

- [ ] **Step 4: Add a signed-in Club-member cross-link on the Basket tab**

```html
<!-- Before (account.html, cart panel): -->
    <div class="dash-panel active" id="panel-cart">
      <img src="brand-assets/basket-background.webp" alt="" class="basket-page-bg" />
      <div class="basket-layout">
        <div class="basket-card">
          <img src="brand-assets/basket-header.webp" alt="Your Bloomin' Basket" class="basket-header-img" />
          <div id="cart-items"></div>
        </div>
      </div>
    </div>

<!-- After: -->
    <div class="dash-panel active" id="panel-cart">
      <img src="brand-assets/basket-background.webp" alt="" class="basket-page-bg" />
      <div class="basket-layout">
        <div class="basket-card">
          <img src="brand-assets/basket-header.webp" alt="Your Bloomin' Basket" class="basket-header-img" />
          <p class="basket-club-hint hidden" id="basket-club-hint">
            Bread Box Club member — <a href="account.html?tab=club">manage your weekly box</a> from the Club tab.
          </p>
          <div id="cart-items"></div>
        </div>
      </div>
    </div>
```

- [ ] **Step 5: Show the hint only for active club members**

In `js/account.js`, find the existing club-membership check used to populate the Club tab (search for where `club_members` is queried and `status === 'active'` is checked). Add this alongside that same check — after the membership status is known, not as a new separate query:

```js
      const basketClubHint = document.getElementById('basket-club-hint');
      if (basketClubHint) {
        basketClubHint.classList.toggle('hidden', !(memberRow?.status === 'active'));
      }
```

(Use whatever the existing membership-row variable is actually named at that point in the file — match it, don't introduce a second Supabase query for the same data.)

- [ ] **Step 6: Style the hint in `css/account.css`**

```css
.basket-club-hint {
  font-family: var(--font-body);
  font-size: .85rem;
  color: var(--earth-mid);
  text-align: center;
  padding: .75rem 1rem;
  margin: 0 0 .5rem;
}
.basket-club-hint a { color: var(--burnt-orange); font-weight: 600; }
```

- [ ] **Step 7: Verify**

Run: `npm run serve`.
- Open `/account.html?tab=cart` while signed out — subhead should read "Sign in to view your basket and manage your subscription."
- Open `/account.html?tab=club` while signed out — subhead should read "Membership is $4.99/month, cancel anytime...".
- Open `/account.html` with no tab param while signed out — subhead should read the original generic copy (no regression).
- Sign in as an active Club member and open the Basket tab — the "manage your weekly box" hint should appear above the basket items, linking to the Club tab.
- Sign in as a non-member and open the Basket tab — the hint should stay hidden.

- [ ] **Step 8: Commit**

```bash
git add account.html js/account.js css/account.css
git commit -m "feat: subscriber-aware copy on account sign-in card and basket tab"
```

---

### Task 6: Compress brand images (logo + homepage photos)

**Files:**
- Modify (binary, regenerated by tooling — not hand-edited): `brand-assets/color-logo.png` and any other `brand-assets/*.png`/`*.jpg` not already `.webp`

**Interfaces:** None — this task runs existing project tooling, it doesn't write new code. `scripts/optimize-images.mjs` already exists and already keeps `color-logo.png` as PNG deliberately (`KEEP_PNG` list — likely for favicon/transparency compatibility), compressing it in place with `sharp` (quality 80, max width 1200px) rather than converting it to WebP. Its current 208KB size means it hasn't been run through this pipeline recently, not that the pipeline is wrong — do not convert the logo to WebP, which would contradict that existing decision.

- [ ] **Step 1: Record current sizes for comparison**

```bash
cd /c/oph-organization/clients/bloomin-acres
ls -la brand-assets/color-logo.png brand-assets/farm-background.webp brand-assets/fresh-produce.webp brand-assets/sourdough-loaves.webp brand-assets/sourdough-pastries.webp
```

- [ ] **Step 2: Run the existing optimization script**

```bash
node scripts/optimize-images.mjs
```

Expected: console output listing each processed file with a before/after size and percentage reduction, e.g. `[png] color-logo.png: 204.0 KB -> XX.X KB (-YY.Y%)`. Files already in `.webp` format that are re-processed (the script reads every png/jpg in the directory — already-`.webp` files are skipped since the extension filter is `['.png', '.jpg', '.jpeg']`) will not be touched again by this run, since they no longer have a `.png`/`.jpg` source file to re-process. This is expected — the four ~250-300KB webp images the audit flagged were already run through this same pipeline previously; re-running only affects files still in their original PNG/JPG form (chiefly `color-logo.png`).

- [ ] **Step 3: Verify every page that references these files still renders correctly**

Run: `npm run serve`, open `/`, `/menu.html`, `/club.html`, `/account.html`, `/admin.html`. Confirm the logo (nav sidebar, hero, footer, auth card) and homepage photos (hero banner, welcome image, three product cards, farm background) all display without broken-image icons — the script keeps `color-logo.png`'s filename unchanged (`KEEP_PNG`), so no HTML `src` attributes need updating for this file.

- [ ] **Step 4: Spot-check visual quality**

Open the compressed logo directly in a browser tab (`http://localhost:3000/brand-assets/color-logo.png`) and compare against how it looked before (or check `git diff --stat` shows a smaller file size, then eyeball it at 100% zoom) — quality-80 compression should be visually lossless for a logo; if it looks noticeably degraded, lower `MAX_WIDTH`/raise quality in `scripts/optimize-images.mjs` is out of scope for this task — flag it instead of hand-tuning.

- [ ] **Step 5: Commit**

```bash
git add brand-assets/color-logo.png
git commit -m "perf: compress logo PNG via existing optimize-images script"
```

---

## Notes on the source PDF for Eric

- **Three "LOW" findings from the audit were already fixed in the current codebase** before this plan started (verified by reading the live source, not just the audit): the homepage calendar already has a Monday column, "Sun & Mon" already reads "— Closed" (not blank), and "4p – 6p (market season)" already has its space. No task in this plan touches them — nothing to do.
- **Finding #4 (no returning-subscriber path)** is implemented as a lighter fix than the audit's literal suggestion. The audit describes building a new "This Week's Order" dashboard tab — but `account.html`'s existing Club tab already has a "My Box" builder (add items, running total, "Order My Box" button) that does exactly this. Task 5 cross-links to that existing feature from the Basket tab instead of duplicating it as a second, parallel ordering flow.
- **The menu-page "baked-in image" finding** — re-reading the current code, the actual bug is the stale-date-banner-next-to-unavailable-message issue fixed in Task 4, not a literal image with baked text (the only always-visible image on that card, `menu-template-header.png`, is decorative brand art with `alt=""`/`aria-hidden="true"`, which is the correct pattern, not an accessibility bug).
- **Mobile verification** (the audit's "not tested" section) isn't a code task — recommend a manual pass on a real phone after this PR merges, covering the nav drawer, menu card, and Club page.
- **Lazy-loading below-the-fold images**, also suggested in the audit's Performance section, is already implemented — every below-the-fold `<img>` on the homepage already has `loading="lazy"` (the hero images correctly omit it and use `fetchpriority="high"` instead, since they're the LCP element). No task in this plan touches it.
