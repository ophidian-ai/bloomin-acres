# Guest Checkout Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow customers to add items to cart and check out without creating an account upfront. Silently create a Supabase account at checkout time so orders are attributed.

**Architecture:** localStorage-based cart available to all visitors. Floating cart icon + slide-out panel on menu/product pages. Guest checkout modal collects name + email, API creates Supabase user and Stripe session. Existing authenticated flow untouched.

**Tech Stack:** Vanilla JS, Supabase Auth (admin API), Stripe Checkout, localStorage

**Design doc:** `docs/plans/2026-03-08-guest-checkout-design.md`

---

### Task 1: Create shared cart module (`js/cart.js`)

**Files:**
- Create: `js/cart.js`

**Step 1: Write the cart module**

```javascript
// js/cart.js — localStorage cart for guest and logged-in users
// Key: 'ba_cart', Value: JSON array of { stripe_product_id, variation_name, variation_delta, quantity }

const CART_KEY = 'ba_cart';

function _read() {
  try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; }
  catch { return []; }
}

function _write(items) {
  localStorage.setItem(CART_KEY, JSON.stringify(items));
  window.dispatchEvent(new Event('cart-updated'));
}

function cartGet() {
  return _read();
}

function cartAdd(stripe_product_id, variation_name = '', variation_delta = 0) {
  const items = _read();
  const match = items.find(i => i.stripe_product_id === stripe_product_id && i.variation_name === variation_name);
  if (match) {
    match.quantity += 1;
  } else {
    items.push({ stripe_product_id, variation_name, variation_delta, quantity: 1 });
  }
  _write(items);
}

function cartRemove(stripe_product_id, variation_name = '') {
  const items = _read().filter(i => !(i.stripe_product_id === stripe_product_id && i.variation_name === variation_name));
  _write(items);
}

function cartUpdateQty(stripe_product_id, variation_name, quantity) {
  const items = _read();
  const match = items.find(i => i.stripe_product_id === stripe_product_id && i.variation_name === variation_name);
  if (match) {
    if (quantity <= 0) {
      cartRemove(stripe_product_id, variation_name);
      return;
    }
    match.quantity = quantity;
    _write(items);
  }
}

function cartCount() {
  return _read().reduce((sum, i) => sum + i.quantity, 0);
}

function cartClear() {
  localStorage.removeItem(CART_KEY);
  window.dispatchEvent(new Event('cart-updated'));
}
```

**Step 2: Commit**

```bash
git add js/cart.js
git commit -m "feat: add shared localStorage cart module (js/cart.js)"
```

---

### Task 2: Create guest checkout API endpoint

**Files:**
- Create: `api/stripe/guest-checkout.js`

**Step 1: Write the endpoint**

This is modeled on `api/stripe/checkout.js` but accepts `guest_email` + `guest_name` instead of `user_id`. It creates (or finds) a Supabase user, then creates the Stripe session.

