import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const secretKey         = process.env.STRIPE_SECRET_KEY;
  const webhookSecret     = process.env.STRIPE_WEBHOOK_SECRET;
  const supabaseUrl       = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!secretKey || !webhookSecret || !supabaseUrl || !supabaseServiceKey) {
    return res.status(500).json({ error: 'Missing environment variables' });
  }

  const stripe = new Stripe(secretKey);
  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    return res.status(400).json({ error: `Webhook signature failed: ${err.message}` });
  }

  const sb = createClient(supabaseUrl, supabaseServiceKey);

  // ── Subscription lifecycle ───────────────────────────────────────────────────
  if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
    const sub = event.data.object;
    const userId = sub.metadata?.user_id || sub.client_reference_id;

    // Try to look up user_id by customer if not in metadata
    let resolvedUserId = userId;
    if (!resolvedUserId) {
      const { data: existing } = await sb
        .from('club_members')
        .select('user_id')
        .eq('stripe_customer_id', sub.customer)
        .maybeSingle();
      resolvedUserId = existing?.user_id;
    }

    if (resolvedUserId) {
      const statusMap = { active: 'active', past_due: 'past_due', canceled: 'cancelled', unpaid: 'past_due' };
      const status = statusMap[sub.status] || sub.status;
      await sb.from('club_members').upsert({
        user_id:               resolvedUserId,
        stripe_customer_id:    sub.customer,
        stripe_subscription_id: sub.id,
        status,
        cancelled_at: status === 'cancelled' ? new Date().toISOString() : null,
      }, { onConflict: 'user_id' });
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    await sb.from('club_members')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('stripe_subscription_id', sub.id);
  }

  // ── Checkout session completed ───────────────────────────────────────────────
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.client_reference_id || session.metadata?.user_id;

    // Handle club subscription signup — store customer_id on the membership
    if (session.mode === 'subscription' && userId) {
      const referralCode = session.metadata?.referral_code || null;
      await sb.from('club_members').upsert({
        user_id:            userId,
        stripe_customer_id: session.customer,
        stripe_subscription_id: session.subscription,
        status: 'active',
        pending_referral_code: referralCode,
      }, { onConflict: 'user_id' });
      // Referral is NOT credited here — it requires subscribe + first order.
      // The referral is stored as pending and credited when the first order is placed.
    }

    // Handle one-time box order
    if (session.mode === 'payment' && userId) {
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100 });

      const { data: order, error: orderErr } = await sb
        .from('orders')
        .insert({
          user_id:          userId,
          stripe_session_id: session.id,
          status:           'paid',
          total_amount:     session.amount_total,
          customer_name:    session.customer_details?.name || null,
          customer_email:   session.customer_details?.email || null,
        })
        .select()
        .single();

      if (!orderErr && order) {
        const orderItemRows = lineItems.data.map(item => ({
          order_id:          order.id,
          stripe_product_id: item.price?.product ?? '',
          product_name:      item.description,
          quantity:          item.quantity,
          unit_amount:       item.price?.unit_amount ?? null,
        }));
        await sb.from('order_items').insert(orderItemRows);
        await sb.from('user_cart').delete().eq('user_id', userId);
      }

      // Credit pending club referral on first order (subscribe + order = qualified)
      const { data: memberRow } = await sb
        .from('club_members')
        .select('pending_referral_code')
        .eq('user_id', userId)
        .maybeSingle();

      if (memberRow?.pending_referral_code) {
        await recordReferral(sb, memberRow.pending_referral_code, userId, 'club', 10);
        await sb.from('club_members')
          .update({ pending_referral_code: null })
          .eq('user_id', userId);
      }

      // Handle referral for regular purchase
      const referralCode = session.metadata?.referral_code;
      if (referralCode && session.metadata?.referral_type === 'regular') {
        await recordReferral(sb, referralCode, userId, 'regular', 5);
      }
    }
  }

  res.json({ received: true });
}

// Records a successful referral use and checks milestone thresholds
async function recordReferral(sb, code, referredUserId, type, discountPct) {
  // Look up referrer
  const { data: codeRow } = await sb
    .from('referral_codes')
    .select('user_id')
    .eq('code', code)
    .maybeSingle();

  if (!codeRow) return;

  // Avoid duplicate referral recording for same referred user
  const { count: existing } = await sb
    .from('referral_uses')
    .select('id', { count: 'exact', head: true })
    .eq('code', code)
    .eq('referred_id', referredUserId);

  if (existing > 0) return;

  await sb.from('referral_uses').insert({
    referrer_id:  codeRow.user_id,
    referred_id:  referredUserId,
    code,
    type,
    discount_pct: discountPct,
  });

  // Check milestone thresholds (1, 3, 5) and store notification
  const { count: total } = await sb
    .from('referral_uses')
    .select('id', { count: 'exact', head: true })
    .eq('referrer_id', codeRow.user_id);

  const milestones = [1, 3, 5];
  for (const m of milestones) {
    if (total === m) {
      await sb.from('site_content').upsert({
        key:   `referral-milestone-${codeRow.user_id}-${m}`,
        value: new Date().toISOString(),
      }, { onConflict: 'key' });
    }
  }
}
