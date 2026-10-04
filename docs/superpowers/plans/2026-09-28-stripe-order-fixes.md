# Stripe Order Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the three order-visibility gaps Christina reported — no notification when an order is placed, pickup location never reaching the printed ticket, and unreliable guest-checkout data — without adding checkout friction.

**Architecture:** Four independent, file-scoped changes: (1) `api/stripe/guest-checkout.js` gains a validated `pickup_location_id` input, a paginated admin user lookup, and a Stripe receipt email; (2) `menu.html` + `js/menu.js` add a pickup-location selector to the existing guest checkout modal; (3) `js/admin.js`'s `printTickets()` gains a pickup-location line; (4) `api/stripe/webhook.js` sends an order-notification email via Resend after a paid order is successfully recorded.

**Tech Stack:** Vercel serverless functions (Node, `type: module`), Supabase JS v2, Stripe Node SDK v14, vanilla JS/HTML on the client. **This project has no automated test suite** (no test runner in `package.json`). Verification in this plan is manual: run `node serve.mjs` for the static/client pieces, and use the Stripe CLI (`stripe listen --forward-to localhost:3000/api/stripe/webhook`, `stripe trigger checkout.session.completed`) plus `curl` for the API pieces. All API testing requires a local `.env` with real Stripe test-mode and Supabase keys already in place — this plan does not create or edit `.env` (per project rules); it only adds new variable *names* to `.env.example`.

**Spec:** `stripe-order-fix-list.pdf` (Bloomin' Acres Stripe diagnosis, 2026-09-27), provided by the client. This plan implements Issues 1–3 from that document, adjusted against what the current codebase actually does (see Global Constraints note on Issue 2).

## Global Constraints

- No new `.env` file reads/writes — only add new variable names to `.env.example` (values are set by Eric in Vercel/Supabase dashboards).
- New runtime dependency `resend` requires Eric's explicit approval — already given for this plan (Resend chosen over SMTP/dashboard-toggle alternatives).
- Never hardcode secrets or the notification email address in code — read `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and `ORDER_NOTIFICATION_EMAIL` from `process.env`.
- Webhook handler must always return a 2xx response for events it processes, even if the notification email fails — Stripe retries indefinitely on non-2xx, and an email outage must not cause duplicate order processing.
- Do not add `billing_address_collection` or any other field to the Stripe Checkout session that adds a form step for the customer — investigation showed customer name is already sourced from the site's own `profiles` table (set at signup or from the guest checkout form), not from Stripe billing details, so no extra Stripe-side collection is needed.
- Work on `engineering/backend/stripe-order-fixes` (already checked out off `main`). Never push directly to `main` — this ships as a PR per the project's CLAUDE.md.

## Review Focus

- **Guest re-checkout with 50+ existing accounts:** `guest-checkout.js` currently calls `sb.auth.admin.listUsers()` with no pagination args, which silently caps at Supabase's default page size (50). A returning guest past that cutoff won't be found, so `createUser` is retried with their already-registered email and fails the whole checkout. Task 1 fixes the page size.
- **Guest submits with no pickup locations configured:** if `pickup_locations` has zero active rows, the guest modal must not show an empty/broken selector or block checkout — it should skip the field entirely.
- **Guest submits a tampered or inactive `pickup_location_id`:** the server must re-validate the id against `active = true` rows itself, not trust whatever the client sent (mirrors the existing stock-validation pattern in the same file).
- **Webhook redelivery after a transient failure:** Stripe retries a webhook if the handler doesn't return 2xx. The notification email must be attempted only once per successful order insert (not on every retry of an already-completed order) and must never throw past a `try/catch`, or a Resend outage would turn into an infinite Stripe retry loop.
- **Bulk ticket printing with mixed pickup locations:** `printTickets()` is called for both single and bulk (up to all filtered orders) prints — the pickup-location line must read per-order data (`order.pickup_location_name`), not a value captured once outside the per-ticket loop.

---

### Task 1: `guest-checkout.js` — pickup location metadata, reliable user lookup, receipt email

**Files:**
- Modify: `api/stripe/guest-checkout.js`
- Test: manual `curl` against local dev server (see Step 6)

**Interfaces:**
- Consumes: request body now optionally includes `pickup_location_id` (string UUID or empty/omitted) alongside existing `items`, `guest_email`, `guest_name`.
- Produces: Stripe Checkout Session with `metadata.pickup_location` (location name, string) set when a valid active location id was provided; `payment_intent_data.receipt_email` always set to the guest's email. No change to the response shape (`{ url }` / `{ error }`).

- [ ] **Step 1: Fix unpaginated admin user lookup**

Replace the unpaginated `listUsers()` call so returning guests past the default 50-user page aren't missed:

```js
// Before:
const { data: existingUsers } = await sb.auth.admin.listUsers();
const existingUser = (existingUsers?.users || []).find(u => u.email === guest_email.toLowerCase().trim());

// After:
const { data: existingUsers } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
const existingUser = (existingUsers?.users || []).find(u => u.email === guest_email.toLowerCase().trim());
```

- [ ] **Step 2: Validate and resolve the pickup location server-side**

Add this block after the existing stock-validation block (after the `for (const item of items)` loop, before "Fetch Stripe products"):

```js
    // Resolve + validate pickup location (guest may not have selected one)
    let pickupLocationName = null;
    const { pickup_location_id } = req.body;
    if (pickup_location_id) {
      const { data: locRow } = await sb
        .from('pickup_locations')
        .select('name')
        .eq('id', pickup_location_id)
        .eq('active', true)
        .maybeSingle();
      if (locRow?.name) pickupLocationName = locRow.name;
    }
```

- [ ] **Step 3: Attach pickup location metadata and receipt email to the session**

```js
// Before:
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lineItems,
      customer_email: guest_email.toLowerCase().trim(),
      client_reference_id: userId,
      metadata: { user_id: userId, is_guest: 'true' },
      success_url: `${origin}/menu.html?order=success`,
      cancel_url: `${origin}/menu.html`,
    });

