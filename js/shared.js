/**
 * shared.js -- Common functionality across all Bloomin' Acres pages.
 * - Navigation sidebar toggle
 * - Pageshow handler (re-enable buttons after back/forward cache)
 */

// Navigation sidebar toggle
(() => {
  const toggle  = document.getElementById('nav-toggle');
  const sidebar = document.getElementById('nav-sidebar');
  const overlay = document.getElementById('nav-overlay');
  if (!toggle || !sidebar || !overlay) return;

  function openNav() {
    sidebar.classList.add('open');
    overlay.classList.add('open');
    toggle.classList.add('open');
    toggle.setAttribute('aria-expanded', 'true');
  }
  function closeNav() {
    sidebar.classList.remove('open');
    overlay.classList.remove('open');
    toggle.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
  }

  toggle.addEventListener('click', () => sidebar.classList.contains('open') ? closeNav() : openNav());
  overlay.addEventListener('click', closeNav);

  sidebar.querySelectorAll('.nav-sidebar-link').forEach(link => {
    link.addEventListener('click', closeNav);
  });

  // My Account submenu toggle (not present on admin page)
  // Some pages use 'sidebar-account-*', menu.html uses 'menu-sidebar-account-*'
  const acctToggle = document.getElementById('sidebar-account-toggle') || document.getElementById('menu-sidebar-account-toggle');
  const acctItem   = document.getElementById('sidebar-account-item')   || document.getElementById('menu-sidebar-account-item');
  if (acctToggle && acctItem) {
    acctToggle.addEventListener('click', () => {
      const open = acctItem.classList.toggle('open');
      acctToggle.setAttribute('aria-expanded', open);
    });
  }

  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeNav(); });
})();

// Pageshow: re-enable buttons after back/forward cache
window.addEventListener('pageshow', function(e) {
  if (!e.persisted) return;

  // Cart checkout button (account.html)
  const ckBtn = document.getElementById('checkout-btn');
  if (ckBtn) { ckBtn.disabled = false; ckBtn.textContent = 'Checkout'; }

  // Club join button (account.html)
  const clubBtn = document.getElementById('join-club-btn');
  if (clubBtn) { clubBtn.disabled = false; clubBtn.textContent = 'Join the Club'; }

  // Club join buttons (club.html)
  var joinTexts = { 'join-btn': 'Join the Club', 'join-btn-2': 'Join the Club', 'join-btn-3': 'Join to Get Your Code' };
  Object.keys(joinTexts).forEach(function(id) {
    var btn = document.getElementById(id);
    if (btn) { btn.disabled = false; btn.textContent = joinTexts[id]; }
  });
});
