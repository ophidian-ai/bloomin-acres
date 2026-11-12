import Stripe from 'stripe';
import { setCors, serviceClient, getRequestUser, requestOrigin } from '../_lib/auth.js';
import { resolveClubPriceId, MEMBER_STATUSES } from '../_lib/club.js';

// Starts a Bread Box Club subscription Checkout for the signed-in account.
// The account is identified from its Supabase session token, never from the body.
export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const sb = serviceClient();
  if (!secretKey || !sb) return res.status(500).json({ error: 'Club checkout is not configured' });

  const user = await getRequestUser(req, sb);
  if (!user) return res.status(401).json({ error: 'Please sign in to join the Club.' });

  const { referral_code } = req.body || {};

  try {
    const stripe = new Stripe(secretKey);

    const { data: existingMember } = await sb
      .from('club_members')
      .select('status, stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (MEMBER_STATUSES.includes(existingMember?.status)) {
      return res.status(409).json({ error: "You're already a Bread Box Club member." });
    }

    // Referral code must exist and belong to someone else
    let validatedReferralCode = null;
    if (referral_code && String(referral_code).trim()) {
      const { data: codeRow } = await sb
        .from('referral_codes')
        .select('user_id, code')
        .eq('code', String(referral_code).trim().toUpperCase())
        .maybeSingle();
      if (codeRow && codeRow.user_id !== user.id) validatedReferralCode = codeRow.code;
    }

    // Reuse the member's Stripe customer when we know it, then any customer with
    // their email (e.g. from past orders), and only then create a new one.
    let customerId = existingMember?.stripe_customer_id || null;
    if (!customerId && user.email) {
      const found = await stripe.customers.list({ email: user.email, limit: 1 });
      customerId = found.data[0]?.id || null;
    }
    if (!customerId) {
      const { data: profile } = await sb.from('profiles').select('first_name, last_name').eq('user_id', user.id).maybeSingle();
      const customer = await stripe.customers.create({
        email: user.email,
        name: [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || undefined,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;
    }

    const origin = requestOrigin(req);
    const sessionParams = {
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: await resolveClubPriceId(stripe), quantity: 1 }],
      client_reference_id: user.id,
      metadata: { user_id: user.id, referral_code: validatedReferralCode || '' },
      subscription_data: { metadata: { user_id: user.id } },
      success_url: `${origin}/account.html?tab=club&subscribed=1`,
      cancel_url: `${origin}/club.html`,
    };

    const referralClubCoupon = process.env.STRIPE_REFERRAL_CLUB_COUPON;
    if (validatedReferralCode && referralClubCoupon) {
      sessionParams.discounts = [{ coupon: referralClubCoupon }];
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    res.json({ url: session.url });
  } catch (err) {
    console.error('[subscribe] error:', err);
    res.status(500).json({ error: err.message });
  }
}