// After:
    const metadata = { user_id: userId, is_guest: 'true' };
    if (pickupLocationName) metadata.pickup_location = pickupLocationName;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lineItems,
      customer_email: guest_email.toLowerCase().trim(),
      client_reference_id: userId,
      metadata,
      payment_intent_data: { receipt_email: guest_email.toLowerCase().trim() },
      success_url: `${origin}/menu.html?order=success`,
      cancel_url: `${origin}/menu.html`,
    });
```

- [ ] **Step 4: Confirm `webhook.js` already stores this metadata (no change needed)**

Read `api/stripe/webhook.js` lines ~99-109 and confirm `pickup_location_name: session.metadata?.pickup_location || null` is already part of the `orders` insert. It is — this task only needs to make sure `pickup_location` metadata is actually set for guests; the storage path already exists from the logged-in checkout flow.

- [ ] **Step 5: Start the local dev server**

Run: `npm run serve`
Expected: server listening on `http://localhost:3000`

- [ ] **Step 6: Manually verify with curl** (requires a local `.env` with real `STRIPE_SECRET_KEY` test-mode key, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — already set up by Eric, not created by this task)

```bash
# Look up a real active pickup_locations.id and stripe_product_id from Supabase first, then:
curl -s -X POST http://localhost:3000/api/stripe/guest-checkout \
  -H "Content-Type: application/json" \
  -d '{"items":[{"stripe_product_id":"<real_product_id>","quantity":1}],"guest_email":"test@example.com","guest_name":"Test Guest","pickup_location_id":"<real_location_id>"}'
```

Expected: JSON response `{"url": "https://checkout.stripe.com/..."}`. In the Stripe Dashboard (test mode) → Payments → open the resulting session → Metadata should show `pickup_location: <location name>`.

- [ ] **Step 7: Verify the pagination fix doesn't break the "existing guest" path**

Run the same curl command twice in a row with the same `guest_email`. Expected: no error on the second call (no duplicate-user 400), and the Supabase `profiles` row for that email is upserted rather than a second account created.

