(async () => {
  const r = await fetch('/api/config').catch(() => null);
  if (!r || !r.ok) return;
  const cfg = await r.json();
  if (!cfg.supabaseUrl) return;
  const sb = supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  const { data: { session } } = await sb.auth.getSession();
  const signinLink  = document.getElementById('sidebar-signin-link');
  const acctItem    = document.getElementById('sidebar-account-item');
  const signoutBtn  = document.getElementById('sidebar-signout-btn');
  if (session) {
    const { data: adminRow } = await sb.from('admins').select('user_id').eq('user_id', session.user.id).maybeSingle();
    signinLink.classList.add('hidden');
    if (adminRow) {
      const dashLink = document.createElement('a');
      dashLink.href = 'admin.html';
      dashLink.className = 'nav-sidebar-link';
      dashLink.textContent = 'Dashboard';
      acctItem.parentNode.insertBefore(dashLink, acctItem);
    } else {
      acctItem.classList.remove('hidden');
    }
    signoutBtn.classList.remove('hidden');
    signoutBtn.addEventListener('click', async () => {
      await sb.auth.signOut();
      window.location.reload();
    });
  }

  // Load all editable landing page content
  const { data: lpContent } = await sb.from('site_content').select('key, value');
  const imgKeys = {
    'landing-hero':   'landing-hero-img',
    'landing-card-1': 'landing-card-img-1',
    'landing-card-2': 'landing-card-img-2',
    'landing-card-3': 'landing-card-img-3',
    'landing-map':    'landing-map-img',
  };
  const textKeys = {
    'lp-welcome-heading': { id: 'lp-welcome-heading', html: true },
    'lp-welcome-body':    { id: 'lp-welcome-body' },
    'lp-card1-title':     { id: 'lp-card1-title' },
    'lp-card1-desc':      { id: 'lp-card1-desc' },
    'lp-card2-title':     { id: 'lp-card2-title' },
    'lp-card2-desc':      { id: 'lp-card2-desc' },
    'lp-card3-title':     { id: 'lp-card3-title' },
    'lp-card3-desc':      { id: 'lp-card3-desc' },
    'lp-hours-tues':      { id: 'lp-hours-tues' },
    'lp-hours-fri':       { id: 'lp-hours-fri' },
    'lp-hours-sat':       { id: 'lp-hours-sat', html: true },
    'lp-address':         { id: 'lp-address', html: true, map: true },
    'lp-email':           { id: 'lp-email', email: true },
    'lp-phone':           { id: 'lp-phone', phone: true },
  };
  (lpContent || []).forEach(({ key, value }) => {
    if (!value) return;
    if (imgKeys[key]) {
      const el = document.getElementById(imgKeys[key]);
      if (el) el.src = value;
    } else if (textKeys[key]) {
      const cfg = textKeys[key];
      const el = document.getElementById(cfg.id);
      if (!el) return;
      if (cfg.html)   el.innerHTML = value;
      else if (cfg.email) { el.textContent = value; el.href = `mailto:${value}`; }
      else if (cfg.phone) { el.textContent = value; el.href = `tel:${value.replace(/\D/g,'')}`; }
      else el.textContent = value;
      // Update map iframe when address changes
      if (cfg.map) {
        const mapFrame = document.getElementById('landing-map-iframe');
        if (mapFrame) mapFrame.src = `https://maps.google.com/maps?q=${encodeURIComponent(value)}&output=embed`;
      }
    }
  });
})();

document.addEventListener('DOMContentLoaded', () => {
  const observer = new IntersectionObserver(
    (entries) => entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('visible');
        observer.unobserve(e.target);
      }
    }),
    { threshold: 0.1 }
  );
  document.querySelectorAll('.animate-fade-up').forEach(el => observer.observe(el));
});
