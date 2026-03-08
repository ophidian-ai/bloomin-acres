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
      if (guest_name) {
        await sb.from('profiles').upsert({
          id: userId,
          first_name: guest_name.split(' ')[0] || '',
          last_name: guest_name.split(' ').slice(1).join(' ') || '',
        }, { onConflict: 'id' });
      }
    } else {
      const tempPassword = crypto.randomBytes(24).toString('base64url');
      const { data: newUser, error: createErr } = await sb.auth.admin.createUser({
        email: guest_email.toLowerCase().trim(),
        password: tempPassword,
        email_confirm: true,
        user_metadata: { is_guest: true },
      });
      if (createErr) return res.status(400).json({ error: createErr.message });
      userId = newUser.user.id;

      if (guest_name) {
        await sb.from('profiles').upsert({
          id: userId,
          first_name: guest_name.split(' ')[0] || '',
          last_name: guest_name.split(' ').slice(1).join(' ') || '',
        }, { onConflict: 'id' });
      }
    }

    // Validate stock before proceeding
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

    // Fetch Stripe products to get their default price IDs
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
