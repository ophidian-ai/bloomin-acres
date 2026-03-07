import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secretKey    = process.env.STRIPE_SECRET_KEY;
  const clubPriceId  = process.env.STRIPE_CLUB_PRICE_ID;
  const referralClubCoupon = process.env.STRIPE_REFERRAL_CLUB_COUPON;
  const supabaseUrl  = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!secretKey || !clubPriceId) {
    return res.status(500).json({ error: 'Stripe club configuration not set' });
  }

  const { user_id, referral_code } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  try {
    const stripe = new Stripe(secretKey);
    const sb = createClient(supabaseUrl, supabaseServiceKey);

    // Validate referral code if provided
    let validatedReferralCode = null;
    if (referral_code && referral_code.trim()) {
      const { data: codeRow } = await sb
        .from('referral_codes')
        .select('user_id, code')
        .eq('code', referral_code.trim().toUpperCase())
        .maybeSingle();
      // Valid as long as it exists and the referrer is not the same person signing up
      if (codeRow && codeRow.user_id !== user_id) {
        validatedReferralCode = codeRow.code;
      }
    }

    // Check if user already has a Stripe customer ID
    const { data: existingMember } = await sb
      .from('club_members')
      .select('stripe_customer_id')
      .eq('user_id', user_id)
      .maybeSingle();

    let customerId = existingMember?.stripe_customer_id || null;

    // Create Stripe customer if none exists
    if (!customerId) {
      const { data: profile } = await sb
        .from('profiles')
        .select('first_name, last_name')
        .eq('user_id', user_id)
        .maybeSingle();

      // Get user email from auth
      const { data: { user } } = await sb.auth.admin.getUserById(user_id);
      const customer = await stripe.customers.create({
        email: user?.email,
        name: [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || undefined,
        metadata: { supabase_user_id: user_id },
      });
      customerId = customer.id;
    }

    const origin = req.headers.origin || `https://${process.env.VERCEL_URL}` || 'http://localhost:3000';

    const sessionParams = {
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: clubPriceId, quantity: 1 }],
      client_reference_id: user_id,
      metadata: { user_id, referral_code: validatedReferralCode || '' },
      success_url: `${origin}/account.html?tab=club&subscribed=1`,
      cancel_url: `${origin}/club.html`,
    };

    // Apply referral discount to first month if valid code
    if (validatedReferralCode && referralClubCoupon) {
      sessionParams.discounts = [{ coupon: referralClubCoupon }];
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