```javascript
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

export default async function handler(req, res) {
  const allowedOrigin = (process.env.ALLOWED_ORIGIN || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')).trim();
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!secretKey) return res.status(500).json({ error: 'STRIPE_SECRET_KEY not set' });
  if (!supabaseUrl || !supabaseServiceKey) return res.status(500).json({ error: 'Supabase not configured' });

  const { items, guest_email, guest_name } = req.body;
  if (!items || !items.length) return res.status(400).json({ error: 'No items provided' });
  if (!guest_email) return res.status(400).json({ error: 'Email is required' });

  // Basic email validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guest_email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  try {
    const stripe = new Stripe(secretKey);
    const sb = createClient(supabaseUrl, supabaseServiceKey);

    // Find or create Supabase user
    let userId;
    const { data: existingUsers } = await sb.auth.admin.listUsers();
    const existingUser = (existingUsers?.users || []).find(u => u.email === guest_email.toLowerCase().trim());

    if (existingUser) {
      userId = existingUser.id;
      // Update name if profile exists
      if (guest_name) {
        await sb.from('profiles').upsert({
          id: userId,
          first_name: guest_name.split(' ')[0] || '',
          last_name: guest_name.split(' ').slice(1).join(' ') || '',
        }, { onConflict: 'id' });
      }
    } else {
      // Create new guest user with random password
      const tempPassword = crypto.randomBytes(24).toString('base64url');
      const { data: newUser, error: createErr } = await sb.auth.admin.createUser({
        email: guest_email.toLowerCase().trim(),
        password: tempPassword,
        email_confirm: true, // Auto-confirm so webhook can attribute orders
        user_metadata: { is_guest: true },
      });
      if (createErr) return res.status(400).json({ error: createErr.message });
      userId = newUser.user.id;

      // Create profile
      if (guest_name) {
        await sb.from('profiles').upsert({
          id: userId,
          first_name: guest_name.split(' ')[0] || '',
          last_name: guest_name.split(' ').slice(1).join(' ') || '',
        }, { onConflict: 'id' });
      }
    }

    // Stock validation (same as checkout.js)
    const productIds = items.map(i => i.stripe_product_id);
    const { data: detailsRows } = await sb.from('product_details').select('stripe_product_id, variations').in('stripe_product_id', productIds);
    const stockMap = {};
    (detailsRows || []).forEach(row => {
      (row.variations || []).forEach(v => {
        stockMap[row.stripe_product_id + '|' + (v.name || '')] = v.quantity;
      });
    });
    for (const item of items) {
      const key = item.stripe_product_id + '|' + (item.variation_name || '');
      const available = stockMap[key];
      if (available !== undefined && available !== null && item.quantity > available) {
        return res.status(400).json({
          error: available === 0
            ? 'An item in your cart is sold out. Please update your cart.'
            : 'An item exceeds available stock. Please update your cart.',
        });
      }
    }

    // Fetch Stripe products
    const products = await Promise.all(
      productIds.map(id => stripe.products.retrieve(id, { expand: ['default_price'] }))
    );

    const lineItems = products.map((product, idx) => {
      const item = items[idx];
      const price = product.default_price;
      if (!price) throw new Error(`No default price for product ${product.id}`);
      const variationDelta = item.variation_delta || 0;
      if (variationDelta) {
        const varLabel = item.variation_name ? ` — ${item.variation_name}` : '';
        return {
          price_data: {
            currency: price.currency || 'usd',
            product_data: { name: `${product.name}${varLabel}` },
            unit_amount: (price.unit_amount || 0) + variationDelta,
          },
          quantity: item.quantity || 1,
        };
      }
      return { price: price.id, quantity: item.quantity || 1 };
    });

    const origin = req.headers.origin
      ? req.headers.origin
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'http://localhost:3000';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lineItems,
      customer_email: guest_email.toLowerCase().trim(),
      client_reference_id: userId,
      metadata: { user_id: userId, is_guest: 'true' },
      success_url: `${origin}/menu.html?order=success`,
      cancel_url: `${origin}/menu.html`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('[guest-checkout] error:', err);
    res.status(500).json({ error: err.message });
  }
}
```

Key differences from `checkout.js`:
- Accepts `guest_email` + `guest_name` instead of `user_id`
- Creates or finds Supabase user server-side
- No club/referral discounts (guest)
- Success URL goes to `menu.html?order=success` (not account.html)
- Sets `customer_email` on Stripe session for receipt

**Step 2: Commit**

```bash
git add api/stripe/guest-checkout.js
git commit -m "feat: add guest checkout API endpoint"
```

---

### Task 3: Add cart panel and checkout modal HTML to `menu.html`

**Files:**
- Modify: `menu.html`

**Step 1: Add floating cart icon, cart panel, checkout modal, and order success toast**

Add before the closing `</body>` tag (before the Supabase CDN script):

```html
<!-- Floating cart icon -->
<button type="button" class="floating-cart-btn" id="floating-cart-btn" aria-label="Open cart" style="display:none;">
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
  <span class="cart-badge" id="cart-badge">0</span>
</button>

<!-- Cart slide-out panel -->
<div class="cart-panel" id="cart-panel" aria-hidden="true">
  <div class="cart-panel-header">
    <h2 class="cart-panel-title">Your Cart</h2>
    <button type="button" class="cart-panel-close" id="cart-panel-close" aria-label="Close cart">&times;</button>
  </div>
  <div class="cart-panel-items" id="cart-panel-items">
    <p class="cart-empty-msg">Your cart is empty.</p>
  </div>
  <div class="cart-panel-footer" id="cart-panel-footer" style="display:none;">
    <div class="cart-total-row">
      <span>Estimated Total</span>
      <span id="cart-total">$0.00</span>
    </div>
    <button type="button" class="cart-checkout-btn" id="cart-checkout-btn">Checkout</button>
    <p class="cart-signin-nudge" id="cart-signin-nudge" style="display:none;">
      <a href="account.html">Sign in</a> for order history &amp; club rewards
    </p>
  </div>
</div>
<div class="cart-overlay" id="cart-overlay" aria-hidden="true"></div>

<!-- Guest checkout modal -->
<div class="guest-modal-overlay" id="guest-modal-overlay" style="display:none;">
  <div class="guest-modal" role="dialog" aria-modal="true" aria-label="Guest checkout">
    <button type="button" class="guest-modal-close" id="guest-modal-close" aria-label="Close">&times;</button>
    <h3 class="guest-modal-title">Checkout</h3>
    <p class="guest-modal-subtitle">Enter your details to complete your order.</p>
    <form id="guest-checkout-form" autocomplete="on">
      <div class="guest-field">
        <label for="guest-name">Name</label>
        <input type="text" id="guest-name" name="name" autocomplete="name" required />
      </div>
      <div class="guest-field">
        <label for="guest-email">Email</label>
        <input type="email" id="guest-email" name="email" autocomplete="email" required />
      </div>
      <button type="submit" class="guest-submit-btn" id="guest-submit-btn">Continue to Payment</button>
    </form>
    <div class="guest-modal-divider"><span>or</span></div>
    <a href="account.html" class="guest-signin-link">Sign in for order history &amp; rewards</a>
  </div>
</div>
```

