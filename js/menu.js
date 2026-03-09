    const _qp = new URLSearchParams(window.location.search);
    const _isDraft = _qp.get('preview') === 'draft';
    if (_qp.get('from') === 'admin' || _isDraft) {
      const bar = document.getElementById('preview-bar');
      if (bar) {
        bar.style.display = 'flex';
        if (_isDraft) {
          const label = document.getElementById('preview-bar-label');
          if (label) label.textContent = 'Draft Preview — Unsaved Changes';
          bar.classList.add('preview-bar-draft');
        }
      }
    }
    (async () => {
      const content = document.getElementById('menu-content');
      const skeleton = document.getElementById('skeleton');
      const seoFallback = document.getElementById('seo-fallback');

      // Show skeleton alongside fallback (fallback only removed on successful data load)
      skeleton.style.display = '';

      function removeFallback() {
        if (seoFallback && seoFallback.parentNode) seoFallback.remove();
      }

      function showError(msg) {
        skeleton.remove();
        // Keep SEO fallback visible for crawlers — only show error alongside it
        if (!seoFallback || !seoFallback.parentNode) {
          const errDiv = document.createElement('div');
          errDiv.className = 'load-error';
          errDiv.textContent = msg;
          content.appendChild(errDiv);
        }
      }

      // 1. Fetch server config
      let cfg;
      try {
        const r = await fetch('/api/config');
        cfg = await r.json();
      } catch {
        showError('Could not reach the server. Please try again.');
        return;
      }

      if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
        showError('Menu configuration is not yet set up.');
        return;
      }

      const sb = supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);

      // 2. Check auth state (for favorite buttons)
      const { data: { session } } = await sb.auth.getSession();
      const currentUser = session?.user ?? null;

      // Wire sidebar auth state
      const signinLink  = document.getElementById('menu-sidebar-signin');
      const acctItem    = document.getElementById('menu-sidebar-account-item');
      const signoutBtn  = document.getElementById('menu-sidebar-signout');
      if (currentUser) {
        const { data: adminRow } = await sb.from('admins').select('user_id').eq('user_id', currentUser.id).maybeSingle();
        signinLink.style.display = 'none';
        acctItem.style.display   = 'none'; // keep hidden regardless
        if (adminRow) {
          // Admin: insert Dashboard link in place of My Account
          const dashLink = document.createElement('a');
          dashLink.href = 'admin.html';
          dashLink.className = 'nav-sidebar-link';
          dashLink.textContent = 'Dashboard';
          acctItem.parentNode.insertBefore(dashLink, acctItem);
        } else {
          // Regular user: show My Account submenu
          acctItem.style.display = 'block';
        }
        if (signoutBtn) {
          signoutBtn.style.display = 'block';
          signoutBtn.addEventListener('click', async () => {
            await sb.auth.signOut();
            window.location.href = 'index.html';
          });
        }
      }

      // Load user's existing favorites (for active state)
      let userFavIds = new Set();   // keys: "pid" (base) or "pid:varName" (variation)
      if (currentUser) {
        const favRes = await sb.from('user_favorites').select('stripe_product_id, variation_name').eq('user_id', currentUser.id);
        (favRes.data || []).forEach(r => {
          const key = r.variation_name ? `${r.stripe_product_id}:${r.variation_name}` : r.stripe_product_id;
          userFavIds.add(key);
        });
      }

      // 3. Fetch Stripe products + schedule in parallel
      let productMap = {};
      let detailsMap = {};
      const [stripeRes, scheduleRes, detailsRes] = await Promise.all([
        fetch('/api/stripe/products').catch(() => null),
        sb.from('menu_schedule').select('start_date,end_date').eq('id', 1).maybeSingle(),
        sb.from('product_details').select('stripe_product_id, variations'),
      ]);
      if (stripeRes && stripeRes.ok) {
        try {
          const products = await stripeRes.json();
          if (Array.isArray(products)) products.forEach(p => { productMap[p.id] = p; });
        } catch { /* non-fatal */ }
      }
      (detailsRes.data || []).forEach(d => { detailsMap[d.stripe_product_id] = d; });
      // Build schedule text (rendered inside menu card later)
      const sched = scheduleRes.data;
      let scheduleRangeText = '';
      if (sched && (sched.start_date || sched.end_date)) {
        const fmtDate = d => {
          const [y, m, day] = d.split('-');
          return new Date(y, parseInt(m) - 1, parseInt(day))
            .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        };
        if (sched.start_date && sched.end_date) scheduleRangeText = `Available ${fmtDate(sched.start_date)} – ${fmtDate(sched.end_date)}`;
        else if (sched.start_date) scheduleRangeText = `Available starting ${fmtDate(sched.start_date)}`;
        else scheduleRangeText = `Available through ${fmtDate(sched.end_date)}`;
      }

      // 4. Fetch menu — from sessionStorage draft or Supabase
      let sections, itemsBySectionId = {};

      if (_isDraft) {
        // Draft preview: load from sessionStorage (set by admin editor)
        const raw = sessionStorage.getItem('menu_draft');
        if (!raw) { showError('No draft data found. Open Preview Draft from the admin editor.'); return; }
        const draft = JSON.parse(raw).filter(sec => sec.title.trim());
        sections = draft.map((sec, i) => ({ id: `draft-${i}`, title: sec.title, sort_order: i }));
        draft.forEach((sec, i) => {
          itemsBySectionId[`draft-${i}`] = (sec.items || []).map((item, j) => ({
            id: `draft-item-${i}-${j}`,
            section_id: `draft-${i}`,
            stripe_product_id: item.stripe_product_id,
            sort_order: j,
          }));
        });
      } else {
        const { data: dbSections, error: secErr } = await sb
          .from('menu_sections').select('id, title, sort_order').order('sort_order');

        if (secErr) { showError('Unable to load the menu right now.'); return; }
        if (!dbSections || dbSections.length === 0) {
          skeleton.remove();
          // Keep SEO fallback for crawlers — don't replace with "coming soon"
          return;
        }
        sections = dbSections;

        const { data: allItems } = await sb
          .from('menu_items').select('id, section_id, stripe_product_id, sort_order').order('sort_order');

        (allItems || []).forEach(item => {
          if (!itemsBySectionId[item.section_id]) itemsBySectionId[item.section_id] = [];
          itemsBySectionId[item.section_id].push(item);
        });
      }

      // --- Cart panel helpers ---
      const floatingCartBtn = document.getElementById('floating-cart-btn');
      const cartBadge = document.getElementById('cart-badge');
      const cartPanel = document.getElementById('cart-panel');
      const cartPanelClose = document.getElementById('cart-panel-close');
      const cartPanelItems = document.getElementById('cart-panel-items');
      const cartPanelFooter = document.getElementById('cart-panel-footer');
      const cartTotalEl = document.getElementById('cart-total');
      const cartCheckoutBtn = document.getElementById('cart-checkout-btn');
      const cartSigninNudge = document.getElementById('cart-signin-nudge');
      const cartOverlay = document.getElementById('cart-overlay');
      const guestModalOverlay = document.getElementById('guest-modal-overlay');
      const guestModalClose = document.getElementById('guest-modal-close');
      const guestCheckoutForm = document.getElementById('guest-checkout-form');
      const guestSubmitBtn = document.getElementById('guest-submit-btn');

      function updateCartBadge() {
        const count = cartCount();
        cartBadge.textContent = count;
        floatingCartBtn.style.display = count > 0 ? '' : 'none';
      }

      function fmtCurrency(cents, currency) {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'usd' }).format(cents / 100);
      }

      function openCartPanel() {
        renderCartPanel();
        cartPanel.classList.add('open');
        cartPanel.setAttribute('aria-hidden', 'false');
        cartOverlay.classList.add('open');
        cartOverlay.setAttribute('aria-hidden', 'false');
      }

      function closeCartPanel() {
        cartPanel.classList.remove('open');
        cartPanel.setAttribute('aria-hidden', 'true');
        cartOverlay.classList.remove('open');
        cartOverlay.setAttribute('aria-hidden', 'true');
      }

      function renderCartPanel() {
        const items = cartGet();

        // Clear existing items using DOM methods
        while (cartPanelItems.firstChild) cartPanelItems.removeChild(cartPanelItems.firstChild);

        if (items.length === 0) {
          const emptyMsg = document.createElement('p');
          emptyMsg.className = 'cart-empty-msg';
          emptyMsg.textContent = 'Your cart is empty.';
          cartPanelItems.appendChild(emptyMsg);
          cartPanelFooter.style.display = 'none';
          return;
        }

        let totalCents = 0;

        items.forEach(ci => {
          const product = productMap[ci.stripe_product_id];
          const name = product ? product.name : ci.stripe_product_id;
          const baseAmount = product?.unit_amount ?? 0;
          const currency = product?.currency || 'usd';
          const unitPrice = baseAmount + (ci.variation_delta || 0);
          const lineTotal = unitPrice * ci.quantity;
          totalCents += lineTotal;

          const row = document.createElement('div');
          row.className = 'cart-panel-item';

          // Info section
          const infoDiv = document.createElement('div');
          infoDiv.className = 'cart-item-info';

          const nameSpan = document.createElement('span');
          nameSpan.className = 'cart-item-name';
          nameSpan.textContent = name;
          if (ci.variation_name) {
            const varSpan = document.createElement('span');
            varSpan.className = 'cart-item-variation';
            varSpan.textContent = ` (${ci.variation_name})`;
            nameSpan.appendChild(varSpan);
          }
          infoDiv.appendChild(nameSpan);

          const priceSpan = document.createElement('span');
          priceSpan.className = 'cart-item-price';
          priceSpan.textContent = fmtCurrency(unitPrice, currency);
          infoDiv.appendChild(priceSpan);

          row.appendChild(infoDiv);

          // Controls section
          const controlsDiv = document.createElement('div');
          controlsDiv.className = 'cart-item-controls';

          const decBtn = document.createElement('button');
          decBtn.className = 'cart-qty-btn';
          decBtn.setAttribute('aria-label', 'Decrease quantity');
          decBtn.textContent = '\u2212';
          decBtn.addEventListener('click', () => {
            cartUpdateQty(ci.stripe_product_id, ci.variation_name || '', ci.quantity - 1);
            renderCartPanel();
          });
          controlsDiv.appendChild(decBtn);

          const qtySpan = document.createElement('span');
          qtySpan.className = 'cart-qty-value';
          qtySpan.textContent = ci.quantity;
          controlsDiv.appendChild(qtySpan);

          const incBtn = document.createElement('button');
          incBtn.className = 'cart-qty-btn';
          incBtn.setAttribute('aria-label', 'Increase quantity');
          incBtn.textContent = '+';
          incBtn.addEventListener('click', () => {
            cartUpdateQty(ci.stripe_product_id, ci.variation_name || '', ci.quantity + 1);
            renderCartPanel();
          });
          controlsDiv.appendChild(incBtn);

          const removeBtn = document.createElement('button');
          removeBtn.className = 'cart-remove-btn';
          removeBtn.setAttribute('aria-label', 'Remove item');
          removeBtn.textContent = '\u00d7';
          removeBtn.addEventListener('click', () => {
            cartRemove(ci.stripe_product_id, ci.variation_name || '');
            renderCartPanel();
          });
          controlsDiv.appendChild(removeBtn);

          row.appendChild(controlsDiv);
          cartPanelItems.appendChild(row);
        });

        const currency = Object.values(productMap)[0]?.currency || 'usd';
        cartTotalEl.textContent = fmtCurrency(totalCents, currency);
        cartPanelFooter.style.display = '';

        // Show sign-in nudge for guests
        cartSigninNudge.style.display = currentUser ? 'none' : '';
      }

      // Floating cart button opens panel
      floatingCartBtn.addEventListener('click', openCartPanel);
      cartPanelClose.addEventListener('click', closeCartPanel);
      cartOverlay.addEventListener('click', closeCartPanel);
      document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeCartPanel(); closeGuestModal(); } });

      // Listen for cart-updated events to sync badge
      window.addEventListener('cart-updated', updateCartBadge);

      // Checkout button
      cartCheckoutBtn.addEventListener('click', () => {
        if (currentUser) {
          window.location.href = 'account.html?tab=cart';
        } else {
          openGuestModal();
        }
      });

      // Guest checkout modal
      function openGuestModal() {
        guestModalOverlay.style.display = '';
      }
      function closeGuestModal() {
        guestModalOverlay.style.display = 'none';
      }
      guestModalClose.addEventListener('click', closeGuestModal);
      guestModalOverlay.addEventListener('click', e => {
        if (e.target === guestModalOverlay) closeGuestModal();
      });

      // Guest checkout form submission
      guestCheckoutForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!guestCheckoutForm.reportValidity()) return;
        const nameVal = document.getElementById('guest-name').value.trim();
        const emailVal = document.getElementById('guest-email').value.trim();
        if (!nameVal || !emailVal) return;

        const items = cartGet();
        if (items.length === 0) return;

        guestSubmitBtn.disabled = true;
        guestSubmitBtn.textContent = 'Processing...';

        try {
          const res = await fetch('/api/stripe/guest-checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              items: items.map(i => ({
                stripe_product_id: i.stripe_product_id,
                variation_name: i.variation_name || '',
                variation_delta: i.variation_delta || 0,
                quantity: i.quantity,
              })),
              guest_email: emailVal,
              guest_name: nameVal,
            }),
          });
          const data = await res.json();
          if (data.url) {
            window.location.href = data.url;
          } else {
            showToast(data.error || 'Something went wrong. Please try again.');
            guestSubmitBtn.disabled = false;
            guestSubmitBtn.textContent = 'Continue to Payment';
          }
        } catch {
          showToast('Could not connect to payment server. Please try again.');
          guestSubmitBtn.disabled = false;
          guestSubmitBtn.textContent = 'Continue to Payment';
        }
      });

      // Handle URL params: ?cart=open, ?order=success
      if (_qp.get('cart') === 'open') {
        // Defer to after render so panel has product data
        setTimeout(() => openCartPanel(), 0);
      }
      if (_qp.get('order') === 'success') {
        cartClear();
        showToast('Order placed successfully!');
        history.replaceState(null, '', 'menu.html');
      }

      // Initialize cart badge on load
      updateCartBadge();

      // Helper: add to localStorage cart + optionally sync to Supabase
      async function addToCart(pid, vName, vDelta, displayName) {
        cartAdd(pid, vName || '', vDelta || 0);
        // Sync to Supabase for logged-in users
        if (currentUser) {
          const { data: existing } = await sb.from('user_cart')
            .select('id, quantity')
            .eq('user_id', currentUser.id)
            .eq('stripe_product_id', pid)
            .eq('variation_name', vName || '')
            .maybeSingle();
          if (existing) {
            await sb.from('user_cart').update({ quantity: existing.quantity + 1 }).eq('id', existing.id);
          } else {
            await sb.from('user_cart').insert({
              user_id: currentUser.id,
              stripe_product_id: pid,
              variation_name: vName || '',
              variation_delta: vDelta || 0,
              quantity: 1,
            });
          }
        }
        const label = vName ? `${displayName} (${vName})` : displayName;
        showToast(`${label} added to cart`);
      }

      // 5. Render — only now remove the SEO fallback (real data loaded successfully)
      removeFallback();
      skeleton.remove();

      // Insert schedule dates inside menu card
      if (scheduleRangeText) {
        const schedEl = document.createElement('div');
        schedEl.className = 'menu-schedule-date';
        schedEl.textContent = scheduleRangeText;
        content.appendChild(schedEl);
      }

      sections.forEach((section, idx) => {
        const items = itemsBySectionId[section.id] || [];

        const labelEl = document.createElement('div');
        labelEl.className = 'section-divider';
        const titleSpan = document.createElement('span');
        titleSpan.className = 'section-title';
        titleSpan.textContent = section.title;
        labelEl.appendChild(titleSpan);
        content.appendChild(labelEl);

        const sortedItems = [...items].sort((a, b) => {
          const nameA = (productMap[a.stripe_product_id]?.name || a.stripe_product_id).toLowerCase();
          const nameB = (productMap[b.stripe_product_id]?.name || b.stripe_product_id).toLowerCase();
          return nameA.localeCompare(nameB);
        });

        sortedItems.forEach(item => {
          const product = productMap[item.stripe_product_id];
          const name = product ? product.name : item.stripe_product_id;
          const price = product?.price_formatted ?? '';
          const pid = item.stripe_product_id;
          const isFav = userFavIds.has(pid);

          const variations = detailsMap[pid]?.variations || [];
          const availableVariations = variations.filter(v => v.available !== false && (v.quantity === undefined || v.quantity > 0));
          const baseAmount = product?.unit_amount ?? null;
          const currency = product?.currency || 'usd';
          const fmtPrice = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);

          // Build variation dropdown HTML — cart buttons always, fav buttons only for logged-in
          const variationDropdownHtml = availableVariations.length > 0 ? `
            <div class="variation-dropdown" id="var-dd-${escHtml(pid)}">
              ${availableVariations.map(v => {
                const total = (baseAmount || 0) + (v.price_delta || 0);
                return `<div class="variation-dropdown-row">
                  <span class="variation-dropdown-name">${escHtml(v.name)}</span>
                  <div class="variation-dd-actions">
                    <span class="variation-dropdown-price">${fmtPrice(total)}</span>
                    ${currentUser ? `<button class="variation-dd-fav" data-vname="${escHtml(v.name)}" data-vdelta="${v.price_delta || 0}" aria-label="Save to favorites">&#9825;</button>` : ''}
                    <button class="variation-dd-cart" data-vname="${escHtml(v.name)}" data-vdelta="${v.price_delta || 0}">+ Cart</button>
                  </div>
                </div>`;
              }).join('')}
            </div>` : '';

          const row = document.createElement('div');
          row.className = 'menu-item';
          row.innerHTML = `
            <div class="menu-item-row">
              <a class="item-name" href="product.html?id=${encodeURIComponent(pid)}">${escHtml(name)}</a>
              <span class="item-dots" aria-hidden="true"></span>
              <span class="item-price">${escHtml(price)}</span>
            </div>
            <div class="menu-item-actions">
              <a class="btn-view" href="product.html?id=${encodeURIComponent(pid)}">View</a>
              ${availableVariations.length > 0
                ? `<button class="btn-options" data-pid="${escHtml(pid)}">Variations &#9662;</button>`
                : ''}
              ${currentUser ? `<button class="btn-fav${isFav ? ' active' : ''}" data-pid="${escHtml(pid)}" aria-label="Save to favorites">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                ${isFav ? 'Saved' : 'Save'}
              </button>` : ''}
              <button class="btn-add-cart" data-pid="${escHtml(pid)}">+ Cart</button>
            </div>
            ${variationDropdownHtml}
          `;

          // Options toggle
          const optBtn = row.querySelector('.btn-options');
          if (optBtn) {
            optBtn.addEventListener('click', () => {
              const dd = row.querySelector('.variation-dropdown');
              const open = dd.classList.toggle('open');
              optBtn.classList.toggle('open', open);
              optBtn.innerHTML = `Variations ${open ? '&#9652;' : '&#9662;'}`;
            });

            // Variation row — cart buttons (always rendered)
            row.querySelectorAll('.variation-dd-cart').forEach(cartBtn => {
              cartBtn.addEventListener('click', () => {
                const vName = cartBtn.dataset.vname;
                const vDelta = parseInt(cartBtn.dataset.vdelta, 10) || 0;
                addToCart(pid, vName, vDelta, name);
              });
            });

            // Variation row — fav buttons (only for logged-in users)
            row.querySelectorAll('.variation-dd-fav').forEach(favBtn => {
              const vName = favBtn.dataset.vname;
              const vDelta = parseInt(favBtn.dataset.vdelta, 10) || 0;
              const favKey = `${pid}:${vName}`;
              if (userFavIds.has(favKey)) { favBtn.classList.add('active'); favBtn.innerHTML = '&#9829;'; }
              favBtn.addEventListener('click', async () => {
                if (favBtn.classList.contains('active')) {
                  await sb.from('user_favorites').delete()
                    .eq('user_id', currentUser.id).eq('stripe_product_id', pid).eq('variation_name', vName);
                  userFavIds.delete(favKey);
                  favBtn.classList.remove('active'); favBtn.innerHTML = '&#9825;';
                  showToast('Removed from favorites');
                } else {
                  await sb.from('user_favorites').upsert({
                    user_id: currentUser.id, stripe_product_id: pid,
                    variation_name: vName, variation_delta: vDelta,
                  }, { onConflict: 'user_id,stripe_product_id,variation_name' });
                  userFavIds.add(favKey);
                  favBtn.classList.add('active'); favBtn.innerHTML = '&#9829;';
                  showToast('Saved to favorites');
                }
              });
            });
          }

          // Favorite button (only for logged-in users)
          row.querySelector('.btn-fav')?.addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            const isActive = btn.classList.contains('active');
            if (isActive) {
              await sb.from('user_favorites').delete()
                .eq('user_id', currentUser.id).eq('stripe_product_id', pid);
              userFavIds.delete(pid);
              btn.classList.remove('active');
              btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg> Save`;
              showToast('Removed from favorites');
            } else {
              await sb.from('user_favorites').upsert({ user_id: currentUser.id, stripe_product_id: pid });
              userFavIds.add(pid);
              btn.classList.add('active');
              btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg> Saved`;
              showToast('Saved to favorites');
            }
          });

          // Add to cart button (always rendered, no auth gate)
          row.querySelector('.btn-add-cart').addEventListener('click', () => {
            addToCart(pid, '', 0, name);
          });

          content.appendChild(row);
        });

        // Wheat separator after every 3rd section (not after the last)
        if ((idx + 1) % 3 === 0 && idx < sections.length - 1) {
          const sep = document.createElement('div');
          sep.className = 'wheat-sep-wrap';
          sep.innerHTML = '<img src="brand-assets/wheat-seperater.webp" class="wheat-sep" alt="" />';
          content.appendChild(sep);
        }

      });
    })();
