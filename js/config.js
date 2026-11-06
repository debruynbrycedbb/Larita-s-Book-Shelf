// Larita's Book Shelf — connection settings.
// The publishable key is meant to be public: what each visitor can read or
// change is enforced by the rules in supabase/setup.sql, not by hiding this key.
// Never put a secret key (sb_secret_…) in this file.
window.SHELF_CONFIG = {
  supabaseUrl: 'https://bzrdbrxoewzvtuutdhnn.supabase.co',
  supabaseKey: 'sb_publishable_JoFtSTA1pJqeQZ58axaIiA_NVL5A5A0',
  // Google Books key — restricted in Google Cloud to this site's address and
  // to the Books API, so it is safe to be public.
  googleBooksKey: 'AIzaSyDYOqLUHIEmkyv_KOyaElDby75MU0fM_R4',
  version: 3
};
