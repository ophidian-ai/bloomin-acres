// Shared helpers for API routes. Files under api/_lib are not deployed as
// Vercel functions (underscore prefix), so this adds no function count.
import { createClient } from '@supabase/supabase-js';

export function setCors(res, methods = 'POST, OPTIONS') {
  const allowedOrigin = (process.env.ALLOWED_ORIGIN || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')).trim();
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export function serviceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// Resolves the signed-in Supabase user from the request's Bearer token.
// Returns null when the token is missing or invalid — never trusts a user_id in the body.
export async function getRequestUser(req, sb) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token || !sb) return null;
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

export async function isAdmin(sb, userId) {
  if (!userId) return false;
  const { data } = await sb.from('admins').select('user_id').eq('user_id', userId).maybeSingle();
  return !!data;
}

export function requestOrigin(req) {
  if (req.headers.origin) return req.headers.origin;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

// Pages through every auth user. The store has a few hundred accounts at most,
// but a single listUsers page silently caps the result, so always paginate.
export async function listAllUsers(sb) {
  const perPage = 1000;
  const users = [];
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const batch = data?.users || [];
    users.push(...batch);
    if (batch.length < perPage) break;
  }
  return users;
}

export async function findUserByEmail(sb, email) {
  const target = String(email || '').toLowerCase().trim();
  if (!target) return null;
  const users = await listAllUsers(sb);
  return users.find(u => (u.email || '').toLowerCase() === target) || null;
}

function splitName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return { first_name: parts[0] || '', last_name: parts.slice(1).join(' ') };
}

// Fills in first/last name on the profile only when the profile has none yet,
// so a Stripe-supplied name never overwrites what the customer typed themselves.
export async function fillProfileNameIfMissing(sb, userId, fullName) {
  if (!userId || !fullName) return;
  const { data: profile } = await sb.from('profiles').select('first_name, last_name').eq('user_id', userId).maybeSingle();
  if (profile && (profile.first_name || profile.last_name)) return;
  await sb.from('profiles').upsert({ user_id: userId, ...splitName(fullName) }, { onConflict: 'user_id' });
}

// Finds the account for an email, creating one (like guest checkout does) when
// none exists. The customer can set a password later with "Forgot password".
export async function findOrCreateUserByEmail(sb, email, fullName, source) {
  const normalized = String(email || '').toLowerCase().trim();
  if (!normalized) return { user: null, created: false };
  const existing = await findUserByEmail(sb, normalized);
  if (existing) {
    await fillProfileNameIfMissing(sb, existing.id, fullName);
    return { user: existing, created: false };
  }
  const { randomBytes } = await import('crypto');
  const { data, error } = await sb.auth.admin.createUser({
    email: normalized,
    password: randomBytes(24).toString('base64url'),
    email_confirm: true,
    user_metadata: { is_guest: true, created_via: source || 'checkout', ...splitName(fullName) },
  });
  if (error) throw error;
  await fillProfileNameIfMissing(sb, data.user.id, fullName);
  return { user: data.user, created: true };
}
