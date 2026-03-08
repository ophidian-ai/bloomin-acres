// js/cart.js — localStorage cart for guest and logged-in users
// Key: 'ba_cart', Value: JSON array of { stripe_product_id, variation_name, variation_delta, quantity }

const CART_KEY = 'ba_cart';

function _cartRead() {
  try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; }
  catch { return []; }
}

function _cartWrite(items) {
  localStorage.setItem(CART_KEY, JSON.stringify(items));
  window.dispatchEvent(new Event('cart-updated'));
}

function cartGet() {
  return _cartRead();
}

function cartAdd(stripe_product_id, variation_name = '', variation_delta = 0) {
  const items = _cartRead();
  const match = items.find(i => i.stripe_product_id === stripe_product_id && i.variation_name === variation_name);
  if (match) {
    match.quantity += 1;
  } else {
    items.push({ stripe_product_id, variation_name, variation_delta, quantity: 1 });
  }
  _cartWrite(items);
}

function cartRemove(stripe_product_id, variation_name = '') {
  const items = _cartRead().filter(i => !(i.stripe_product_id === stripe_product_id && i.variation_name === variation_name));
  _cartWrite(items);
}

function cartUpdateQty(stripe_product_id, variation_name, quantity) {
  const items = _cartRead();
  const match = items.find(i => i.stripe_product_id === stripe_product_id && i.variation_name === variation_name);
  if (match) {
    if (quantity <= 0) {
      cartRemove(stripe_product_id, variation_name);
      return;
    }
    match.quantity = quantity;
    _cartWrite(items);
  }
}

function cartCount() {
  return _cartRead().reduce((sum, i) => sum + i.quantity, 0);
}

function cartClear() {
  localStorage.removeItem(CART_KEY);
  window.dispatchEvent(new Event('cart-updated'));
}
