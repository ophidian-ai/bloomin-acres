(async () => {
  // Fallback wording, used only when Christina hasn't saved her own text in
  // Admin → Club. The cells render empty until the saved text has loaded, so
  // the first thing a visitor sees is always the saved wording.
  const DEFAULT_REWARD_TEXT = {
    'referral-reward-1': '2% bonus discount — stacked on your 5% for 30 days',
    'referral-reward-3': 'Free item credit — added to your account, no expiry',
    'referral-reward-5': '10% off one order — promo code emailed, valid 90 days',
  };
  const MEMBER_STATUSES = ['active', 'past_due'];

  // ── Referral code from URL ─────────────────────────────────────────────────
  const params = new URLSearchParams(window.location.search);
  const urlRef = params.get('ref');
  if (urlRef) {
    sessionStorage.setItem('referral_code', urlRef.trim().toUpperCase());
    document.getElementById('referral-banner').classList.remove('hidden');
  }

  function fillRewardText(saved) {
    for (const [key, fallback] of Object.entries(DEFAULT_REWARD_TEXT)) {
      const el = document.getElementById(key.replace('referral-', ''));
      if (!el) continue;
      el.textContent = saved[key] || fallback;
      el.classList.remove('is-loading');
      el.removeAttribute('aria-busy');
    }
  }

  // ── Load shared client + auth ──────────────────────────────────────────────
  const sb = await getSupabase();
  if (!sb) {
    fillRewardText({});
    document.getElementById('hero-actions').classList.remove('visibility-hidden');
    return;
  }

  // Public content: saved reward text + the named delivery locations
  const [{ data: rewards }, { data: locs }] = await Promise.all([
    sb.from('site_content').select('key, value').in('key', Object.keys(DEFAULT_REWARD_TEXT)),
    sb.from('pickup_locations').select('name').eq('active', true).order('sort_order'),
  ]);
  fillRewardText(Object.fromEntries((rewards || []).map(r => [r.key, r.value])));

  const locationNames = (locs || []).map(l => l.name).filter(Boolean);
  if (locationNames.length) {
    // Names can contain commas ("Rural King, Columbus") — separate with semicolons then
    const sep = locationNames.some(n => n.includes(',')) ? ';' : ',';
    const list = locationNames.length === 1 ? locationNames[0]
      : `${locationNames.slice(0, -1).join(sep + ' ')}${locationNames.length > 2 ? sep : ''} or ${locationNames[locationNames.length - 1]}`;
    document.getElementById('club-delivery-locations').textContent = list;
  }

  const { data: { session } } = await sb.auth.getSession();

  const signinLink = document.getElementById('sidebar-signin-link');
  const acctItem   = document.getElementById('sidebar-account-item');
  const signoutBtn = document.getElementById('sidebar-signout-btn');

  let currentUser = null;
  let isMember = false;

  if (session) {
    currentUser = session.user;
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
    if (signoutBtn) {
      signoutBtn.classList.remove('hidden');
      signoutBtn.addEventListener('click', async () => {
        await sb.auth.signOut();
        window.location.reload();
      });
    }

    const [{ data: member }, { data: codeRow }] = await Promise.all([
      sb.from('club_members').select('status').eq('user_id', currentUser.id).maybeSingle(),
      sb.from('referral_codes').select('code').eq('user_id', currentUser.id).maybeSingle(),
    ]);

    isMember = MEMBER_STATUSES.includes(member?.status) || !!adminRow;

    if (isMember) {
      document.getElementById('join-btn').classList.add('hidden');
      document.getElementById('member-link').classList.remove('hidden');
      document.getElementById('join-btn-2').classList.add('hidden');
      document.getElementById('join-btn-3').classList.add('hidden');
      document.getElementById('referral-cta').classList.add('hidden');

      // Referral links belong to members only — rewards start when a friend subscribes
      if (codeRow?.code) {
        document.getElementById('my-code-display').value = `${window.location.origin}/club.html?ref=${codeRow.code}`;
        document.getElementById('my-code-box').classList.remove('hidden');
      }
    }

    const storedRef = sessionStorage.getItem('referral_code');
    if (storedRef && !isMember) {
      const note = document.getElementById('referral-code-note');
      note.textContent = `Referral code "${storedRef}" will be applied when you join.`;
      note.classList.remove('hidden');
    }
  }
  // Reveal hero actions now that auth state is resolved
  document.getElementById('hero-actions').classList.remove('visibility-hidden');

  // ── Join CTA ───────────────────────────────────────────────────────────────
  async function handleJoin(e) {
    if (!currentUser) {
      // Sign in / create an account first; account.html continues to checkout
      sessionStorage.setItem('club_join_intent', '1');
      window.location.href = 'account.html?tab=club&join=1';
      return;
    }
    if (isMember) {
      window.location.href = 'account.html?tab=club';
      return;
    }

    const btn = e.currentTarget;
    const origText = btn.textContent;
    btn.disabled = true; btn.textContent = 'Redirecting…';

    const { data: { session: s } } = await sb.auth.getSession();
    const res = await fetch('/api/stripe/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s?.access_token || ''}` },
      body: JSON.stringify({ referral_code: sessionStorage.getItem('referral_code') || '' }),
    }).catch(() => null);

    let body = {};
    try { body = res ? await res.json() : {}; } catch {}
    if (!res || !res.ok || !body.url) {
      btn.disabled = false; btn.textContent = origText;
      showToast(body.error || 'Something went wrong. Please try again.', true);
      console.error('Subscribe error:', body.error || res?.status);
      if (res?.status === 409) window.location.href = 'account.html?tab=club';
      return;
    }
    window.location.href = body.url;
  }

  ['join-btn', 'join-btn-2', 'join-btn-3'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', handleJoin);
  });

  // ── Copy link ──────────────────────────────────────────────────────────────
  document.getElementById('copy-link-btn')?.addEventListener('click', () => {
    const input = document.getElementById('my-code-display');
    navigator.clipboard.writeText(input.value).then(() => {
      showToast('Link copied!');
    }).catch(() => {
      input.select();
      document.execCommand('copy');
      showToast('Link copied!');
    });
  });

})();
