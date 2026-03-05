import Stripe from 'stripe';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return res.status(500).json({ error: 'STRIPE_SECRET_KEY not set' });

  const { items } = req.body;
  if (!items || !items.length) return res.status(400).json({ error: 'No items provided' });

  try {
    const stripe = new Stripe(secretKey);

    // Fetch Stripe products to get their default price IDs
    const productIds = items.map(i => i.stripe_product_id);
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
      return {
        price: price.id,
        quantity: item.quantity || 1,
      };
    });

    const origin = req.headers.origin || process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lineItems,
      success_url: `${origin}/account.html?tab=orders&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/account.html?tab=cart`,
    });

    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
