(async () => {
  // ── Referral code from URL ─────────────────────────────────────────────────
  const params = new URLSearchParams(window.location.search);
  const urlRef = params.get('ref');
  if (urlRef) {
    sessionStorage.setItem('referral_code', urlRef.trim().toUpperCase());
    document.getElementById('referral-banner').classList.remove('hidden');
  }

  // ── Load config + auth ─────────────────────────────────────────────────────
  const r = await fetch('/api/config').catch(() => null);
  if (!r || !r.ok) return;
  const cfg = await r.json();
  if (!cfg.supabaseUrl) return;

  const sb = supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  const { data: { session } } = await sb.auth.getSession();

  const signinLink = document.getElementById('sidebar-signin-link');
  const acctItem   = document.getElementById('sidebar-account-item');
  const signoutBtn = document.getElementById('sidebar-signout-btn');

  let currentUser = null;
  let isMember = false;
  let myReferralCode = null;

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
    signoutBtn.classList.remove('hidden');
    signoutBtn.addEventListener('click', async () => {
      await sb.auth.signOut();
      window.location.reload();
    });

    // Load membership status
    const [{ data: member }, { data: codeRow }] = await Promise.all([
      sb.from('club_members').select('status').eq('user_id', currentUser.id).maybeSingle(),
      sb.from('referral_codes').select('code').eq('user_id', currentUser.id).maybeSingle(),
    ]);

    isMember = (member?.status === 'active') || (member?.status === 'past_due') || !!adminRow;
    myReferralCode = codeRow?.code || null;

    // If member, show "Go to My Club" instead of join
    if (isMember) {
      document.getElementById('join-btn').classList.add('hidden');
      document.getElementById('member-link').classList.remove('hidden');
      document.getElementById('join-btn-2').classList.add('hidden');
      document.getElementById('join-btn-3').classList.add('hidden');
      document.getElementById('referral-cta').classList.add('hidden');
    }
    // Reveal hero actions now that auth state is resolved
    document.getElementById('hero-actions').classList.remove('visibility-hidden');

    // Show referral code if available
    if (myReferralCode) {
      const shareUrl = `${window.location.origin}/club.html?ref=${myReferralCode}`;
      document.getElementById('my-code-display').value = shareUrl;
      document.getElementById('my-code-box').classList.remove('hidden');
      document.getElementById('referral-cta').classList.add('hidden');
    }

    // Note on hero if ref code in session
    const storedRef = sessionStorage.getItem('referral_code');
    if (storedRef && !isMember) {
      const note = document.getElementById('referral-code-note');
      note.textContent = `Referral code "${storedRef}" will be applied at signup.`;
      note.classList.remove('hidden');
    }
  } else {
    // Not logged in — show join button immediately
    document.getElementById('hero-actions').classList.remove('visibility-hidden');
  }

  // ── Load reward text from site_content ─────────────────────────────────────
  const { data: rewards } = await sb.from('site_content')
    .select('key, value')
    .in('key', ['referral-reward-5', 'referral-reward-15', 'referral-reward-25']);
  if (rewards) {
    for (const row of rewards) {
      const elId = row.key === 'referral-reward-5' ? 'reward-5'
                 : row.key === 'referral-reward-15' ? 'reward-15'
                 : 'reward-25';
      const el = document.getElementById(elId);
      if (el && row.value) el.textContent = row.value;
    }
  }

  // ── Join CTA ───────────────────────────────────────────────────────────────
  async function handleJoin() {
    if (!currentUser) {
      // Store intent and redirect to account for login
      sessionStorage.setItem('club_join_intent', '1');
      window.location.href = 'account.html?tab=club';
      return;
    }
    if (isMember) {
      window.location.href = 'account.html?tab=club';
      return;
    }
    // Start Stripe subscription checkout
    const btn = document.getElementById('join-btn') || document.getElementById('join-btn-2') || document.getElementById('join-btn-3');
    const referralCode = sessionStorage.getItem('referral_code') || '';
    const origText = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = 'Redirecting…'; }

    const res = await fetch('/api/stripe/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: currentUser.id, referral_code: referralCode }),
    }).catch(() => null);

    if (!res || !res.ok) {
      if (btn) { btn.disabled = false; btn.textContent = origText; }
      showToast('Something went wrong. Please try again.', true);
      return;
    }
    const { url, error } = await res.json();
    if (error || !url) {
      if (btn) { btn.disabled = false; btn.textContent = origText; }
      showToast(error || 'Checkout failed', true);
      return;
    }
    window.location.href = url;
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