Also add `<script src="/js/cart.js"></script>` before `<script src="/js/menu.js"></script>`.

**Step 2: Commit**

```bash
git add menu.html
git commit -m "feat: add cart panel, checkout modal, and floating cart icon to menu.html"
```

---

### Task 4: Add floating cart icon to `product.html` and `index.html`

**Files:**
- Modify: `product.html`
- Modify: `index.html`

**Step 1: Add the same floating cart button and cart script tag**

In both files, add the floating cart button HTML (just the button, not the full panel -- clicking it redirects to menu.html with cart open):

```html
<button type="button" class="floating-cart-btn" id="floating-cart-btn" aria-label="Open cart" style="display:none;" onclick="window.location.href='menu.html?cart=open'">
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
  <span class="cart-badge" id="cart-badge">0</span>
</button>
```

Add `<script src="/js/cart.js"></script>` before the page-specific script in both files.

Add a small inline script (or add to `js/product.js` / `js/index.js`) to update the badge on load:

```javascript
// Show floating cart icon if items in localStorage cart
window.addEventListener('cart-updated', updateCartBadge);
function updateCartBadge() {
  const count = cartCount();
  const btn = document.getElementById('floating-cart-btn');
  const badge = document.getElementById('cart-badge');
  if (btn) { btn.style.display = count > 0 ? 'flex' : 'none'; }
  if (badge) { badge.textContent = count; }
}
updateCartBadge();
```

**Step 2: Commit**

```bash
git add product.html index.html js/product.js js/index.js
git commit -m "feat: add floating cart icon to product and index pages"
```

---

### Task 5: Add cart panel + checkout modal CSS to `css/global.css`

**Files:**
- Modify: `css/global.css`

**Step 1: Add styles**

Append to `css/global.css`. Match the existing Bloomin' Acres style (cream/wheat/sage palette, Playfair Display headings, DM Sans body, farm aesthetic):

- `.floating-cart-btn` -- Fixed bottom-right, 52px circle, earth-brown bg, white icon, 44px min touch target
- `.cart-badge` -- 18px red circle, white text, absolute positioned top-right of cart button
- `.cart-panel` -- Slide-in from right, 380px max-width, white bg, cream header, shadow
- `.cart-panel-items` -- Scrollable item list
- `.cart-item` -- Row with name, variation, qty controls, price, remove button
- `.cart-checkout-btn` -- Full-width wheat/burnt-orange button
- `.guest-modal-overlay` -- Full-screen semi-transparent overlay
- `.guest-modal` -- Centered card, max-width 400px, white bg, rounded corners
- `.guest-field` -- Label + input styling matching existing account.html form fields
- `.guest-submit-btn` -- Same style as `.cart-checkout-btn`
- `.guest-signin-link` -- Subtle text link below the form