- [ ] **Step 8: Commit**

```bash
git add api/stripe/guest-checkout.js
git commit -m "fix: guest checkout sends pickup location, paginates user lookup, requests receipt email"
```

---

### Task 2: Guest checkout modal — collect pickup location

**Files:**
- Modify: `menu.html`
- Modify: `js/menu.js`

**Interfaces:**
- Consumes: `pickup_locations` table (public-read for `active = true`, per `supabase/migrate-pickup-locations.sql`) — same table `js/account.js` already reads for the logged-in profile picker.
- Produces: `pickup_location_id` included in the guest checkout POST body from Task 1.

- [ ] **Step 1: Add the selector markup to the guest modal**

In `menu.html`, inside `#guest-checkout-form`, insert a new field between the email field and the submit button (find the closing `</div>` of the `guest-field` for `guest-email`, insert after it, before `<button type="submit" class="guest-submit-btn"...`):

```html
        <div class="guest-field guest-field-pickup hidden" id="guest-pickup-field">
          <label for="guest-pickup-location">Pickup Location</label>
          <select id="guest-pickup-location" name="pickup_location_id"></select>
        </div>
```

- [ ] **Step 2: Add a `.hidden { display: none; }` rule if not already global**

Check `css/global.css` for an existing `.hidden { display: none; }` rule (used elsewhere in these pages, e.g. `nav-account-item.hidden`). If present, no CSS change needed. If absent, add it to `css/menu.css`.

- [ ] **Step 3: Fetch active locations and populate the selector**

In `js/menu.js`, inside the guest-checkout section (near the other `guestModal*` DOM refs, after `const guestSubmitBtn = document.getElementById('guest-submit-btn');`), add:

```js
      const guestPickupField = document.getElementById('guest-pickup-field');
      const guestPickupSelect = document.getElementById('guest-pickup-location');
      let pickupLocationsLoaded = false;

      async function loadGuestPickupLocations() {
        if (pickupLocationsLoaded) return;
        pickupLocationsLoaded = true;
        const { data: locations } = await sb
          .from('pickup_locations')
          .select('id, name')
          .eq('active', true)
          .order('sort_order');
        if (!locations || !locations.length) return; // no locations configured — skip the field entirely
        guestPickupSelect.innerHTML = locations
          .map(loc => `<option value="${escHtml(loc.id)}">${escHtml(loc.name)}</option>`)
          .join('');
        guestPickupField.classList.remove('hidden');
      }
```

- [ ] **Step 4: Load locations when the guest modal opens**

Modify the existing `openGuestModal` function:

```js
// Before:
      function openGuestModal() {
        guestModalOverlay.style.display = '';
      }

// After:
      function openGuestModal() {
        guestModalOverlay.style.display = '';
        loadGuestPickupLocations();
      }
```

- [ ] **Step 5: Include the selected location in the checkout request**

Modify the guest checkout form submit handler's fetch body:

```js
// Before:
            body: JSON.stringify({
              items: items.map(i => ({
                stripe_product_id: i.stripe_product_id,
                variation_name: i.variation_name || '',
                variation_delta: i.variation_delta || 0,
                quantity: i.quantity,
              })),
              guest_email: emailVal,
              guest_name: nameVal,
            }),

// After:
            body: JSON.stringify({
              items: items.map(i => ({
                stripe_product_id: i.stripe_product_id,
                variation_name: i.variation_name || '',
                variation_delta: i.variation_delta || 0,
                quantity: i.quantity,
              })),
              guest_email: emailVal,
              guest_name: nameVal,
              pickup_location_id: guestPickupSelect.value || null,
            }),
```

- [ ] **Step 6: Manually verify in the browser**

Run: `npm run serve`, open `http://localhost:3000/menu.html`, add an item to cart, open checkout as a guest.
Expected: if at least one active `pickup_locations` row exists in the connected Supabase project, the "Pickup Location" dropdown appears populated between Email and the submit button. If no active locations exist, the field stays hidden and the form still submits normally.

- [ ] **Step 7: Commit**

