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

  const COLS = 'id,profile_id,title,title_en,author,year,pages,genre,description,cover_url,cover_data,cover_aspect,spine_color,isbn,source,list,rating,review,created_at';

  // Friendly messages for problems people can act on.
  function explain(error) {
    const msg = String((error && (error.message || error.error_description)) || error || '');
    if (/anonymous sign-ins are disabled/i.test(msg)) {
      return 'L’entrada encara no està activada: cal permetre els inicis de sessió anònims a Supabase.';
    }
    if (/could not find the function|schema cache|relation .* does not exist|column .* does not exist|PGRST20/i.test(msg)) {
      return 'La base de dades no està al dia: cal executar supabase/setup.sql a Supabase.';
    }
    if (/failed to fetch|network/i.test(msg)) return 'No es pot connectar amb el servidor. Comprova la connexió i torna-ho a provar.';
    if (/rate limit/i.test(msg)) return 'Massa intents des d’aquesta connexió. Espera una mica i torna-ho a provar.';
    return 'Alguna cosa no ha funcionat. Torna-ho a provar.';
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

    signUp: (username, password) => rpc('sign_up', { p_username: username, p_password: password }),

    async signOut() {
      try { await client.rpc('sign_out'); } catch (_) { /* signing out anyway */ }
      await client.auth.signOut().catch(() => {});
    },

    async listBooks(profileId) {
      const res = await client.from('books').select(COLS).eq('profile_id', profileId).order('created_at', { ascending: true });
      if (res.error) fail(res.error);
      return res.data;
    },

    async getBook(id) {
      const res = await client.from('books').select(COLS).eq('id', id).maybeSingle();
      if (res.error) fail(res.error);
      return res.data;
    },

    async listShelves() {
      const res = await client.rpc('list_shelves');
      if (res.error) fail(res.error);
      return res.data || [];
    },

    async listQuotes(bookId) {
      const res = await client.from('quotes').select('id,book_id,body,page,created_at').eq('book_id', bookId).order('created_at');
      if (res.error) fail(res.error);
      return res.data;
    },

    async addQuote(bookId, body, page) {
      const res = await client.from('quotes').insert({ book_id: bookId, body, page: page || null }).select('id,book_id,body,page,created_at').single();
      if (res.error) fail(res.error);
      return res.data;
    },

    async removeQuote(id) {
      const res = await client.from('quotes').delete().eq('id', id);
      if (res.error) fail(res.error);
    },

    async listComments(bookId) {
      const res = await client.from('comments')
        .select('id,book_id,author_id,body,created_at,author:profiles(display_name)')
        .eq('book_id', bookId).order('created_at');
      if (res.error) fail(res.error);
      return res.data;
    },

    async addComment(bookId, body) {
      const res = await client.from('comments').insert({ book_id: bookId, body })
        .select('id,book_id,author_id,body,created_at,author:profiles(display_name)').single();
      if (res.error) fail(res.error);
      return res.data;
    },

    async removeComment(id) {
      const res = await client.from('comments').delete().eq('id', id);
      if (res.error) fail(res.error);
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
