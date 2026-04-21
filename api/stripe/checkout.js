import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  console.log('[checkout] handler invoked', req.method);
  const allowedOrigin = (process.env.ALLOWED_ORIGIN || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')).trim();
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return res.status(500).json({ error: 'STRIPE_SECRET_KEY not set' });

  const { items, user_id, is_club_member, referral_code } = req.body;
  if (!items || !items.length) return res.status(400).json({ error: 'No items provided' });

  try {
    const stripe = new Stripe(secretKey);
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const sb = supabaseUrl && supabaseServiceKey
      ? createClient(supabaseUrl, supabaseServiceKey)
      : null;

    // Validate stock before proceeding
    const productIds = items.map(i => i.stripe_product_id);
    if (sb) {
      const { data: detailsRows } = await sb.from('product_details').select('stripe_product_id, variations, quantity').in('stripe_product_id', productIds);
      const stockMap = {};
      const baseQtyMap = {};
      (detailsRows || []).forEach(row => {
        if (row.quantity !== null && row.quantity !== undefined) baseQtyMap[row.stripe_product_id] = row.quantity;
        (row.variations || []).forEach(v => {
          stockMap[row.stripe_product_id + '|' + (v.name || '')] = v.quantity;
        });
      });
      for (const item of items) {
        const key = item.stripe_product_id + '|' + (item.variation_name || '');
        const variationQty = stockMap[key];
        const available = variationQty !== undefined ? variationQty : baseQtyMap[item.stripe_product_id];
        if (available !== undefined && available !== null && item.quantity > available) {
          return res.status(400).json({ error: available === 0 ? 'An item in your cart is sold out. Please update your cart.' : 'An item exceeds available stock. Please update your cart.' });
        }
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

    // Calculate cart total (cents) for minimum order check
    const cartTotal = lineItems.reduce((sum, li) => {
      const unitAmount = li.price_data
        ? li.price_data.unit_amount
        : products.find(p => p.default_price?.id === li.price)?.default_price?.unit_amount || 0;
      return sum + unitAmount * (li.quantity || 1);
    }, 0);

    const origin = req.headers.origin
      ? req.headers.origin
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'http://localhost:3000';

    const sessionParams = {
      mode: 'payment',
      line_items: lineItems,
      success_url: `${origin}/account.html?tab=orders&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/account.html?tab=cart`,
    };

    // Always set client_reference_id so webhook can attribute the order
    if (user_id) {
      sessionParams.client_reference_id = user_id;
      sessionParams.metadata = { user_id };
    }

    // Determine discounts to apply (only one discount allowed per Stripe session)
    let appliedDiscount = null;

    // Club member discount: 5% off every order — no minimum
    const clubDiscountCoupon = process.env.STRIPE_CLUB_DISCOUNT_ID;
    if (is_club_member && user_id && sb && clubDiscountCoupon) {
      // Verify club membership server-side (also allow admins)
      const [{ data: memberRow }, { data: adminRow }] = await Promise.all([
        sb.from('club_members').select('status').eq('user_id', user_id).maybeSingle(),
        sb.from('admins').select('user_id').eq('user_id', user_id).maybeSingle(),
      ]);
      if (memberRow?.status === 'active' || adminRow) {
        appliedDiscount = { coupon: clubDiscountCoupon };
        sessionParams.metadata.discount_type = 'club_member';
      }
    }

    // Referral discount (5% off first regular order) — only if no club discount applied
    const referralRegCoupon = process.env.STRIPE_REFERRAL_REG_COUPON;
    if (!appliedDiscount && referral_code && user_id && sb && referralRegCoupon) {
      // Validate referral code exists and belongs to a different user
      const { data: codeRow } = await sb
        .from('referral_codes')
        .select('user_id, code')
        .eq('code', referral_code.trim().toUpperCase())
        .maybeSingle();

      if (codeRow && codeRow.user_id !== user_id) {
        // Check this is the user's first order
        const { count } = await sb
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user_id);

        if (count === 0) {
          appliedDiscount = { coupon: referralRegCoupon };
          sessionParams.metadata.referral_code = codeRow.code;
          sessionParams.metadata.referral_type = 'regular';
          sessionParams.metadata.discount_type = 'referral_regular';
        }
      }
    }

    if (appliedDiscount) {
      sessionParams.discounts = [appliedDiscount];
    }

    // Delivery fee: free for club members in the delivery zone, otherwise charge if delivery requested
    if (req.body.delivery && sb && user_id) {
      const { data: profileRow } = await sb
        .from('profiles')
        .select('delivery_eligible')
        .eq('user_id', user_id)
        .maybeSingle();

      const isMemberWithFreeDelivery = appliedDiscount?.coupon === clubDiscountCoupon && profileRow?.delivery_eligible === true;

      if (!isMemberWithFreeDelivery) {
        // Add delivery fee line item (configurable via STRIPE_DELIVERY_PRICE_ID)
        const deliveryPriceId = process.env.STRIPE_DELIVERY_PRICE_ID;
        if (deliveryPriceId) {
          sessionParams.line_items.push({ price: deliveryPriceId, quantity: 1 });
        }
      }
      sessionParams.metadata.delivery = 'true';
      sessionParams.metadata.free_delivery = isMemberWithFreeDelivery ? 'true' : 'false';
    }

    // Attach preferred pickup location name to order metadata
    if (sb && user_id) {
      const { data: profileWithPickup } = await sb
        .from('profiles')
        .select('preferred_pickup_location_id')
        .eq('user_id', user_id)
        .maybeSingle();

      if (profileWithPickup?.preferred_pickup_location_id) {
        const { data: locRow } = await sb
          .from('pickup_locations')
          .select('name')
          .eq('id', profileWithPickup.preferred_pickup_location_id)
          .maybeSingle();
        if (locRow?.name) {
          if (!sessionParams.metadata) sessionParams.metadata = {};
          sessionParams.metadata.pickup_location = locRow.name;
        }
      }
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    res.json({ url: session.url });
  } catch (err) {
    console.error('[checkout] error:', err);
    res.status(500).json({ error: err.message });
  }
}
