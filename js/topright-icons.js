/**
 * topright-icons.js
 * Injects cart + account icons (top-right) on public pages.
 * All innerHTML usage is static SVG markup only -- no user data.
 * Requires: Supabase JS loaded, /api/config endpoint, css/global.css .topright-* styles.
 */
(async () => {
  // ── Build SVG helper (static markup only, never user data) ──
  function svgIcon(size, paths) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    // paths is static SVG content defined in this file
    const g = document.createElementNS(ns, 'g');
    g.innerHTML = paths;
    while (g.firstChild) svg.appendChild(g.firstChild);
    return svg;
  }

  const CART_SVG = '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>';
  const PERSON_SVG = '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>';
  const SIGNOUT_SVG = '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>';

  // ── Inject HTML ──────────────────────────────────────────
  const container = document.createElement('div');
  container.className = 'topright-icons';
  container.id = 'topright-icons';

  // Basket icon
  const cartLink = document.createElement('a');
  cartLink.href = 'account.html?tab=cart';
  cartLink.className = 'topright-icon';
  cartLink.setAttribute('aria-label', 'Basket');
  const basketImg = document.createElement('img');
  basketImg.src = 'brand-assets/basket-icon.png';
  basketImg.alt = '';
  basketImg.width = 20;
  basketImg.height = 20;
  basketImg.setAttribute('aria-hidden', 'true');
  cartLink.appendChild(basketImg);
  const cartBadge = document.createElement('span');
  cartBadge.className = 'topright-badge hidden';
  cartBadge.id = 'topright-cart-badge';
  cartBadge.textContent = '0';
  cartLink.appendChild(cartBadge);

  // Sign-in link (shown when logged out)
  const signinLink = document.createElement('a');
  signinLink.href = 'account.html';
  signinLink.className = 'topright-signin';
  signinLink.id = 'topright-signin';
  signinLink.setAttribute('aria-label', 'Sign in');
  signinLink.appendChild(svgIcon(18, PERSON_SVG));

  // Account wrap (shown when logged in)
  const accountWrap = document.createElement('div');
  accountWrap.className = 'topright-account-wrap hidden';
  accountWrap.id = 'topright-account-wrap';

  const accountBtn = document.createElement('button');
  accountBtn.type = 'button';
  accountBtn.className = 'topright-account-btn';
  accountBtn.id = 'topright-account-btn';
  accountBtn.setAttribute('aria-haspopup', 'true');
  accountBtn.setAttribute('aria-expanded', 'false');
  accountBtn.setAttribute('aria-label', 'Account menu');
  const avatar = document.createElement('span');
  avatar.className = 'topright-avatar';
  avatar.id = 'topright-avatar';
  avatar.textContent = '?';
  accountBtn.appendChild(avatar);

  // Dropdown menu
  const menu = document.createElement('div');
  menu.className = 'topright-account-menu';
  menu.id = 'topright-account-menu';
  menu.setAttribute('role', 'menu');

  const menuDefs = [
    { href: 'account.html?tab=cart', img: 'brand-assets/basket-icon.png', label: 'Basket' },
    { href: 'account.html?tab=favorites', svg: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>', label: 'Favorites' },
    { href: 'account.html?tab=orders', svg: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>', label: 'Orders' },
    { href: 'account.html?tab=profile', svg: PERSON_SVG, label: 'Profile' },
    { href: 'account.html?tab=club', svg: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>', label: 'Club' },
  ];

  menuDefs.forEach(item => {
    const a = document.createElement('a');
    a.href = item.href;
    a.setAttribute('role', 'menuitem');
    if (item.img) {
      const img = document.createElement('img');
      img.src = item.img;
      img.alt = '';
      img.width = 15;
      img.height = 15;
      img.setAttribute('aria-hidden', 'true');
      a.appendChild(img);
    } else {
      a.appendChild(svgIcon(15, item.svg));
    }
    a.appendChild(document.createTextNode(' ' + item.label));
    menu.appendChild(a);
  });

  const divider = document.createElement('div');
  divider.className = 'topright-menu-divider';
  menu.appendChild(divider);

  const signoutBtn = document.createElement('button');
  signoutBtn.type = 'button';
  signoutBtn.className = 'topright-menu-signout';
  signoutBtn.id = 'topright-signout-btn';
  signoutBtn.setAttribute('role', 'menuitem');
  signoutBtn.appendChild(svgIcon(15, SIGNOUT_SVG));
  signoutBtn.appendChild(document.createTextNode(' Sign Out'));
  menu.appendChild(signoutBtn);

  accountWrap.append(accountBtn, menu);
  container.append(cartLink, signinLink, accountWrap);

  // Insert into page after nav-overlay
  const overlay = document.getElementById('nav-overlay');
  if (overlay && overlay.parentNode) {
    overlay.parentNode.insertBefore(container, overlay.nextSibling);
  } else {
    document.body.prepend(container);
  }

  // ── Wire up with Supabase auth ──────────────────────────
  try {
    const r = await fetch('/api/config').catch(() => null);
    if (!r || !r.ok) return;
    const cfg = await r.json();
    if (!cfg.supabaseUrl || !window.supabase) return;
    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    const { data: { session } } = await sb.auth.getSession();

    if (session) {
      signinLink.classList.add('hidden');
      accountWrap.classList.remove('hidden');

      const { data: profile } = await sb.from('profiles').select('first_name').eq('user_id', session.user.id).maybeSingle();
      avatar.textContent = (profile?.first_name || session.user.email || 'U')[0].toUpperCase();

      accountBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = menu.classList.toggle('open');
        accountBtn.setAttribute('aria-expanded', String(open));
      });
      document.addEventListener('click', () => {
        menu.classList.remove('open');
        accountBtn.setAttribute('aria-expanded', 'false');
      });
      menu.addEventListener('click', (e) => e.stopPropagation());

      signoutBtn.addEventListener('click', async () => {
        await sb.auth.signOut();
        window.location.reload();
      });

      // Cart badge
      const { data: cartData } = await sb.from('user_cart').select('quantity').eq('user_id', session.user.id);
      const count = (cartData || []).reduce((s, i) => s + i.quantity, 0);
      if (count) {
        cartBadge.textContent = String(count);
        cartBadge.classList.remove('hidden');
      }
    }
  } catch (e) {
    // Silently fail -- icons still visible in logged-out state
  }
})();
