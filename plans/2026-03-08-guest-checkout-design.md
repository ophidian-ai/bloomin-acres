# Guest Checkout -- Design Document

**Date:** 2026-03-08
**Project:** Bloomin' Acres
**Status:** Approved

## Summary

Add guest checkout so customers can purchase without creating an account upfront. Behind the scenes, a Supabase account is silently created (auto-account model) so orders are attributed and the customer can claim their account later.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Guest model | Auto-account (silent Supabase user creation) | Builds customer base while removing friction |
| Cart storage | localStorage for all users | Enables anonymous add-to-cart; syncs to Supabase on login |
| Favorites | Account-only | Keeps scope small; guest checkout is about removing purchase barriers |
| Checkout UI location | On menu/product pages (no redirect to account.html) | Keeps guests on pages they're already browsing |
| API approach | New `api/stripe/guest-checkout.js` endpoint | Keeps existing authenticated checkout untouched |
| Club discounts | Account-only (nudge shown to guests) | Requires verified membership |

## Architecture

### Cart Layer

- **localStorage key:** `ba_cart`
- **Format:** `[{ stripe_product_id, variation_name, variation_delta, quantity }]`
- Logged-in users: write to both localStorage AND Supabase `user_cart` (existing behavior preserved)
- On login: merge localStorage cart into Supabase cart, clear localStorage
- Cart badge count shown via floating cart icon on menu.html, product.html, index.html

### Guest Checkout Flow

1. Guest browses menu/product, clicks "Add to Cart" -- no auth prompt, item goes to localStorage
2. Floating cart icon shows item count; clicking opens slide-out cart panel (same design as account cart)
3. Guest clicks "Checkout" in cart panel
4. Checkout modal appears with two paths:
   - **"Continue as Guest"** -- name + email fields, then Stripe redirect
   - **"Sign in for order history & rewards"** -- link to account.html (localStorage cart survives redirect, merges on login)
5. Guest path: `api/stripe/guest-checkout.js` creates Supabase user (or finds by email), creates Stripe Checkout session
6. Post-purchase: "Claim your account" email sent via Supabase password reset

### New Endpoint: `api/stripe/guest-checkout.js`

- Accepts: `{ items, guest_email, guest_name }`
- Server-side: create Supabase user with email + random password + `{ is_guest: true }` metadata
- If email already exists: look up existing user_id (don't create duplicate)
- Create Stripe Checkout session with that user_id (same as existing checkout.js logic)
- Stock validation same as existing checkout.js
- No club/referral discounts for guests

### Webhook Changes

- None. `webhook.js` already uses `client_reference_id` / `metadata.user_id` for order attribution.

### Login Cart Merge

- On successful auth in `account.js`, check localStorage `ba_cart`
- For each item: upsert into `user_cart` (increment quantity if duplicate)
- Clear `ba_cart` from localStorage
- Render merged cart

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `js/cart.js` | CREATE | Shared localStorage cart module (read, add, remove, count, clear) |
| `api/stripe/guest-checkout.js` | CREATE | Guest checkout endpoint |
| `js/menu.js` | MODIFY | Remove auth gate on "Add to Cart", use localStorage, add cart panel + checkout modal |
| `js/product.js` | MODIFY | Same as menu.js -- remove auth gate, localStorage cart |
| `js/account.js` | MODIFY | Add localStorage cart merge on login |
| `menu.html` | MODIFY | Add cart panel HTML, floating cart icon, checkout modal markup |
| `product.html` | MODIFY | Add floating cart icon |
| `index.html` | MODIFY | Add floating cart icon |
| `css/global.css` | MODIFY | Cart panel, floating icon, checkout modal styles |
| `css/tailwind-src.css` | REBUILD | Recompile after HTML changes |

## What Stays Account-Only

- Favorites (heart toggle)
- Order history viewing
- Club membership / referral rewards
- Club discounts at checkout
- Admin dashboard
- Profile management

## Edge Cases

- **Returning guest (same email):** API finds existing user, attributes new order to same account
- **Guest then creates account:** If they sign up with same email, orders are already linked
- **Cart expiration:** localStorage persists until cleared; no TTL needed for a farmstand
- **Stock changes between add-to-cart and checkout:** Server-side stock validation in checkout API catches this
