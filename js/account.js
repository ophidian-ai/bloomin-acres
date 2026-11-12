(() => {
  let sb = null;
  let currentUser = null;
  let products = {};   // stripe_product_id → { name, price_formatted, unit_amount }
  let cartItems = [];
  let favItems = [];
  let menuProductIds = new Set(); // currently published menu items
  let isSigningUp = false;
  let userBirthday = null;
  // Read before supabase-js consumes (and clears) the URL hash from the reset email link
  const cameFromPasswordReset = /type=recovery/.test(window.location.hash);

  // ── Helpers ──────────────────────────────────────────────────────────────
  const fmt = formatPrice;
  const CLUB_DISCOUNT_PCT = 5;
  const MEMBER_STATUSES = ['active', 'past_due'];

  // Headers for our API routes — the server identifies the account from the token
  async function authHeaders() {
    const { data: { session } } = await sb.auth.getSession();
    const headers = { 'Content-Type': 'application/json' };
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
    return headers;
  }

  async function readError(r, fallback) {
    if (!r) return 'Network error — please check your connection and try again.';
    try { const body = await r.json(); return body.error || fallback; } catch { return fallback; }
  }

  function isClubMember() {
    return !!clubMembership && MEMBER_STATUSES.includes(clubMembership.status);
  }
  // Admins get member pricing too (matches the server's checkout rule)
  function hasMemberPricing() { return isAdminUser || isClubMember(); }
  function memberDiscount(totalCents) {
    return hasMemberPricing() ? Math.round(totalCents * CLUB_DISCOUNT_PCT / 100) : 0;
  }

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
      const url = new URL(window.location);
      url.searchParams.set('tab', panel);
      history.replaceState(null, '', url);
    });
  });

  // ── Init ─────────────────────────────────────────────────────────────────
  async function init() {
    sb = await getSupabase();
    if (!sb) { setLoading(false); showToast('Cannot reach server', true); return; }

    // Check for deep-link tab (e.g. ?tab=orders after Stripe redirect)
    const params = new URLSearchParams(window.location.search);
    const targetTab = params.get('tab');

    const { data: { session } } = await sb.auth.getSession();
    let alreadySignedIn = !!session;

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
      showAuthCard(targetTab);
    }

    // Only redirect on genuine new sign-ins, not token refreshes when already logged in
    sb.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        if (alreadySignedIn) return;
        if (isSigningUp) {
          isSigningUp = false;
          window.location.href = 'account.html?tab=profile';
        } else {
          const tab = new URLSearchParams(window.location.search).get('tab');
          window.location.href = tab ? `account.html?tab=${encodeURIComponent(tab)}` : '/';
        }
      } else if (event === 'SIGNED_OUT') {
        alreadySignedIn = false;
        // Re-read the tab from the URL rather than the stale `targetTab` closure —
        // the dash-tab click handler updates the URL on tab switch but not this variable.
        const currentTab = new URLSearchParams(window.location.search).get('tab');
        showAuthCard(currentTab);
      }
    });

    setLoading(false);
  }

  function showAuthCard(tab) {
    document.getElementById('auth-wrap').classList.remove('hidden');
    document.getElementById('dashboard').classList.add('hidden');
    const subhead = document.getElementById('auth-subhead');
    if (subhead) {
      if (tab === 'cart') {
        subhead.textContent = 'Sign in to view your basket and manage your subscription.';
      } else if (tab === 'club') {
        subhead.textContent = 'Membership is $4.99/month, cancel anytime. Sign in or create an account to join.';
      } else {
        subhead.textContent = 'Sign in to save favorites, track orders, and join the Bread Box Club';
      }
    }
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
    let { data: profile } = await sb.from('profiles').select('*').eq('user_id', user.id).maybeSingle();

    // First login after signup: profile may not exist because the signup upsert
    // runs before email verification (no session → RLS blocks the write).
    // Seed the profile from user_metadata saved during signUp.
    if (!profile) {
      const meta = user.user_metadata || {};
      const seed = {
        user_id: user.id,
        first_name: meta.first_name || '',
        last_name: meta.last_name || '',
        phone: meta.phone || '',
        updated_at: new Date().toISOString(),
      };
      if (meta.birthday) seed.birthday = meta.birthday;
      const { data: seeded } = await sb.from('profiles').upsert(seed, { onConflict: 'user_id' }).select().single();
      if (seeded) profile = seeded;
    }

    const firstName = profile?.first_name || '';
    const lastName = profile?.last_name || '';
    document.getElementById('profile-first-name').value = firstName;
    document.getElementById('profile-last-name').value = lastName;
    document.getElementById('profile-phone').value = profile?.phone || '';
    document.getElementById('profile-birthday').value = profile?.birthday || '';
    userBirthday = profile?.birthday || null;

    // Load pickup locations (non-blocking)
    loadPickupLocations(profile?.preferred_pickup_location_id || null);

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

    // On mobile, scroll the active dashboard tab into view
    const activeTab = document.querySelector('.dash-tab.active');
    if (activeTab && window.innerWidth <= 768) {
      activeTab.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }

    // Returned from a "Forgot password" email: the reset link signs them in,
    // so point them straight at the new-password fields.
    if (cameFromPasswordReset) {
      document.querySelector('.dash-tab[data-panel="profile"]')?.click();
      const pw = document.getElementById('new-password');
      pw?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      pw?.focus();
      showToast('Choose a new password below');
    }

    await loadProducts();

    // Basket tab shows a cross-link to the Club box builder for members — fetched
    // here (concurrently with the other dashboard data) since Basket is the
    // default tab and most returning members land on it directly, before
    // loadClub()'s own lazy fetch would ever run. Shares the same membership
    // row/admin flag loadClub() uses below, so both places agree on who counts
    // as a member instead of each re-deriving it independently.
    const [, , , , { data: membershipRow }] = await Promise.all([
      loadCart(), loadFavorites(), loadOrders(), loadMenuItems(),
      sb.from('club_members').select('*').eq('user_id', user.id).maybeSingle(),
    ]);
    clubMembership = membershipRow;
    isAdminUser = !!adminRow;

    const basketClubHint = document.getElementById('basket-club-hint');
    if (basketClubHint) basketClubHint.classList.toggle('hidden', !hasMemberPricing());
    // Basket rendered before membership was known — redraw with the member discount line
    renderCart();

    // Load club data if club tab requested or already active
    if (targetTab === 'club') {
      await loadClub();
    }

    // Lazy-load club on first tab click
    let clubLoaded = targetTab === 'club';
    document.querySelector('.dash-tab[data-panel="club"]')?.addEventListener('click', async () => {
      if (!clubLoaded) { clubLoaded = true; await loadClub(); }
    }, { once: true });

    // Lazy-load reviews on first tab click
    let reviewsLoaded = targetTab === 'reviews';
    if (reviewsLoaded) await loadMyReviews();
    document.querySelector('.dash-tab[data-panel="reviews"]')?.addEventListener('click', async () => {
      if (!reviewsLoaded) { reviewsLoaded = true; await loadMyReviews(); }
    }, { once: true });

    initReviewForm();
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
    const discount = memberDiscount(total);
    if (discount) {
      const discountEl = document.createElement('div');
      discountEl.className = 'basket-discount';
      const label = document.createElement('span');
      label.textContent = `Bread Box Club ${CLUB_DISCOUNT_PCT}% off`;
      const amount = document.createElement('span');
      amount.textContent = '−' + fmt(discount);
      discountEl.append(label, amount);
      frag.appendChild(discountEl);
    }
    const totalEl = document.createElement('div');
    totalEl.className = 'basket-total';
    totalEl.textContent = 'Total: ' + fmt(total - discount);
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

    const discount = memberDiscount(total);
    if (discount) {
      const dRow = document.createElement('div');
      dRow.className = 'order-review-row order-review-discount';
      const dLabel = document.createElement('span');
      dLabel.textContent = `Bread Box Club ${CLUB_DISCOUNT_PCT}% off`;
      const dAmt = document.createElement('span');
      dAmt.textContent = '−' + fmt(discount);
      dRow.append(dLabel, dAmt);
      frag.appendChild(dRow);
    }

    itemsEl.textContent = '';
    itemsEl.appendChild(frag);
    totalEl.textContent = 'Total: ' + fmt(total - discount);
    overlay.classList.remove('hidden');

    const pickupField = document.getElementById('order-review-pickup');
    const pickupSelect = document.getElementById('review-pickup-location');
    const [{ data: pickupLocs }, { data: prof }] = await Promise.all([
      sb.from('pickup_locations').select('id, name').eq('active', true).order('sort_order'),
      sb.from('profiles').select('preferred_pickup_location_id').eq('user_id', currentUser.id).maybeSingle(),
    ]);
    const hasPickup = !!pickupLocs?.length;
    pickupField.classList.toggle('hidden', !hasPickup);
    if (hasPickup) {
      pickupSelect.innerHTML = '<option value="" disabled>Choose a pickup location</option>' +
        pickupLocs.map(l => `<option value="${escHtml(l.id)}">${escHtml(l.name)}</option>`).join('');
      pickupSelect.value = pickupLocs.some(l => l.id === prof?.preferred_pickup_location_id) ? prof.preferred_pickup_location_id : '';
    }
    const pickupOk = () => !hasPickup || !!pickupSelect.value;
    const syncConfirm = () => {
      confirmBtn.disabled = hasStockIssue || !pickupOk();
      confirmBtn.textContent = hasStockIssue ? 'Fix Cart to Continue'
        : pickupOk() ? 'Confirm & Pay' : 'Choose a Pickup Location';
    };
    pickupSelect.onchange = syncConfirm;
    syncConfirm();

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
      headers: await authHeaders(),
      body: JSON.stringify({ items, user_id: currentUser.id, pickup_location_id: document.getElementById('review-pickup-location').value || null }),
    }).catch(() => null);
    if (!r || !r.ok) { btn.disabled = false; btn.textContent = 'Confirm & Pay'; overlay.classList.add('hidden'); showToast(await readError(r, 'Checkout failed'), true); return; }
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
    const firstName = document.getElementById('signup-first-name').value.trim();
    const lastName = document.getElementById('signup-last-name').value.trim();
    const phone = document.getElementById('signup-phone').value.trim();
    const birthday = document.getElementById('signup-birthday')?.value || null;
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;
    const confirm = document.getElementById('signup-confirm').value;
    const errEl = document.getElementById('signup-error');
    const btn = document.getElementById('signup-btn');
    errEl.classList.remove('visible');
    if (!firstName) { errEl.textContent = 'First name is required'; errEl.classList.add('visible'); return; }
    if (password !== confirm) { errEl.textContent = 'Passwords do not match'; errEl.classList.add('visible'); return; }
    if (password.length < 8) { errEl.textContent = 'Password must be at least 8 characters'; errEl.classList.add('visible'); return; }
    btn.disabled = true; btn.textContent = 'Creating account…';
    isSigningUp = true;
    const displayName = [firstName, lastName].filter(Boolean).join(' ');
    // Someone who clicked "Join the Club" lands back on the Club tab after confirming
    const joining = sessionStorage.getItem('club_join_intent') === '1';
    const emailRedirectTo = `https://bloominacresmarket.com/account.html?tab=${joining ? 'club&join=1' : 'profile'}`;
    const meta = { display_name: displayName, full_name: displayName, first_name: firstName, last_name: lastName, phone };
    if (birthday) meta.birthday = birthday;
    const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo, data: meta } });
    btn.disabled = false; btn.textContent = 'Create Account';
    if (error) { isSigningUp = false; errEl.textContent = error.message; errEl.classList.add('visible'); return; }
    if (data.user) {
      const row = { user_id: data.user.id, first_name: firstName, last_name: lastName, phone, updated_at: new Date().toISOString() };
      if (birthday) row.birthday = birthday;
      await sb.from('profiles').upsert(row, { onConflict: 'user_id' });
    }
    showToast('Account created! Check your email to confirm.');
  });

  // Forgot password — emails a reset link that signs them in on account.html,
  // where enterDashboard() opens the Change Password fields.
  document.getElementById('forgot-password-btn')?.addEventListener('click', async () => {
    const email = document.getElementById('signin-email').value.trim();
    const note = document.getElementById('forgot-password-note');
    const errEl = document.getElementById('signin-error');
    errEl.classList.remove('visible');
    if (!email) {
      errEl.textContent = 'Enter your email above, then tap "Forgot password?" again.';
      errEl.classList.add('visible');
      document.getElementById('signin-email').focus();
      return;
    }
    const btn = document.getElementById('forgot-password-btn');
    btn.disabled = true;
    // Same URL the signup confirmation already uses (it's on Supabase's redirect allow-list)
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: 'https://bloominacresmarket.com/account.html?tab=profile',
    });
    btn.disabled = false;
    if (error) { errEl.textContent = error.message; errEl.classList.add('visible'); return; }
    note.textContent = `If an account exists for ${email}, a password reset link is on its way. Check your inbox (and spam folder).`;
    note.classList.remove('hidden');
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
    const birthday = document.getElementById('profile-birthday').value || null;
    const btn = document.getElementById('save-profile-btn');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    const { error } = await sb.from('profiles').upsert(
      { user_id: currentUser.id, first_name: firstName, last_name: lastName, phone, birthday, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
    btn.disabled = false;
    btn.textContent = 'Save Changes';
    if (error) { showToast(error.message, true); return; }
    userBirthday = birthday;
    renderBirthdayBlock();
    const fullName = [firstName, lastName].filter(Boolean).join(' ');
    const updatePayload = { data: { display_name: fullName, full_name: fullName, first_name: firstName, last_name: lastName, phone } };
    const { error: authError } = await sb.auth.updateUser(updatePayload);
    if (authError) console.error('updateUser failed:', authError.message);
    // Update greeting and avatar live
    document.getElementById('dash-greeting').textContent = firstName ? `Welcome back, ${firstName}` : 'Welcome back';
    document.getElementById('dash-avatar').textContent = (firstName || currentUser.email || 'U')[0].toUpperCase();
    showToast('Profile saved');
  });

  // Delivery / pickup location preference (Christina's named locations — there is no delivery zone)
  async function loadPickupLocations(preferredId) {
    const listEl = document.getElementById('pickup-locations-list');
    if (!listEl) return;

    const { data: locations, error } = await sb
      .from('pickup_locations')
      .select('id, name, address, hours, notes')
      .eq('active', true)
      .order('sort_order');

    if (error || !locations?.length) {
      listEl.innerHTML = '<p class="pickup-location-empty">No pickup locations configured yet.</p>';
      document.getElementById('save-pickup-btn')?.classList.add('hidden');
      return;
    }

    listEl.innerHTML = locations.map(loc => `
      <label class="pickup-location-card${loc.id === preferredId ? ' selected' : ''}">
        <input type="radio" name="pickup-location" value="${escHtml(loc.id)}" ${loc.id === preferredId ? 'checked' : ''} />
        <div class="pickup-location-info">
          <span class="pickup-location-name">${escHtml(loc.name)}</span>
          <span class="pickup-location-address">${escHtml(loc.address)}</span>
          ${loc.hours ? `<span class="pickup-location-hours">${escHtml(loc.hours)}</span>` : ''}
          ${loc.notes ? `<span class="pickup-location-notes">${escHtml(loc.notes)}</span>` : ''}
        </div>
      </label>
    `).join('');

    listEl.querySelectorAll('.pickup-location-card').forEach(card => {
      card.addEventListener('click', () => {
        listEl.querySelectorAll('.pickup-location-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
      });
    });
  }

  document.getElementById('save-pickup-btn')?.addEventListener('click', async () => {
    const checked = document.querySelector('input[name="pickup-location"]:checked');
    const btn = document.getElementById('save-pickup-btn');
    if (!checked) { showToast('Please select a location first', true); return; }

    btn.disabled = true; btn.textContent = 'Saving…';
    const { error } = await sb.from('profiles').upsert(
      { user_id: currentUser.id, preferred_pickup_location_id: checked.value },
      { onConflict: 'user_id' }
    );
    btn.disabled = false; btn.textContent = 'Save Preference';
    if (error) showToast('Save failed: ' + error.message, true);
    else showToast('Pickup location saved');
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
  let clubMembership = null;   // club_members row (status: active | past_due | cancelled | incomplete)
  let clubSubscription = null; // live Stripe status from /api/stripe/portal (GET)
  let isAdminUser = false;
  let boxSelections = [];
  let productVariations = null; // stripe_product_id → [{ name, price_delta, quantity, available }]
  let myReferralCode = null;
  let referralCount = 0;
  let clubWired = false;
  const REFERRAL_MILESTONES = [1, 3, 5]; // same ladder as the public Club page and the webhook rewards

  async function refreshMembership() {
    const { data } = await sb.from('club_members').select('*').eq('user_id', currentUser.id).maybeSingle();
    clubMembership = data || null;
    return clubMembership;
  }

  // Live subscription details from Stripe. The endpoint also links a Club
  // subscription it finds under this account's email (Payment Link signups).
  async function fetchSubscription() {
    const r = await fetch('/api/stripe/portal', { headers: await authHeaders() }).catch(() => null);
    if (r && r.ok) {
      const body = await r.json().catch(() => ({}));
      clubSubscription = body.subscription || null;
    }
    await refreshMembership();
    return clubSubscription;
  }

  const fmtDate = iso => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  async function loadClub() {
    const loadingEl = document.getElementById('club-loading-state');
    const nonMemberEl = document.getElementById('club-non-member');
    const memberEl = document.getElementById('club-member-view');
    const activatingEl = document.getElementById('club-activating');
    loadingEl.classList.remove('hidden');
    nonMemberEl.classList.add('hidden');
    memberEl.classList.add('hidden');
    activatingEl.classList.add('hidden');

    const params = new URLSearchParams(window.location.search);

    // Just back from Stripe Checkout — the webhook can take a few seconds to land
    if (params.get('subscribed') === '1' && !isClubMember()) {
      loadingEl.classList.add('hidden');
      activatingEl.classList.remove('hidden');
      for (let i = 0; i < 8 && !isClubMember(); i++) {
        await new Promise(r => setTimeout(r, 2000));
        await refreshMembership();
      }
      activatingEl.classList.add('hidden');
      loadingEl.classList.remove('hidden');
    }

    await fetchSubscription();

    if (params.get('subscribed') === '1') {
      const url = new URL(window.location);
      url.searchParams.delete('subscribed');
      history.replaceState(null, '', url);
      if (isClubMember()) showToast('Welcome to the Bread Box Club!');
      else showToast('Your payment went through — your membership will show here shortly. Refresh in a minute.', true);
    }

    loadingEl.classList.add('hidden');
    document.getElementById('basket-club-hint')?.classList.toggle('hidden', !hasMemberPricing());
    renderCart();

    if (!hasMemberPricing()) {
      await renderNonMember(params);
      return;
    }

    const [{ data: boxData, error: boxErr }, { data: codeRow }] = await Promise.all([
      sb.from('box_selections').select('items').eq('user_id', currentUser.id).maybeSingle(),
      sb.from('referral_codes').select('code').eq('user_id', currentUser.id).maybeSingle(),
    ]);
    if (boxErr) console.error('Box load failed:', boxErr.message);
    boxSelections = boxData?.items || [];
    myReferralCode = codeRow?.code || null;

    memberEl.classList.remove('hidden');
    renderMembershipStatus();
    renderBirthdayBlock();

    // Punch card
    const punchCount = clubMembership?.punch_count || 0;
    const punchGrid = document.getElementById('punch-card-grid');
    if (punchGrid) {
      punchGrid.innerHTML = Array.from({ length: 10 }, (_, i) =>
        `<div class="punch-dot${i < punchCount ? ' punched' : ''}"></div>`
      ).join('');
      document.getElementById('punch-card-label').textContent = `${punchCount} / 10`;
    }

    await loadProductVariations();
    renderBoxBuilder();
    wireClubControls();

    // Referral link — members only
    if (!myReferralCode) await createReferralCode();
    if (myReferralCode) {
      document.getElementById('my-ref-code-input').value = `${window.location.origin}/club.html?ref=${myReferralCode}`;
      const { count } = await sb.from('referral_uses')
        .select('id', { count: 'exact', head: true })
        .eq('code', myReferralCode);
      referralCount = count || 0;
    }
    renderReferralDashboard();
  }

  async function renderNonMember(params) {
    const el = document.getElementById('club-non-member');
    el.classList.remove('hidden');
    if (clubMembership?.status === 'cancelled') {
      document.getElementById('club-join-heading').textContent = 'Rejoin the Bread Box Club';
    }

    // Free delivery = Christina's named locations, listed from Admin → Locations
    const { data: locs } = await sb.from('pickup_locations').select('name').eq('active', true).order('sort_order');
    const names = (locs || []).map(l => l.name).filter(Boolean);
    if (names.length) {
      // Names can contain commas ("Rural King, Columbus") — separate with semicolons then
      const sep = names.some(n => n.includes(',')) ? ';' : ',';
      const list = names.length === 1 ? names[0]
        : `${names.slice(0, -1).join(sep + ' ')}${names.length > 2 ? sep : ''} or ${names[names.length - 1]}`;
      document.getElementById('club-join-locations').textContent = list;
    }

    const joinBtn = document.getElementById('join-club-btn');
    if (!joinBtn.dataset.wired) {
      joinBtn.dataset.wired = '1';
      joinBtn.addEventListener('click', startClubJoin);
    }

    // Arrived from "Join the Club" (club page, or the confirm-email link) → go straight to checkout
    const intent = sessionStorage.getItem('club_join_intent') === '1' || params.get('join') === '1';
    if (intent) {
      sessionStorage.removeItem('club_join_intent');
      const url = new URL(window.location);
      url.searchParams.delete('join');
      history.replaceState(null, '', url);
      startClubJoin();
    }
  }

  function renderMembershipStatus() {
    const badge = document.getElementById('club-status-badge');
    const detail = document.getElementById('club-status-detail');
    const billingBtn = document.getElementById('manage-billing-btn');
    const billingNote = document.getElementById('club-billing-note');
    detail.textContent = '';

    if (isAdminUser && !isClubMember()) {
      badge.textContent = 'Admin Access';
      badge.className = 'club-status-badge admin';
      detail.textContent = 'Admin accounts see member pricing for testing — there is no subscription to bill.';
      billingBtn.classList.add('hidden');
      billingNote.classList.add('hidden');
      return;
    }

    billingBtn.classList.remove('hidden');
    billingNote.classList.remove('hidden');
    const status = clubSubscription?.status || clubMembership?.status;
    const labels = { active: 'Active Member', past_due: 'Payment Due', cancelled: 'Cancelled' };
    badge.textContent = labels[status] || 'Active Member';
    badge.className = `club-status-badge ${status || 'active'}`;

    if (status === 'past_due') {
      detail.textContent = 'Your last payment didn’t go through — update your card in Manage Billing to keep your perks.';
    } else if (clubSubscription?.cancel_at_period_end && clubSubscription.current_period_end) {
      badge.textContent = 'Cancelling';
      detail.textContent = `Cancels on ${fmtDate(clubSubscription.current_period_end)} — your perks continue until then. Changed your mind? Use Manage Billing to keep your membership.`;
    } else if (clubSubscription?.current_period_end) {
      detail.textContent = `$4.99/month · renews ${fmtDate(clubSubscription.current_period_end)}`;
    }
  }

  function birthdayWeekLabel(iso) {
    const [, m, d] = iso.split('-').map(Number);
    return new Date(2000, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  }

  function renderBirthdayBlock() {
    const text = document.getElementById('club-birthday-text');
    const input = document.getElementById('club-birthday-input');
    const saveBtn = document.getElementById('club-birthday-save');
    if (!text || !input) return;
    input.value = userBirthday || '';
    if (userBirthday) {
      text.textContent = `Your birthday is ${birthdayWeekLabel(userBirthday)}. Any order you place within 3 days of it gets one free item of your choice — your order ticket is flagged automatically, so just tell us your pick at pickup.`;
      saveBtn.textContent = 'Update Birthday';
    } else {
      text.textContent = 'Add your birthday and any order you place within 3 days of it gets one free item of your choice. Your order ticket is flagged automatically, so just tell us your pick at pickup.';
      saveBtn.textContent = 'Save Birthday';
    }
  }

  function wireClubControls() {
    if (clubWired) return;
    clubWired = true;

    document.getElementById('manage-billing-btn').addEventListener('click', async () => {
      const btn = document.getElementById('manage-billing-btn');
      btn.disabled = true; btn.textContent = 'Opening…';
      const r = await fetch('/api/stripe/portal', { method: 'POST', headers: await authHeaders() }).catch(() => null);
      if (!r || !r.ok) {
        btn.disabled = false; btn.textContent = 'Manage Billing';
        showToast(await readError(r, 'Could not open billing — please try again.'), true);
        return;
      }
      const { url, error } = await r.json();
      if (error || !url) { btn.disabled = false; btn.textContent = 'Manage Billing'; showToast(error || 'Billing is unavailable right now', true); return; }
      window.location.href = url;
    });

    document.getElementById('club-birthday-save').addEventListener('click', async () => {
      const value = document.getElementById('club-birthday-input').value || null;
      if (!value) { showToast('Choose your birthday first', true); return; }
      const btn = document.getElementById('club-birthday-save');
      btn.disabled = true;
      const { error } = await sb.from('profiles').upsert(
        { user_id: currentUser.id, birthday: value, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );
      btn.disabled = false;
      if (error) { showToast('Could not save birthday: ' + error.message, true); return; }
      userBirthday = value;
      document.getElementById('profile-birthday').value = value;
      renderBirthdayBlock();
      showToast('Birthday saved');
    });

    document.getElementById('add-to-box-btn').addEventListener('click', () => {
      const picker = document.getElementById('club-product-picker');
      const nowHidden = picker.classList.toggle('hidden');
      if (!nowHidden) {
        renderProductPicker();
        picker.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
    document.getElementById('picker-close-btn').addEventListener('click', () => {
      document.getElementById('club-product-picker').classList.add('hidden');
    });
    document.getElementById('picker-search').addEventListener('input', renderProductPicker);
    document.getElementById('order-box-btn').addEventListener('click', orderMyBox);

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

  async function loadProductVariations() {
    if (productVariations) return;
    productVariations = {};
    const { data } = await sb.from('product_details').select('stripe_product_id, variations');
    (data || []).forEach(row => { productVariations[row.stripe_product_id] = row.variations || []; });
  }

  function boxItemPrice(item) {
    return (products[item.stripe_product_id]?.unit_amount ?? 0) + (item.variation_delta || 0);
  }

  function renderBoxBuilder() {
    const el = document.getElementById('box-items-list');
    const footer = document.getElementById('box-footer');

    if (!boxSelections.length) {
      el.innerHTML = '<p class="box-empty-msg">Your box is empty. Tap "+ Add Items" to choose what goes in it.</p>';
      footer.classList.add('hidden');
      return;
    }

    let total = 0;
    el.innerHTML = boxSelections.map((item, idx) => {
      const p = products[item.stripe_product_id];
      const price = boxItemPrice(item);
      total += price * item.quantity;
      return `<div class="box-item-row">
        <div class="box-item-name">${escHtml(p?.name || item.stripe_product_id)}${item.variation_name ? ` — ${escHtml(item.variation_name)}` : ''}</div>
        <div class="box-item-controls">
          <button type="button" class="qty-sm" data-idx="${idx}" data-action="dec" aria-label="One less">−</button>
          <span class="qty-sm-num">${item.quantity}</span>
          <button type="button" class="qty-sm" data-idx="${idx}" data-action="inc" aria-label="One more">+</button>
        </div>
        <div class="box-item-price">${fmt(price * item.quantity)}</div>
        <button type="button" class="box-remove-btn" data-idx="${idx}" aria-label="Remove">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`;
    }).join('');

    el.querySelectorAll('.qty-sm').forEach(btn => {
      btn.addEventListener('click', () => updateBoxQty(parseInt(btn.dataset.idx, 10), btn.dataset.action));
    });
    el.querySelectorAll('.box-remove-btn').forEach(btn => {
      btn.addEventListener('click', () => removeBoxItem(parseInt(btn.dataset.idx, 10)));
    });

    footer.classList.remove('hidden');
    const discount = memberDiscount(total);
    document.getElementById('box-total-label').textContent = `Total: ${fmt(total - discount)}`;
    document.getElementById('box-total-label').className = 'box-total-amount qualified';
    const hint = document.getElementById('box-min-hint');
    hint.textContent = discount ? `Includes your ${CLUB_DISCOUNT_PCT}% member discount (−${fmt(discount)}), applied at checkout` : '';
    hint.className = 'box-min-hint success';
  }

  // Saves the box and reads it back, so what's shown is what's stored.
  // On failure the previous box is restored and the error is shown.
  async function saveBoxSelections(previous) {
    const { data, error } = await sb.from('box_selections').upsert(
      { user_id: currentUser.id, items: boxSelections, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    ).select('items').single();
    if (error) {
      boxSelections = previous;
      renderBoxBuilder();
      if (!document.getElementById('club-product-picker').classList.contains('hidden')) renderProductPicker();
      showToast('Couldn’t save your box: ' + error.message, true);
      return false;
    }
    boxSelections = data?.items || boxSelections;
    return true;
  }

  const cloneBox = () => boxSelections.map(i => ({ ...i }));

  async function updateBoxQty(idx, action) {
    const item = boxSelections[idx];
    if (!item) return;
    if (action === 'dec' && item.quantity <= 1) return removeBoxItem(idx);
    const previous = cloneBox();
    item.quantity += action === 'inc' ? 1 : -1;
    renderBoxBuilder();
    if (await saveBoxSelections(previous)) renderBoxBuilder();
  }

  async function removeBoxItem(idx) {
    const previous = cloneBox();
    boxSelections.splice(idx, 1);
    renderBoxBuilder();
    if (await saveBoxSelections(previous)) {
      renderBoxBuilder();
      if (!document.getElementById('club-product-picker').classList.contains('hidden')) renderProductPicker();
      showToast('Removed from box');
    }
  }

  // One choice per product, or one per variation (flavor/size) when it has them
  function pickerChoices() {
    const q = document.getElementById('picker-search').value.trim().toLowerCase();
    const onMenu = id => !menuProductIds.size || menuProductIds.has(id);
    const choices = [];
    Object.entries(products).forEach(([id, p]) => {
      if (!onMenu(id)) return;
      const variations = (productVariations?.[id] || [])
        .filter(v => v.available !== false && (v.quantity === undefined || v.quantity === null || v.quantity > 0));
      if (variations.length) {
        variations.forEach(v => choices.push({ id, name: p.name, vname: v.name, delta: v.price_delta || 0, base: p.unit_amount }));
      } else {
        choices.push({ id, name: p.name, vname: '', delta: 0, base: p.unit_amount });
      }
    });
    return choices.filter(c => !q || `${c.name} ${c.vname}`.toLowerCase().includes(q));
  }

  function renderProductPicker() {
    const grid = document.getElementById('picker-grid');
    const choices = pickerChoices();
    if (!choices.length) {
      grid.innerHTML = '<p class="picker-empty">No menu items found.</p>';
      return;
    }
    grid.innerHTML = choices.map((c, i) => {
      const inBox = boxSelections.find(b => b.stripe_product_id === c.id && (b.variation_name || '') === c.vname);
      return `<button type="button" class="picker-item${inBox ? ' in-box' : ''}" data-i="${i}">
        <span class="picker-item-name">${escHtml(c.name)}${c.vname ? ` — ${escHtml(c.vname)}` : ''}</span>
        <span class="picker-item-price">${fmt((c.base ?? 0) + c.delta)}</span>
        ${inBox ? `<span class="picker-in-box">In Box ×${inBox.quantity}</span>` : ''}
      </button>`;
    }).join('');
    grid.querySelectorAll('.picker-item').forEach(btn => {
      btn.addEventListener('click', () => addToBox(choices[parseInt(btn.dataset.i, 10)]));
    });
  }

  async function addToBox(choice) {
    const previous = cloneBox();
    const existing = boxSelections.find(i => i.stripe_product_id === choice.id && (i.variation_name || '') === choice.vname);
    if (existing) existing.quantity++;
    else boxSelections.push({ stripe_product_id: choice.id, quantity: 1, variation_name: choice.vname, variation_delta: choice.delta });
    renderBoxBuilder();
    renderProductPicker();
    if (await saveBoxSelections(previous)) {
      renderBoxBuilder();
      renderProductPicker();
      showToast('Added to box');
    }
  }

  async function orderMyBox() {
    if (!boxSelections.length) { showToast('Your box is empty', true); return; }
    const btn = document.getElementById('order-box-btn');
    btn.disabled = true; btn.textContent = 'Adding…';

    let failed = null;
    for (const item of boxSelections) {
      const { error } = await sb.from('user_cart').upsert({
        user_id: currentUser.id,
        stripe_product_id: item.stripe_product_id,
        variation_name: item.variation_name || '',
        variation_delta: item.variation_delta || 0,
        quantity: item.quantity,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,stripe_product_id,variation_name' });
      if (error) { failed = error; break; }
    }

    await loadCart();
    btn.disabled = false; btn.textContent = 'Order My Box →';
    if (failed) { showToast('Couldn’t add your box to the basket: ' + failed.message, true); return; }
    document.querySelector('.dash-tab[data-panel="cart"]')?.click();
    showToast('Box added to your basket!');
  }

  function renderReferralDashboard() {
    const milestones = REFERRAL_MILESTONES;
    const nextMilestone = milestones.find(m => m > referralCount) || null;
    const prevMilestone = milestones.filter(m => m <= referralCount).pop() || 0;

    document.getElementById('ref-count').textContent = referralCount;

    const progress = nextMilestone
      ? Math.min(100, ((referralCount - prevMilestone) / (nextMilestone - prevMilestone)) * 100)
      : 100;
    document.getElementById('ref-progress-fill').style.width = `${progress}%`;
    document.getElementById('ref-next-label').textContent = nextMilestone
      ? `${nextMilestone - referralCount} more to your next reward`
      : 'All milestones reached!';

    document.getElementById('milestone-chips').innerHTML = milestones.map(m => {
      const done = referralCount >= m;
      return `<div class="milestone-chip${done ? ' done' : ''}">
        <span class="milestone-chip-num">${m}</span>
        <span class="milestone-chip-status">${done ? '✓' : `${m - Math.min(referralCount, m)} to go`}</span>
      </div>`;
    }).join('');
  }

  async function startClubJoin() {
    const btn = document.getElementById('join-club-btn');
    btn.disabled = true; btn.textContent = 'Taking you to secure checkout…';
    const referralCode = sessionStorage.getItem('referral_code') || '';
    const r = await fetch('/api/stripe/subscribe', {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ referral_code: referralCode }),
    }).catch(() => null);
    if (!r || !r.ok) {
      btn.disabled = false; btn.textContent = 'Join the Club';
      showToast(await readError(r, 'Something went wrong — please try again.'), true);
      if (r?.status === 409) loadClub();
      return;
    }
    const { url, error } = await r.json();
    if (error || !url) { btn.disabled = false; btn.textContent = 'Join the Club'; showToast(error || 'Checkout failed', true); return; }
    window.location.href = url;
  }

  // ── Reviews ──────────────────────────────────────────────────────────────
  let selectedRating = 0;

  function initReviewForm() {
    const starsWrap = document.getElementById('review-stars-input');
    if (!starsWrap) return;

    const starBtns = starsWrap.querySelectorAll('.review-star-btn');
    starBtns.forEach(btn => {
      btn.addEventListener('mouseenter', () => {
        const val = parseInt(btn.dataset.value, 10);
        starBtns.forEach(b => {
          b.classList.toggle('active', parseInt(b.dataset.value, 10) <= val);
        });
      });
      btn.addEventListener('click', () => {
        selectedRating = parseInt(btn.dataset.value, 10);
        starBtns.forEach(b => {
          b.classList.toggle('selected', parseInt(b.dataset.value, 10) <= selectedRating);
        });
      });
    });
    starsWrap.addEventListener('mouseleave', () => {
      starBtns.forEach(b => {
        b.classList.toggle('active', parseInt(b.dataset.value, 10) <= selectedRating);
      });
    });

    document.getElementById('btn-submit-review')?.addEventListener('click', submitReview);
  }

  async function submitReview() {
    const quote = document.getElementById('review-quote').value.trim();
    if (!quote) { showToast('Please write a review', true); return; }
    if (selectedRating === 0) { showToast('Please select a star rating', true); return; }

    // Get user's name from profile
    const { data: profile } = await sb.from('profiles').select('first_name, last_name').eq('user_id', currentUser.id).maybeSingle();
    const authorName = profile
      ? ((profile.first_name || '') + ' ' + (profile.last_name || '')).trim() || 'Anonymous'
      : 'Anonymous';

    const { error } = await sb.from('testimonials').insert({
      quote,
      author_name: authorName,
      rating: selectedRating,
      status: 'pending',
      visible: false,
      submitted_by: currentUser.id,
      sort_order: 999,
    });

    if (error) { showToast('Failed to submit: ' + error.message, true); return; }

    document.getElementById('review-quote').value = '';
    selectedRating = 0;
    document.querySelectorAll('.review-star-btn').forEach(b => {
      b.classList.remove('selected', 'active');
    });
    showToast('Review submitted! It will appear once approved.');
    await loadMyReviews();
  }

  async function loadMyReviews() {
    const list = document.getElementById('my-reviews-list');
    if (!list) return;

    const { data, error } = await sb.from('testimonials')
      .select('*')
      .eq('submitted_by', currentUser.id)
      .order('created_at', { ascending: false });

    list.textContent = '';
    if (error || !data || data.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'review-empty';
      empty.textContent = "You haven't submitted any reviews yet.";
      list.appendChild(empty);
      return;
    }

    data.forEach(r => {
      const card = document.createElement('div');
      card.className = 'review-my-card';

      const stars = document.createElement('div');
      stars.className = 'review-my-stars';
      for (let i = 0; i < 5; i++) {
        const s = document.createElement('span');
        s.textContent = '\u2605';
        s.className = i < r.rating ? 'filled' : '';
        stars.appendChild(s);
      }
      card.appendChild(stars);

      const quote = document.createElement('p');
      quote.className = 'review-my-quote';
      quote.textContent = r.quote;
      card.appendChild(quote);

      const status = document.createElement('span');
      status.className = 'review-status review-status-' + r.status;
      status.textContent = r.status === 'approved' ? 'Published' : r.status === 'pending' ? 'Pending approval' : 'Not published';
      card.appendChild(status);

      list.appendChild(card);
    });
  }

  init();
})();
