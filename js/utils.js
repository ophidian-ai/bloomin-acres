/**
 * utils.js -- Shared utility functions for Bloomin' Acres pages.
 * - showToast: Display a toast notification
 * - escHtml: Escape HTML entities
 * - formatPrice: Format cents to currency string
 */

/**
 * Show a toast notification.
 * Uses element with id="toast" on the page.
 * @param {string} msg - Message to display
 * @param {boolean} [isError=false] - Show as error style
 */
function showToast(msg, isError = false) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = isError ? 'error show' : 'show';
  clearTimeout(t._tid);
  t._tid = setTimeout(() => { t.className = ''; }, 3000);
}

/**
 * Escape HTML entities to prevent XSS.
 * @param {*} s - Value to escape
 * @returns {string}
 */
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Format a price in cents to a currency string.
 * @param {number|null} cents - Price in cents
 * @param {string} [currency='usd'] - ISO currency code
 * @returns {string}
 */
function formatPrice(cents, currency = 'usd') {
  if (cents == null) return '\u2014';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

/**
 * The current posted menu (site change #7): only these products can be
 * ordered, and only while the menu window in Admin → Menu Editor is open.
 * Same open/closed rule as menu.js; checkout enforces it again server-side.
 * @param {object} sb - Supabase client
 * @returns {Promise<{open: boolean, message: string, productIds: Set<string>, loaded: boolean}>}
 */
async function getActiveMenuState(sb) {
  const [schedRes, itemsRes] = await Promise.all([
    sb.from('menu_schedule').select('start_date,end_date,message').eq('id', 1).maybeSingle(),
    sb.from('menu_items').select('stripe_product_id'),
  ]);
  const sched = schedRes.data;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const open = !sched || ((!sched.start_date || today >= sched.start_date) && (!sched.end_date || today <= sched.end_date));
  return {
    open,
    message: sched?.message || '',
    productIds: new Set((itemsRes.data || []).map(r => r.stripe_product_id)),
    loaded: !schedRes.error && !itemsRes.error,
  };
}
