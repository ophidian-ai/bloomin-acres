import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

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

  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  try {
    const sb = createClient(supabaseUrl, supabaseServiceKey);
    const { data: member } = await sb
      .from('club_members')
      .select('stripe_customer_id')
      .eq('user_id', user_id)
      .maybeSingle();

    if (!member?.stripe_customer_id) {
      return res.status(404).json({ error: 'No active membership found' });
    }

    const stripe = new Stripe(secretKey);
    const origin = req.headers.origin || `https://${process.env.VERCEL_URL}` || 'http://localhost:3000';

    const session = await stripe.billingPortal.sessions.create({
      customer: member.stripe_customer_id,
      return_url: `${origin}/account.html?tab=club`,
    });

    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