```bash
git add menu.html js/menu.js
git commit -m "feat: collect pickup location in guest checkout modal"
```

---

### Task 3: Print pickup location on admin order tickets

**Files:**
- Modify: `js/admin.js`

**Interfaces:**
- Consumes: `order.pickup_location_name` — already present on every row returned by the existing `orders` query (`js/admin.js:1758`, column added in `supabase/migrate-pickup-locations.sql`) and already populated by the webhook for both guest (after Task 1) and logged-in checkouts.

- [ ] **Step 1: Add a pickup-location line to `printTickets()`**

In `js/admin.js`, inside the `tickets = orders.map(order => { ... })` block, add this right after the existing `if (fields.date) { ... }` block and before `if (fields.items) {`:

```js
        if (order.pickup_location_name) {
          const loc = document.createElement('div');
          loc.className = 'ticket-pickup-location';
          loc.textContent = `Pickup: ${order.pickup_location_name}`;
          ticket.appendChild(loc);
        }
```

- [ ] **Step 2: Add matching print CSS**

In `css/admin.css`, immediately after the existing `.ticket-date` rule (line 1180: `.ticket-date { font-size: 9pt; color: #555; margin-top: 4pt; }`), add:

```css
.ticket-pickup-location { font-size: 9pt; color: #555; margin-top: 2pt; }
```

Also add the same rule inside the `.print-size-3x5`/`.print-size-3x4` small-ticket override block (around line 1444, alongside the existing `.ticket-customer` font-size overrides), so it shrinks consistently on the smaller ticket sizes:

```css
  .print-size-3x5 .ticket-pickup-location,
  .print-size-3x4 .ticket-pickup-location { font-size: 8pt; }
```

- [ ] **Step 3: Manually verify**

