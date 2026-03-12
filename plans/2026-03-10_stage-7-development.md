# Bloomin' Acres — Stage 7 Development Plan

**Created:** 2026-03-10
**Current Score:** 8.6/10
**Target Score:** 9.2/10

## Context

Visual design (7/10) is the weakest category and biggest opportunity. The admin variant management plan from 2026-03-06 is already implemented — marked complete.

This stage groups the highest-impact roadmap features into 4 deployable phases, prioritized by score impact per effort.

---

## Phase 1: Visual Design Push (Visual 7 → 9)

Biggest score gain. Pure frontend, no backend changes.

**Features:**
- Product page visual enrichment — texture overlays, ingredient tags as styled chips, image gallery with thumbnails
- Micro-interactions — button hover fills, heart pulse on favorite, card lift on menu hover, toast entrance animation
- Responsive image optimization — `srcset`/`sizes` on product and hero images, `loading="lazy"` on below-fold images

**Files:**
| File | Change | Size |
|------|--------|------|
| `css/product.css` | Texture overlays, ingredient chips, gallery grid, button transitions | M |
| `css/menu.css` | Card lift hover states | S |
| `css/global.css` | Shared keyframes (pulse, fill), toast animation | S |
| `css/index.css` | Landing card hovers, hero treatment | S |
| `product.html` | Gallery markup, ingredient tags, `loading="lazy"` | S |
| `js/product.js` | Gallery click handler, ingredient tag rendering | S |
| `index.html` | `srcset`/`sizes` on hero, `loading="lazy"` on cards | S |
| `menu.html` | `loading="lazy"` on decorative images | S |

**Complexity:** Medium

---

## Phase 2: Mobile Cart & Checkout UX

Revenue path optimization. Directly affects conversion.

**Features:**
- Mobile-optimized cart panel — full-width under 640px, larger tap targets, swipe-to-remove, sticky checkout button
- Touch-friendly menu — larger tap targets on action buttons, sticky category nav, native `<select>` for variant dropdowns on mobile
- Cart panel improvements — product thumbnails in cart rows, running subtotals

**Files:**
| File | Change | Size |
|------|--------|------|
| `css/global.css` | Cart panel responsive overrides, swipe animation, sticky checkout | M |
| `css/menu.css` | Larger tap targets, sticky section nav, mobile variant selectors | M |
| `js/menu.js` | Sticky category nav scroll handler, native select on touch, cart images | M |
| `menu.html` | Category nav anchors for sticky behavior | S |

**Complexity:** Medium

---

## Phase 3: Pickup Time Slots

Core business feature — order fulfillment coordination. Requires frontend + backend.

**Features:**
- Checkout pickup window selector (both guest and logged-in flows)
- Admin time slot configuration (new dashboard section)
- Optional slot capacity limits, decremented on successful checkout

**Files:**
| File | Change | Size |
|------|--------|------|
| `supabase-schema.sql` | New `pickup_slots` table | S |
| `admin.html` | New "Pickup Slots" tab | M |
| `js/admin.js` | CRUD for pickup slots | M |
| `css/admin.css` | Pickup slot management styles | S |
| `menu.html` | Slot selector in cart panel before checkout | M |
| `js/menu.js` | Fetch slots, render selector, pass to checkout | M |
| `account.html` | Slot selector in account checkout flow | S |
| `js/account.js` | Slot selection for logged-in checkout | S |
| `api/stripe/checkout.js` | Accept `pickup_slot`, attach to Stripe metadata | S |
| `api/stripe/guest-checkout.js` | Same pickup slot handling | S |
| `api/stripe/webhook.js` | Record slot on payment, decrement capacity | M |

**Complexity:** Large

---

## Phase 4: Code Quality & Infrastructure

Not customer-visible but needed for 9.2 target. Run last so Phases 1-3 code follows new patterns.

**Features:**
- Extract shared auth init into `js/auth.js` (duplicated across 5 page scripts)
- Extract shared cart-sync logic into `cart.js` as `cartAddAndSync()`
- Add `safeFetch()` wrapper in `utils.js` with retry toast and offline indicator
- Consolidate duplicated toast styles to `global.css` only
- Variable naming cleanup (consistent camelCase)

**Files:**
| File | Change | Size |
|------|--------|------|
| `js/auth.js` (new) | Shared auth init, sidebar wiring, admin check | M |
| `js/utils.js` | `safeFetch()` with retry and offline detection | S |
| `js/cart.js` | `cartAddAndSync()` with Supabase sync | S |
| `js/index.js`, `menu.js`, `product.js`, `account.js`, `admin.js` | Replace boilerplate with shared calls, wrap fetches | M |
| `css/global.css` | Consolidate toast styles, offline banner | S |
| `css/menu.css`, `css/product.css` | Remove duplicated toast styles | S |
| All HTML files | Add `<script src="js/auth.js">` | S |

**Complexity:** Medium (many files, mechanical changes)

---

## Phase Summary

| Phase | Score Impact | Effort | Depends On |
|-------|-------------|--------|------------|
| 1: Visual Design | High (Visual 7→9) | Medium | None |
| 2: Mobile Cart/Checkout | Medium (Nav, Accessibility up) | Medium | None (parallel with Phase 1) |
| 3: Pickup Time Slots | Medium (new business feature) | Large | Phase 2 (shared cart/checkout flow) |
| 4: Code Quality | Medium (Code Quality 8.5→9.5) | Medium | Phases 1-3 (refactor after new code lands) |

**Projected score after Stage 7:** 8.6 → 9.2+

---

## Verification

After each phase:
1. Run `node serve.mjs` and test on localhost:3000
2. Test on mobile viewport (Chrome DevTools, 375px width)
3. Verify no console errors
4. For Phase 3: test full checkout flow with Stripe test mode
5. For Phase 4: verify no regressions across all 6 pages
