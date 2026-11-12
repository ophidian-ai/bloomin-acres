// Bread Box Club helpers shared by subscribe, portal, webhook, checkout and admin routes.
import { Resend } from 'resend';
import { findOrCreateUserByEmail, fillProfileNameIfMissing } from './auth.js';

// Created in Christina's Stripe account on 2026-11-09. Env vars override these,
// but a stale env value is ignored rather than breaking the join flow.
export const CLUB_PRODUCT_ID = (process.env.STRIPE_CLUB_PRODUCT_ID || 'prod_Vb6dndEWLhptAw').trim();
const DEFAULT_CLUB_PRICE_ID = 'price_1UZuQ6JYJib0yIyhjNFanuQM';
export const CLUB_PAYMENT_LINK = 'https://buy.stripe.com/4gM4gA9Tr87R4o36Xu9oc01';
const CLUB_COUPON_ID = 'BREADBOX-CLUB-5';
export const CLUB_DISCOUNT_PCT = 5;
export const MEMBER_STATUSES = ['active', 'past_due'];

// Active pickup/delivery locations with their Club-only flag. Falls back to
// treating every location as open if the club_only column isn't there yet, so
// checkout never silently skips location validation.
export async function activePickupLocations(sb) {
  const withFlag = await sb.from('pickup_locations').select('id, name, club_only').eq('active', true);
  if (!withFlag.error) return withFlag.data || [];
  const { data, error } = await sb.from('pickup_locations').select('id, name').eq('active', true);
  if (error) throw error;
  return (data || []).map(l => ({ ...l, club_only: false }));
}

export const CLUB_ONLY_LOCATION_ERROR = 'That delivery location is a Bread Box Club perk — please choose another location or join the Club.';

let cachedPriceId = null;
export async function resolveClubPriceId(stripe) {
  if (cachedPriceId) return cachedPriceId;
  const envId = (process.env.STRIPE_CLUB_PRICE_ID || '').trim();
  if (envId && envId !== DEFAULT_CLUB_PRICE_ID) {
    try {
      const p = await stripe.prices.retrieve(envId);
      if (p.active && p.recurring) { cachedPriceId = p.id; return cachedPriceId; }
    } catch (err) {
      console.warn('[club] STRIPE_CLUB_PRICE_ID is not a usable price, falling back:', err.message);
    }
  }
  cachedPriceId = DEFAULT_CLUB_PRICE_ID;
  return cachedPriceId;
}

// The 5% member coupon. Uses STRIPE_CLUB_DISCOUNT_ID when it points at a real
// coupon; otherwise creates (once) a fixed-id 5%-forever coupon in Stripe.
let cachedCouponId = null;
export async function resolveClubCouponId(stripe) {
  if (cachedCouponId) return cachedCouponId;
  const envId = (process.env.STRIPE_CLUB_DISCOUNT_ID || '').trim();
  for (const id of [envId, CLUB_COUPON_ID].filter(Boolean)) {
    try {
      const c = await stripe.coupons.retrieve(id);
      if (c.valid) { cachedCouponId = c.id; return cachedCouponId; }
    } catch { /* not found — try next */ }
  }
  try {
    const created = await stripe.coupons.create({
      id: CLUB_COUPON_ID,
      percent_off: CLUB_DISCOUNT_PCT,
      duration: 'forever',
      name: `Bread Box Club — ${CLUB_DISCOUNT_PCT}% member discount`,
    });
    cachedCouponId = created.id;
  } catch (err) {
    // Another cold start created it first
    cachedCouponId = (await stripe.coupons.retrieve(CLUB_COUPON_ID)).id;
  }
  return cachedCouponId;
}

export function isClubSubscription(sub) {
  const envPrice = (process.env.STRIPE_CLUB_PRICE_ID || '').trim();
  return (sub?.items?.data || []).some(item => {
    const price = item.price || {};
    const product = typeof price.product === 'string' ? price.product : price.product?.id;
    return product === CLUB_PRODUCT_ID || price.id === DEFAULT_CLUB_PRICE_ID || (envPrice && price.id === envPrice);
  });
}

export function memberStatusFromStripe(stripeStatus) {
  const map = {
    active: 'active', trialing: 'active',
    past_due: 'past_due', unpaid: 'past_due', paused: 'past_due',
    canceled: 'cancelled', incomplete_expired: 'cancelled',
    incomplete: 'incomplete',
  };
  return map[stripeStatus] || stripeStatus;
}


