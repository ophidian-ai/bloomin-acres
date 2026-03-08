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
