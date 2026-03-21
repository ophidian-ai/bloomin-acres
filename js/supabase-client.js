/**
 * supabase-client.js -- Shared Supabase client singleton.
 * Fetches config from /api/config once and creates a single client instance.
 * All page scripts should use window.getSupabase() instead of creating their own client.
 *
 * Load this script BEFORE any page-specific scripts:
 *   <script src="/js/supabase-client.js"></script>
 */

(function () {
  var _clientPromise = null;

  window.getSupabase = function () {
    if (!_clientPromise) {
      _clientPromise = _init();
    }
    return _clientPromise;
  };

  async function _init() {
    try {
      var r = await fetch('/api/config');
      if (!r.ok) return null;
      var cfg = await r.json();
      if (!cfg.supabaseUrl || !window.supabase) return null;
      return window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    } catch (e) {
      return null;
    }
  }
})();