Use exact colors from `js/tailwind-config.js`: wheat (#EDA339), sage (#7A9B8E), earth (#4A3322), cream (#FAF0E6), burnt-orange (#C85A3A).

**Step 2: Rebuild Tailwind**

```bash
npm run build
```

**Step 3: Commit**

```bash
git add css/global.css css/tailwind.css
git commit -m "feat: add cart panel, floating icon, and checkout modal styles"
```

---

### Task 6: Update `js/menu.js` -- remove auth gate, wire localStorage cart + cart panel + guest checkout

**Files:**
- Modify: `js/menu.js`

This is the biggest change. Key modifications:

**Step 1: Always show "Add to Cart" buttons (remove `currentUser` gates)**

In the item rendering (~line 204-228), change the conditional so cart buttons always show. Keep favorite buttons behind `currentUser` check.

Current pattern:
```javascript
${currentUser ? `<button class="btn-add-cart" ...>+ Cart</button>` : ''}
```

New pattern:
```javascript
<button class="btn-add-cart" data-pid="${escHtml(pid)}">+ Cart</button>
${currentUser ? `<button class="btn-fav..." ...>` : ''}
```

Same for variation dropdown cart buttons -- always show them. Keep variation fav buttons behind auth.

**Step 2: Change cart click handlers to use localStorage**

Current (menu.js ~line 244-265):
```javascript
cartBtn.addEventListener('click', async () => {
  if (!currentUser) { window.location.href = 'account.html'; return; }
  // ...Supabase insert...
});
```

New:
```javascript
cartBtn.addEventListener('click', () => {
  cartAdd(pid, vName, vDelta);
  if (currentUser) {
    // Also sync to Supabase for logged-in users
    sb.from('user_cart').upsert({
      user_id: currentUser.id, stripe_product_id: pid,
      variation_name: vName, variation_delta: vDelta, quantity: /* get from localStorage */,
    }, { onConflict: 'user_id,stripe_product_id,variation_name' });
  }
  showToast(`${name} (${vName}) added to cart`);
});
```

**Step 3: Wire floating cart badge**

At the end of the IIFE, add badge update listener:

```javascript
function updateCartBadge() {
  const count = cartCount();
  const btn = document.getElementById('floating-cart-btn');
  const badge = document.getElementById('cart-badge');
  if (btn) btn.style.display = count > 0 ? 'flex' : 'none';
  if (badge) badge.textContent = count;
}
window.addEventListener('cart-updated', updateCartBadge);
updateCartBadge();
```

**Step 4: Wire cart panel open/close**

```javascript
document.getElementById('floating-cart-btn').addEventListener('click', openCartPanel);
document.getElementById('cart-panel-close').addEventListener('click', closeCartPanel);
document.getElementById('cart-overlay').addEventListener('click', closeCartPanel);

// Auto-open if ?cart=open
if (new URLSearchParams(window.location.search).get('cart') === 'open') openCartPanel();
// Show success toast if ?order=success
if (new URLSearchParams(window.location.search).get('order') === 'success') {
  showToast('Order placed! Check your email for confirmation.');
  cartClear();
  history.replaceState(null, '', 'menu.html');
}
```

**Step 5: Implement `renderCartPanel()` function**

Reads from `cartGet()`, cross-references `productMap` (already loaded) for names and prices. Renders each item with qty +/- buttons and remove. Shows total. Calls `cartUpdateQty()` and `cartRemove()` on user actions.

**Step 6: Wire checkout button**

```javascript
document.getElementById('cart-checkout-btn').addEventListener('click', () => {
  if (currentUser) {
    // Logged-in: redirect to account.html cart tab (existing flow)
    window.location.href = 'account.html?tab=cart';
  } else {
    // Guest: open checkout modal
    document.getElementById('guest-modal-overlay').style.display = 'flex';
  }
});
```

**Step 7: Wire guest checkout form submission**

```javascript
document.getElementById('guest-checkout-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('guest-submit-btn');
  btn.disabled = true;
  btn.textContent = 'Processing...';

  const name = document.getElementById('guest-name').value.trim();
  const email = document.getElementById('guest-email').value.trim();
  const items = cartGet();

  try {
    const res = await fetch('/api/stripe/guest-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, guest_email: email, guest_name: name }),
    });
    const data = await res.json();
    if (data.url) {
      window.location.href = data.url;
    } else {
      showToast(data.error || 'Checkout failed', true);
      btn.disabled = false;
      btn.textContent = 'Continue to Payment';
    }
  } catch {
    showToast('Could not reach server', true);
    btn.disabled = false;
    btn.textContent = 'Continue to Payment';
  }
});
```

**Step 8: Show sign-in nudge for guests**

```javascript
if (!currentUser) {
  const nudge = document.getElementById('cart-signin-nudge');
  if (nudge) nudge.style.display = 'block';
}
```

**Step 9: Commit**

```bash
git add js/menu.js
git commit -m "feat: wire localStorage cart, cart panel, and guest checkout on menu page"
```

---

### Task 7: Update `js/product.js` -- remove auth gate, use localStorage cart

**Files:**
- Modify: `js/product.js`

**Step 1: Always show "Add to Cart" button**

Change the conditional in `renderProduct()` (~line 171):

Current:
```javascript
${currentUser
  ? `<button class="btn-cart" id="btn-cart">...Add to Cart...</button>
     <button class="btn-fav" id="btn-fav">...Save...</button>`
  : `<a href="account.html" class="btn-cart">Sign In to Order</a>`
}
```

New:
```javascript
<button class="btn-cart" id="btn-cart">
  <svg ...></svg> Add to Cart
</button>
${currentUser
  ? `<button class="btn-fav" id="btn-fav">...Save...</button>`
  : ''
}
```

**Step 2: Update `wireCart()` to use localStorage**

Change `wireCart()` (~line 279) to use `cartAdd()` instead of Supabase insert:

```javascript
async function wireCart() {
  const btn = document.getElementById('btn-cart');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const { name: varName, delta: varDelta } = getSelectedVariation();
    cartAdd(productId, varName, varDelta);
    // Sync to Supabase if logged in
    if (currentUser) {
      const items = cartGet();
      const match = items.find(i => i.stripe_product_id === productId && i.variation_name === varName);
      await sb.from('user_cart').upsert({
        user_id: currentUser.id,
        stripe_product_id: productId,
        variation_name: varName,
        variation_delta: varDelta,
        quantity: match?.quantity || 1,
      }, { onConflict: 'user_id,stripe_product_id,variation_name' });
    }
    const label = varName ? `${stripeProduct?.name || 'Item'} (${varName})` : (stripeProduct?.name || 'Item');
    showToast(`${label} added to cart`);
  });
}
```

**Step 3: Add cart badge update**

At the end of `init()`:
```javascript
function updateCartBadge() {
  const count = cartCount();
  const btn = document.getElementById('floating-cart-btn');
  const badge = document.getElementById('cart-badge');
  if (btn) btn.style.display = count > 0 ? 'flex' : 'none';
  if (badge) badge.textContent = count;
}
window.addEventListener('cart-updated', updateCartBadge);
updateCartBadge();
```

**Step 4: Commit**

```bash
git add js/product.js
git commit -m "feat: remove auth gate from product add-to-cart, use localStorage"
```

---

### Task 8: Update `js/account.js` -- merge localStorage cart on login

**Files:**
- Modify: `js/account.js`

**Step 1: Add cart merge logic after successful login**

In `enterDashboard()` (called when user is authenticated), add at the top:

```javascript
// Merge any localStorage guest cart into Supabase
const localCart = cartGet();
if (localCart.length > 0) {
  for (const item of localCart) {
    await sb.from('user_cart').upsert({
      user_id: user.id,
      stripe_product_id: item.stripe_product_id,
      variation_name: item.variation_name || '',
      variation_delta: item.variation_delta || 0,
      quantity: item.quantity,
    }, { onConflict: 'user_id,stripe_product_id,variation_name' });
  }
  cartClear();
}
```

Also add `<script src="/js/cart.js"></script>` to `account.html` before `js/account.js`.

**Step 2: Commit**

```bash
git add js/account.js account.html
git commit -m "feat: merge localStorage cart into Supabase on login"
```

---

### Task 9: Rebuild Tailwind, screenshot all pages, verify

**Files:**
- Modify: `css/tailwind.css` (rebuild)

**Step 1: Rebuild Tailwind**

```bash
npm run build
```

**Step 2: Start dev server and screenshot**

```bash
node serve.mjs &
node screenshot.mjs http://localhost:3000/menu.html menu-guest-cart
node screenshot.mjs http://localhost:3000/product.html?id=<any-product-id> product-guest-cart
node screenshot.mjs http://localhost:3000/ index-guest-cart
```

**Step 3: Verify**

- Menu page shows "Add to Cart" buttons without being logged in
- Clicking "+ Cart" adds item and shows floating cart icon with badge
- Clicking floating cart icon opens cart panel
- Cart panel shows items with correct names and prices
- Clicking "Checkout" opens guest modal (when not logged in)
- Guest form validates email
- Product page shows "Add to Cart" without sign-in gate
- Index page shows floating cart icon when items in cart

**Step 4: Commit**

```bash
git add css/tailwind.css
git commit -m "chore: rebuild Tailwind CSS for guest checkout markup"
```

---

### Task 10: Final commit, push, update submodule

**Step 1: Push submodule**

```bash
cd revenue/projects/active/bloomin-acres
git push
```

**Step 2: Update parent repo**

```bash
cd ../../../..
git add revenue/projects/active/bloomin-acres
git commit -m "Update Bloomin' Acres submodule (guest checkout)"
git push
```
