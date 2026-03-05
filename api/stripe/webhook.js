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

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const supabaseUrl = process.env.SUPABASE_URL;
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

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const sb = createClient(supabaseUrl, supabaseServiceKey);

    // Get line items from Stripe
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100 });

    // We need the user_id — stored in client_reference_id or metadata
    const userId = session.client_reference_id || session.metadata?.user_id;

    if (userId) {
      // Create order record
      const { data: order, error: orderErr } = await sb
        .from('orders')
        .insert({
          user_id: userId,
          stripe_session_id: session.id,
          status: 'paid',
          total_amount: session.amount_total,
        })
        .select()
        .single();

      if (!orderErr && order) {
        // Create order_items
        const orderItemRows = lineItems.data.map(item => ({
          order_id: order.id,
          stripe_product_id: item.price?.product ?? '',
          product_name: item.description,
          quantity: item.quantity,
          unit_amount: item.price?.unit_amount ?? null,
        }));

        await sb.from('order_items').insert(orderItemRows);

        // Clear the user's cart
        await sb.from('user_cart').delete().eq('user_id', userId);
      }
    }
  }

  res.json({ received: true });
}