// Links a Stripe Club subscription to a site account and writes the membership row.
// User resolution order: explicit hint (our own Checkout) → existing row for the
// Stripe customer → the Stripe customer's email (Payment Link signups).
export async function syncClubSubscription(sb, stripe, sub, { userIdHint, email, name } = {}) {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  let userId = userIdHint || sub.metadata?.user_id || null;
  let accountCreated = false;
  let customerEmail = email || (typeof sub.customer === 'object' ? sub.customer?.email : null);
  let customerName = name || (typeof sub.customer === 'object' ? sub.customer?.name : null);

  if (!userId && customerId) {
    const { data: row } = await sb.from('club_members').select('user_id').eq('stripe_customer_id', customerId).maybeSingle();
    userId = row?.user_id || null;
  }
  if ((!userId || !customerEmail) && customerId) {
    const customer = await stripe.customers.retrieve(customerId);
    customerEmail = customerEmail || customer?.email || null;
    customerName = customerName || customer?.name || null;
  }
  if (!userId && customerEmail) {
    const { user, created } = await findOrCreateUserByEmail(sb, customerEmail, customerName, 'club_payment_link');
    userId = user?.id || null;
    accountCreated = created;
  } else if (userId && customerName) {
    await fillProfileNameIfMissing(sb, userId, customerName);
  }
  if (!userId) return { userId: null };

  const status = memberStatusFromStripe(sub.status);

  // Never let a different subscription replace a live membership: a late event
  // for an old subscription, a second subscription, or a Payment Link signup
  // using this account's email must not clobber the one that's paying.
  const { data: existing } = await sb.from('club_members')
    .select('stripe_subscription_id, status').eq('user_id', userId).maybeSingle();
  if (existing?.stripe_subscription_id && existing.stripe_subscription_id !== sub.id
      && MEMBER_STATUSES.includes(existing.status)) {
    console.warn(`[club] kept ${existing.stripe_subscription_id} for ${userId}; ignored ${sub.id} (${sub.status})`);
    return { userId, accountCreated, email: customerEmail, name: customerName, status: existing.status, skipped: true };
  }

  const { error } = await sb.from('club_members').upsert({
    user_id: userId,
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    status,
    cancelled_at: status === 'cancelled' ? new Date().toISOString() : null,
  }, { onConflict: 'user_id' });
  if (error) throw error;

  return { userId, accountCreated, email: customerEmail, name: customerName, status };
}

// Sends the member welcome email once per subscription. The subscription's own
// metadata is the "already sent" marker, so webhook retries don't double-send.
export async function sendClubWelcomeOnce(stripe, sub, { email, name, accountCreated }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from || !email) return;
  if (!['active', 'trialing'].includes(sub.status)) return;
  try {
    const fresh = await stripe.subscriptions.retrieve(sub.id);
    if (fresh.metadata?.welcome_sent === 'true') return;

    const site = (process.env.SITE_URL || 'https://bloominacresmarket.com').replace(/\/$/, '');
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const firstName = String(name || '').trim().split(/\s+/)[0] || 'friend';
    const passwordNote = accountCreated
      ? `<p>We created a Bloomin' Acres account for you with this email address. To sign in the first time, go to <a href="${site}/account.html">your account page</a>, choose <strong>Forgot password?</strong>, and set a password.</p>`
      : '';
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from,
      to: email,
      subject: "Welcome to the Bread Box Club!",
      html: `
        <p>Hi ${esc(firstName)},</p>
        <p>Thank you for joining <strong>The Bread Box Club</strong> at Bloomin' Acres! Your $4.99/month membership is active.</p>
        <p><strong>Your perks:</strong></p>
        <ul>
          <li>${CLUB_DISCOUNT_PCT}% off every order — applied automatically at checkout when you're signed in</li>
          <li>Free delivery to our Club delivery stops — choose one at checkout</li>
          <li>A birthday treat — add your birthday in your account and your first order in the 30 days starting on your birthday gets a free item</li>
          <li>Punch card — every 10 orders earns a free item</li>
          <li>Your own referral link to share with friends</li>
        </ul>
        ${passwordNote}
        <p>Build your box, see your punch card, or manage billing any time from the <a href="${site}/account.html?tab=club">Club tab in your account</a>. You can cancel whenever you like.</p>
        <p>See you at the farmstand!<br>Christina &amp; the Bloomin' Acres family</p>
      `,
    });
    // Mark as sent only after the email went out, so a failed send can be retried
    await stripe.subscriptions.update(sub.id, { metadata: { ...fresh.metadata, welcome_sent: 'true' } });

    const notify = process.env.ORDER_NOTIFICATION_EMAIL;
    if (notify) {
      await resend.emails.send({
        from,
        to: notify,
        subject: `New Bread Box Club member — ${name || email}`,
        html: `<p><strong>${esc(name || 'New member')}</strong> (${esc(email)}) just joined the Bread Box Club.</p>`,
      });
    }
  } catch (err) {
    console.error('[club] welcome email failed:', err.message);
  }
}
