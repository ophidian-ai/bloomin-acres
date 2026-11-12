import Stripe from 'stripe';
import { setCors, serviceClient, getRequestUser, isAdmin, listAllUsers } from '../_lib/auth.js';
import { resolveClubPriceId, syncClubSubscription, memberStatusFromStripe, CLUB_PAYMENT_LINK } from '../_lib/club.js';

// Admin-only, read-mostly view of accounts and Club members. Runs with the
// service role so it sees every account (the browser client only sees rows
// RLS allows, which is why the Club tab used to show 0 members).
//
//   GET  /api/admin/customers                → every registered account + order totals
//   GET  /api/admin/customers?view=club      → Club members with live Stripe status
//   POST /api/admin/customers?action=sync-club → link Club subscriptions found in Stripe
//
// Password data is never read or returned.
export default async function handler(req, res) {
  setCors(res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sb = serviceClient();
  if (!sb) return res.status(500).json({ error: 'Supabase environment variables not set' });

  const user = await getRequestUser(req, sb);
  if (!user) return res.status(401).json({ error: 'Please sign in again.' });
  if (!(await isAdmin(sb, user.id))) return res.status(403).json({ error: 'Not an admin' });

  try {
    if (req.method === 'POST' && req.query.action === 'sync-club') return res.json(await syncClub(sb));
    if (req.method === 'GET' && req.query.view === 'club') return res.json(await clubView(sb));
    if (req.method === 'GET') return res.json(await customersView(sb));
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[admin/customers] error:', err);
    return res.status(500).json({ error: err.message });
  }
}

const ORDER_KEY = { profiles: 'user_id', club_members: 'user_id', orders: 'created_at' };

// Reads every row of a table. `optional` columns are dropped and the read
// retried if the live table doesn't have them yet (pre-migration databases).
async function selectAll(sb, table, columns, optional = []) {
  const read = async cols => {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      // Stable order so paging never skips or repeats rows
      const { data, error } = await sb.from(table).select(cols).order(ORDER_KEY[table] || 'user_id').range(from, from + 999);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    return rows;
  };
  if (!optional.length) return read(columns);
  try {
    return await read([columns, ...optional].join(', '));
  } catch (err) {
    console.warn(`[admin/customers] ${table}: optional columns unavailable (${err.message})`);
    return read(columns);
  }
}

async function customersView(sb) {
  const [users, profiles, orders, members] = await Promise.all([
    listAllUsers(sb),
    selectAll(sb, 'profiles', 'user_id, first_name, last_name, phone', ['birthday']),
    selectAll(sb, 'orders', 'user_id, customer_email, customer_name, total_amount, status, created_at'),
    selectAll(sb, 'club_members', 'user_id, status, started_at'),
  ]);

  const profileById = new Map(profiles.map(p => [p.user_id, p]));
  const memberById = new Map(members.map(m => [m.user_id, m]));
  const idByEmail = new Map(users.filter(u => u.email).map(u => [u.email.toLowerCase(), u.id]));

  // Orders count toward an account by user_id, or by email when the order has
  // no account attached (e.g. admin-entered phone orders).
  const stats = new Map();
  const orderNameById = new Map();
  for (const o of orders) {
    const id = o.user_id || (o.customer_email ? idByEmail.get(o.customer_email.toLowerCase()) : null);
    if (!id) continue;
    if (o.customer_name && !orderNameById.has(id)) orderNameById.set(id, o.customer_name);
    if (o.status === 'cancelled') continue;
    const s = stats.get(id) || { order_count: 0, lifetime_cents: 0, last_order_at: null };
    s.order_count += 1;
    s.lifetime_cents += o.total_amount || 0;
    if (!s.last_order_at || o.created_at > s.last_order_at) s.last_order_at = o.created_at;
    stats.set(id, s);
  }

  const customers = users.map(u => {
    const p = profileById.get(u.id) || {};
    const meta = u.user_metadata || {};
    const first = p.first_name || meta.first_name || '';
    const last = p.last_name || meta.last_name || '';
    const name = [first, last].filter(Boolean).join(' ') || meta.full_name || orderNameById.get(u.id) || '';
    const m = memberById.get(u.id);
    return {
      id: u.id,
      email: u.email || '',
      name,
      phone: p.phone || meta.phone || '',
      birthday: p.birthday || null,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at || null,
      email_confirmed: !!u.email_confirmed_at,
      is_guest: !!meta.is_guest,
      created_via: meta.created_via || (meta.is_guest ? 'guest_checkout' : 'signup'),
      club_status: m?.status || null,
      ...(stats.get(u.id) || { order_count: 0, lifetime_cents: 0, last_order_at: null }),
    };
  }).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  return { customers, total: customers.length };
}

async function listClubSubscriptions(stripe) {
  const priceId = await resolveClubPriceId(stripe);
  const subs = [];
  for await (const s of stripe.subscriptions.list({ price: priceId, status: 'all', limit: 100, expand: ['data.customer'] })) {
    subs.push(s);
    if (subs.length >= 1000) break;
  }
  return { priceId, subs };
}

async function clubView(sb) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY not set');
  const stripe = new Stripe(secretKey);

  const [{ priceId, subs }, members, users, profiles] = await Promise.all([
    listClubSubscriptions(stripe),
    selectAll(sb, 'club_members', 'user_id, status, started_at, cancelled_at, stripe_customer_id, stripe_subscription_id', ['punch_count']),
    listAllUsers(sb),
    selectAll(sb, 'profiles', 'user_id, first_name, last_name'),
  ]);

  const price = await stripe.prices.retrieve(priceId).catch(() => null);
  const userById = new Map(users.map(u => [u.id, u]));
  const profileById = new Map(profiles.map(p => [p.user_id, p]));
  const subById = new Map(subs.map(s => [s.id, s]));

  const memberList = await Promise.all(members.map(async m => {
    let sub = m.stripe_subscription_id ? subById.get(m.stripe_subscription_id) : null;
    if (!sub && m.stripe_subscription_id) {
      sub = await stripe.subscriptions.retrieve(m.stripe_subscription_id).catch(() => null);
    }
    const u = userById.get(m.user_id);
    const p = profileById.get(m.user_id) || {};
    return {
      user_id: m.user_id,
      name: [p.first_name, p.last_name].filter(Boolean).join(' ') || u?.user_metadata?.full_name || '',
      email: u?.email || '',
      started_at: m.started_at,
      status: sub ? memberStatusFromStripe(sub.status) : m.status,
      stored_status: m.status,
      punch_count: m.punch_count || 0,
      stripe_customer_id: m.stripe_customer_id,
      stripe: sub ? {
        status: sub.status,
        cancel_at_period_end: !!sub.cancel_at_period_end,
        current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
      } : null,
    };
  }));

  // Keep stored statuses in step with Stripe so checkout discounts match reality
  await Promise.all(memberList
    .filter(m => m.stripe && m.status !== m.stored_status)
    .map(m => sb.from('club_members').update({ status: m.status }).eq('user_id', m.user_id)));

  const linkedSubIds = new Set(members.map(m => m.stripe_subscription_id).filter(Boolean));
  const unlinked = subs
    .filter(s => !linkedSubIds.has(s.id) && !['canceled', 'incomplete_expired'].includes(s.status))
    .map(s => ({
      subscription_id: s.id,
      email: s.customer?.email || '',
      name: s.customer?.name || '',
      status: s.status,
      created: new Date(s.created * 1000).toISOString(),
    }));

  memberList.sort((a, b) => (b.started_at || '').localeCompare(a.started_at || ''));

  return {
    plan: {
      price_id: priceId,
      amount: price?.unit_amount ?? null,
      currency: price?.currency || 'usd',
      interval: price?.recurring?.interval || 'month',
      payment_link: CLUB_PAYMENT_LINK,
    },
    members: memberList,
    unlinked,
  };
}

async function syncClub(sb) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY not set');
  const stripe = new Stripe(secretKey);
  const { subs } = await listClubSubscriptions(stripe);
  const members = await selectAll(sb, 'club_members', 'stripe_subscription_id');
  const linkedSubIds = new Set(members.map(m => m.stripe_subscription_id).filter(Boolean));

  const linked = [];
  const failed = [];
  for (const s of subs) {
    if (linkedSubIds.has(s.id) || ['canceled', 'incomplete_expired'].includes(s.status)) continue;
    try {
      const result = await syncClubSubscription(sb, stripe, s);
      if (result.userId) linked.push({ subscription_id: s.id, email: result.email, account_created: !!result.accountCreated });
      else failed.push({ subscription_id: s.id, reason: 'No email on the Stripe customer' });
    } catch (err) {
      failed.push({ subscription_id: s.id, reason: err.message });
    }
  }
  return { linked, failed };
}