Run: `npm run serve`, sign in to `/admin.html` as an admin user, open Orders, and print (single or bulk) an order that has a non-null `pickup_location_name` in the database (check via Supabase table editor if needed, or use an order created in Task 1's curl test).
Expected: the print preview / print dialog shows a "Pickup: <location name>" line between the date and the item list. An order with `pickup_location_name = null` shows no such line (no "Pickup: " with blank value).

- [ ] **Step 4: Commit**

```bash
git add js/admin.js css/admin.css
git commit -m "feat: print pickup location on admin order tickets"
```

---

### Task 4: Order-placed email notification via Resend

**Files:**
- Modify: `api/stripe/webhook.js`
- Modify: `package.json`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `ORDER_NOTIFICATION_EMAIL` from `process.env` (new — Eric sets these in Vercel after this ships).
- Produces: no change to webhook response shape or timing-sensitive behavior; fires a best-effort email after a `payment` mode order is successfully inserted.

- [ ] **Step 1: Add the `resend` dependency**

```bash
cd /c/oph-organization/clients/bloomin-acres && npm install resend
```

Expected: `package.json` `dependencies` gains `"resend": "^<version>"`, `package-lock.json` updates.

- [ ] **Step 2: Document the new env vars**

In `.env.example`, add a new section after the `# Stripe` block:

```
# Order notifications (Resend)
RESEND_API_KEY=
RESEND_FROM_EMAIL=
ORDER_NOTIFICATION_EMAIL=
```

- [ ] **Step 3: Import Resend and add a notification helper in `webhook.js`**

Add near the top of the file, after the existing imports:

```js
import { Resend } from 'resend';
```

Add this function after the existing `recordReferral` function (end of file):

```js
// Sends a best-effort order notification email. Never throws — a Resend
// outage must not turn a successful order into a webhook retry loop.
async function notifyOrderPlaced(order, orderItemRows) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  const to = process.env.ORDER_NOTIFICATION_EMAIL;
  if (!apiKey || !from || !to) return; // notification not configured — skip silently

  try {
    const resend = new Resend(apiKey);
    const itemLines = orderItemRows
      .map(i => `${i.quantity}x ${i.product_name} — $${((i.unit_amount || 0) * i.quantity / 100).toFixed(2)}`)
      .join('<br>');
    const total = ((order.total_amount || 0) / 100).toFixed(2);
    await resend.emails.send({
      from,
      to,
      subject: `New order — ${order.customer_name || 'Guest'} — $${total}`,
      html: `
        <p><strong>${order.customer_name || 'Guest'}</strong> (${order.customer_email || 'no email'})</p>
        <p>${order.pickup_location_name ? `Pickup: ${order.pickup_location_name}` : ''}</p>
        <p>${itemLines}</p>
        <p><strong>Total: $${total}</strong></p>
      `,
    });
  } catch (err) {
    console.error('[webhook] order notification email failed:', err.message);
  }
}
```

- [ ] **Step 4: Call it after a successful order insert**

In the `if (session.mode === 'payment' && userId) { ... }` block, immediately after the existing `await sb.from('user_cart').delete().eq('user_id', userId);` line (inside the `if (!orderErr && order) { ... }` block), add:

```js
        await notifyOrderPlaced(order, orderItemRows);
```

- [ ] **Step 5: Start the Stripe CLI listener and dev server**

Run: `npm run serve` (in one terminal)
Run: `stripe listen --forward-to localhost:3000/api/stripe/webhook` (in another terminal — copy the printed `whsec_...` into local `.env` as `STRIPE_WEBHOOK_SECRET` if not already set to the CLI's value)

- [ ] **Step 6: Trigger a test event**

Run: `stripe trigger checkout.session.completed`
Expected: the local server logs show the webhook handler ran without throwing. Because the CLI's synthetic event won't have a real `client_reference_id` matching a Supabase user, the order-insert branch will be skipped — this step only confirms the handler still returns 200 and doesn't crash on the new import/function.

- [ ] **Step 7: Verify the email path directly with a real test-mode checkout**

Using the local dev server and a real test-mode Stripe key, complete an actual guest checkout end-to-end (menu.html → guest modal → Stripe test card `4242 4242 4242 4242`) with `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `ORDER_NOTIFICATION_EMAIL` set in local `.env`.
Expected: after the redirect back to `menu.html?order=success`, an email arrives at `ORDER_NOTIFICATION_EMAIL` with the customer name, items, total, and pickup location (if one was selected in Task 2).

- [ ] **Step 8: Verify a Resend failure doesn't break the webhook**

Temporarily set `RESEND_API_KEY` to an invalid value in local `.env`, repeat Step 7.
Expected: the order still gets created in Supabase (checkout still succeeds from the customer's perspective), the webhook still returns 200, and the server log shows `[webhook] order notification email failed: ...`. Restore the real key afterward.

- [ ] **Step 9: Commit**

```bash
git add api/stripe/webhook.js package.json package-lock.json .env.example
git commit -m "feat: email order notification via Resend on checkout.session.completed"
```

---

## Notes on the source PDF for Eric

- **Issue 1 (no notification):** implemented via Resend, Task 4. You'll need to sign up for Resend, verify a sending domain (or use their test domain during development), and set `RESEND_API_KEY` / `RESEND_FROM_EMAIL` / `ORDER_NOTIFICATION_EMAIL` in Vercel after this merges.
- **Issue 2 (guest checkout shows no name/email):** the PDF's stated root cause — "guests have no site account" — doesn't match the current code. `guest-checkout.js` already creates a Supabase account and a `profiles` row (with the name from the guest form) for every guest checkout, and both the admin order list and print-ticket code already read from that `profiles` row with a fallback to `order.customer_name`. This was diagnosed from the Stripe API alone (per the PDF's own header), without reading the site's source, which likely explains the mismatch. I found and fixed one adjacent real bug instead (Task 1, Step 1): the admin user lookup only checked the first 50 accounts, so a returning guest past that count would fail to check out. If you're still seeing blank names on tickets after this ships, flag a specific order ID and I'll trace that exact record.
- **Issue 3 (pickup location missing):** implemented across Tasks 1–3. Logged-in checkout was already sending pickup location to Stripe metadata (from the customer's saved profile preference) — only guest checkout and the printed ticket were missing it.
