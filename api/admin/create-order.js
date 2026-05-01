import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  const allowedOrigin = (process.env.ALLOWED_ORIGIN || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')).trim();
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
    return res.status(500).json({ error: 'Supabase environment variables not set' });
  }

  // Verify the caller is an authenticated admin
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing auth token' });

  const anonClient = createClient(supabaseUrl, supabaseAnonKey);
  const { data: { user }, error: userErr } = await anonClient.auth.getUser(token);
  if (userErr || !user) return res.status(401).json({ error: 'Invalid auth token' });

  const sb = createClient(supabaseUrl, supabaseServiceKey);
  const { data: adminRow } = await sb.from('admins').select('user_id').eq('user_id', user.id).maybeSingle();
  if (!adminRow) return res.status(403).json({ error: 'Not an admin' });

  // Validate request body
  const { customer_name, customer_email, customer_user_id, items, pickup_location_name, total_amount } = req.body || {};

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'At least one item is required' });
  }
  if (!customer_name || !customer_name.trim()) {
    return res.status(400).json({ error: 'Customer name is required' });
  }
  for (const item of items) {
    if (!item.stripe_product_id || !item.quantity || item.quantity < 1) {
      return res.status(400).json({ error: 'Each item must have a product and quantity' });
    }
  }

  try {
    const { data: order, error: orderErr } = await sb
      .from('orders')
      .insert({
        user_id:              customer_user_id || null,
        status:               'paid',
        total_amount:         total_amount || null,
        customer_name:        customer_name.trim(),
        customer_email:       customer_email?.trim() || null,
        pickup_location_name: pickup_location_name || null,
        admin_created:        true,
      })
      .select()
      .single();

    if (orderErr) {
      console.error('[admin/create-order] order insert error:', orderErr);
      return res.status(500).json({ error: orderErr.message });
    }

    const orderItemRows = items.map(item => ({
      order_id:          order.id,
      stripe_product_id: item.stripe_product_id,
      product_name:      item.product_name || null,
      quantity:          item.quantity,
      unit_amount:       item.unit_amount || null,
    }));

    const { error: itemsErr } = await sb.from('order_items').insert(orderItemRows);
    if (itemsErr) {
      console.error('[admin/create-order] order_items insert error:', itemsErr);
      // Roll back the order if items failed
      await sb.from('orders').delete().eq('id', order.id);
      return res.status(500).json({ error: itemsErr.message });
    }

    res.json({ order });
  } catch (err) {
    console.error('[admin/create-order] unexpected error:', err);
    res.status(500).json({ error: err.message });
  }
}
