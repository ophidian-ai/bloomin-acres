(() => {
  let sb = null;
  let currentUser = null;
  let products = {};   // stripe_product_id → { name, price_formatted, unit_amount }
  let cartItems = [];
  let favItems = [];
  let menuProductIds = new Set(); // currently published menu items
  let isSigningUp = false;

  // ── Helpers ──────────────────────────────────────────────────────────────
  const fmt = formatPrice;

  function setLoading(on) {
    document.getElementById('loading').classList.toggle('hidden', !on);
  }

  // ── Tab switching ─────────────────────────────────────────────────────────
  document.querySelectorAll('.auth-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.auth-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.auth-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`panel-${tab}`).classList.add('active');
    });
  });

  document.querySelectorAll('.dash-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const panel = btn.dataset.panel;
      document.querySelectorAll('.dash-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.dash-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`panel-${panel}`).classList.add('active');
    });
  });

  // ── Init ─────────────────────────────────────────────────────────────────
  async function init() {
    const r = await fetch('/api/config').catch(() => null);
    if (!r || !r.ok) { setLoading(false); showToast('Cannot reach server', true); return; }
    const cfg = await r.json();
    if (!cfg.supabaseUrl) { setLoading(false); showToast('Server not configured', true); return; }

    sb = supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);

    // Check for deep-link tab (e.g. ?tab=orders after Stripe redirect)
    const params = new URLSearchParams(window.location.search);
    const targetTab = params.get('tab');

    const { data: { session } } = await sb.auth.getSession();
    const alreadySignedIn = !!session;

    // Wire sidebar auth state
    const signinLink = document.getElementById('sidebar-signin-link');
    const acctItemEl = document.getElementById('sidebar-account-item');
    const signoutBtn = document.getElementById('sidebar-signout-btn');

    if (session) {
      signinLink.classList.add('hidden');
      const { data: adminCheck } = await sb.from('admins').select('user_id').eq('user_id', session.user.id).maybeSingle();
      if (adminCheck) {
        const dashLink = document.createElement('a');
        dashLink.href = 'admin.html';
        dashLink.className = 'nav-sidebar-link';
        dashLink.textContent = 'Dashboard';
        acctItemEl.parentNode.insertBefore(dashLink, acctItemEl);
      } else {
        acctItemEl.classList.remove('hidden');
      }
      if (signoutBtn) {
        signoutBtn.classList.remove('hidden');
        signoutBtn.addEventListener('click', async () => {
          await sb.auth.signOut();
          window.location.reload();
        });
      }
      await enterDashboard(session.user, targetTab);
    } else {
      showAuthCard();
    }

    // Only redirect on genuine new sign-ins, not token refreshes when already logged in
    sb.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        if (alreadySignedIn) return;
        if (isSigningUp) {
          isSigningUp = false;
          window.location.href = 'account.html?tab=profile';
        } else {
          window.location.href = 'index.html';
        }
      } else if (event === 'SIGNED_OUT') {
        showAuthCard();
      }
    });

    setLoading(false);
  }

  function showAuthCard() {
    document.getElementById('auth-wrap').classList.remove('hidden');
    document.getElementById('dashboard').classList.add('hidden');
  }

  async function enterDashboard(user, targetTab) {
    // Check if this user is an admin (used for admin link, but don't redirect)
    const { data: adminRow } = await sb.from('admins').select('user_id').eq('user_id', user.id).maybeSingle();

    currentUser = user;

    // Merge any localStorage guest cart into Supabase
    if (typeof cartGet === 'function') {
      const localCart = cartGet();
      if (localCart.length > 0) {
        for (const item of localCart) {
          await sb.from('user_cart').upsert({
            user_id: user.id,
            stripe_product_id: item.stripe_product_id,
            variation_name: item.variation_name || '',
            variation_delta: item.variation_delta || 0,
            quantity: item.quantity,
          }, { onConflict: 'user_id,stripe_product_id,variation_name' });
        }
        cartClear();
      }
    }

    document.getElementById('auth-wrap').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');
    document.getElementById('profile-email').textContent = user.email;

    // Populate profile fields from profiles table
    const { data: profile } = await sb.from('profiles').select('*').eq('user_id', user.id).maybeSingle();
    const firstName = profile?.first_name || '';
    const lastName = profile?.last_name || '';
    document.getElementById('profile-first-name').value = firstName;
    document.getElementById('profile-last-name').value = lastName;
    document.getElementById('profile-phone').value = profile?.phone || '';

    // Update greeting and avatar
    const initial = (firstName || user.email || 'U')[0].toUpperCase();
    document.getElementById('dash-greeting').textContent = firstName ? `Welcome back, ${firstName}` : 'Welcome back';
    document.getElementById('dash-avatar').textContent = initial;

    // Wire topbar account badge
    const topbarBtn = document.getElementById('topbar-account-btn');
    const topbarAvatar = document.getElementById('topbar-avatar');
    const topbarMenu = document.getElementById('topbar-account-menu');
    const topbarSignout = document.getElementById('topbar-signout-btn');
    topbarAvatar.textContent = initial;
    topbarBtn.classList.remove('hidden');
    topbarBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = topbarMenu.classList.toggle('open');
      topbarBtn.setAttribute('aria-expanded', open);
    });
    document.addEventListener('click', () => {
      topbarMenu.classList.remove('open');
      topbarBtn.setAttribute('aria-expanded', 'false');
    });
    topbarMenu.addEventListener('click', (e) => e.stopPropagation());
    topbarSignout.addEventListener('click', async () => {
      await sb.auth.signOut();
      window.location.reload();
    });

    // Activate requested tab
    if (targetTab) {
      const tabBtn = document.querySelector(`.dash-tab[data-panel="${targetTab}"]`);
      if (tabBtn) tabBtn.click();
    }

    await loadProducts();
    await Promise.all([loadCart(), loadFavorites(), loadOrders(), loadMenuItems()]);

    // Load club data if club tab requested or already active
    if (targetTab === 'club') {
      await loadClub();
    }

    // Lazy-load club on first tab click
    let clubLoaded = targetTab === 'club';
    document.querySelector('.dash-tab[data-panel="club"]')?.addEventListener('click', async () => {
      if (!clubLoaded) { clubLoaded = true; await loadClub(); }
    }, { once: true });
  }

  // ── Load Stripe products ──────────────────────────────────────────────────
  async function loadProducts() {
    const r = await fetch('/api/stripe/products').catch(() => null);
    if (!r || !r.ok) return;
    const list = await r.json();
    list.forEach(p => { products[p.id] = p; });
  }

  // ── Menu items (for availability check) ──────────────────────────────────
  async function loadMenuItems() {
    const { data } = await sb.from('menu_items').select('stripe_product_id');
    (data || []).forEach(r => menuProductIds.add(r.stripe_product_id));
    renderFavorites(); // re-render once menu data is available
  }

  // ── Cart ──────────────────────────────────────────────────────────────────
  async function loadCart() {
    const { data, error } = await sb.from('user_cart').select('*').eq('user_id', currentUser.id);
    if (error) return;
    cartItems = data || [];
    renderCart();
  }

  function renderCart() {
    const el = document.getElementById('cart-items');
    const badge = document.getElementById('cart-badge');
    const topbarBadge = document.getElementById('topbar-cart-badge');
    const count = cartItems.reduce((s, i) => s + i.quantity, 0);
    badge.textContent = count;
    badge.classList.toggle('hidden', !count);
    if (topbarBadge) {
      topbarBadge.textContent = count;
      topbarBadge.classList.toggle('hidden', !count);
    }

    if (!cartItems.length) {
      // NOTE: All values here are static strings or from our own Stripe product data, not user input
      el.textContent = '';
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'basket-empty';
      const p = document.createElement('p');
      p.textContent = 'Your basket is empty.';
      const a = document.createElement('a');
      a.href = 'menu.html';
      a.className = 'basket-btn-browse';
      a.textContent = 'Browse the Menu';
      emptyDiv.append(p, a);
      el.appendChild(emptyDiv);
      return;
    }

    let total = 0;
    // NOTE: product names come from our Stripe account (admin-controlled), not user input
    const frag = document.createDocumentFragment();
    cartItems.forEach(item => {
      const pr = products[item.stripe_product_id];
      const name = pr?.name || item.stripe_product_id;
      const varLabel = item.variation_name ? ' \u2014 ' + item.variation_name : '';
      const price = (pr?.unit_amount ?? 0) + (item.variation_delta || 0);
      total += price * item.quantity;

      const row = document.createElement('div');
      row.className = 'basket-item';
      row.dataset.id = item.id;

      const bullet = document.createElement('span');
      bullet.className = 'basket-bullet';

      const nameEl = document.createElement('span');
      nameEl.className = 'basket-item-name';
      nameEl.textContent = name + varLabel;

      const qtyWrap = document.createElement('span');
      qtyWrap.className = 'basket-item-qty';
      const decBtn = document.createElement('button');
      decBtn.type = 'button';
      decBtn.className = 'basket-qty-btn';
      decBtn.dataset.action = 'dec';
      decBtn.dataset.id = item.id;
      decBtn.textContent = '\u2212';
      const qtyNum = document.createElement('span');
      qtyNum.className = 'basket-qty-num';
      qtyNum.textContent = item.quantity > 1 ? '\u00d7' + item.quantity : '';
      const incBtn = document.createElement('button');
      incBtn.type = 'button';
      incBtn.className = 'basket-qty-btn';
      incBtn.dataset.action = 'inc';
      incBtn.dataset.id = item.id;
      incBtn.textContent = '+';
      qtyWrap.append(decBtn, qtyNum, incBtn);

      const priceEl = document.createElement('span');
      priceEl.className = 'basket-item-price';
      priceEl.textContent = fmt(price * item.quantity);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'basket-remove';
      removeBtn.dataset.id = item.id;
      removeBtn.setAttribute('aria-label', 'Remove');
      removeBtn.textContent = '\u00d7';

      row.append(bullet, nameEl, qtyWrap, priceEl, removeBtn);
      frag.appendChild(row);
    });

    // Footer
    const footer = document.createElement('div');
    footer.className = 'basket-footer';
    const totalEl = document.createElement('div');
    totalEl.className = 'basket-total';
    totalEl.textContent = 'Total: ' + fmt(total);
    const actionsEl = document.createElement('div');
    actionsEl.className = 'basket-actions';
    const addMore = document.createElement('a');
    addMore.href = 'menu.html';
    addMore.className = 'basket-btn-add';
    addMore.textContent = '+ Add More';
    const checkoutBtn = document.createElement('button');
    checkoutBtn.type = 'button';
    checkoutBtn.className = 'basket-btn-checkout';
    checkoutBtn.id = 'checkout-btn';
    checkoutBtn.textContent = 'Checkout';
    actionsEl.append(addMore, checkoutBtn);
    footer.append(totalEl, actionsEl);
    frag.appendChild(footer);

    el.textContent = '';
    el.appendChild(frag);

    // Qty controls
    el.querySelectorAll('.basket-qty-btn').forEach(btn => {
      btn.addEventListener('click', () => updateQty(btn.dataset.id, btn.dataset.action));
    });
    el.querySelectorAll('.basket-remove').forEach(btn => {
      btn.addEventListener('click', () => removeCartItem(btn.dataset.id));
    });
    document.getElementById('checkout-btn')?.addEventListener('click', startCheckout);
  }

  async function updateQty(id, action) {
    const item = cartItems.find(i => i.id === id);
    if (!item) return;
    const newQty = action === 'inc' ? item.quantity + 1 : item.quantity - 1;
    if (newQty < 1) return removeCartItem(id);
    const { error } = await sb.from('user_cart').update({ quantity: newQty }).eq('id', id);
    if (!error) { item.quantity = newQty; renderCart(); }
  }

  async function removeCartItem(id) {
    const { error } = await sb.from('user_cart').delete().eq('id', id);
    if (!error) { cartItems = cartItems.filter(i => i.id !== id); renderCart(); showToast('Removed from cart'); }
  }

  async function startCheckout() {
    const overlay = document.getElementById('order-review-overlay');
    const itemsEl = document.getElementById('order-review-items');
    const totalEl = document.getElementById('order-review-total');
    const confirmBtn = document.getElementById('review-confirm-btn');

    // Fetch current stock for all cart products
    const productIds = [...new Set(cartItems.map(i => i.stripe_product_id))];
    const { data: detailsRows } = await sb.from('product_details').select('stripe_product_id, variations').in('stripe_product_id', productIds);
    const stockMap = {};
    (detailsRows || []).forEach(row => {
      (row.variations || []).forEach(v => {
        stockMap[row.stripe_product_id + '|' + (v.name || '')] = v.quantity;
      });
    });

    let total = 0;
    let hasStockIssue = false;
    const frag = document.createDocumentFragment();
    cartItems.forEach(item => {
      const pr = products[item.stripe_product_id];
      const name = pr?.name || item.stripe_product_id;
      const varLabel = item.variation_name ? ' \u2014 ' + item.variation_name : '';
      const price = (pr?.unit_amount ?? 0) + (item.variation_delta || 0);
      total += price * item.quantity;

      const stockKey = item.stripe_product_id + '|' + (item.variation_name || '');
      const available = stockMap[stockKey];
      const overStock = available !== undefined && available !== null && item.quantity > available;
      if (overStock) hasStockIssue = true;

      const row = document.createElement('div');
      row.className = 'order-review-row' + (overStock ? ' stock-warning' : '');
      const nameSpan = document.createElement('span');
      nameSpan.textContent = name + varLabel + (item.quantity > 1 ? ' \u00d7' + item.quantity : '');
      if (overStock) {
        const warn = document.createElement('span');
        warn.className = 'stock-warning-text';
        warn.textContent = available === 0 ? ' (sold out)' : ' (only ' + available + ' available)';
        nameSpan.appendChild(warn);
      }
      const priceSpan = document.createElement('span');
      priceSpan.textContent = fmt(price * item.quantity);
      row.append(nameSpan, priceSpan);
      frag.appendChild(row);
    });

    itemsEl.textContent = '';
    itemsEl.appendChild(frag);
    totalEl.textContent = 'Total: ' + fmt(total);
    confirmBtn.disabled = hasStockIssue;
    confirmBtn.textContent = hasStockIssue ? 'Fix Cart to Continue' : 'Confirm & Pay';
    overlay.classList.remove('hidden');

    document.getElementById('review-cancel-btn').onclick = () => overlay.classList.add('hidden');
    confirmBtn.onclick = hasStockIssue ? null : confirmCheckout;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.add('hidden'); });
  }

  async function confirmCheckout() {
    const overlay = document.getElementById('order-review-overlay');
    const btn = document.getElementById('review-confirm-btn');
    btn.disabled = true; btn.textContent = 'Redirecting\u2026';
    const items = cartItems.map(i => ({ stripe_product_id: i.stripe_product_id, quantity: i.quantity, variation_name: i.variation_name || '', variation_delta: i.variation_delta || 0 }));
    const r = await fetch('/api/stripe/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, user_id: currentUser.id }),
    }).catch(() => null);
    if (!r || !r.ok) { btn.disabled = false; btn.textContent = 'Confirm & Pay'; overlay.classList.add('hidden'); showToast('Checkout failed', true); return; }
    const { url, error } = await r.json();
    if (error || !url) { btn.disabled = false; btn.textContent = 'Confirm & Pay'; overlay.classList.add('hidden'); showToast(error || 'Checkout failed', true); return; }
    window.location.href = url;
  }

  // ── Favorites ─────────────────────────────────────────────────────────────
  async function loadFavorites() {
    const { data, error } = await sb.from('user_favorites').select('*').eq('user_id', currentUser.id);
    if (error) return;
    favItems = data || [];
    renderFavorites();
  }

  function renderFavorites() {
    const el = document.getElementById('favorites-items');
    if (!favItems.length) {
      el.innerHTML = `<div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
        <p>No favorites saved yet.</p>
        <a href="menu.html">Browse the Menu</a>
      </div>`;
      return;
    }
    el.innerHTML = `<div class="favorites-grid">${
      favItems.map(item => {
        const p = products[item.stripe_product_id];
        // Dynamic price: current Stripe base + stored variation delta
        const baseAmount = p?.unit_amount ?? null;
        const totalAmount = baseAmount !== null ? baseAmount + (item.variation_delta || 0) : null;
        const priceDisplay = totalAmount !== null
          ? new Intl.NumberFormat('en-US', { style: 'currency', currency: p?.currency || 'usd' }).format(totalAmount / 100)
          : '—';
        const onMenu = menuProductIds.size === 0 || menuProductIds.has(item.stripe_product_id);
        return `<div class="fav-card${onMenu ? '' : ' unavailable'}">
          <div class="fav-card-name">${p?.name || item.stripe_product_id}</div>
          ${item.variation_name ? `<div class="fav-card-variation">${item.variation_name}</div>` : ''}
          <div class="fav-card-price">${priceDisplay}</div>
          <div class="fav-card-actions">
            ${onMenu
              ? `<button class="btn-cart-add" data-pid="${item.stripe_product_id}" data-vname="${item.variation_name || ''}" data-vdelta="${item.variation_delta || 0}">+ Cart</button>`
              : `<span class="fav-card-unavailable">Not on the Menu</span>`
            }
            <button class="btn-unfav" data-fid="${item.id}" aria-label="Remove favorite">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>`;
      }).join('')
    }</div>`;

    el.querySelectorAll('.btn-cart-add').forEach(btn => {
      btn.addEventListener('click', () => addToCartFromFav(btn.dataset.pid, btn.dataset.vname, parseInt(btn.dataset.vdelta, 10) || 0));
    });
    el.querySelectorAll('.btn-unfav').forEach(btn => {
      btn.addEventListener('click', () => removeFavorite(btn.dataset.fid));
    });
  }

  async function addToCartFromFav(productId, variationName = '', variationDelta = 0) {
    const existing = cartItems.find(i => i.stripe_product_id === productId && (i.variation_name || '') === variationName);
    if (existing) {
      await updateQty(existing.id, 'inc');
    } else {
      const { data, error } = await sb.from('user_cart')
        .insert({ user_id: currentUser.id, stripe_product_id: productId, variation_name: variationName, variation_delta: variationDelta, quantity: 1 })
        .select().single();
      if (!error && data) { cartItems.push(data); renderCart(); }
    }
    showToast('Added to cart');
  }

  async function removeFavorite(id) {
    const { error } = await sb.from('user_favorites').delete().eq('id', id);
    if (!error) { favItems = favItems.filter(i => i.id !== id); renderFavorites(); showToast('Removed from favorites'); }
  }

  // ── Orders ────────────────────────────────────────────────────────────────
  async function loadOrders() {
    const { data: orderList, error } = await sb
      .from('orders').select('*, order_items(*)')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false });
    if (error) return;
    renderOrders(orderList || []);
  }

  function renderOrders(list) {
    const el = document.getElementById('orders-list');
    if (!list.length) {
      el.innerHTML = `<div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <p>No orders yet.</p>
        <a href="menu.html">Browse the Menu</a>
      </div>`;
      return;
    }
    el.innerHTML = list.map(order => {
      const date = new Date(order.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const items = (order.order_items || []).map(i =>
        `<div class="order-item-row"><span>${i.product_name || i.stripe_product_id} × ${i.quantity}</span><span>${fmt(i.unit_amount * i.quantity)}</span></div>`
      ).join('');
      return `<div class="order-card">
        <div class="order-card-header">
          <div>
            <div class="order-date">${date}</div>
            <div class="order-id">${order.id.slice(0,8)}…</div>
          </div>
          <span class="order-status ${order.status}">${order.status}</span>
          <div class="order-total">${fmt(order.total_amount)}</div>
        </div>
        ${items ? `<div class="order-items-list">${items}</div>` : ''}
      </div>`;
    }).join('');
  }

  // ── Auth actions ──────────────────────────────────────────────────────────
  document.getElementById('signin-btn').addEventListener('click', async () => {
    const email = document.getElementById('signin-email').value.trim();
    const password = document.getElementById('signin-password').value;
    const errEl = document.getElementById('signin-error');
    const btn = document.getElementById('signin-btn');
    errEl.classList.remove('visible');
    btn.disabled = true; btn.textContent = 'Signing in…';
    const { error } = await sb.auth.signInWithPassword({ email, password });
    btn.disabled = false; btn.textContent = 'Sign In';
    if (error) { errEl.textContent = error.message; errEl.classList.add('visible'); }
  });

  document.getElementById('signin-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('signin-btn').click();
  });

  document.getElementById('signup-btn').addEventListener('click', async () => {
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;
    const confirm = document.getElementById('signup-confirm').value;
    const errEl = document.getElementById('signup-error');
    const btn = document.getElementById('signup-btn');
    errEl.classList.remove('visible');
    if (password !== confirm) { errEl.textContent = 'Passwords do not match'; errEl.classList.add('visible'); return; }
    if (password.length < 8) { errEl.textContent = 'Password must be at least 8 characters'; errEl.classList.add('visible'); return; }
    btn.disabled = true; btn.textContent = 'Creating account…';
    isSigningUp = true;
    const { error } = await sb.auth.signUp({ email, password });
    btn.disabled = false; btn.textContent = 'Create Account';
    if (error) { isSigningUp = false; errEl.textContent = error.message; errEl.classList.add('visible'); }
    else { showToast('Account created! Check your email to confirm.'); }
  });

  async function signOut() {
    await sb.auth.signOut();
  }
  document.getElementById('signout-btn-2').addEventListener('click', signOut);

  // Phone number auto-format: (xxx) xxx-xxxx
  document.getElementById('profile-phone').addEventListener('input', function () {
    const digits = this.value.replace(/\D/g, '').slice(0, 10);
    let formatted = '';
    if (digits.length > 0) formatted = '(' + digits.slice(0, 3);
    if (digits.length >= 4) formatted += ') ' + digits.slice(3, 6);
    if (digits.length >= 7) formatted += '-' + digits.slice(6, 10);
    this.value = formatted;
  });

  // Save profile
  document.getElementById('save-profile-btn').addEventListener('click', async () => {
    const firstName = document.getElementById('profile-first-name').value.trim();
    const lastName = document.getElementById('profile-last-name').value.trim();
    const phone = document.getElementById('profile-phone').value.trim();
    const btn = document.getElementById('save-profile-btn');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    const { error } = await sb.from('profiles').upsert(
      { user_id: currentUser.id, first_name: firstName, last_name: lastName, phone, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
    btn.disabled = false;
    btn.textContent = 'Save Changes';
    if (error) { showToast(error.message, true); return; }
    // Update greeting and avatar live
    document.getElementById('dash-greeting').textContent = firstName ? `Welcome back, ${firstName}` : 'Welcome back';
    document.getElementById('dash-avatar').textContent = (firstName || currentUser.email || 'U')[0].toUpperCase();
    showToast('Profile saved');
  });

  // Change password
  document.getElementById('change-pw-btn').addEventListener('click', async () => {
    const pw = document.getElementById('new-password').value;
    const confirm = document.getElementById('new-password-confirm').value;
    const errEl = document.getElementById('pw-error');
    errEl.classList.remove('visible');
    if (pw !== confirm) { errEl.textContent = 'Passwords do not match'; errEl.classList.add('visible'); return; }
    if (pw.length < 8) { errEl.textContent = 'Password must be at least 8 characters'; errEl.classList.add('visible'); return; }
    const { error } = await sb.auth.updateUser({ password: pw });
    if (error) { errEl.textContent = error.message; errEl.classList.add('visible'); }
    else { document.getElementById('new-password').value = ''; document.getElementById('new-password-confirm').value = ''; showToast('Password updated'); }
  });

  // ── Club ──────────────────────────────────────────────────────────────────
  let clubMembership = null;
  let boxSelections = [];
  let myReferralCode = null;
  let referralCount = 0;
  const clubMinCents = 2500; // $25

  async function loadClub() {
    document.getElementById('club-loading-state').classList.remove('hidden');
    document.getElementById('club-non-member').classList.add('hidden');
    document.getElementById('club-member-view').classList.add('hidden');

    // Check admin status (admins always have club access)
    const { data: adminRow } = await sb.from('admins').select('user_id').eq('user_id', currentUser.id).maybeSingle();

    const [{ data: member }, { data: boxData }, { data: codeRow }] = await Promise.all([
      sb.from('club_members').select('*').eq('user_id', currentUser.id).maybeSingle(),
      sb.from('box_selections').select('items').eq('user_id', currentUser.id).maybeSingle(),
      sb.from('referral_codes').select('code').eq('user_id', currentUser.id).maybeSingle(),
    ]);

    clubMembership = member;
    boxSelections = boxData?.items || [];
    myReferralCode = codeRow?.code || null;

    const isMember = adminRow || (member && member.status !== 'cancelled');

    document.getElementById('club-loading-state').classList.add('hidden');

    if (!isMember) {
      document.getElementById('club-non-member').classList.remove('hidden');
      document.getElementById('join-club-btn').addEventListener('click', startClubJoin);
      return;
    }

    document.getElementById('club-member-view').classList.remove('hidden');

    // Status badge
    const badge = document.getElementById('club-status-badge');
    if (adminRow && !member) {
      badge.textContent = 'Admin Access';
      badge.className = 'club-status-badge admin';
    } else {
      const statusMap = { active: 'Active Member', past_due: 'Payment Due', cancelled: 'Cancelled' };
      badge.textContent = statusMap[member?.status] || member?.status || 'Active';
      badge.className = `club-status-badge ${member?.status || 'active'}`;
    }

    // Manage billing
    document.getElementById('manage-billing-btn').addEventListener('click', async () => {
      const btn = document.getElementById('manage-billing-btn');
      btn.disabled = true; btn.textContent = 'Loading…';
      const r = await fetch('/api/stripe/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: currentUser.id }),
      }).catch(() => null);
      btn.disabled = false; btn.textContent = 'Manage Billing';
      if (!r || !r.ok) { showToast('Could not open billing portal', true); return; }
      const { url, error } = await r.json();
      if (error || !url) { showToast(error || 'Portal unavailable', true); return; }
      window.location.href = url;
    });

    // Box builder
    renderBoxBuilder();

    // Add items button
    document.getElementById('add-to-box-btn').addEventListener('click', () => {
      const picker = document.getElementById('club-product-picker');
      const wasHidden = picker.classList.toggle('hidden');
      if (!wasHidden) renderProductPicker();
    });
    document.getElementById('picker-close-btn').addEventListener('click', () => {
      document.getElementById('club-product-picker').classList.add('hidden');
    });
    document.getElementById('picker-search').addEventListener('input', renderProductPicker);

    // Order box button
    document.getElementById('order-box-btn').addEventListener('click', orderMyBox);

    // Ensure referral code exists (auto-create if needed)
    if (!myReferralCode) {
      await createReferralCode();
    }
    if (myReferralCode) {
      const shareUrl = `${window.location.origin}/club.html?ref=${myReferralCode}`;
      document.getElementById('my-ref-code-input').value = shareUrl;
    }

    // Load referral count
    if (myReferralCode) {
      const { count } = await sb.from('referral_uses')
        .select('id', { count: 'exact', head: true })
        .eq('code', myReferralCode);
      referralCount = count || 0;
    }
    renderReferralDashboard();

    document.getElementById('copy-ref-btn').addEventListener('click', () => {
      const input = document.getElementById('my-ref-code-input');
      navigator.clipboard.writeText(input.value).then(() => showToast('Link copied!')).catch(() => {
        input.select(); document.execCommand('copy'); showToast('Link copied!');
      });
    });
  }

  async function createReferralCode() {
    const { data: profile } = await sb.from('profiles').select('first_name').eq('user_id', currentUser.id).maybeSingle();
    const prefix = ((profile?.first_name || 'USER').slice(0, 4).toUpperCase()).replace(/[^A-Z]/g, 'X').padEnd(4, 'X');
    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
    const code = `${prefix}-${suffix}`;
    const { data } = await sb.from('referral_codes').insert({ user_id: currentUser.id, code }).select('code').single();
    myReferralCode = data?.code || null;
  }

  function renderBoxBuilder() {
    const el = document.getElementById('box-items-list');
    const footer = document.getElementById('box-footer');

    if (!boxSelections.length) {
      el.innerHTML = '<p class="box-empty-msg">Your box is empty. Click "+ Add Items" to get started.</p>';
      footer.classList.add('hidden');
      return;
    }

    let total = 0;
    el.innerHTML = boxSelections.map((item, idx) => {
      const p = products[item.stripe_product_id];
      const price = (p?.unit_amount ?? 0) + (item.variation_delta ?? 0);
      total += price * item.quantity;
      return `<div class="box-item-row">
        <div class="box-item-name">${p?.name || item.stripe_product_id}${item.variation_name ? ` — ${item.variation_name}` : ''}</div>
        <div class="box-item-controls">
          <button type="button" class="qty-sm" data-idx="${idx}" data-action="dec">−</button>
          <span class="qty-sm-num">${item.quantity}</span>
          <button type="button" class="qty-sm" data-idx="${idx}" data-action="inc">+</button>
        </div>
        <div class="box-item-price">${fmt(price * item.quantity)}</div>
        <button type="button" class="box-remove-btn" data-idx="${idx}" aria-label="Remove">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`;
    }).join('');

    el.querySelectorAll('.qty-sm').forEach(btn => {
      btn.addEventListener('click', () => updateBoxQty(parseInt(btn.dataset.idx), btn.dataset.action));
    });
    el.querySelectorAll('.box-remove-btn').forEach(btn => {
      btn.addEventListener('click', () => removeBoxItem(parseInt(btn.dataset.idx)));
    });

    // Total / discount hint
    footer.classList.remove('hidden');
    const totalLabel = document.getElementById('box-total-label');
    const hint = document.getElementById('box-min-hint');
    totalLabel.textContent = `Total: ${fmt(total)}`;
    totalLabel.className = `box-total-amount${total >= clubMinCents ? ' qualified' : ''}`;
    if (total > 0 && total < clubMinCents) {
      hint.textContent = `Add ${fmt(clubMinCents - total)} more to unlock 5% member discount`;
      hint.className = 'box-min-hint warning';
    } else if (total >= clubMinCents) {
      hint.textContent = '5% member discount will be applied at checkout';
      hint.className = 'box-min-hint success';
    } else {
      hint.textContent = '';
    }
  }

  async function saveBoxSelections() {
    await sb.from('box_selections').upsert(
      { user_id: currentUser.id, items: boxSelections, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
  }

  async function updateBoxQty(idx, action) {
    const item = boxSelections[idx];
    if (!item) return;
    if (action === 'dec' && item.quantity <= 1) return removeBoxItem(idx);
    if (action === 'inc') item.quantity++;
    else item.quantity--;
    await saveBoxSelections();
    renderBoxBuilder();
  }

  async function removeBoxItem(idx) {
    boxSelections.splice(idx, 1);
    await saveBoxSelections();
    renderBoxBuilder();
    showToast('Removed from box');
  }

  function renderProductPicker() {
    const grid = document.getElementById('picker-grid');
    const q = document.getElementById('picker-search').value.trim().toLowerCase();
    const menuItems = [...menuProductIds];
    const filtered = Object.entries(products).filter(([id, p]) => {
      if (menuItems.length && !menuProductIds.has(id)) return false;
      if (q && !p.name.toLowerCase().includes(q)) return false;
      return true;
    });

    if (!filtered.length) {
      grid.innerHTML = '<p class="picker-empty">No menu items found.</p>';
      return;
    }

    grid.innerHTML = filtered.map(([id, p]) => {
      const inBox = boxSelections.find(i => i.stripe_product_id === id && !i.variation_name);
      return `<button type="button" class="picker-item${inBox ? ' in-box' : ''}" data-pid="${id}">
        <span class="picker-item-name">${p.name}</span>
        <span class="picker-item-price">${fmt(p.unit_amount)}</span>
        ${inBox ? '<span class="picker-in-box">In Box ✓</span>' : ''}
      </button>`;
    }).join('');

    grid.querySelectorAll('.picker-item').forEach(btn => {
      btn.addEventListener('click', () => addToBox(btn.dataset.pid));
    });
  }

  async function addToBox(productId) {
    const existing = boxSelections.find(i => i.stripe_product_id === productId && !i.variation_name);
    if (existing) {
      existing.quantity++;
    } else {
      boxSelections.push({ stripe_product_id: productId, quantity: 1, variation_name: '', variation_delta: 0 });
    }
    await saveBoxSelections();
    renderBoxBuilder();
    renderProductPicker();
    showToast('Added to box');
  }

  async function orderMyBox() {
    if (!boxSelections.length) { showToast('Your box is empty', true); return; }
    const btn = document.getElementById('order-box-btn');
    btn.disabled = true; btn.textContent = 'Loading…';

    // Check total for discount hint
    const total = boxSelections.reduce((sum, item) => {
      const p = products[item.stripe_product_id];
      return sum + ((p?.unit_amount ?? 0) + (item.variation_delta ?? 0)) * item.quantity;
    }, 0);

    if (total < clubMinCents) {
      const remaining = fmt(clubMinCents - total);
      showToast(`Add ${remaining} more to unlock 5% member discount`, false);
    }

    // Upsert all box items into user_cart
    for (const item of boxSelections) {
      await sb.from('user_cart').upsert({
        user_id: currentUser.id,
        stripe_product_id: item.stripe_product_id,
        variation_name: item.variation_name || '',
        variation_delta: item.variation_delta || 0,
        quantity: item.quantity,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,stripe_product_id,variation_name' });
    }

    // Reload cart and switch to cart tab
    await loadCart();
    btn.disabled = false; btn.textContent = 'Order My Box →';
    document.querySelector('.dash-tab[data-panel="cart"]')?.click();
    showToast('Box added to cart!');
  }

  function renderReferralDashboard() {
    const milestones = [5, 15, 25];
    const nextMilestone = milestones.find(m => m > referralCount) || null;
    const prevMilestone = milestones.filter(m => m <= referralCount).pop() || 0;

    document.getElementById('ref-count').textContent = referralCount;

    const progress = nextMilestone
      ? Math.min(100, ((referralCount - prevMilestone) / (nextMilestone - prevMilestone)) * 100)
      : 100;
    document.getElementById('ref-progress-fill').style.width = `${progress}%`;
    document.getElementById('ref-next-label').textContent = nextMilestone
      ? `${nextMilestone - referralCount} more to next milestone`
      : 'All milestones reached!';

    const chips = document.getElementById('milestone-chips');
    chips.innerHTML = milestones.map(m => {
      const done = referralCount >= m;
      return `<div class="milestone-chip${done ? ' done' : ''}">
        <span class="milestone-chip-num">${m === 25 ? '25+' : m}</span>
        <span class="milestone-chip-status">${done ? '✓' : `${m - Math.min(referralCount, m)} to go`}</span>
      </div>`;
    }).join('');
  }

  async function startClubJoin() {
    const btn = document.getElementById('join-club-btn');
    btn.disabled = true; btn.textContent = 'Redirecting…';
    const referralCode = sessionStorage.getItem('referral_code') || '';
    const r = await fetch('/api/stripe/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: currentUser.id, referral_code: referralCode }),
    }).catch(() => null);
    btn.disabled = false; btn.textContent = 'Join the Club';
    if (!r || !r.ok) { showToast('Something went wrong', true); return; }
    const { url, error } = await r.json();
    if (error || !url) { showToast(error || 'Checkout failed', true); return; }
    window.location.href = url;
  }

  init();
})();
