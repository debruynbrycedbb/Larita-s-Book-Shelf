/* Larita's Book Shelf — talking to Supabase.
 *
 * Every visitor gets an anonymous Supabase session first; signing in with a
 * username and password links that session to a shelf (see supabase/setup.sql).
 */
(function () {
  'use strict';

  const cfg = window.SHELF_CONFIG;
  const client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'larita-shelf-auth' }
  });

  const COLS = 'id,title,author,year,pages,genre,description,cover_url,cover_data,cover_aspect,spine_color,isbn,source,created_at';

  // Friendly messages for problems people can act on.
  function explain(error) {
    const msg = String((error && (error.message || error.error_description)) || error || '');
    if (/anonymous sign-ins are disabled/i.test(msg)) {
      return 'Sign-in isn’t switched on yet: anonymous sign-ins need to be enabled in Supabase.';
    }
    if (/could not find the function|schema cache|relation .* does not exist|PGRST20/i.test(msg)) {
      return 'The database isn’t set up yet: run supabase/setup.sql in Supabase.';
    }
    if (/failed to fetch|network/i.test(msg)) return 'Can’t reach the server. Check your connection and try again.';
    if (/rate limit/i.test(msg)) return 'Too many attempts from this connection. Wait a little and try again.';
    return 'Something went wrong. Please try again.';
  }

  function fail(error) {
    console.error(error);
    const e = new Error(explain(error));
    e.cause = error;
    throw e;
  }

  async function ensureSession() {
    const { data } = await client.auth.getSession();
    if (data.session) return data.session;
    const res = await client.auth.signInAnonymously();
    if (res.error) fail(res.error);
    return res.data.session;
  }

  async function rpc(name, args) {
    await ensureSession();
    let res = await client.rpc(name, args);
    if (!res.error && res.data === 'no_session') {
      // The stored session was stale; start a fresh one and retry once.
      await client.auth.signOut().catch(() => {});
      await ensureSession();
      res = await client.rpc(name, args);
    }
    if (res.error) fail(res.error);
    return res.data;
  }

  const DB = {
    async whoami() {
      const { data } = await client.auth.getSession();
      if (!data.session) return null;
      const res = await client.rpc('whoami');
      if (res.error) {
        // An expired or deleted anonymous user: treat as signed out.
        if (/JWT|token|401|403/i.test(res.error.message || '') || res.status === 401) return null;
        fail(res.error);
      }
      return (res.data && res.data[0]) || null;
    },

    signIn: (username, password) => rpc('sign_in', { p_username: username, p_password: password }),

    signUp: (username, displayName, password) =>
      rpc('sign_up', { p_username: username, p_display_name: displayName, p_password: password }),

    async signOut() {
      try { await client.rpc('sign_out'); } catch (_) { /* signing out anyway */ }
      await client.auth.signOut().catch(() => {});
    },

    async listBooks() {
      const res = await client.from('books').select(COLS).order('created_at', { ascending: true });
      if (res.error) fail(res.error);
      return res.data;
    },

    async addBook(book) {
      const res = await client.from('books').insert(book).select(COLS).single();
      if (res.error) fail(res.error);
      return res.data;
    },

    async updateBook(id, patch) {
      const res = await client.from('books').update(patch).eq('id', id).select(COLS).single();
      if (res.error) fail(res.error);
      return res.data;
    },

    async removeBook(id) {
      const res = await client.from('books').delete().eq('id', id);
      if (res.error) fail(res.error);
    }
  };

  window.DB = DB;
})();
