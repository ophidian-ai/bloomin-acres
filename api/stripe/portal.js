import Stripe from 'stripe';
import { setCors, serviceClient, getRequestUser, requestOrigin } from '../_lib/auth.js';
import { isClubSubscription, resolveClubPriceId, syncClubSubscription, memberStatusFromStripe } from '../_lib/club.js';

// GET  → the signed-in member's live subscription status (for the account Club tab)
// POST → opens a Stripe billing portal session (update card, invoices, cancel)
//
// Both resolve the member from their session token. If the membership row is
// missing but Stripe has a Club subscription under the account's email (e.g. a
// Payment Link signup before the webhook matched it), it is linked here.
export default async function handler(req, res) {
  setCors(res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const sb = serviceClient();
  if (!secretKey || !sb) return res.status(500).json({ error: 'Billing is not configured' });

  const user = await getRequestUser(req, sb);
  if (!user) return res.status(401).json({ error: 'Please sign in again to manage billing.' });

  try {
    const stripe = new Stripe(secretKey);
    const { data: member } = await sb
      .from('club_members')
      .select('status, stripe_customer_id, stripe_subscription_id')
      .eq('user_id', user.id)
      .maybeSingle();

    let customerId = member?.stripe_customer_id || null;
    let subscription = null;

    if (member?.stripe_subscription_id) {
      subscription = await stripe.subscriptions.retrieve(member.stripe_subscription_id).catch(() => null);
    }

    // Self-heal: find a Club subscription for this email and link it. Only for
    // accounts that have proved they own the address (clicked the confirmation
    // link), so nobody can claim someone else's subscription by signing up
    // with their email.
    if (!subscription && user.email && user.email_confirmed_at) {
      const priceId = await resolveClubPriceId(stripe);
      const customers = await stripe.customers.list({ email: user.email, limit: 10 });
      for (const c of customers.data) {
        const subs = await stripe.subscriptions.list({ customer: c.id, status: 'all', limit: 20 });
        const clubSub = subs.data
          .filter(s => isClubSubscription(s) || s.items.data.some(i => i.price?.id === priceId))
          .sort((a, b) => b.created - a.created)[0];
        if (clubSub) {
          await syncClubSubscription(sb, stripe, clubSub, { userIdHint: user.id, email: user.email });
          subscription = clubSub;
          customerId = c.id;
          break;
        }
      }
    }

    if (subscription && !customerId) {
      customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
    }

    if (req.method === 'GET') {
      if (!subscription) return res.json({ subscription: null });
      // Keep the stored status in step with Stripe (covers a missed webhook)
      const status = memberStatusFromStripe(subscription.status);
      if (member && member.status !== status) {
        await sb.from('club_members').update({ status }).eq('user_id', user.id);
      }
      return res.json({
        subscription: {
          status,
          stripe_status: subscription.status,
          cancel_at_period_end: !!subscription.cancel_at_period_end,
          current_period_end: subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null,
        },
      });
    }

    if (!customerId) {
      return res.status(404).json({ error: `We couldn't find a Bread Box Club subscription for ${user.email}.` });
    }

    const params = { customer: customerId, return_url: `${requestOrigin(req)}/account.html?tab=club` };
    if (process.env.STRIPE_PORTAL_CONFIG_ID) params.configuration = process.env.STRIPE_PORTAL_CONFIG_ID.trim();
    const session = await stripe.billingPortal.sessions.create(params);
    res.json({ url: session.url });
  } catch (err) {
    console.error('[portal] error:', err);
    res.status(500).json({ error: err.message });
  }
}
