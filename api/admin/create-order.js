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

  // Validate request body. Orders entered here are booth / phone pre-orders
  // (the Order Sheet's Pre-Order tab): they can be unpaid, carry a pickup date,
  // phone and notes, and may include custom items that aren't in Stripe.
  const { customer_name, customer_email, customer_user_id, items, pickup_location_name,
          phone, notes, pickup_date } = req.body || {};
  const paid = req.body?.paid !== false; // default: paid

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'At least one item is required' });
  }
  if (items.length > 100) return res.status(400).json({ error: 'Too many items' });
  if (!customer_name || !customer_name.trim()) {
    return res.status(400).json({ error: 'Customer name is required' });
  }
  if (pickup_date && !/^\d{4}-\d{2}-\d{2}$/.test(pickup_date)) {
    return res.status(400).json({ error: 'Pickup date must be a date' });
  }
  const cleanItems = [];
  for (const item of items) {
    const quantity = Number(item.quantity);
    const unitAmount = Number(item.unit_amount);
    const isCustom = !item.stripe_product_id || item.stripe_product_id === 'custom';
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
      return res.status(400).json({ error: 'Each item needs a quantity between 1 and 999' });
    }
    if (!Number.isInteger(unitAmount) || unitAmount < 0 || unitAmount > 1000000) {
      return res.status(400).json({ error: 'Each item needs a price' });
    }
    if (isCustom && !String(item.product_name || '').trim()) {
      return res.status(400).json({ error: 'Custom items need a name' });
    }
    cleanItems.push({
      stripe_product_id: isCustom ? 'custom' : String(item.stripe_product_id),
      variation_name:    !isCustom && typeof item.variation_name === 'string' && item.variation_name.trim()
                           ? item.variation_name.trim().slice(0, 200) : null,
      product_name:      String(item.product_name || '').trim().slice(0, 200) || null,
      quantity,
      unit_amount:       unitAmount,
    });
  }
  // The total is always the sum of the lines — never a number sent by the page
  const totalAmount = cleanItems.reduce((sum, i) => sum + i.quantity * i.unit_amount, 0);
  const trimOrNull = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

  try {
    const { data: order, error: orderErr } = await sb
      .from('orders')
      .insert({
        user_id:              customer_user_id || null,
        status:               'paid',            // "open / not picked up" — payment is the `paid` flag
        paid,
        source:               'booth',
        total_amount:         totalAmount,
        customer_name:        customer_name.trim().slice(0, 200),
        customer_email:       trimOrNull(customer_email, 200),
        phone:                trimOrNull(phone, 40),
        notes:                trimOrNull(notes, 500),
        pickup_date:          pickup_date || null,
        pickup_location_name: pickup_location_name || null,
        admin_created:        true,
      })
      .select()
      .single();

    if (orderErr) {
      console.error('[admin/create-order] order insert error:', orderErr);
      return res.status(500).json({ error: orderErr.message });
    }

    const orderItemRows = cleanItems.map(item => ({ order_id: order.id, ...item }));

    const { error: itemsErr } = await sb.from('order_items').insert(orderItemRows);
    if (itemsErr) {
      console.error('[admin/create-order] order_items insert error:', itemsErr);
      // Roll back the order if items failed
      await sb.from('orders').delete().eq('id', order.id);
      return res.status(500).json({ error: itemsErr.message });
    }

    // Booth orders count down item availability too (custom items aren't tracked)
    const { error: stockErr } = await sb.rpc('take_order_stock', { p_order_id: order.id });
    if (stockErr) console.error('[admin/create-order] stock countdown failed:', order.id, stockErr.message);

    res.json({ order });
  } catch (err) {
    console.error('[admin/create-order] unexpected error:', err);
    res.status(500).json({ error: err.message });
  }
}
