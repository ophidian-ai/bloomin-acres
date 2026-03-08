import Stripe from 'stripe';

export default async function handler(req, res) {
  const allowedOrigin = (process.env.ALLOWED_ORIGIN || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')).trim();
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return res.status(500).json({ error: 'STRIPE_SECRET_KEY not set' });
  }

  try {
    const stripe = new Stripe(secretKey);
    const result = await stripe.products.list({
      active: true,
      expand: ['data.default_price'],
      limit: 100,
    });

    const products = result.data.map(p => {
      const price = p.default_price;
      const unit_amount = price?.unit_amount ?? null;
      const currency = price?.currency ?? 'usd';
      return {
        id: p.id,
        name: p.name,
        description: p.description || '',
        images: p.images || [],
        unit_amount,
        currency,
        price_formatted: unit_amount != null
          ? new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(unit_amount / 100)
          : null,
      };
    });

    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
