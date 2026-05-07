  (() => {
    // ── State ────────────────────────────────────────────────────────────────
    let sb = null;
    let allProducts = [];   // Stripe products
    let sections = [];      // { id?, title, items: [{ id?, stripe_product_id }] }
    let savedMenus = [];    // { id, title, sections, created_at }
    let loadedMenuId = null; // ID of the saved menu currently loaded in editor
    let dragState = null;   // { type: 'section'|'item', si, ii? }

    // ── Init ─────────────────────────────────────────────────────────────────
    async function init() {
      // Preview mode: admin.html?preview — shows dashboard without auth
      if (new URLSearchParams(window.location.search).has('preview')) {
        document.getElementById('dashboard').classList.add('visible');
        document.getElementById('topbar-user-email').textContent = 'preview@bloominacres.com';
        document.getElementById('account-email-display').textContent = 'preview@bloominacres.com';
        document.getElementById('account-avatar').textContent = 'P';
        return;
      }

      sb = await getSupabase();
      if (!sb) { alert('Cannot reach server or .env not configured.'); return; }

      // Initial check from localStorage — reliable and instant
      const { data: { session } } = await sb.auth.getSession();
      if (session) {
        enterDashboard(session.user);
      } else {
        showLogin();
      }

      // Only react to explicit sign-in / sign-out events — ignore TOKEN_REFRESHED etc.
      sb.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN' && session) {
          enterDashboard(session.user);
        } else if (event === 'SIGNED_OUT') {
          showLogin();
        }
      });
    }

    // ── Login ─────────────────────────────────────────────────────────────────
    function showLogin() {
      // All sign-in is handled by account.html
      window.location.href = 'account.html';
    }

    // ── Dashboard ─────────────────────────────────────────────────────────────
    async function enterDashboard(user) {
      // Verify user is an admin before showing dashboard
      const { data: adminRow } = await sb.from('admins').select('user_id').eq('user_id', user.id).maybeSingle();
      if (!adminRow) {
        await sb.auth.signOut();
        window.location.href = 'account.html';
        return;
      }

      document.getElementById('dashboard').classList.add('visible');
      document.getElementById('topbar-user-email').textContent = user.email;
      document.getElementById('account-email-display').textContent = user.email;
      document.getElementById('account-avatar').textContent = (user.email || 'A')[0].toUpperCase();

      // Load data in parallel
      await loadProducts(); // must complete before menu editor renders (populates allProducts for dropdowns)
      await Promise.all([loadMenuFromSupabase(), loadMenuSchedule(), loadSavedMenus(), loadLandingContent()]);

      // Lazy-load locations tab on first click
      let locationsTabLoaded = false;
      document.querySelector('[data-tab="locations"]')?.addEventListener('click', async () => {
        if (!locationsTabLoaded) { locationsTabLoaded = true; await loadLocations(); }
      }, { once: true });

      // Lazy-load club tab on first click
      let clubTabLoaded = false;
      document.querySelector('[data-tab="club"]')?.addEventListener('click', async () => {
        if (!clubTabLoaded) { clubTabLoaded = true; await loadClubTab(); }
      }, { once: true });
    }

    // ── Logout ────────────────────────────────────────────────────────────────
    document.getElementById('logout-btn').addEventListener('click', async () => {
      await sb.auth.signOut();
      window.location.href = 'account.html';
    });

    // Wire sidebar sign-out
    const sidebarSignout = document.getElementById('sidebar-signout-btn');
    if (sidebarSignout) {
      sidebarSignout.classList.remove('hidden');
      sidebarSignout.addEventListener('click', async () => {
        await sb.auth.signOut();
        window.location.href = 'account.html';
      });
    }

    // ── Tabs ──────────────────────────────────────────────────────────────────
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => {
          b.classList.remove('active'); b.setAttribute('aria-selected','false');
        });
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active'); btn.setAttribute('aria-selected','true');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      });
    });

    // ── Stripe Catalogue ──────────────────────────────────────────────────────
    async function loadProducts() {
      const grid = document.getElementById('product-grid');
      const r = await fetch('/api/stripe/products').catch(() => null);
      if (!r || !r.ok) {
        grid.innerHTML = '<p class="grid-message">Could not load Stripe products. Check STRIPE_SECRET_KEY in .env.</p>';
        return;
      }
      const data = await r.json();
      if (data.error) {
        grid.innerHTML = `<p class="grid-message grid-error">${escHtml(data.error)}</p>`;
        return;
      }
      allProducts = data.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      renderProductGrid(allProducts);
    }

    function renderProductGrid(products) {
      const grid = document.getElementById('product-grid');
      if (!products.length) {
        grid.innerHTML = '<p class="grid-message">No active products found in your Stripe account.</p>';
        return;
      }
      grid.innerHTML = products.map(p => `
        <a class="product-card" href="product.html?id=${encodeURIComponent(p.id)}">
          ${p.images && p.images[0] ? `<img class="product-card-img" src="${escHtml(p.images[0])}" alt="${escHtml(p.name)}" loading="lazy" />` : ''}
          <div class="product-name">${escHtml(p.name)}</div>
          ${p.description ? `<div class="product-desc">${escHtml(p.description)}</div>` : ''}
          <div class="product-footer">
            <span class="product-price">${escHtml(p.price_formatted || '—')}</span>
            <span class="product-id" title="${escHtml(p.id)}">${escHtml(p.id)}</span>
          </div>
          <div class="product-click-hint">Click to edit →</div>
        </a>
      `).join('');
    }

    document.getElementById('product-search').addEventListener('input', e => {
      const q = e.target.value.toLowerCase();
      renderProductGrid(allProducts.filter(p =>
        p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q)
      ));
    });

    // ── Menu Editor ───────────────────────────────────────────────────────────
    async function loadMenuFromSupabase() {
      const { data: dbSections } = await sb
        .from('menu_sections').select('id, title, sort_order').order('sort_order');
      const { data: dbItems } = await sb
        .from('menu_items').select('id, section_id, stripe_product_id, sort_order').order('sort_order');

      const itemsMap = {};
      (dbItems || []).forEach(i => {
        if (!itemsMap[i.section_id]) itemsMap[i.section_id] = [];
        itemsMap[i.section_id].push({ id: i.id, stripe_product_id: i.stripe_product_id });
      });

      sections = (dbSections || []).map(s => ({
        id: s.id,
        title: s.title,
        items: (itemsMap[s.id] || []).map(i => ({ id: i.id, stripe_product_id: i.stripe_product_id })),
      }));

      renderMenuEditor();
    }

    function renderMenuEditor() {
      const container = document.getElementById('sections-container');
      container.innerHTML = '';
      sections.forEach((sec, si) => renderSection(container, sec, si));
    }

    const DRAG_HANDLE_SVG = `<svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true"><circle cx="3" cy="3" r="1.2"/><circle cx="7" cy="3" r="1.2"/><circle cx="3" cy="7" r="1.2"/><circle cx="7" cy="7" r="1.2"/><circle cx="3" cy="11" r="1.2"/><circle cx="7" cy="11" r="1.2"/></svg>`;

    function renderSection(container, sec, si) {
      const block = document.createElement('div');
      block.className = 'section-block';
      block.dataset.si = si;
      block.draggable = true;

      block.addEventListener('dragstart', e => {
        dragState = { type: 'section', si };
        e.dataTransfer.effectAllowed = 'move';
        block.classList.add('dragging');
      });
      block.addEventListener('dragend', () => {
        dragState = null;
        block.classList.remove('dragging');
        document.querySelectorAll('.section-block.drag-over').forEach(el => el.classList.remove('drag-over'));
      });
      block.addEventListener('dragover', e => {
        if (!dragState || dragState.type !== 'section') return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        document.querySelectorAll('.section-block.drag-over').forEach(el => el.classList.remove('drag-over'));
        block.classList.add('drag-over');
      });
      block.addEventListener('drop', e => {
        e.preventDefault();
        if (!dragState || dragState.type !== 'section') return;
        const fromSi = dragState.si;
        const toSi = parseInt(block.dataset.si, 10);
        if (fromSi === toSi) return;
        const moved = sections.splice(fromSi, 1)[0];
        sections.splice(toSi, 0, moved);
        dragState = null;
        renderMenuEditor();
      });

      // Title row
      const titleRow = document.createElement('div');
      titleRow.className = 'section-title-row';

      const sectionHandle = document.createElement('div');
      sectionHandle.className = 'drag-handle';
      sectionHandle.setAttribute('aria-label', 'Drag to reorder section');
      sectionHandle.innerHTML = DRAG_HANDLE_SVG;

      const titleInput = document.createElement('input');
      titleInput.type = 'text';
      titleInput.className = 'section-title-input';
      titleInput.value = sec.title;
      titleInput.placeholder = 'Section title…';
      titleInput.setAttribute('aria-label', 'Section title');
      titleInput.addEventListener('input', e => { sections[si].title = e.target.value; });

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'icon-btn';
      deleteBtn.type = 'button';
      deleteBtn.title = 'Delete section';
      deleteBtn.setAttribute('aria-label', 'Delete section');
      deleteBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true"><path d="M2 2l9 9M11 2l-9 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
      deleteBtn.addEventListener('click', () => {
        sections.splice(si, 1);
        renderMenuEditor();
      });

      titleRow.appendChild(sectionHandle);
      titleRow.appendChild(titleInput);
      titleRow.appendChild(deleteBtn);
      block.appendChild(titleRow);

      // Items
      const itemsList = document.createElement('div');
      itemsList.className = 'items-list';
      sec.items.forEach((item, ii) => renderItem(itemsList, item, si, ii));
      block.appendChild(itemsList);

      // Add item button
      const addItemBtn = document.createElement('button');
      addItemBtn.className = 'add-item-link';
      addItemBtn.type = 'button';
      addItemBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true"><line x1="5.5" y1="1" x2="5.5" y2="10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><line x1="1" y1="5.5" x2="10" y2="5.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg> Add Item`;
      addItemBtn.addEventListener('click', () => {
        sections[si].items.push({ stripe_product_id: '' });
        renderMenuEditor();
        // Focus the new select
        setTimeout(() => {
          const selects = container.querySelectorAll(`.section-block[data-si="${si}"] .item-select`);
          if (selects.length) selects[selects.length - 1].focus();
        }, 50);
      });
      block.appendChild(addItemBtn);

      container.appendChild(block);
    }

    function renderItem(list, item, si, ii) {
      const row = document.createElement('div');
      row.className = 'item-row';
      row.draggable = true;

      row.addEventListener('dragstart', e => {
        e.stopPropagation();
        dragState = { type: 'item', si, ii };
        e.dataTransfer.effectAllowed = 'move';
        row.classList.add('dragging');
      });
      row.addEventListener('dragend', () => {
        dragState = null;
        row.classList.remove('dragging');
        document.querySelectorAll('.item-row.drag-over').forEach(el => el.classList.remove('drag-over'));
      });
      row.addEventListener('dragover', e => {
        if (!dragState || dragState.type !== 'item' || dragState.si !== si) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        document.querySelectorAll('.item-row.drag-over').forEach(el => el.classList.remove('drag-over'));
        row.classList.add('drag-over');
      });
      row.addEventListener('drop', e => {
        e.preventDefault();
        e.stopPropagation();
        if (!dragState || dragState.type !== 'item' || dragState.si !== si) return;
        const fromIi = dragState.ii;
        const toIi = ii;
        if (fromIi === toIi) return;
        const items = sections[si].items;
        const moved = items.splice(fromIi, 1)[0];
        items.splice(toIi, 0, moved);
        dragState = null;
        renderMenuEditor();
      });

      const itemHandle = document.createElement('div');
      itemHandle.className = 'drag-handle';
      itemHandle.setAttribute('aria-label', 'Drag to reorder item');
      itemHandle.innerHTML = DRAG_HANDLE_SVG;

      // Product select
      const select = document.createElement('select');
      select.className = 'item-select';
      select.setAttribute('aria-label', 'Choose product');

      const blank = document.createElement('option');
      blank.value = ''; blank.textContent = '— choose product —';
      select.appendChild(blank);

      allProducts.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name + (p.price_formatted ? ` — ${p.price_formatted}` : '');
        if (p.id === item.stripe_product_id) opt.selected = true;
        select.appendChild(opt);
      });
      select.addEventListener('change', e => { sections[si].items[ii].stripe_product_id = e.target.value; });

      // Dots visual
      const dots = document.createElement('span');
      dots.className = 'item-dots-visual';
      dots.setAttribute('aria-hidden', 'true');

      // Remove button
      const removeBtn = document.createElement('button');
      removeBtn.className = 'icon-btn'; removeBtn.type = 'button';
      removeBtn.title = 'Remove item'; removeBtn.setAttribute('aria-label', 'Remove item');
      removeBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M1.5 1.5l8 8M9.5 1.5l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
      removeBtn.addEventListener('click', () => {
        sections[si].items.splice(ii, 1);
        renderMenuEditor();
      });

      row.append(itemHandle, select, dots, removeBtn);
      list.appendChild(row);
    }

    document.getElementById('add-section-btn').addEventListener('click', () => {
      sections.push({ title: '', items: [] });
      renderMenuEditor();
      setTimeout(() => {
        const inputs = document.querySelectorAll('.section-title-input');
        if (inputs.length) inputs[inputs.length - 1].focus();
      }, 50);
    });

    // ── Preview Draft ────────────────────────────────────────────────────────
    document.getElementById('preview-draft-btn').addEventListener('click', () => {
      const draft = sections.map(sec => ({
        title: sec.title,
        items: sec.items.filter(i => i.stripe_product_id).map(i => ({ stripe_product_id: i.stripe_product_id })),
      }));
      sessionStorage.setItem('menu_draft', JSON.stringify(draft));
      window.open('menu.html?preview=draft', '_blank');
    });

    // ── Publish ───────────────────────────────────────────────────────────────
    document.getElementById('publish-btn').addEventListener('click', async () => {
      const btn = document.getElementById('publish-btn');
      btn.disabled = true;
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.6" stroke-dasharray="8 8"><animateTransform attributeName="transform" type="rotate" from="0 7 7" to="360 7 7" dur=".8s" repeatCount="indefinite"/></circle></svg> Publishing…`;

      try {
        // 1. Delete all existing sections (cascade deletes items)
        const { error: delErr } = await sb
          .from('menu_sections')
          .delete()
          .neq('id', '00000000-0000-0000-0000-000000000000'); // delete all
        if (delErr) throw delErr;

        // 2. Insert sections
        for (let si = 0; si < sections.length; si++) {
          const sec = sections[si];
          if (!sec.title.trim()) continue;

          const { data: newSec, error: secErr } = await sb
            .from('menu_sections')
            .insert({ title: sec.title.trim(), sort_order: si })
            .select('id')
            .single();
          if (secErr) throw secErr;

          // 3. Insert items for this section
          const validItems = sec.items.filter(i => i.stripe_product_id);
          if (validItems.length) {
            const { error: itemErr } = await sb
              .from('menu_items')
              .insert(validItems.map((item, ii) => ({
                section_id: newSec.id,
                stripe_product_id: item.stripe_product_id,
                sort_order: ii,
              })));
            if (itemErr) throw itemErr;
          }
        }

        showToast('Menu published successfully!');
        await loadMenuFromSupabase(); // refresh IDs
      } catch (err) {
        showToast('Publish failed: ' + err.message, true);
      } finally {
        btn.disabled = false;
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2 10l4-7 4 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><line x1="4.5" y1="7.5" x2="9.5" y2="7.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg> Publish Menu`;
      }
    });

    // ── Menu Schedule ─────────────────────────────────────────────────────────
    async function loadMenuSchedule() {
      const { data } = await sb.from('menu_schedule').select('*').eq('id', 1).maybeSingle();
      if (data) {
        document.getElementById('schedule-start').value = data.start_date || '';
        document.getElementById('schedule-end').value = data.end_date || '';
        document.getElementById('schedule-message').value = data.message || '';
      }
      // Sync calendar UI with loaded data
      if (typeof initScheduleCalendar === 'function') initScheduleCalendar();
    }

    document.getElementById('btn-save-schedule').addEventListener('click', async () => {
      const btn = document.getElementById('btn-save-schedule');
      btn.disabled = true;
      const start   = document.getElementById('schedule-start').value || null;
      const end     = document.getElementById('schedule-end').value || null;
      const message = document.getElementById('schedule-message').value.trim() || null;
      const { error } = await sb.from('menu_schedule').upsert(
        { id: 1, start_date: start, end_date: end, message, updated_at: new Date().toISOString() },
        { onConflict: 'id' }
      );
      if (error) showToast('Failed: ' + error.message, true);
      else showToast('Schedule saved');
      btn.disabled = false;
    });

    // ── Saved Menus ───────────────────────────────────────────────────────────
    async function loadSavedMenus() {
      const { data } = await sb.from('saved_menus').select('*').order('created_at', { ascending: false });
      savedMenus = data || [];
      renderSavedMenusTab();
    }

    function renderSavedMenusTab() {
      const list = document.getElementById('saved-menus-list');
      if (!list) return;
      if (!savedMenus.length) {
        list.innerHTML = '<div class="empty-state">No saved menus yet.<br>Build a menu and click "Save Snapshot" to store it here.</div>';
        return;
      }
      list.innerHTML = savedMenus.map(m => {
        const date = new Date(m.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const sectionCount = (m.sections || []).length;
        return `
        <div class="saved-menu-card">
          <div class="saved-menu-card-info">
            <div class="saved-menu-title">${escHtml(m.title)}</div>
            <div class="saved-menu-meta">Saved ${escHtml(date)} &middot; ${sectionCount} section${sectionCount !== 1 ? 's' : ''}</div>
          </div>
          <button class="btn-load" data-id="${escHtml(m.id)}" type="button">Load into Editor</button>
          <button class="btn-del-saved" data-id="${escHtml(m.id)}" type="button">Delete</button>
        </div>`;
      }).join('');

      list.querySelectorAll('.btn-load').forEach(btn =>
        btn.addEventListener('click', () => loadSavedMenu(btn.dataset.id))
      );
      list.querySelectorAll('.btn-del-saved').forEach(btn =>
        btn.addEventListener('click', () => deleteSavedMenu(btn.dataset.id))
      );
    }

    function loadSavedMenu(id) {
      const menu = savedMenus.find(m => m.id === id);
      if (!menu) return;
      if (!confirm(`Load "${menu.title}" into the editor?\nThis replaces your current unsaved changes.`)) return;
      sections = (menu.sections || []).map(sec => ({
        title: sec.title,
        items: (sec.items || []).map(i => ({ stripe_product_id: i.stripe_product_id }))
      }));
      loadedMenuId = id;
      renderMenuEditor();
      // Pre-fill the snapshot title and show update button
      document.getElementById('save-menu-title').value = menu.title;
      updateSaveMenuUI();
      // Switch to Menu Editor tab
      document.querySelectorAll('.tab-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected','false'); });
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      const menuBtn = document.querySelector('[data-tab="menu"]');
      menuBtn.classList.add('active'); menuBtn.setAttribute('aria-selected','true');
      document.getElementById('tab-menu').classList.add('active');
      showToast(`"${menu.title}" loaded — publish when ready`);
    }

    async function deleteSavedMenu(id) {
      const menu = savedMenus.find(m => m.id === id);
      if (!menu || !confirm(`Delete "${menu.title}"?`)) return;
      const { error } = await sb.from('saved_menus').delete().eq('id', id);
      if (error) showToast('Delete failed', true);
      else { showToast('Deleted'); await loadSavedMenus(); }
    }

    function updateSaveMenuUI() {
      const updateBtn = document.getElementById('btn-update-menu');
      if (loadedMenuId) {
        updateBtn.classList.remove('hidden');
      } else {
        updateBtn.classList.add('hidden');
      }
    }

    document.getElementById('btn-save-menu').addEventListener('click', async () => {
      const btn = document.getElementById('btn-save-menu');
      const title = document.getElementById('save-menu-title').value.trim();
      if (!title) { showToast('Enter a snapshot title first', true); return; }
      btn.disabled = true;
      const snapshot = sections.map(sec => ({
        title: sec.title,
        items: sec.items.map(i => ({ stripe_product_id: i.stripe_product_id }))
      }));
      const { error } = await sb.from('saved_menus').insert({ title, sections: snapshot });
      if (error) showToast('Save failed: ' + error.message, true);
      else {
        showToast(`"${title}" saved`);
        document.getElementById('save-menu-title').value = '';
        loadedMenuId = null;
        updateSaveMenuUI();
        await loadSavedMenus();
      }
      btn.disabled = false;
    });

    document.getElementById('btn-update-menu').addEventListener('click', async () => {
      if (!loadedMenuId) return;
      const btn = document.getElementById('btn-update-menu');
      const title = document.getElementById('save-menu-title').value.trim();
      if (!title) { showToast('Enter a snapshot title first', true); return; }
      btn.disabled = true;
      const snapshot = sections.map(sec => ({
        title: sec.title,
        items: sec.items.map(i => ({ stripe_product_id: i.stripe_product_id }))
      }));
      const { error } = await sb.from('saved_menus').update({ title, sections: snapshot }).eq('id', loadedMenuId);
      if (error) showToast('Update failed: ' + error.message, true);
      else {
        showToast(`"${title}" updated`);
        await loadSavedMenus();
      }
      btn.disabled = false;
    });

    // ── Landing Page Content ──────────────────────────────────────────────────
    async function loadLandingContent() {
      const { data } = await sb.from('site_content').select('key, value');
      const imgPreviewMap = {
        'landing-hero':   'lc-preview-hero',
        'landing-card-1': 'lc-preview-1',
        'landing-card-2': 'lc-preview-2',
        'landing-card-3': 'lc-preview-3',
      };
      (data || []).forEach(({ key, value }) => {
        if (!value) return;
        if (imgPreviewMap[key]) {
          const el = document.getElementById(imgPreviewMap[key]);
          if (el) el.src = value;
        }
        // Text inputs: key like "lp-welcome-heading" → input id "inp-welcome-heading"
        if (key.startsWith('lp-')) {
          const el = document.getElementById('inp-' + key.slice(3));
          if (el) el.value = value;
        }
      });
    }

    // Image file inputs
    document.querySelectorAll('.lc-file-input').forEach(input => {
      input.addEventListener('change', () => {
        const file = input.files[0];
        if (!file) return;
        const previewEl = document.getElementById(input.dataset.preview);
        const nameEl   = document.getElementById(input.dataset.name);
        const saveBtn  = input.closest('.lc-row').querySelector('.lc-upload-btn');
        previewEl.src = URL.createObjectURL(file);
        nameEl.textContent = file.name;
        saveBtn.disabled = false;
      });
    });

    document.querySelectorAll('.lc-upload-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const key     = btn.dataset.key;
        const inputEl = document.getElementById(btn.dataset.input);
        const file    = inputEl.files[0];
        if (!file) return;

        btn.disabled = true;
        btn.textContent = 'Saving…';

        const ext  = file.name.split('.').pop();
        const path = `${key}.${ext}`;
        const { error: upErr } = await sb.storage
          .from('site-images')
          .upload(path, file, { upsert: true, contentType: file.type });

        if (upErr) {
          showToast('Upload failed: ' + upErr.message, true);
          btn.disabled = false;
          btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 14 14" fill="none"><path d="M2 7l3.5 3.5L12 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg> Save';
          return;
        }

        const { data: { publicUrl } } = sb.storage.from('site-images').getPublicUrl(path);
        const bustUrl = publicUrl + '?t=' + Date.now();
        const { error: dbErr } = await sb.from('site_content')
          .upsert({ key, value: bustUrl }, { onConflict: 'key' });

        if (dbErr) showToast('Save failed: ' + dbErr.message, true);
        else showToast('Image saved');

        btn.disabled = false;
        btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 14 14" fill="none"><path d="M2 7l3.5 3.5L12 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg> Save';
      });
    });

    // Cache original labels before any interaction
    document.querySelectorAll('.lp-text-save-btn').forEach(btn => {
      btn.setAttribute('data-label', btn.textContent.trim());
    });

    // Text / textarea save buttons
    document.querySelectorAll('.lp-text-save-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const originalLabel = btn.getAttribute('data-label') || 'Save';
        const isMulti = btn.dataset.multi === 'true';
        btn.disabled = true;
        btn.textContent = 'Saving…';

        let rows;
        if (isMulti) {
          const keys   = btn.dataset.key.split(',');
          const inputs = btn.dataset.inputs.split(',');
          rows = keys.map((k, i) => ({ key: k.trim(), value: document.getElementById(inputs[i].trim())?.value.trim() || '' }));
        } else {
          const inputEl = document.getElementById(btn.dataset.input);
          rows = [{ key: btn.dataset.key, value: inputEl?.value.trim() || '' }];
        }

        const { error } = await sb.from('site_content').upsert(rows, { onConflict: 'key' });
        if (error) {
          showToast('Save failed: ' + error.message, true);
        } else {
          showToast('Saved');
          // Update map preview when address is saved
          if (btn.dataset.key === 'lp-address') {
            const addr = rows[0].value;
            const mapFrame = document.getElementById('admin-map-preview');
            if (mapFrame && addr) mapFrame.src = `https://maps.google.com/maps?q=${encodeURIComponent(addr)}&output=embed`;
          }
        }

        btn.disabled = false;
        btn.textContent = originalLabel;
      });
    });

    // ── Pickup Locations ──────────────────────────────────────────────────────
    async function loadLocations() {
      const list = document.getElementById('locations-list');
      const { data, error } = await sb
        .from('pickup_locations')
        .select('*')
        .order('sort_order');

      if (error) {
        list.innerHTML = '<p class="grid-message grid-error">Failed to load locations.</p>';
        return;
      }

      renderLocations(data || []);

      document.getElementById('btn-add-location').addEventListener('click', () => {
        openLocationModal(null);
      });
    }

    function renderLocations(locations) {
      const list = document.getElementById('locations-list');
      if (!locations.length) {
        list.innerHTML = '<p class="empty-state">No pickup locations yet. Click "Add Location" to create one.</p>';
        return;
      }

      list.innerHTML = locations.map(loc => `
        <div class="location-card" data-id="${escHtml(loc.id)}">
          <div class="location-card-header">
            <div class="location-card-title">
              <strong>${escHtml(loc.name)}</strong>
              <span class="location-status-pill ${loc.active ? 'pill-active' : 'pill-inactive'}">${loc.active ? 'Active' : 'Inactive'}</span>
            </div>
            <div class="location-card-actions">
              <button type="button" class="btn-ghost-sm btn-edit-location" data-id="${escHtml(loc.id)}">Edit</button>
              <button type="button" class="btn-ghost-sm btn-delete-location" data-id="${escHtml(loc.id)}">Delete</button>
            </div>
          </div>
          <div class="location-card-body">
            <div class="location-detail">${escHtml(loc.address)}</div>
            ${loc.hours ? `<div class="location-detail location-hours">${escHtml(loc.hours)}</div>` : ''}
            ${loc.notes ? `<div class="location-detail location-notes">${escHtml(loc.notes)}</div>` : ''}
          </div>
        </div>
      `).join('');

      list.querySelectorAll('.btn-edit-location').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.id;
          const { data } = await sb.from('pickup_locations').select('*').eq('id', id).maybeSingle();
          if (data) openLocationModal(data);
        });
      });

      list.querySelectorAll('.btn-delete-location').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.id;
          if (!confirm('Delete this pickup location? This will clear it from any customer profiles that selected it.')) return;
          const { error } = await sb.from('pickup_locations').delete().eq('id', id);
          if (error) { showToast('Delete failed: ' + error.message, true); return; }
          showToast('Location deleted');
          await reloadLocations();
        });
      });
    }

    async function reloadLocations() {
      const { data } = await sb.from('pickup_locations').select('*').order('sort_order');
      renderLocations(data || []);
    }

    function openLocationModal(existing) {
      // Remove any existing modal
      document.getElementById('location-modal')?.remove();

      const modal = document.createElement('div');
      modal.id = 'location-modal';
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal-panel">
          <div class="modal-header">
            <h3 class="modal-title">${existing ? 'Edit Location' : 'Add Pickup Location'}</h3>
            <button type="button" class="modal-close" id="location-modal-close" aria-label="Close">&times;</button>
          </div>
          <div class="modal-body">
            <div class="admin-field">
              <label class="admin-label" for="loc-name">Name <span class="required-star">*</span></label>
              <input type="text" class="admin-input" id="loc-name" placeholder="e.g. Hope Farmers Market" value="${escHtml(existing?.name || '')}" />
            </div>
            <div class="admin-field">
              <label class="admin-label" for="loc-address">Address <span class="required-star">*</span></label>
              <input type="text" class="admin-input" id="loc-address" placeholder="e.g. 123 Main St, Hope, IN 47246" value="${escHtml(existing?.address || '')}" />
            </div>
            <div class="admin-field">
              <label class="admin-label" for="loc-hours">Hours / Pickup Window</label>
              <input type="text" class="admin-input" id="loc-hours" placeholder="e.g. Saturdays 8am–12pm" value="${escHtml(existing?.hours || '')}" />
            </div>
            <div class="admin-field">
              <label class="admin-label" for="loc-notes">Notes / Instructions</label>
              <input type="text" class="admin-input" id="loc-notes" placeholder="e.g. Look for the blue tent" value="${escHtml(existing?.notes || '')}" />
            </div>
            <div class="admin-field">
              <label class="admin-label" for="loc-calendar">Calendar Event ID <span class="admin-label-note">(optional)</span></label>
              <input type="text" class="admin-input" id="loc-calendar" placeholder="Google Calendar event ID" value="${escHtml(existing?.calendar_event_id || '')}" />
            </div>
            <div class="admin-field admin-field-inline">
              <label class="admin-label" for="loc-active">Active (visible to customers)</label>
              <input type="checkbox" id="loc-active" ${existing?.active !== false ? 'checked' : ''} />
            </div>
            <div class="admin-field">
              <label class="admin-label" for="loc-sort">Sort Order</label>
              <input type="number" class="admin-input admin-input-sm" id="loc-sort" min="0" max="999" value="${existing?.sort_order ?? 0}" />
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn-ghost-sm" id="location-modal-cancel">Cancel</button>
            <button type="button" class="btn-secondary" id="location-modal-save">
              ${existing ? 'Save Changes' : 'Add Location'}
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      modal.querySelector('#location-modal-close').addEventListener('click', () => modal.remove());
      modal.querySelector('#location-modal-cancel').addEventListener('click', () => modal.remove());
      modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

      modal.querySelector('#location-modal-save').addEventListener('click', async () => {
        const saveBtn = modal.querySelector('#location-modal-save');
        const name = modal.querySelector('#loc-name').value.trim();
        const address = modal.querySelector('#loc-address').value.trim();
        if (!name || !address) { showToast('Name and address are required', true); return; }

        const payload = {
          name,
          address,
          hours: modal.querySelector('#loc-hours').value.trim() || null,
          notes: modal.querySelector('#loc-notes').value.trim() || null,
          calendar_event_id: modal.querySelector('#loc-calendar').value.trim() || null,
          active: modal.querySelector('#loc-active').checked,
          sort_order: parseInt(modal.querySelector('#loc-sort').value, 10) || 0,
        };

        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving…';

        let error;
        if (existing) {
          ({ error } = await sb.from('pickup_locations').update(payload).eq('id', existing.id));
        } else {
          ({ error } = await sb.from('pickup_locations').insert(payload));
        }

        if (error) {
          showToast('Save failed: ' + error.message, true);
          saveBtn.disabled = false;
          saveBtn.textContent = existing ? 'Save Changes' : 'Add Location';
          return;
        }

        showToast(existing ? 'Location updated' : 'Location added');
        modal.remove();
        await reloadLocations();
      });
    }

    // ── Club Admin ────────────────────────────────────────────────────────────
    async function loadClubTab() {
      await Promise.all([loadClubMembers(), loadClubReferrals(), loadRewardTexts()]);
      setupRewardSaveButtons();
    }

    async function loadClubMembers() {
      const tbody = document.getElementById('club-members-tbody');
      const countEl = document.getElementById('club-member-count');

      // Fetch club_members with status active or past_due
      const { data: members, error } = await sb
        .from('club_members')
        .select('user_id, status, started_at')
        .in('status', ['active', 'past_due'])
        .order('started_at', { ascending: false });

      if (error || !members) {
        tbody.innerHTML = `<tr><td colspan="4" class="club-table-loading">Failed to load members</td></tr>`;
        return;
      }

      countEl.textContent = members.length;

      if (!members.length) {
        tbody.innerHTML = `<tr><td colspan="4" class="club-table-empty">No active members yet</td></tr>`;
        return;
      }

      // Fetch profiles + emails for these user_ids
      const userIds = members.map(m => m.user_id);
      const [{ data: profiles }, { data: authUsers }] = await Promise.all([
        sb.from('profiles').select('user_id, first_name, last_name').in('user_id', userIds),
        sb.from('admins').select('user_id'), // just to get admin list for display
      ]);

      const profileMap = {};
      (profiles || []).forEach(p => { profileMap[p.user_id] = p; });

      tbody.innerHTML = members.map(m => {
        const p = profileMap[m.user_id];
        const name = p ? [p.first_name, p.last_name].filter(Boolean).join(' ') || '—' : '—';
        const joined = new Date(m.started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const statusClass = m.status === 'active' ? 'status-active' : 'status-pastdue';
        return `<tr>
          <td>${escHtml(name)}</td>
          <td class="club-user-id">${escHtml(m.user_id.slice(0,8))}…</td>
          <td>${escHtml(joined)}</td>
          <td><span class="club-status-pill ${statusClass}">${m.status === 'past_due' ? 'Past Due' : 'Active'}</span></td>
        </tr>`;
      }).join('');
    }

    async function loadClubReferrals() {
      const tbody = document.getElementById('club-referral-tbody');

      // Get all referral codes
      const { data: codes, error } = await sb
        .from('referral_codes')
        .select('user_id, code, created_at');

      if (error || !codes || !codes.length) {
        tbody.innerHTML = `<tr><td colspan="4" class="club-table-empty">No referral activity yet</td></tr>`;
        return;
      }

      // Get use counts per code
      const { data: uses } = await sb
        .from('referral_uses')
        .select('code');

      const useCounts = {};
      (uses || []).forEach(u => { useCounts[u.code] = (useCounts[u.code] || 0) + 1; });

      // Get profiles
      const userIds = codes.map(c => c.user_id);
      const { data: profiles } = await sb
        .from('profiles')
        .select('user_id, first_name, last_name')
        .in('user_id', userIds);
      const profileMap = {};
      (profiles || []).forEach(p => { profileMap[p.user_id] = p; });

      const milestones = [5, 15, 25];
      const rows = codes
        .map(c => ({ ...c, count: useCounts[c.code] || 0 }))
        .sort((a, b) => b.count - a.count)
        .filter(c => c.count > 0 || codes.length < 20);

      if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="4" class="club-table-empty">No referrals recorded yet</td></tr>`;
        return;
      }

      tbody.innerHTML = rows.map(c => {
        const p = profileMap[c.user_id];
        const name = p ? [p.first_name, p.last_name].filter(Boolean).join(' ') || '—' : '—';
        const reached = milestones.filter(m => c.count >= m).pop() || null;
        const milestoneDisplay = reached ? `<span class="milestone-pill">${reached}+ ✓</span>` : '—';
        return `<tr>
          <td>${escHtml(name)}</td>
          <td><code class="ref-code-pill">${escHtml(c.code)}</code></td>
          <td class="ref-count-cell">${c.count}</td>
          <td>${milestoneDisplay}</td>
        </tr>`;
      }).join('');
    }

    async function loadRewardTexts() {
      const { data } = await sb.from('site_content')
        .select('key, value')
        .in('key', ['referral-reward-1', 'referral-reward-3', 'referral-reward-5']);
      (data || []).forEach(row => {
        const suffix = row.key.replace('referral-reward-', '');
        const el = document.getElementById(`reward-text-${suffix}`);
        if (el && row.value) el.value = row.value;
      });
    }

    function setupRewardSaveButtons() {
      [['save-reward-1', 'reward-text-1', 'referral-reward-1'],
       ['save-reward-3', 'reward-text-3', 'referral-reward-3'],
       ['save-reward-5', 'reward-text-5', 'referral-reward-5']].forEach(([btnId, inputId, key]) => {
        document.getElementById(btnId)?.addEventListener('click', async () => {
          const btn = document.getElementById(btnId);
          const val = document.getElementById(inputId).value.trim();
          btn.disabled = true; btn.textContent = 'Saving…';
          const { error } = await sb.from('site_content')
            .upsert({ key, value: val }, { onConflict: 'key' });
          btn.disabled = false; btn.textContent = 'Save';
          if (error) showToast('Save failed: ' + error.message, true);
          else showToast('Reward text saved');
        });
      });
    }

    // ── Orders ─────────────────────────────────────────────────────────────────
    let allOrders = [];
    let filteredOrders = [];
    let ordersLoaded = false;

    const fmtUSD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

    async function loadAllOrders() {
      const list = document.getElementById('admin-orders-list');
      const { data: orders, error } = await sb
        .from('orders')
        .select('*, order_items(*)')
        .order('created_at', { ascending: false });

      if (error) {
        list.innerHTML = `<p class="grid-message grid-error">Failed to load orders: ${escHtml(error.message)}</p>`;
        return;
      }

      // Fetch profiles for all unique user_ids
      const userIds = [...new Set((orders || []).map(o => o.user_id))];
      const profileMap = {};
      if (userIds.length) {
        const { data: profiles } = await sb
          .from('profiles')
          .select('user_id, first_name, last_name, phone')
          .in('user_id', userIds);
        (profiles || []).forEach(p => { profileMap[p.user_id] = p; });
      }

      allOrders = (orders || []).map(o => ({ ...o, profiles: profileMap[o.user_id] || null }));
      applyOrderFilters();
    }

    function applyOrderFilters() {
      const search = (document.getElementById('order-search').value || '').toLowerCase();
      const dateFilter = document.getElementById('order-date-filter').value;
      const statusFilter = document.getElementById('order-status-filter').value;
      const now = new Date();

      filteredOrders = allOrders.filter(o => {
        // Date filter
        if (dateFilter !== 'all') {
          const d = new Date(o.created_at);
          if (dateFilter === 'today') {
            if (d.toDateString() !== now.toDateString()) return false;
          } else if (dateFilter === 'week') {
            const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7);
            if (d < weekAgo) return false;
          } else if (dateFilter === 'month') {
            if (d.getMonth() !== now.getMonth() || d.getFullYear() !== now.getFullYear()) return false;
          }
        }
        // Status filter
        if (statusFilter !== 'all' && o.status !== statusFilter) return false;
        // Search
        if (search) {
          const p = o.profiles;
          const name = p ? `${p.first_name || ''} ${p.last_name || ''}`.toLowerCase() : '';
          const stripeName = (o.customer_name || '').toLowerCase();
          const email = (o.customer_email || '').toLowerCase();
          const id = o.id.toLowerCase();
          if (!name.includes(search) && !stripeName.includes(search) && !email.includes(search) && !id.includes(search)) return false;
        }
        return true;
      });

      renderAdminOrders();
    }

    function renderAdminOrders() {
      const list = document.getElementById('admin-orders-list');
      const summary = document.getElementById('orders-summary');
      const total = filteredOrders.reduce((s, o) => s + (o.total_amount || 0), 0);
      summary.innerHTML = `<span>${filteredOrders.length} order${filteredOrders.length !== 1 ? 's' : ''}</span><span>${fmtUSD.format(total / 100)}</span>`;

      if (!filteredOrders.length) {
        list.innerHTML = '<div class="empty-state">No orders match your filters.</div>';
        return;
      }
      list.innerHTML = filteredOrders.map(order => {
        const p = order.profiles;
        const name = p ? [p.first_name, p.last_name].filter(Boolean).join(' ') || order.customer_name || 'Unknown' : order.customer_name || 'Unknown';
        const phone = p?.phone || '';
        const email = order.customer_email || '';
        const date = new Date(order.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
        const items = (order.order_items || []).map(i =>
          `<div class="admin-order-item"><span>${escHtml(i.product_name || i.stripe_product_id)} &times; ${i.quantity}</span><span>${fmtUSD.format((i.unit_amount * i.quantity) / 100)}</span></div>`
        ).join('');
        return `<div class="admin-order-card" data-order-id="${escHtml(order.id)}">
          <div class="admin-order-header">
            <div class="admin-order-customer">
              <strong>${escHtml(name)}</strong>
              ${phone ? `<span class="admin-order-phone">${escHtml(phone)}</span>` : email ? `<span class="admin-order-phone">${escHtml(email)}</span>` : ''}
            </div>
            <div class="admin-order-meta">
              <span class="admin-order-date">${escHtml(date)}</span>
              <span class="admin-order-id">#${escHtml(order.id.slice(0,8))}</span>
            </div>
          </div>
          <div class="admin-order-body">
            <div class="admin-order-items">${items}</div>
            <div class="admin-order-footer">
              <div class="admin-order-total">${fmtUSD.format((order.total_amount || 0) / 100)}</div>
              <div class="admin-order-actions">
                <select class="order-status-select status-${escHtml(order.status)}" data-id="${escHtml(order.id)}" aria-label="Order status">
                  ${['paid','fulfilled','picked_up','cancelled'].map(s =>
                    `<option value="${s}" ${s === order.status ? 'selected' : ''}>${s === 'picked_up' ? 'Picked Up' : s.charAt(0).toUpperCase() + s.slice(1)}</option>`
                  ).join('')}
                </select>
                <button class="btn-print-single icon-btn" data-id="${escHtml(order.id)}" title="Print ticket" aria-label="Print order ticket">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                </button>
              </div>
            </div>
          </div>
        </div>`;
      }).join('');

      // Wire status selects
      list.querySelectorAll('.order-status-select').forEach(sel => {
        sel.addEventListener('change', () => updateOrderStatus(sel.dataset.id, sel.value));
      });
      // Wire single print buttons
      list.querySelectorAll('.btn-print-single').forEach(btn => {
        btn.addEventListener('click', () => openPrintDialog([allOrders.find(o => o.id === btn.dataset.id)]));
      });
    }

    async function updateOrderStatus(orderId, newStatus) {
      const { error } = await sb.from('orders').update({ status: newStatus }).eq('id', orderId);
      if (error) {
        showToast('Status update failed: ' + error.message, true);
        return;
      }
      const order = allOrders.find(o => o.id === orderId);
      if (order) order.status = newStatus;
      showToast(`Order marked as ${newStatus === 'picked_up' ? 'Picked Up' : newStatus}`);
      applyOrderFilters();
    }

    // Wire order filter controls
    document.getElementById('order-search').addEventListener('input', applyOrderFilters);
    document.getElementById('order-date-filter').addEventListener('change', applyOrderFilters);
    document.getElementById('order-status-filter').addEventListener('change', applyOrderFilters);

    // Lazy-load orders tab on first click
    document.querySelector('[data-tab="orders"]')?.addEventListener('click', async () => {
      if (!ordersLoaded) { ordersLoaded = true; await loadAllOrders(); }
    }, { once: true });

    // Bulk print
    document.getElementById('bulk-print-btn').addEventListener('click', () => {
      openPrintDialog(filteredOrders, true);
    });

    // ── Create Order (manual / on behalf of customer) ──────────────────────────
    let adminProducts = null;
    let adminPickupLocations = null;

    async function loadAdminOrderAssets() {
      if (!adminProducts) {
        const res = await fetch('/api/stripe/products');
        adminProducts = res.ok ? await res.json() : [];
      }
      if (!adminPickupLocations) {
        const { data } = await sb.from('pickup_locations').select('id, name').eq('active', true).order('sort_order');
        adminPickupLocations = data || [];
      }
    }

    document.getElementById('create-order-btn').addEventListener('click', async () => {
      await loadAdminOrderAssets();
      openCreateOrderModal();
    });

    function openCreateOrderModal() {
      const locationOptions = adminPickupLocations.map(loc =>
        `<option value="${escHtml(loc.name)}">${escHtml(loc.name)}</option>`
      ).join('');

      const modal = document.createElement('div');
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal-panel" style="max-width:600px;width:100%">
          <div class="modal-header">
            <h3 class="modal-title">Create Order</h3>
            <button class="modal-close" aria-label="Close">&times;</button>
          </div>
          <div class="modal-body" style="display:flex;flex-direction:column;gap:1.25rem">

            <div>
              <label class="admin-label">Customer</label>
              <input type="text" class="admin-input" id="co-customer-search" placeholder="Search by name or phone…" autocomplete="off" />
              <ul id="co-customer-results" style="list-style:none;margin:0;padding:0;border:1px solid #ddd;border-top:none;border-radius:0 0 6px 6px;display:none;max-height:160px;overflow-y:auto;background:#fff;"></ul>
              <div style="display:flex;gap:.75rem;margin-top:.5rem">
                <input type="text" class="admin-input" id="co-customer-name" placeholder="Full name *" style="flex:1" />
                <input type="email" class="admin-input" id="co-customer-email" placeholder="Email (optional)" style="flex:1" />
              </div>
              <input type="hidden" id="co-customer-user-id" />
            </div>

            <div>
              <label class="admin-label">Pickup Location</label>
              <select class="admin-input" id="co-pickup-location">
                <option value="">— None / Not specified —</option>
                ${locationOptions}
              </select>
            </div>

            <div>
              <label class="admin-label">Items</label>
              <div id="co-items-list" style="display:flex;flex-direction:column;gap:.5rem"></div>
              <button type="button" class="btn-ghost-sm" id="co-add-item-btn" style="margin-top:.5rem">+ Add Item</button>
            </div>

            <div style="text-align:right;font-weight:600;font-size:.95rem" id="co-total-display">Total: $0.00</div>

          </div>
          <div class="modal-footer">
            <button class="btn-ghost-sm" id="co-cancel-btn">Cancel</button>
            <button class="btn-secondary" id="co-submit-btn">Create Order</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      // Product dropdown HTML helper
      const productOptions = (adminProducts || []).map(p =>
        `<option value="${escHtml(p.id)}" data-price="${p.unit_amount || 0}" data-name="${escHtml(p.name)}">${escHtml(p.name)} — ${p.price_formatted || '$?'}</option>`
      ).join('');

      function addItemRow(product = null) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:.5rem';
        row.innerHTML = `
          <select class="admin-input co-product-select" style="flex:2">
            <option value="">Select product…</option>
            ${productOptions}
          </select>
          <input type="number" class="admin-input co-qty-input" value="1" min="1" style="width:64px;text-align:center" aria-label="Quantity" />
          <span class="co-item-price" style="min-width:56px;text-align:right;font-size:.875rem;color:#666">$0.00</span>
          <button type="button" class="modal-close" aria-label="Remove item" style="font-size:1rem;line-height:1">×</button>
        `;
        if (product) {
          const sel = row.querySelector('.co-product-select');
          sel.value = product.id;
          row.querySelector('.co-item-price').textContent = product.price_formatted || '$0.00';
        }
        row.querySelector('.co-product-select').addEventListener('change', e => {
          const opt = e.target.selectedOptions[0];
          const price = parseInt(opt?.dataset.price || '0', 10);
          row.querySelector('.co-item-price').textContent = formatPrice(price);
          recalcTotal();
        });
        row.querySelector('.co-qty-input').addEventListener('input', recalcTotal);
        row.querySelector('[aria-label="Remove item"]').addEventListener('click', () => {
          row.remove();
          recalcTotal();
        });
        modal.querySelector('#co-items-list').appendChild(row);
        recalcTotal();
      }

      addItemRow();

      modal.querySelector('#co-add-item-btn').addEventListener('click', () => addItemRow());

      function recalcTotal() {
        let cents = 0;
        modal.querySelectorAll('#co-items-list > div').forEach(row => {
          const sel = row.querySelector('.co-product-select');
          const qty = parseInt(row.querySelector('.co-qty-input').value, 10) || 0;
          const price = parseInt(sel?.selectedOptions[0]?.dataset.price || '0', 10);
          cents += price * qty;
        });
        modal.querySelector('#co-total-display').textContent = `Total: ${formatPrice(cents)}`;
        modal._totalCents = cents;
      }

      // Customer search with debounce
      let searchTimer;
      modal.querySelector('#co-customer-search').addEventListener('input', e => {
        clearTimeout(searchTimer);
        const q = e.target.value.trim();
        const results = modal.querySelector('#co-customer-results');
        if (q.length < 2) { results.style.display = 'none'; return; }
        searchTimer = setTimeout(async () => {
          const { data } = await sb
            .from('profiles')
            .select('user_id, first_name, last_name, phone')
            .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,phone.ilike.%${q}%`)
            .limit(8);
          if (!data || !data.length) { results.style.display = 'none'; return; }
          results.innerHTML = data.map(p => {
            const name = `${p.first_name || ''} ${p.last_name || ''}`.trim() || '(no name)';
            return `<li data-uid="${escHtml(p.user_id)}" data-name="${escHtml(name)}" style="padding:.5rem .75rem;cursor:pointer;border-bottom:1px solid #eee">${escHtml(name)}${p.phone ? ' — ' + escHtml(p.phone) : ''}</li>`;
          }).join('');
          results.style.display = 'block';
          results.querySelectorAll('li').forEach(li => {
            li.addEventListener('click', () => {
              modal.querySelector('#co-customer-name').value = li.dataset.name;
              modal.querySelector('#co-customer-user-id').value = li.dataset.uid;
              modal.querySelector('#co-customer-search').value = li.dataset.name;
              results.style.display = 'none';
            });
          });
        }, 300);
      });

      // Close handlers
      const close = () => modal.remove();
      modal.querySelector('.modal-close').addEventListener('click', close);
      modal.querySelector('#co-cancel-btn').addEventListener('click', close);
      modal.addEventListener('click', e => { if (e.target === modal) close(); });

      // Submit
      modal.querySelector('#co-submit-btn').addEventListener('click', async () => {
        const customerName = modal.querySelector('#co-customer-name').value.trim();
        const customerEmail = modal.querySelector('#co-customer-email').value.trim();
        const customerUserId = modal.querySelector('#co-customer-user-id').value.trim() || null;
        const pickupLocationName = modal.querySelector('#co-pickup-location').value || null;

        if (!customerName) {
          showToast('Please enter a customer name', true);
          modal.querySelector('#co-customer-name').focus();
          return;
        }

        const items = [];
        let valid = true;
        modal.querySelectorAll('#co-items-list > div').forEach(row => {
          const sel = row.querySelector('.co-product-select');
          const qty = parseInt(row.querySelector('.co-qty-input').value, 10) || 0;
          const opt = sel?.selectedOptions[0];
          if (!sel?.value) { valid = false; return; }
          items.push({
            stripe_product_id: sel.value,
            product_name: opt?.dataset.name || sel.value,
            quantity: qty,
            unit_amount: parseInt(opt?.dataset.price || '0', 10),
          });
        });

        if (!valid || !items.length) {
          showToast('Please select a product for every item row', true);
          return;
        }

        const btn = modal.querySelector('#co-submit-btn');
        btn.disabled = true;
        btn.textContent = 'Creating…';

        try {
          const { data: { session } } = await sb.auth.getSession();
          const res = await fetch('/api/admin/create-order', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              customer_name: customerName,
              customer_email: customerEmail || null,
              customer_user_id: customerUserId,
              items,
              pickup_location_name: pickupLocationName,
              total_amount: modal._totalCents || null,
            }),
          });
          if (res.ok) {
            showToast('Order created');
            modal.remove();
            ordersLoaded = false;
            await loadAllOrders();
          } else {
            const err = await res.json().catch(() => ({}));
            showToast(err.error || 'Failed to create order', true);
            btn.disabled = false;
            btn.textContent = 'Create Order';
          }
        } catch (e) {
          showToast('Network error — please try again', true);
          btn.disabled = false;
          btn.textContent = 'Create Order';
        }
      });
    }

    // ── Print Dialog ───────────────────────────────────────────────────────────
    let printOrders = [];
    let printIsBulk = false;

    function openPrintDialog(orders, bulk = false) {
      printOrders = orders.filter(Boolean);
      printIsBulk = bulk;
      const modal = document.getElementById('print-modal');
      const typeFilters = document.getElementById('print-type-filters');

      if (bulk) {
        typeFilters.classList.remove('hidden');
        const counts = { paid: 0, fulfilled: 0, cancelled: 0 };
        printOrders.forEach(o => { if (counts[o.status] !== undefined) counts[o.status]++; });
        document.getElementById('print-paid-count').textContent = counts.paid;
        document.getElementById('print-fulfilled-count').textContent = counts.fulfilled;
        document.getElementById('print-cancelled-count').textContent = counts.cancelled;
      } else {
        typeFilters.classList.add('hidden');
      }

      modal.classList.remove('hidden');
    }

    document.getElementById('print-cancel').addEventListener('click', () => {
      document.getElementById('print-modal').classList.add('hidden');
    });

    // Toggle custom fields visibility
    document.querySelectorAll('input[name="print-detail"]').forEach(r => {
      r.addEventListener('change', () => {
        document.getElementById('print-custom-fields').classList.toggle('hidden', !(r.value === 'custom' && r.checked));
      });
    });

    document.getElementById('print-go').addEventListener('click', () => {
      const size = document.getElementById('print-ticket-size').value;
      const detailMode = document.querySelector('input[name="print-detail"]:checked').value;
      let fields = { name: true, phone: true, items: true, prices: true, orderId: true, date: true };
      if (detailMode === 'custom') {
        fields = {};
        document.querySelectorAll('#print-custom-fields input[type="checkbox"]').forEach(cb => {
          fields[cb.dataset.field] = cb.checked;
        });
      }

      let orders = [...printOrders];
      if (printIsBulk) {
        const allowedStatuses = [];
        if (document.getElementById('print-paid').checked) allowedStatuses.push('paid');
        if (document.getElementById('print-fulfilled').checked) allowedStatuses.push('fulfilled');
        if (document.getElementById('print-cancelled').checked) allowedStatuses.push('cancelled');
        orders = orders.filter(o => allowedStatuses.includes(o.status));
      }

      if (!orders.length) { showToast('No orders to print', true); return; }
      printTickets(orders, size, fields);
      document.getElementById('print-modal').classList.add('hidden');
    });

    // Page sizes for @page CSS injection (width x height)
    const pageSizes = {
      '4x6': '4in 6in', '4x5': '4in 5in', '4x4': '4in 4in',
      '3x5': '3in 5in', '3x4': '3in 4in',
      'letter': '8.5in 11in'
    };

    function setPageSize(size) {
      let el = document.getElementById('print-page-style');
      if (!el) { el = document.createElement('style'); el.id = 'print-page-style'; document.head.appendChild(el); }
      const dim = pageSizes[size] || pageSizes.letter;
      el.textContent = `@media print { @page { size: ${dim}; margin: 0; } }`;
    }

    function printTickets(orders, size, fields) {
      const area = document.getElementById('print-area');
      area.className = `print-area print-size-${size}`;
      setPageSize(size);

      const tickets = orders.map(order => {
        const p = order.profiles;
        const name = p ? [p.first_name, p.last_name].filter(Boolean).join(' ') || order.customer_name || 'Customer' : order.customer_name || 'Customer';
        const phone = p?.phone || '';
        const date = new Date(order.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const items = (order.order_items || []);
        const total = (order.total_amount || 0) / 100;
        const statusLabel = order.status === 'picked_up' ? 'Picked Up' : (order.status || 'paid').charAt(0).toUpperCase() + (order.status || 'paid').slice(1);

        const ticket = document.createElement('div');
        ticket.className = 'print-ticket';

        const brand = document.createElement('div');
        brand.className = 'ticket-brand';
        brand.textContent = 'BLOOMIN\' ACRES';
        ticket.appendChild(brand);

        if (fields.orderId) {
          const oid = document.createElement('div');
          oid.className = 'ticket-order-id';
          oid.textContent = `Order #${order.id.slice(0,8)}`;
          ticket.appendChild(oid);
        }

        ticket.appendChild(createDivider());

        if (fields.name) {
          const cust = document.createElement('div');
          cust.className = 'ticket-customer';
          cust.textContent = name;
          ticket.appendChild(cust);
        }
        if (fields.phone && phone) {
          const ph = document.createElement('div');
          ph.className = 'ticket-phone';
          ph.textContent = phone;
          ticket.appendChild(ph);
        }
        if (fields.date) {
          const dt = document.createElement('div');
          dt.className = 'ticket-date';
          dt.textContent = `${date} \u00B7 ${statusLabel}`;
          ticket.appendChild(dt);
        }
        if (fields.items) {
          ticket.appendChild(createDivider());
          items.forEach(i => {
            const row = document.createElement('div');
            row.className = 'ticket-item';
            const nameSpan = document.createElement('span');
            nameSpan.textContent = `${i.quantity}\u00D7 ${i.product_name || i.stripe_product_id}`;
            row.appendChild(nameSpan);
            if (fields.prices) {
              const priceSpan = document.createElement('span');
              priceSpan.textContent = fmtUSD.format((i.unit_amount * i.quantity) / 100);
              row.appendChild(priceSpan);
            }
            ticket.appendChild(row);
          });
          if (fields.prices) {
            ticket.appendChild(createDivider());
            const totalRow = document.createElement('div');
            totalRow.className = 'ticket-total';
            const totalLabel = document.createElement('strong');
            totalLabel.textContent = 'TOTAL';
            const totalVal = document.createElement('strong');
            totalVal.textContent = fmtUSD.format(total);
            totalRow.appendChild(totalLabel);
            totalRow.appendChild(totalVal);
            ticket.appendChild(totalRow);
          }
        }
        return ticket;
      });

      area.replaceChildren(...tickets);
      setTimeout(() => window.print(), 100);
    }

    function createDivider() {
      const d = document.createElement('div');
      d.className = 'ticket-divider';
      return d;
    }

    // ── Prep List ─────────────────────────────────────────────────────────────
    document.getElementById('prep-list-btn').addEventListener('click', () => {
      const orders = filteredOrders.filter(o => o.status !== 'cancelled');
      if (!orders.length) { showToast('No orders to summarize', true); return; }

      // Aggregate quantities by product + variation
      const agg = {};
      orders.forEach(o => {
        (o.order_items || []).forEach(item => {
          const name = item.product_name || item.stripe_product_id;
          if (!agg[name]) agg[name] = { total: 0 };
          agg[name].total += item.quantity;
        });
      });

      // Build table using DOM methods
      const body = document.getElementById('prep-list-body');
      const table = document.createElement('table');
      const thead = document.createElement('thead');
      const headRow = document.createElement('tr');
      const thProduct = document.createElement('th');
      thProduct.textContent = 'Product';
      const thQty = document.createElement('th');
      thQty.textContent = 'Quantity';
      headRow.appendChild(thProduct);
      headRow.appendChild(thQty);
      thead.appendChild(headRow);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      const sorted = Object.entries(agg).sort((a, b) => a[0].localeCompare(b[0]));
      let grandTotal = 0;

      sorted.forEach(([name, data]) => {
        const row = document.createElement('tr');
        const tdName = document.createElement('td');
        tdName.className = 'prep-product-name';
        tdName.textContent = name;
        const tdQty = document.createElement('td');
        tdQty.textContent = data.total;
        row.appendChild(tdName);
        row.appendChild(tdQty);
        tbody.appendChild(row);
        grandTotal += data.total;
      });

      // Total row
      const totalRow = document.createElement('tr');
      totalRow.className = 'prep-total-row';
      const tdTotalLabel = document.createElement('td');
      tdTotalLabel.textContent = 'Total Items';
      const tdTotalVal = document.createElement('td');
      tdTotalVal.textContent = grandTotal;
      totalRow.appendChild(tdTotalLabel);
      totalRow.appendChild(tdTotalVal);
      tbody.appendChild(totalRow);
      table.appendChild(tbody);
      body.replaceChildren(table);

      // Date label
      const dateFilter = document.getElementById('order-date-filter');
      const label = dateFilter.options[dateFilter.selectedIndex].text;
      document.getElementById('prep-date-label').textContent =
        `${label} \u2014 ${orders.length} order${orders.length !== 1 ? 's' : ''}`;

      document.getElementById('prep-modal').classList.remove('hidden');
    });

    document.getElementById('prep-close').addEventListener('click', () => {
      document.getElementById('prep-modal').classList.add('hidden');
    });

    // Print prep list
    document.getElementById('prep-print-btn').addEventListener('click', () => {
      const area = document.getElementById('print-area');
      area.className = 'print-area';
      setPageSize('letter');

      const dateLabel = document.getElementById('prep-date-label').textContent;
      const wrapper = document.createElement('div');
      wrapper.className = 'prep-list-printable';

      const header = document.createElement('div');
      header.className = 'prep-print-header';
      header.textContent = 'Bloomin\' Acres \u2014 Prep List';
      wrapper.appendChild(header);

      const dateLine = document.createElement('div');
      dateLine.className = 'prep-print-date';
      dateLine.textContent = dateLabel;
      wrapper.appendChild(dateLine);

      // Clone the table from the modal
      const srcTable = document.querySelector('#prep-list-body table');
      if (srcTable) wrapper.appendChild(srcTable.cloneNode(true));

      area.replaceChildren(wrapper);
      setTimeout(() => window.print(), 100);
    });

    // Download prep list as CSV
    document.getElementById('prep-download-btn').addEventListener('click', () => {
      const rows = [['Product', 'Quantity']];
      document.querySelectorAll('#prep-list-body tbody tr').forEach(tr => {
        const cells = tr.querySelectorAll('td');
        if (cells.length >= 2) {
          rows.push([cells[0].textContent, cells[1].textContent]);
        }
      });
      const csv = rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const dateFilter = document.getElementById('order-date-filter');
      a.download = `prep-list-${dateFilter.value}-${new Date().toISOString().slice(0,10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });

    // ── Analytics ──────────────────────────────────────────────────────────────
    let analyticsLoaded = false;
    let analyticsPeriod = 'month';
    let analyticsData = { orders: [], members: [], referralUses: [], profileMap: {} };

    // Lazy-load analytics on first click
    document.querySelector('[data-tab="analytics"]')?.addEventListener('click', async () => {
      if (!analyticsLoaded) { analyticsLoaded = true; await loadAnalytics(); }
    }, { once: true });

    // Period selector
    document.querySelectorAll('.period-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        analyticsPeriod = btn.dataset.period;
        const customRange = document.getElementById('custom-range');
        customRange.classList.toggle('hidden', analyticsPeriod !== 'custom');
        if (analyticsPeriod !== 'custom') renderAnalytics();
      });
    });

    document.getElementById('apply-range')?.addEventListener('click', () => renderAnalytics());

    function getDateRange() {
      const now = new Date();
      let start, end;
      if (analyticsPeriod === 'week') {
        start = new Date(now); start.setDate(start.getDate() - start.getDay() + 1); // Monday
        start.setHours(0,0,0,0);
        end = new Date(start); end.setDate(end.getDate() + 6); end.setHours(23,59,59,999);
      } else if (analyticsPeriod === 'month') {
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      } else {
        start = new Date(document.getElementById('range-start').value || now);
        end = new Date(document.getElementById('range-end').value || now);
        start.setHours(0,0,0,0);
        end.setHours(23,59,59,999);
      }
      return { start, end };
    }

    async function loadAnalytics() {
      const [ordersRes, membersRes, refUsesRes] = await Promise.all([
        sb.from('orders').select('*, order_items(*)').order('created_at', { ascending: false }),
        sb.from('club_members').select('*'),
        sb.from('referral_uses').select('*'),
      ]);
      analyticsData.orders = ordersRes.data || [];
      analyticsData.members = membersRes.data || [];
      analyticsData.referralUses = refUsesRes.data || [];

      // Fetch profiles for analytics customer insights
      const userIds = [...new Set(analyticsData.orders.map(o => o.user_id))];
      if (userIds.length) {
        const { data: profiles } = await sb.from('profiles').select('user_id, first_name, last_name').in('user_id', userIds);
        (profiles || []).forEach(p => { analyticsData.profileMap[p.user_id] = p; });
      }

      renderAnalytics();
    }

    function renderAnalytics() {
      const { start, end } = getDateRange();
      const periodOrders = analyticsData.orders.filter(o => {
        const d = new Date(o.created_at);
        return d >= start && d <= end && o.status !== 'cancelled';
      });
      const allPeriodOrders = analyticsData.orders.filter(o => {
        const d = new Date(o.created_at);
        return d >= start && d <= end;
      });

      // KPIs
      const revenue = periodOrders.reduce((s, o) => s + (o.total_amount || 0), 0);
      const orderCount = periodOrders.length;
      const aov = orderCount ? revenue / orderCount : 0;
      const activeMembers = analyticsData.members.filter(m => m.status === 'active').length;

      document.getElementById('kpi-revenue').textContent = fmtUSD.format(revenue / 100);
      document.getElementById('kpi-orders').textContent = orderCount;
      document.getElementById('kpi-aov').textContent = fmtUSD.format(aov / 100);
      document.getElementById('kpi-members').textContent = activeMembers;

      renderRevenueChart(periodOrders, start, end);
      renderTopProducts(periodOrders, revenue);
      renderStatusBreakdown(allPeriodOrders);
      renderCustomerInsights(periodOrders, start, end);
      renderClubStats(start, end);
    }

    function renderRevenueChart(orders, start, end) {
      const container = document.getElementById('revenue-chart');
      const days = {};
      const d = new Date(start);
      while (d <= end) {
        days[d.toISOString().slice(0,10)] = 0;
        d.setDate(d.getDate() + 1);
      }
      orders.forEach(o => {
        const key = new Date(o.created_at).toISOString().slice(0,10);
        if (days[key] !== undefined) days[key] += (o.total_amount || 0) / 100;
      });

      const entries = Object.entries(days);
      const max = Math.max(...entries.map(e => e[1]), 1);

      const dense = entries.length > 14;
      container.innerHTML = `<div class="chart-bars${dense ? ' chart-bars-dense' : ''}">${entries.map(([date, val]) => {
        const pct = (val / max) * 100;
        const label = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return `<div class="chart-bar-col" title="${label}: ${fmtUSD.format(val)}">
          <div class="chart-bar-value">${val > 0 ? fmtUSD.format(val) : ''}</div>
          <div class="chart-bar" style="--bar-h:${Math.max(pct, 2)}%"></div>
          <div class="chart-bar-label">${!dense ? label : ''}</div>
        </div>`;
      }).join('')}</div>`;
    }

    function renderTopProducts(orders, totalRevenue) {
      const tbody = document.getElementById('top-products-tbody');
      const products = {};
      orders.forEach(o => {
        (o.order_items || []).forEach(i => {
          const name = i.product_name || i.stripe_product_id;
          if (!products[name]) products[name] = { qty: 0, revenue: 0 };
          products[name].qty += i.quantity;
          products[name].revenue += i.unit_amount * i.quantity;
        });
      });

      const sorted = Object.entries(products).sort((a, b) => b[1].qty - a[1].qty);
      if (!sorted.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="club-table-empty">No product data for this period.</td></tr>';
        return;
      }
      tbody.innerHTML = sorted.map(([name, d]) => {
        const pct = totalRevenue ? ((d.revenue / totalRevenue) * 100).toFixed(1) : '0.0';
        return `<tr><td>${escHtml(name)}</td><td class="num-col">${d.qty}</td><td class="num-col">${fmtUSD.format(d.revenue / 100)}</td><td class="num-col">${pct}%</td></tr>`;
      }).join('');
    }

    function renderStatusBreakdown(orders) {
      const el = document.getElementById('status-breakdown');
      const counts = { paid: 0, fulfilled: 0, picked_up: 0, cancelled: 0 };
      orders.forEach(o => { if (counts[o.status] !== undefined) counts[o.status]++; });
      el.innerHTML = Object.entries(counts).map(([status, count]) => {
        const label = status === 'picked_up' ? 'Picked Up' : status.charAt(0).toUpperCase() + status.slice(1);
        return `<div class="status-stat"><div class="status-stat-count">${count}</div><div class="status-stat-label status-color-${status}">${label}</div></div>`;
      }).join('');
    }

    function renderCustomerInsights(orders, start, end) {
      const el = document.getElementById('customer-insights');
      // Group orders by user
      const userOrders = {};
      analyticsData.orders.forEach(o => {
        if (!userOrders[o.user_id]) userOrders[o.user_id] = [];
        userOrders[o.user_id].push(o);
      });

      const periodUserIds = new Set(orders.map(o => o.user_id));
      let newCustomers = 0, repeatCustomers = 0;
      const spendByUser = {};

      periodUserIds.forEach(uid => {
        const all = userOrders[uid] || [];
        const firstOrder = all.reduce((min, o) => new Date(o.created_at) < new Date(min.created_at) ? o : min, all[0]);
        const firstDate = new Date(firstOrder.created_at);
        if (firstDate >= start && firstDate <= end) newCustomers++;
        if (all.length >= 2) repeatCustomers++;
        spendByUser[uid] = orders.filter(o => o.user_id === uid).reduce((s, o) => s + (o.total_amount || 0), 0);
      });

      const topCustomers = Object.entries(spendByUser).sort((a, b) => b[1] - a[1]).slice(0, 5);

      el.innerHTML = `
        <div class="insight-card"><div class="insight-value">${newCustomers}</div><div class="insight-label">New Customers</div></div>
        <div class="insight-card"><div class="insight-value">${repeatCustomers}</div><div class="insight-label">Repeat Customers</div></div>
        <div class="insight-card insight-card-wide">
          <div class="insight-label">Top Customers</div>
          ${topCustomers.length ? topCustomers.map(([uid, spend]) => {
            const p = analyticsData.profileMap[uid];
            const userOrders = orders.filter(o => o.user_id === uid);
            const stripeName = userOrders.find(o => o.customer_name)?.customer_name;
            const name = p ? [p.first_name, p.last_name].filter(Boolean).join(' ') || stripeName || uid.slice(0,8) : stripeName || uid.slice(0,8);
            return `<div class="top-customer-row"><span>${escHtml(name)}</span><span>${fmtUSD.format(spend / 100)}</span></div>`;
          }).join('') : '<div class="grid-message">No data</div>'}
        </div>`;
    }

    function renderClubStats(start, end) {
      const el = document.getElementById('club-stats');
      const members = analyticsData.members;
      const active = members.filter(m => m.status === 'active').length;
      const newSignups = members.filter(m => {
        const d = new Date(m.started_at);
        return d >= start && d <= end;
      }).length;
      const churned = members.filter(m => {
        if (m.status !== 'cancelled') return false;
        const d = new Date(m.updated_at || m.started_at);
        return d >= start && d <= end;
      }).length;
      const periodReferrals = analyticsData.referralUses.filter(r => {
        const d = new Date(r.created_at);
        return d >= start && d <= end;
      }).length;

      el.innerHTML = `
        <div class="insight-card"><div class="insight-value">${active}</div><div class="insight-label">Active Members</div></div>
        <div class="insight-card"><div class="insight-value">${newSignups}</div><div class="insight-label">New Signups</div></div>
        <div class="insight-card"><div class="insight-value">${churned}</div><div class="insight-label">Churned</div></div>
        <div class="insight-card"><div class="insight-value">${periodReferrals}</div><div class="insight-label">Referrals</div></div>`;
    }

    // ── Testimonials ──────────────────────────────────────────────────────
    let testimonials = [];
    let testimonialsLoaded = false;

    let pendingReviews = [];

    async function loadTestimonials() {
      const { data, error } = await sb.from('testimonials').select('*').order('sort_order');
      if (error) { showToast('Failed to load testimonials', true); return; }
      const all = data || [];
      testimonials = all.filter(t => t.status !== 'pending');
      pendingReviews = all.filter(t => t.status === 'pending');
      renderTestimonialsList();
      renderPendingReviews();
    }

    function renderTestimonialsList() {
      const list = document.getElementById('testimonials-admin-list');
      if (!list) return;
      list.textContent = '';

      if (testimonials.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = 'No testimonials yet. Add one above.';
        list.appendChild(empty);
        return;
      }

      testimonials.forEach((t, idx) => {
        const row = document.createElement('div');
        row.className = 'testimonial-admin-row';
        if (!t.visible) row.classList.add('testimonial-hidden');

        // Reorder buttons
        const controls = document.createElement('div');
        controls.className = 'testimonial-admin-controls';

        if (idx > 0) {
          const upBtn = document.createElement('button');
          upBtn.type = 'button';
          upBtn.className = 'btn-ghost btn-sm';
          upBtn.textContent = '\u2191';
          upBtn.title = 'Move up';
          upBtn.addEventListener('click', () => reorderTestimonial(idx, idx - 1));
          controls.appendChild(upBtn);
        }
        if (idx < testimonials.length - 1) {
          const downBtn = document.createElement('button');
          downBtn.type = 'button';
          downBtn.className = 'btn-ghost btn-sm';
          downBtn.textContent = '\u2193';
          downBtn.title = 'Move down';
          downBtn.addEventListener('click', () => reorderTestimonial(idx, idx + 1));
          controls.appendChild(downBtn);
        }
        row.appendChild(controls);

        // Content
        const content = document.createElement('div');
        content.className = 'testimonial-admin-content';
        const q = document.createElement('p');
        q.className = 'testimonial-admin-quote';
        q.textContent = '\u201C' + t.quote + '\u201D';
        content.appendChild(q);
        if (t.rating) {
          const stars = document.createElement('span');
          stars.className = 'testimonial-admin-stars';
          stars.textContent = '\u2605'.repeat(t.rating) + '\u2606'.repeat(5 - t.rating);
          content.appendChild(stars);
        }
        const author = document.createElement('span');
        author.className = 'testimonial-admin-author';
        author.textContent = '\u2014 ' + t.author_name + (t.author_title ? ', ' + t.author_title : '');
        content.appendChild(author);
        row.appendChild(content);

        // Actions
        const actions = document.createElement('div');
        actions.className = 'testimonial-admin-actions';

        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'btn-ghost btn-sm';
        toggleBtn.textContent = t.visible ? 'Hide' : 'Show';
        toggleBtn.addEventListener('click', () => toggleTestimonial(t.id, !t.visible));
        actions.appendChild(toggleBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'btn-ghost btn-sm btn-danger';
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', () => deleteTestimonial(t.id));
        actions.appendChild(deleteBtn);

        row.appendChild(actions);
        list.appendChild(row);
      });
    }

    function renderPendingReviews() {
      const list = document.getElementById('testimonials-pending-list');
      if (!list) return;
      list.textContent = '';

      if (pendingReviews.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = 'No pending reviews.';
        list.appendChild(empty);
        return;
      }

      pendingReviews.forEach(t => {
        const row = document.createElement('div');
        row.className = 'testimonial-admin-row testimonial-pending';

        const content = document.createElement('div');
        content.className = 'testimonial-admin-content';

        if (t.rating) {
          const stars = document.createElement('span');
          stars.className = 'testimonial-admin-stars';
          stars.textContent = '\u2605'.repeat(t.rating) + '\u2606'.repeat(5 - t.rating);
          content.appendChild(stars);
        }

        const q = document.createElement('p');
        q.className = 'testimonial-admin-quote';
        q.textContent = '\u201C' + t.quote + '\u201D';
        content.appendChild(q);

        const author = document.createElement('span');
        author.className = 'testimonial-admin-author';
        author.textContent = '\u2014 ' + t.author_name + (t.author_title ? ', ' + t.author_title : '');
        content.appendChild(author);

        row.appendChild(content);

        const actions = document.createElement('div');
        actions.className = 'testimonial-admin-actions';

        const approveBtn = document.createElement('button');
        approveBtn.type = 'button';
        approveBtn.className = 'btn-secondary btn-sm';
        approveBtn.textContent = 'Approve';
        approveBtn.addEventListener('click', () => approveReview(t.id));
        actions.appendChild(approveBtn);

        const rejectBtn = document.createElement('button');
        rejectBtn.type = 'button';
        rejectBtn.className = 'btn-ghost btn-sm btn-danger';
        rejectBtn.textContent = 'Reject';
        rejectBtn.addEventListener('click', () => rejectReview(t.id));
        actions.appendChild(rejectBtn);

        row.appendChild(actions);
        list.appendChild(row);
      });
    }

    async function approveReview(id) {
      const { error } = await sb.from('testimonials').update({
        status: 'approved',
        visible: true,
        sort_order: testimonials.length,
      }).eq('id', id);
      if (error) { showToast('Failed to approve', true); return; }
      await loadTestimonials();
      showToast('Review approved and published!');
    }

    async function rejectReview(id) {
      const { error } = await sb.from('testimonials').update({
        status: 'rejected',
        visible: false,
      }).eq('id', id);
      if (error) { showToast('Failed to reject', true); return; }
      await loadTestimonials();
      showToast('Review rejected');
    }

    async function reorderTestimonial(fromIdx, toIdx) {
      const moved = testimonials.splice(fromIdx, 1)[0];
      testimonials.splice(toIdx, 0, moved);
      const updates = testimonials.map((t, i) => ({ id: t.id, sort_order: i }));
      for (const u of updates) {
        await sb.from('testimonials').update({ sort_order: u.sort_order }).eq('id', u.id);
      }
      renderTestimonialsList();
    }

    async function toggleTestimonial(id, visible) {
      const { error } = await sb.from('testimonials').update({ visible }).eq('id', id);
      if (error) { showToast('Failed to update', true); return; }
      await loadTestimonials();
      showToast(visible ? 'Testimonial shown' : 'Testimonial hidden');
    }

    async function deleteTestimonial(id) {
      if (!confirm('Delete this testimonial?')) return;
      const { error } = await sb.from('testimonials').delete().eq('id', id);
      if (error) { showToast('Failed to delete', true); return; }
      await loadTestimonials();
      showToast('Testimonial deleted');
    }

    document.getElementById('btn-add-testimonial')?.addEventListener('click', async () => {
      const quote = document.getElementById('testimonial-quote').value.trim();
      const authorName = document.getElementById('testimonial-author').value.trim();
      const authorTitle = document.getElementById('testimonial-title').value.trim();
      const rating = parseInt(document.getElementById('testimonial-rating').value, 10);

      if (!quote || !authorName) {
        showToast('Quote and name are required', true);
        return;
      }

      const { error } = await sb.from('testimonials').insert({
        quote,
        author_name: authorName,
        author_title: authorTitle,
        rating,
        sort_order: testimonials.length,
        visible: true,
      });

      if (error) { showToast('Failed to add: ' + error.message, true); return; }

      document.getElementById('testimonial-quote').value = '';
      document.getElementById('testimonial-author').value = '';
      document.getElementById('testimonial-title').value = '';
      document.getElementById('testimonial-rating').value = '5';
      await loadTestimonials();
      showToast('Testimonial added!');
    });

    // Lazy-load testimonials on first tab click
    document.querySelector('[data-tab="testimonials"]')?.addEventListener('click', async () => {
      if (!testimonialsLoaded) { testimonialsLoaded = true; await loadTestimonials(); }
    }, { once: true });

    // ── Download Menu (opens full public menu in print mode) ─────────────
    document.getElementById('download-menu-btn')?.addEventListener('click', () => {
      window.open('menu.html?mode=print', '_blank');
    });

    // Download report
    document.getElementById('download-report-btn')?.addEventListener('click', () => {
      window.print();
    });

    // ── Boot ──────────────────────────────────────────────────────────────────
    init();
  })();
