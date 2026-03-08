    const _qp = new URLSearchParams(window.location.search);
    const _isDraft = _qp.get('preview') === 'draft';
    if (_qp.get('from') === 'admin' || _isDraft) {
      const bar = document.getElementById('preview-bar');
      bar.style.display = 'flex';
      if (_isDraft) {
        document.getElementById('preview-bar-label').textContent = 'Draft Preview — Unsaved Changes';
        bar.classList.add('preview-bar-draft');
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

      // 2. Check auth state (for favorite/cart buttons)
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
        signoutBtn.style.display = 'block';
        signoutBtn.addEventListener('click', async () => {
          await sb.auth.signOut();
          window.location.href = 'index.html';
        });
      }

      // Load user's existing favorites and cart IDs (for active state)
      let userFavIds = new Set();   // keys: "pid" (base) or "pid:varName" (variation)
      let userCartIds = new Set();
      if (currentUser) {
        const [favRes, cartRes] = await Promise.all([
          sb.from('user_favorites').select('stripe_product_id, variation_name').eq('user_id', currentUser.id),
          sb.from('user_cart').select('stripe_product_id').eq('user_id', currentUser.id),
        ]);
        (favRes.data || []).forEach(r => {
          const key = r.variation_name ? `${r.stripe_product_id}:${r.variation_name}` : r.stripe_product_id;
          userFavIds.add(key);
        });
        (cartRes.data || []).forEach(r => userCartIds.add(r.stripe_product_id));
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
      // Show schedule banner if dates are set
      const sched = scheduleRes.data;
      if (sched && (sched.start_date || sched.end_date)) {
        const fmtDate = d => {
          const [y, m, day] = d.split('-');
          return new Date(y, parseInt(m) - 1, parseInt(day))
            .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        };
        let rangeText = '';
        if (sched.start_date && sched.end_date) rangeText = `${fmtDate(sched.start_date)} – ${fmtDate(sched.end_date)}`;
        else if (sched.start_date) rangeText = `starting ${fmtDate(sched.start_date)}`;
        else rangeText = `through ${fmtDate(sched.end_date)}`;
        document.getElementById('schedule-range-text').textContent = rangeText;
        document.getElementById('schedule-banner').style.display = 'block';
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

      // 5. Render — only now remove the SEO fallback (real data loaded successfully)
      removeFallback();
      skeleton.remove();

      sections.forEach((section, idx) => {
        const items = itemsBySectionId[section.id] || [];

        const labelEl = document.createElement('div');
        labelEl.className = 'section-divider';
        labelEl.innerHTML = `<span class="section-title">${escHtml(section.title)}</span>`;
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

          const variationDropdownHtml = availableVariations.length > 0 ? `
            <div class="variation-dropdown" id="var-dd-${escHtml(pid)}">
              ${availableVariations.map(v => {
                const total = (baseAmount || 0) + (v.price_delta || 0);
                return `<div class="variation-dropdown-row">
                  <span class="variation-dropdown-name">${escHtml(v.name)}</span>
                  <div class="variation-dd-actions">
                    <span class="variation-dropdown-price">${fmtPrice(total)}</span>
                    ${currentUser ? `<button class="variation-dd-fav" data-vname="${escHtml(v.name)}" data-vdelta="${v.price_delta || 0}" aria-label="Save to favorites">&#9825;</button>
                    <button class="variation-dd-cart" data-vname="${escHtml(v.name)}" data-vdelta="${v.price_delta || 0}">+ Cart</button>` : ''}
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
                ? `<button class="btn-options" data-pid="${escHtml(pid)}">Options &#9662;</button>`
                : ''}
              ${currentUser ? `<button class="btn-fav${isFav ? ' active' : ''}" data-pid="${escHtml(pid)}" aria-label="Save to favorites">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                ${isFav ? 'Saved' : 'Save'}
              </button>
              <button class="btn-add-cart" data-pid="${escHtml(pid)}">+ Cart</button>` : ''}
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
              optBtn.innerHTML = `Options ${open ? '&#9652;' : '&#9662;'}`;
            });

            // Variation row — cart buttons
            row.querySelectorAll('.variation-dd-cart').forEach(cartBtn => {
              cartBtn.addEventListener('click', async () => {
                if (!currentUser) { window.location.href = 'account.html'; return; }
                const vName = cartBtn.dataset.vname;
                const vDelta = parseInt(cartBtn.dataset.vdelta, 10) || 0;
                const { data: existing } = await sb.from('user_cart')
                  .select('id, quantity')
                  .eq('user_id', currentUser.id)
                  .eq('stripe_product_id', pid)
                  .eq('variation_name', vName)
                  .maybeSingle();
                if (existing) {
                  await sb.from('user_cart').update({ quantity: existing.quantity + 1 }).eq('id', existing.id);
                } else {
                  await sb.from('user_cart').insert({
                    user_id: currentUser.id, stripe_product_id: pid,
                    variation_name: vName, variation_delta: vDelta, quantity: 1,
                  });
                  userCartIds.add(pid);
                }
                showToast(`${name} (${vName}) added to cart`);
              });
            });

            // Variation row — fav buttons
            row.querySelectorAll('.variation-dd-fav').forEach(favBtn => {
              const vName = favBtn.dataset.vname;
              const vDelta = parseInt(favBtn.dataset.vdelta, 10) || 0;
              const favKey = `${pid}:${vName}`;
              if (userFavIds.has(favKey)) { favBtn.classList.add('active'); favBtn.innerHTML = '&#9829;'; }
              favBtn.addEventListener('click', async () => {
                if (!currentUser) { window.location.href = 'account.html'; return; }
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

          // Favorite button
          row.querySelector('.btn-fav')?.addEventListener('click', async (e) => {
            if (!currentUser) { window.location.href = 'account.html'; return; }
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

          // Add to cart button
          row.querySelector('.btn-add-cart')?.addEventListener('click', async () => {
            if (!currentUser) { window.location.href = 'account.html'; return; }
            if (userCartIds.has(pid)) {
              const { data: existing } = await sb.from('user_cart')
                .select('id, quantity').eq('user_id', currentUser.id).eq('stripe_product_id', pid).single();
              if (existing) {
                await sb.from('user_cart').update({ quantity: existing.quantity + 1 }).eq('id', existing.id);
              }
            } else {
              await sb.from('user_cart').insert({ user_id: currentUser.id, stripe_product_id: pid, quantity: 1 });
              userCartIds.add(pid);
            }
            showToast(`${name} added to cart`);
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

