  (() => {
    let sb = null;
    let currentUser = null;
    let isAdmin = false;
    let productId = null;
    let stripeProduct = null;
    let productDetails = null;  // { description, image_url, variations }

    async function init() {
      // Get product ID from URL
      const params = new URLSearchParams(window.location.search);
      productId = params.get('id');
      if (!productId) {
        document.getElementById('product-card').innerHTML =
          '<div class="product-body"><p class="text-muted">No product specified.</p></div>';
        return;
      }

      const r = await fetch('/api/config').catch(() => null);
      if (!r || !r.ok) return;
      const cfg = await r.json();
      if (!cfg.supabaseUrl) return;

      sb = supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);

      // Load auth state
      const { data: { session } } = await sb.auth.getSession();
      // Wire sidebar auth state
      const signinLink = document.getElementById('sidebar-signin-link');
      const acctItemEl = document.getElementById('sidebar-account-item');
      const signoutBtn = document.getElementById('sidebar-signout-btn');

      if (session) {
        currentUser = session.user;
        const { data: adminRow } = await sb.from('admins').select('user_id').eq('user_id', currentUser.id).maybeSingle();
        isAdmin = !!adminRow;

        // Sidebar: hide sign-in, show account submenu or dashboard link
        signinLink.classList.add('hidden');
        if (isAdmin) {
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
      }

      // Load Stripe products + product details in parallel
      const [stripeRes, detailsRes] = await Promise.all([
        fetch('/api/stripe/products').catch(() => null),
        sb.from('product_details').select('*').eq('stripe_product_id', productId).maybeSingle(),
      ]);

      if (stripeRes && stripeRes.ok) {
        const products = await stripeRes.json();
        stripeProduct = Array.isArray(products) ? products.find(p => p.id === productId) : null;
      }
      productDetails = detailsRes.data || null;

      renderProduct();
    }

    function getSelectedVariation() {
      const checked = document.querySelector('input[name="variation"]:checked');
      if (!checked) return { name: '', delta: 0 };
      return { name: checked.dataset.name, delta: parseInt(checked.value, 10) };
    }

    function renderProduct() {
      const card = document.getElementById('product-card');
      const name = stripeProduct ? stripeProduct.name : 'Product';
      const baseAmount = stripeProduct?.unit_amount ?? null;
      const currency = stripeProduct?.currency || 'usd';
      const price = stripeProduct ? (stripeProduct.price_formatted || '') : '';
      const description = productDetails?.description || '';
      const ingredients = productDetails?.ingredients || '';
      const imageUrl = productDetails?.image_url || stripeProduct?.images?.[0] || '';
      const variations = productDetails?.variations || [];

      const visibleVariations = variations.filter(v => v.available !== false && (v.quantity === undefined || v.quantity > 0));
      const variationSelectorHtml = visibleVariations.length > 0 ? `
        <div class="variation-selector">
          <span class="variation-selector-label">Options</span>
          <div class="variation-options" id="variation-options">
            ${visibleVariations.map((v, i) => {
              const totalCents = (baseAmount || 0) + (v.price_delta || 0);
              let label = v.price_delta
                ? `${escHtml(v.name)} &nbsp;·&nbsp; ${formatPrice(totalCents, currency)}`
                : escHtml(v.name);
              if (v.quantity > 0 && v.quantity <= 5) {
                label += ` <span class="variation-stock-note">(${v.quantity} left)</span>`;
              }
              const vIngredients = v.ingredients ? `<span class="variation-ingredients">${escHtml(v.ingredients)}</span>` : '';
              return `<label class="variation-option${i === 0 ? ' selected' : ''}">
                <input type="radio" name="variation" value="${v.price_delta || 0}" data-name="${escHtml(v.name)}" ${i === 0 ? 'checked' : ''} />
                ${label}
                ${vIngredients}
              </label>`;
            }).join('')}
          </div>
        </div>` : '';

      const adminVariationsHtml = `
        <div class="admin-field">
          <label class="admin-label">Variations <span class="admin-label-note">(optional — e.g. sizes, flavors)</span></label>
          <div id="variations-list">
            ${(productDetails?.variations || []).map(v => `
              <div class="variation-row-wrap">
                <div class="variation-row${v.available === false ? ' variation-row-unavailable' : ''}">
                  <span class="variation-drag-handle" title="Drag to reorder">
                    <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true">
                      <circle cx="3" cy="2" r="1.2"/><circle cx="7" cy="2" r="1.2"/>
                      <circle cx="3" cy="7" r="1.2"/><circle cx="7" cy="7" r="1.2"/>
                      <circle cx="3" cy="12" r="1.2"/><circle cx="7" cy="12" r="1.2"/>
                    </svg>
                  </span>
                  <input type="checkbox" class="variation-available-check" title="Visible to customers" ${v.available !== false ? 'checked' : ''} />
                  <input type="text" class="variation-name-input" placeholder="Name (e.g. Large)" value="${escHtml(v.name)}" />
                  <div class="variation-delta-wrap">
                    <span class="variation-delta-prefix">+$</span>
                    <input type="number" class="variation-delta-input" step="0.01" min="0" placeholder="0.00" value="${((v.price_delta || 0) / 100).toFixed(2)}" />
                  </div>
                  <div class="variation-qty-wrap">
                    <span class="variation-qty-label">Qty</span>
                    <input type="number" class="variation-qty-input" min="0" max="9999" placeholder="0" value="${v.quantity ?? 0}" />
                  </div>
                  <button type="button" class="btn-variation-remove" title="Remove">&times;</button>
                </div>
                <input type="text" class="variation-ingredients-input" placeholder="Ingredients for this variant…" value="${escHtml(v.ingredients || '')}" />
              </div>`).join('')}
          </div>
          <button type="button" class="btn-add-variation" id="btn-add-variation">+ Add Variation</button>
        </div>`;

      card.innerHTML = `
        <div class="product-img-wrap">
          ${imageUrl
            ? `<img src="${escHtml(imageUrl)}" class="product-img" alt="${escHtml(name)}" />`
            : `<div class="product-img-placeholder">
                <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="#4A3322" stroke-width="1">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                  <polyline points="9 22 9 12 15 12 15 22"/>
                </svg>
              </div>`
          }
        </div>
        <div class="product-body">
          <h1 class="product-name">${escHtml(name)}</h1>
          <div class="product-price" id="product-price-display">${escHtml(price)}</div>
          <div class="product-divider"></div>
          <p class="product-description" id="product-desc-display">${escHtml(description)}</p>
          <p class="product-ingredients" id="product-ingredients-display">${escHtml(ingredients)}</p>
          ${variationSelectorHtml}
          <div class="product-actions" id="product-actions">
            <button class="btn-cart" id="btn-cart">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
              Add to Cart
            </button>
            ${currentUser
              ? `<button class="btn-fav" id="btn-fav">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                  Save
                </button>`
              : ''
            }
          </div>
        </div>
        ${isAdmin ? `
        <div class="admin-edit-panel visible" id="admin-panel">
          <div class="admin-panel-heading">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Admin — Edit Product Details
          </div>
          <div class="admin-field">
            <label class="admin-label" for="edit-description">Description</label>
            <textarea class="admin-textarea" id="edit-description" placeholder="Describe this product — how it's made, serving suggestions…">${escHtml(description)}</textarea>
          </div>
          <div class="admin-field">
            <label class="admin-label" for="edit-ingredients">Ingredients</label>
            <textarea class="admin-textarea" id="edit-ingredients" placeholder="e.g. Organic flour, water, sea salt, sourdough starter…">${escHtml(productDetails?.ingredients || '')}</textarea>
          </div>
          <div class="admin-field">
            <label class="admin-label">Product Image</label>
            <div class="admin-file-wrap">
              <img src="${escHtml(imageUrl)}" class="admin-img-thumb${imageUrl ? ' visible' : ''}" id="admin-img-thumb" alt="" />
              <input type="file" class="admin-file-input" id="edit-image" accept="image/*" />
            </div>
          </div>
          ${adminVariationsHtml}
          <button class="btn-save" id="btn-save">Save Changes</button>
          <a href="menu.html" class="btn-back-to-menu">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
            Back to Menu
          </a>
        </div>` : ''}
      `;

      // Update meta tags dynamically for SEO / social sharing
      if (name && name !== 'Product') {
        const fullTitle = name + ' \u2014 Bloomin\u2019 Acres Farmstand & Bakery';
        document.title = fullTitle;
        const metaDesc = description ? description.substring(0, 160) : 'Fresh from Bloomin\u2019 Acres Farmstand & Bakery in Hope, Indiana.';
        const canonicalUrl = 'https://bloominacresmarket.com/product.html?id=' + encodeURIComponent(productId);
        const ogImage = imageUrl || 'https://bloominacresmarket.com/brand-assets/color-logo.png';
        document.querySelector('meta[name="description"]')?.setAttribute('content', metaDesc);
        document.querySelector('meta[property="og:title"]')?.setAttribute('content', fullTitle);
        document.querySelector('meta[property="og:description"]')?.setAttribute('content', metaDesc);
        document.querySelector('meta[property="og:url"]')?.setAttribute('content', canonicalUrl);
        document.querySelector('meta[property="og:image"]')?.setAttribute('content', ogImage);
        let canonical = document.querySelector('link[rel="canonical"]');
        if (!canonical) { canonical = document.createElement('link'); canonical.rel = 'canonical'; document.head.appendChild(canonical); }
        canonical.href = canonicalUrl;
      }

      // Variation pill selection
      document.querySelectorAll('.variation-option').forEach(lbl => {
        lbl.addEventListener('click', () => {
          document.querySelectorAll('.variation-option').forEach(l => l.classList.remove('selected'));
          lbl.classList.add('selected');
          const radio = lbl.querySelector('input[name="variation"]');
          if (radio && baseAmount !== null) {
            const delta = parseInt(radio.value, 10) || 0;
            document.getElementById('product-price-display').textContent = formatPrice(baseAmount + delta, currency);
          }
        });
      });

      // Wire up cart (always available)
      if (productId) {
        wireCart();
      }
      // Wire up favorites (logged-in only)
      if (currentUser && productId) {
        wireFavorite();
      }

      // Cart badge
      function updateCartBadge() {
        const count = cartCount();
        const btn = document.getElementById('floating-cart-btn');
        const badge = document.getElementById('cart-badge');
        if (btn) btn.style.display = count > 0 ? '' : 'none';
        if (badge) badge.textContent = count;
      }
      window.addEventListener('cart-updated', updateCartBadge);
      updateCartBadge();

      // Wire up admin save
      if (isAdmin) {
        wireAdminSave();
      }
    }

    async function wireFavorite() {
      const btn = document.getElementById('btn-fav');
      if (!btn) return;
      const { data } = await sb.from('user_favorites')
        .select('id').eq('user_id', currentUser.id).eq('stripe_product_id', productId).maybeSingle();
      let isFav = !!data;
      updateFavBtn(btn, isFav);

      btn.addEventListener('click', async () => {
        if (isFav) {
          await sb.from('user_favorites').delete()
            .eq('user_id', currentUser.id).eq('stripe_product_id', productId);
          isFav = false;
        } else {
          await sb.from('user_favorites').upsert({ user_id: currentUser.id, stripe_product_id: productId });
          isFav = true;
        }
        updateFavBtn(btn, isFav);
        showToast(isFav ? 'Saved to favorites' : 'Removed from favorites');
      });
    }

    function updateFavBtn(btn, isFav) {
      btn.className = 'btn-fav' + (isFav ? ' active' : '');
      btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg> ${isFav ? 'Saved' : 'Save'}`;
    }

    function wireCart() {
      const btn = document.getElementById('btn-cart');
      if (!btn) return;
      btn.addEventListener('click', async () => {
        const { name: varName, delta: varDelta } = getSelectedVariation();
        cartAdd(productId, varName, varDelta);
        // Sync to Supabase for logged-in users
        if (currentUser) {
          const { data: existing } = await sb.from('user_cart')
            .select('id, quantity')
            .eq('user_id', currentUser.id)
            .eq('stripe_product_id', productId)
            .eq('variation_name', varName)
            .maybeSingle();
          if (existing) {
            await sb.from('user_cart').update({ quantity: existing.quantity + 1 }).eq('id', existing.id);
          } else {
            await sb.from('user_cart').insert({
              user_id: currentUser.id,
              stripe_product_id: productId,
              variation_name: varName,
              variation_delta: varDelta,
              quantity: 1,
            });
          }
        }
        const label = varName ? `${stripeProduct?.name || 'Item'} (${varName})` : (stripeProduct?.name || 'Item');
        showToast(`${label} added to cart`);
      });
    }

    function wireVariationRowBehavior(row) {
      // Remove button — remove the wrap (parent) if it exists, otherwise the row
      const removeBtn = row.querySelector('.btn-variation-remove');
      if (removeBtn) removeBtn.addEventListener('click', () => {
        const wrap = row.closest('.variation-row-wrap');
        (wrap || row).remove();
      });

      // Checkbox toggle
      const checkbox = row.querySelector('.variation-available-check');
      if (checkbox) {
        checkbox.addEventListener('change', () => {
          row.classList.toggle('variation-row-unavailable', !checkbox.checked);
        });
      }

      // Drag handle — desktop HTML5 drag-and-drop (operates on wraps)
      const handle = row.querySelector('.variation-drag-handle');
      if (!handle) return;
      const wrap = row.closest('.variation-row-wrap') || row;

      handle.addEventListener('mousedown', () => { wrap.setAttribute('draggable', 'true'); });
      handle.addEventListener('mouseup', () => { wrap.removeAttribute('draggable'); });

      wrap.addEventListener('dragstart', (e) => {
        wrap.classList.add('dragging');
        row.classList.add('variation-row-dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      wrap.addEventListener('dragend', () => {
        wrap.classList.remove('dragging');
        row.classList.remove('variation-row-dragging');
        wrap.removeAttribute('draggable');
        document.querySelectorAll('#variations-list .variation-row').forEach(r => {
          r.classList.remove('drag-over-above', 'drag-over-below');
        });
      });
      wrap.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = wrap.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        row.classList.toggle('drag-over-above', e.clientY < midY);
        row.classList.toggle('drag-over-below', e.clientY >= midY);
      });
      wrap.addEventListener('dragleave', () => {
        row.classList.remove('drag-over-above', 'drag-over-below');
      });
      wrap.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('drag-over-above', 'drag-over-below');
        const list = document.getElementById('variations-list');
        const draggedWrap = list.querySelector('.variation-row-wrap.dragging');
        if (!draggedWrap || draggedWrap === wrap) return;
        const rect = wrap.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.clientY < midY) {
          list.insertBefore(draggedWrap, wrap);
        } else {
          list.insertBefore(draggedWrap, wrap.nextSibling);
        }
      });

      // Touch drag for mobile
      let touchStartY = 0;
      let touchWraps = [];
      handle.addEventListener('touchstart', (e) => {
        e.preventDefault();
        touchStartY = e.touches[0].clientY;
        wrap.classList.add('dragging');
        row.classList.add('variation-row-dragging');
        touchWraps = [...document.querySelectorAll('#variations-list .variation-row-wrap')];
      }, { passive: false });
      handle.addEventListener('touchmove', (e) => {
        e.preventDefault();
        const y = e.touches[0].clientY;
        touchWraps.forEach(w => {
          const r = w.querySelector('.variation-row');
          if (r) r.classList.remove('drag-over-above', 'drag-over-below');
          if (w === wrap) return;
          const rect = w.getBoundingClientRect();
          if (y > rect.top && y < rect.bottom) {
            const mid = rect.top + rect.height / 2;
            if (r) {
              r.classList.toggle('drag-over-above', y < mid);
              r.classList.toggle('drag-over-below', y >= mid);
            }
          }
        });
      }, { passive: false });
      handle.addEventListener('touchend', (e) => {
        e.preventDefault();
        wrap.classList.remove('dragging');
        row.classList.remove('variation-row-dragging');
        const y = e.changedTouches[0].clientY;
        const list = document.getElementById('variations-list');
        let target = null;
        let above = false;
        touchWraps.forEach(w => {
          if (w === wrap) return;
          const rect = w.getBoundingClientRect();
          if (y > rect.top && y < rect.bottom) {
            target = w;
            above = y < rect.top + rect.height / 2;
          }
          const wr = w.querySelector('.variation-row');
          if (wr) wr.classList.remove('drag-over-above', 'drag-over-below');
        });
        if (target) {
          if (above) {
            list.insertBefore(wrap, target);
          } else {
            list.insertBefore(wrap, target.nextSibling);
          }
        }
        touchWraps = [];
      }, { passive: false });
    }

    function addVariationRow(name = '', delta = '', available = true, quantity = 0, ingredients = '') {
      const wrap = document.createElement('div');
      wrap.className = 'variation-row-wrap';
      const row = document.createElement('div');
      row.className = 'variation-row' + (!available ? ' variation-row-unavailable' : '');
      row.innerHTML = `
        <span class="variation-drag-handle" title="Drag to reorder">
          <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true">
            <circle cx="3" cy="2" r="1.2"/><circle cx="7" cy="2" r="1.2"/>
            <circle cx="3" cy="7" r="1.2"/><circle cx="7" cy="7" r="1.2"/>
            <circle cx="3" cy="12" r="1.2"/><circle cx="7" cy="12" r="1.2"/>
          </svg>
        </span>
        <input type="checkbox" class="variation-available-check" title="Visible to customers" ${available ? 'checked' : ''} />
        <input type="text" class="variation-name-input" placeholder="Name (e.g. Large)" value="${escHtml(name)}" />
        <div class="variation-delta-wrap">
          <span class="variation-delta-prefix">+$</span>
          <input type="number" class="variation-delta-input" step="0.01" min="0" placeholder="0.00" value="${escHtml(String(delta))}" />
        </div>
        <div class="variation-qty-wrap">
          <span class="variation-qty-label">Qty</span>
          <input type="number" class="variation-qty-input" min="0" max="9999" placeholder="0" value="${quantity}" />
        </div>
        <button type="button" class="btn-variation-remove" title="Remove">&times;</button>`;
      wrap.appendChild(row);
      const ingredientsInput = document.createElement('input');
      ingredientsInput.type = 'text';
      ingredientsInput.className = 'variation-ingredients-input';
      ingredientsInput.placeholder = 'Ingredients for this variant…';
      ingredientsInput.value = ingredients;
      wrap.appendChild(ingredientsInput);
      wireVariationRowBehavior(row);
      document.getElementById('variations-list').appendChild(wrap);
    }

    function wireAdminSave() {
      const btn = document.getElementById('btn-save');
      const fileInput = document.getElementById('edit-image');
      const thumb = document.getElementById('admin-img-thumb');

      // Wire existing variation rows (drag, checkbox, remove)
      document.querySelectorAll('#variations-list .variation-row-wrap .variation-row').forEach(row => {
        wireVariationRowBehavior(row);
      });

      document.getElementById('btn-add-variation').addEventListener('click', () => addVariationRow());

      // Preview selected image
      fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        if (file) {
          const url = URL.createObjectURL(file);
          thumb.src = url;
          thumb.classList.add('visible');
        }
      });

      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Saving…';

        let imageUrl = productDetails?.image_url || '';
        const file = fileInput.files[0];

        if (file) {
          // Upload to Supabase Storage
          const ext = file.name.split('.').pop();
          const path = `${productId}.${ext}`;
          const { error: uploadError } = await sb.storage
            .from('product-images')
            .upload(path, file, { upsert: true, contentType: file.type });

          if (uploadError) {
            showToast('Image upload failed: ' + uploadError.message, true);
            btn.disabled = false;
            btn.textContent = 'Save Changes';
            return;
          }

          const { data: { publicUrl } } = sb.storage
            .from('product-images')
            .getPublicUrl(path);
          imageUrl = publicUrl;
        }

        const description = document.getElementById('edit-description').value.trim();
        const ingredients = document.getElementById('edit-ingredients').value.trim();

        // Collect variations
        const variations = [];
        document.querySelectorAll('#variations-list .variation-row-wrap').forEach(wrap => {
          const row = wrap.querySelector('.variation-row');
          const name = row.querySelector('.variation-name-input').value.trim();
          const deltaRaw = parseFloat(row.querySelector('.variation-delta-input').value) || 0;
          const available = row.querySelector('.variation-available-check').checked;
          const quantity = parseInt(row.querySelector('.variation-qty-input').value, 10) || 0;
          const vIngredients = wrap.querySelector('.variation-ingredients-input')?.value.trim() || '';
          if (name) variations.push({ name, price_delta: Math.round(deltaRaw * 100), available, quantity, ingredients: vIngredients });
        });

        const { error } = await sb.from('product_details').upsert(
          { stripe_product_id: productId, description, ingredients, image_url: imageUrl, variations, updated_at: new Date().toISOString() },
          { onConflict: 'stripe_product_id' }
        );

        if (error) {
          showToast('Save failed: ' + error.message, true);
        } else {
          productDetails = { description, ingredients, image_url: imageUrl, variations };
          showToast('Product updated');
          // Refresh ingredients display
          const ingredientsDisplay = document.getElementById('product-ingredients-display');
          if (ingredientsDisplay) ingredientsDisplay.textContent = ingredients;
          // Refresh the product image display
          const imgWrap = document.querySelector('.product-img-wrap');
          if (imgWrap && imageUrl) {
            imgWrap.innerHTML = `<img src="${escHtml(imageUrl)}" class="product-img" alt="${escHtml(stripeProduct?.name || '')}" />`;
          }
          const descDisplay = document.getElementById('product-desc-display');
          if (descDisplay) descDisplay.textContent = description;

          // Refresh customer-facing variation pills
          const visibleVars = variations.filter(v => v.available !== false && (v.quantity === undefined || v.quantity > 0));
          const selectorDiv = document.querySelector('.variation-selector');
          const optionsDiv = document.getElementById('variation-options');
          if (visibleVars.length > 0) {
            if (!selectorDiv) {
              // Create variation selector if it didn't exist before
              const newSelector = document.createElement('div');
              newSelector.className = 'variation-selector';
              newSelector.innerHTML = `
                <span class="variation-selector-label">Options</span>
                <div class="variation-options" id="variation-options"></div>`;
              const actionsDiv = document.getElementById('product-actions');
              if (actionsDiv) actionsDiv.parentNode.insertBefore(newSelector, actionsDiv);
            }
            const targetDiv = document.getElementById('variation-options');
            if (targetDiv) {
              const baseAmount = stripeProduct?.unit_amount ?? null;
              const currency = stripeProduct?.currency || 'usd';
              targetDiv.innerHTML = visibleVars.map((v, i) => {
                const totalCents = (baseAmount || 0) + (v.price_delta || 0);
                let label = v.price_delta
                  ? `${escHtml(v.name)} &nbsp;·&nbsp; ${formatPrice(totalCents, currency)}`
                  : escHtml(v.name);
                if (v.quantity > 0 && v.quantity <= 5) {
                  label += ` <span class="variation-stock-note">(${v.quantity} left)</span>`;
                }
                const vIng = v.ingredients ? `<span class="variation-ingredients">${escHtml(v.ingredients)}</span>` : '';
                return `<label class="variation-option${i === 0 ? ' selected' : ''}">
                  <input type="radio" name="variation" value="${v.price_delta || 0}" data-name="${escHtml(v.name)}" ${i === 0 ? 'checked' : ''} />
                  ${label}
                  ${vIng}
                </label>`;
              }).join('');
              // Re-wire pill click listeners
              targetDiv.querySelectorAll('.variation-option').forEach(lbl => {
                lbl.addEventListener('click', () => {
                  targetDiv.querySelectorAll('.variation-option').forEach(l => l.classList.remove('selected'));
                  lbl.classList.add('selected');
                });
              });
            }
            const sel = document.querySelector('.variation-selector');
            if (sel) sel.classList.remove('hidden');
          } else {
            // Hide variation selector when no variants pass the filter
            if (selectorDiv) selectorDiv.classList.add('hidden');
          }
        }

        btn.disabled = false;
        btn.textContent = 'Save Changes';
      });
    }

    init();
  })();
