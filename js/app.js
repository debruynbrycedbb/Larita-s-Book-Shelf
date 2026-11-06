/* Larita's Book Shelf — pages and flow.
 *
 * Routes (in the address after #):
 *   #/              the shelf
 *   #/book/<id>     one book
 *   #/add           add a book
 *   #/edit/<id>     edit a book
 *   #/signin        sign in or create a shelf
 */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const app = $('app');
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const state = {
    me: null,
    books: [],       // sorted
    decade: 'all',
    shelf: null,
    view: 'loading',
    draft: null,     // book being added / edited
    editingId: null,
    searchSeq: 0
  };

  // ---------------------------------------------------------------- utils

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // Shelf order: by year published, then title. Books without a year go last.
  function sortBooks(list) {
    return list.slice().sort((a, b) => {
      const ay = a.year ?? 99999, by = b.year ?? 99999;
      if (ay !== by) return ay - by;
      return String(a.title).localeCompare(String(b.title));
    });
  }

  function decadeOf(b) { return b.year != null ? Math.floor(b.year / 10) * 10 : null; }

  function visibleBooks() {
    if (state.decade === 'all') return state.books;
    return state.books.filter(b => decadeOf(b) === state.decade);
  }

  function possessive(name) { return /s$/i.test(name) ? `${name}’` : `${name}’s`; }

  function metaLine(b) {
    const parts = [];
    if (b.year != null) parts.push(b.year);
    if (b.genre) parts.push(b.genre);
    if (b.pages) parts.push(`${b.pages} pages`);
    return parts.join(' / ');
  }

  // ---------------------------------------------------------------- views

  function show(name) {
    state.view = name;
    app.dataset.view = name;
    for (const v of document.querySelectorAll('.view')) v.hidden = v.dataset.name !== name;
    const signedIn = !!state.me;
    $('back').hidden = !(name === 'book' || name === 'edit');
    $('add-link').hidden = !(signedIn && name === 'shelf');
    $('foot-right').hidden = !signedIn;
  }

  function setHeader() {
    $('brand-sub').textContent = state.me ? `${possessive(state.me.display_name)} shelf` : '';
    $('foot-user').textContent = state.me ? state.me.display_name : '';
    const n = state.books.length;
    const years = state.books.map(b => b.year).filter(y => y != null);
    let left = 'Larita’s Book Shelf';
    if (state.me) {
      left = n === 1 ? '1 book' : `${n} books`;
      if (years.length > 1) left += ` · ${Math.min(...years)}–${Math.max(...years)}`;
    }
    $('foot-left').textContent = left;
  }

  // ---------------------------------------------------------------- shelf

  function renderFilters() {
    const box = $('filters');
    const decades = [...new Set(state.books.map(decadeOf).filter(d => d != null))].sort((a, b) => a - b);
    box.innerHTML = '';
    if (decades.length < 2) { box.hidden = true; state.decade = 'all'; return; }
    box.hidden = false;
    if (state.decade !== 'all' && !decades.includes(state.decade)) state.decade = 'all';
    const add = (value, label) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.setAttribute('aria-pressed', String(state.decade === value));
      b.addEventListener('click', () => {
        if (state.decade === value) return;
        state.decade = value;
        renderFilters();
        fillShelf();
      });
      box.appendChild(b);
    };
    add('all', 'All');
    for (const d of decades) add(d, d < 0 ? `${d}` : `${d}s`);
  }

  function fillShelf(focusId) {
    const list = visibleBooks();
    $('empty').hidden = list.length > 0;
    $('prev').hidden = $('next').hidden = list.length < 2;
    $('caption').hidden = !list.length;
    state.shelf.setBooks(list, focusId);
    const ol = $('book-list');
    ol.innerHTML = '';
    for (const b of list) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = `#/book/${b.id}`;
      a.textContent = [b.title, b.author && `by ${b.author}`, b.year].filter(Boolean).join(', ');
      li.appendChild(a);
      ol.appendChild(li);
    }
  }

  let capTween = null;
  function onFocus(book, i, n) {
    $('live').textContent = `${book.title}${book.author ? ', ' + book.author : ''}. ${i + 1} of ${n}.`;
    const cap = $('caption');
    const write = () => {
      $('cap-title').textContent = book.title;
      $('cap-author').textContent = book.author || '';
      $('cap-year').textContent = book.year ?? '';
    };
    if (capTween) capTween.kill();
    if (reduceMotion() || !$('cap-title').textContent) { write(); gsap.set(cap, { opacity: 1 }); return; }
    capTween = gsap.timeline()
      .to(cap, { opacity: 0, duration: 0.12, ease: 'power1.in' })
      .add(write)
      .to(cap, { opacity: 1, duration: 0.22, ease: 'power1.out' });
  }

  function openBook(book) { location.hash = `#/book/${book.id}`; }

  // A single large book, centred in `box`, with a soft shadow beneath.
  function figure(box, book, H) {
    const { root, dims } = Books.build(book, { H, eager: true });
    const holder = document.createElement('div');
    holder.className = 'figure-book';
    holder.appendChild(root);
    const shadow = document.createElement('div');
    shadow.className = 'figure-shadow';
    shadow.style.width = dims.W * 1.25 + 'px';
    shadow.style.top = `calc(50% + ${H / 2 - 14}px)`;
    box.append(shadow, holder);
    return root;
  }

  // ----------------------------------------------------------- book page

  function renderBookPage(id) {
    const list = visibleBooks().length ? visibleBooks() : state.books;
    const i = list.findIndex(b => b.id === id);
    const book = i >= 0 ? list[i] : state.books.find(b => b.id === id);
    if (!book) { location.hash = '#/'; return; }

    $('book-author').textContent = book.author || '';
    $('book-title').textContent = book.title;
    $('book-meta').textContent = metaLine(book);
    const desc = $('book-desc');
    desc.innerHTML = '';
    for (const para of String(book.description || '').split(/\n{2,}/).map(s => s.trim()).filter(Boolean)) {
      const p = document.createElement('p');
      p.textContent = para;
      desc.appendChild(p);
    }
    $('book-by').textContent = book.author ? `Written by ${book.author}.` : '';
    $('book-edit').href = `#/edit/${book.id}`;
    $('book-remove').onclick = () => removeBook(book);

    const prev = i >= 0 && list.length > 1 ? list[(i - 1 + list.length) % list.length] : null;
    const next = i >= 0 && list.length > 1 ? list[(i + 1) % list.length] : null;
    for (const [el, b] of [[$('book-prev'), prev], [$('book-next'), next]]) {
      el.hidden = !b;
      if (b) { el.href = `#/book/${b.id}`; el.querySelector('span').textContent = b.title; }
    }

    const fig = $('book-figure');
    fig.innerHTML = '';
    const H = Math.round(Math.min(fig.clientHeight || 560, window.innerHeight * 0.66, 620));
    const root = figure(fig, book, Math.max(240, H));

    // The book turns from its spine to its cover, as if pulled from the shelf.
    if (reduceMotion()) {
      gsap.set(root, { rotationY: 20 });
    } else {
      gsap.fromTo(root, { rotationY: 90, x: -40, opacity: 0.4 },
        { rotationY: 20, x: 0, opacity: 1, duration: 0.95, ease: 'power3.out' });
      gsap.fromTo('.book-text > *', { y: 14, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.55, stagger: 0.05, ease: 'power2.out', delay: 0.1 });
    }
    state.shelf.goToId(book.id); // so going back lands on this book
  }

  async function removeBook(book) {
    const dlg = $('confirm');
    $('confirm-text').textContent = `“${book.title}” will be taken off your shelf. This can’t be undone.`;
    dlg.returnValue = '';
    dlg.showModal();
    dlg.addEventListener('close', async () => {
      if (dlg.returnValue !== 'yes') return;
      try {
        await DB.removeBook(book.id);
        state.books = state.books.filter(b => b.id !== book.id);
        afterBooksChanged();
        toast('Removed from your shelf');
        location.hash = '#/';
      } catch (e) { toast(e.message); }
    }, { once: true });
  }

  function afterBooksChanged(focusId) {
    state.books = sortBooks(state.books);
    setHeader();
    renderFilters();
    fillShelf(focusId);
  }

  // ------------------------------------------------------- add / edit

  const PREVIEW_H = () => Math.round(Math.min(window.innerHeight * 0.5, 440));

  function emptyDraft() {
    return { title: '', author: '', year: null, pages: null, genre: '', description: '',
      cover_url: null, cover_data: null, cover_aspect: 0.66, spine_color: null, isbn: null, source: null };
  }

  function renderSwatches() {
    const box = $('swatches');
    box.innerHTML = '';
    const current = (state.draft.spine_color || Books.hashSwatch(state.draft.title).hex).toLowerCase();
    for (const p of Books.PALETTE) {
      const label = document.createElement('label');
      label.className = 'swatch';
      label.style.setProperty('--c', p.hex);
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'spine';
      input.value = p.hex;
      input.checked = p.hex === current;
      input.addEventListener('change', () => { state.draft.spine_color = p.hex; renderPreview(); });
      const span = document.createElement('span');
      span.className = 'sr-only';
      span.textContent = p.name;
      label.append(input, span);
      box.appendChild(label);
    }
  }

  function renderPreview(animate) {
    const stage = $('preview-stage');
    stage.innerHTML = '';
    const d = state.draft;
    if (!d || !d.title) { $('preview-note').hidden = false; return; }
    $('preview-note').hidden = true;
    const root = figure(stage, d, PREVIEW_H());
    if (animate && !reduceMotion()) {
      gsap.fromTo(root, { rotationY: 90 }, { rotationY: 38, duration: 1.1, ease: 'power3.out' });
    } else {
      gsap.set(root, { rotationY: 38 });
    }
  }

  function fillForm() {
    const d = state.draft;
    $('f-title').value = d.title || '';
    $('f-author').value = d.author || '';
    $('f-year').value = d.year ?? '';
    $('f-pages').value = d.pages ?? '';
    $('f-genre').value = d.genre || '';
    $('f-desc').value = d.description || '';
    $('f-cover').value = '';
    $('f-cover-clear').hidden = !(d.cover_url || d.cover_data);
    $('book-error').textContent = '';
    renderSwatches();
  }

  function showForm(animate) {
    $('book-form').hidden = false;
    fillForm();
    renderPreview(animate);
  }

  function openEditView(id) {
    state.searchSeq++;
    $('results').innerHTML = '';
    $('search-status').textContent = '';
    $('search-q').value = '';
    if (id) {
      const book = state.books.find(b => b.id === id);
      if (!book) { location.hash = '#/'; return; }
      state.editingId = id;
      state.draft = { ...book };
      $('edit-title').textContent = 'Edit details';
      $('book-save').textContent = 'Save changes';
      $('book-cancel').href = `#/book/${id}`;
      $('back').href = `#/book/${id}`;
      $('search-form').hidden = true;
      showForm(false);
    } else {
      state.editingId = null;
      state.draft = null;
      $('edit-title').textContent = 'Add a book';
      $('book-save').textContent = 'Add to shelf';
      $('book-cancel').href = '#/';
      $('search-form').hidden = false;
      $('book-form').hidden = true;
      renderPreview();
      setTimeout(() => $('search-q').focus(), 50);
    }
  }

  // Open Library search
  async function search(q) {
    const seq = ++state.searchSeq;
    const status = $('search-status');
    const list = $('results');
    list.innerHTML = '';
    status.textContent = 'Searching…';
    const isbn = q.replace(/[-\s]/g, '');
    const params = new URLSearchParams({
      fields: 'key,title,author_name,first_publish_year,number_of_pages_median,cover_i,isbn,subject',
      limit: '12'
    });
    if (/^(\d{9}[\dXx]|\d{13})$/.test(isbn)) params.set('isbn', isbn); else params.set('q', q);
    try {
      const res = await fetch(`https://openlibrary.org/search.json?${params}`);
      if (!res.ok) throw new Error(res.status);
      const json = await res.json();
      if (seq !== state.searchSeq) return;
      const docs = (json.docs || []).filter(d => d.title);
      status.textContent = docs.length ? `${docs.length} result${docs.length > 1 ? 's' : ''}` : 'Nothing found. Try other words, or add it by hand.';
      for (const doc of docs) list.appendChild(resultItem(doc));
    } catch (e) {
      if (seq !== state.searchSeq) return;
      console.error(e);
      status.textContent = 'Search isn’t available right now. You can still add the book by hand.';
    }
  }

  function resultItem(doc) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'result';
    const thumb = document.createElement('span');
    thumb.className = 'result-thumb';
    if (doc.cover_i) {
      const img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      img.src = `https://covers.openlibrary.org/b/id/${doc.cover_i}-S.jpg`;
      thumb.appendChild(img);
    }
    const text = document.createElement('span');
    text.className = 'result-text';
    const t = document.createElement('span');
    t.className = 'result-title';
    t.textContent = doc.title;
    const m = document.createElement('span');
    m.className = 'result-meta';
    m.textContent = [doc.author_name && doc.author_name.slice(0, 2).join(', '), doc.first_publish_year].filter(Boolean).join(' · ');
    text.append(t, m);
    btn.append(thumb, text);
    btn.addEventListener('click', () => pickResult(doc, btn));
    li.appendChild(btn);
    return li;
  }

  async function pickResult(doc, btn) {
    for (const b of document.querySelectorAll('.result')) b.classList.toggle('is-picked', b === btn);
    const cover = doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg` : null;
    const genre = (doc.subject || []).find(s => /^(fiction|novel|poetry|essays?|biography|history|philosophy|memoir|short stories|science fiction|fantasy|romance|thriller|mystery|drama)/i.test(s)) || '';
    state.draft = {
      ...emptyDraft(),
      title: doc.title,
      author: (doc.author_name || []).join(', '),
      year: doc.first_publish_year ?? null,
      pages: doc.number_of_pages_median ?? null,
      genre: genre ? genre[0].toUpperCase() + genre.slice(1) : '',
      cover_url: cover,
      isbn: (doc.isbn || [])[0] || null,
      source: `openlibrary:${doc.key}`
    };
    state.draft.spine_color = Books.hashSwatch(doc.title).hex;
    showForm(true);
    $('book-form').scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });

    const draft = state.draft;
    // Fill in details that need extra requests: cover shape, colour, description.
    const [aspect, colour, desc] = await Promise.all([
      Books.measureAspect(cover),
      Books.sampleColour(cover),
      fetch(`https://openlibrary.org${doc.key}.json`).then(r => r.ok ? r.json() : null).catch(() => null)
    ]);
    if (state.draft !== draft) return;
    if (cover && aspect == null) { draft.cover_url = null; $('f-cover-clear').hidden = true; } // no real cover
    if (aspect) draft.cover_aspect = aspect;
    if (colour) draft.spine_color = colour;
    const text = desc && (typeof desc.description === 'string' ? desc.description : desc.description && desc.description.value);
    if (text && !$('f-desc').value) {
      draft.description = text.replace(/\r/g, '').replace(/\(\[source\]\[\d+\]\)|\[\d+\]:.*$/gm, '').replace(/-{3,}[\s\S]*$/, '').trim().slice(0, 4000);
      $('f-desc').value = draft.description;
    }
    renderSwatches();
    renderPreview();
  }

  function readForm() {
    const d = state.draft;
    const num = v => { const n = parseInt(String(v).trim(), 10); return Number.isFinite(n) ? n : null; };
    d.title = $('f-title').value.trim();
    d.author = $('f-author').value.trim() || null;
    d.year = num($('f-year').value);
    d.pages = num($('f-pages').value);
    d.genre = $('f-genre').value.trim() || null;
    d.description = $('f-desc').value.trim() || null;
  }

  function validate(d) {
    if (!d.title) return ['f-title', 'Add the book’s title.'];
    if (d.year != null && (d.year < -3000 || d.year > 2100)) return ['f-year', 'The year looks wrong.'];
    if (d.pages != null && (d.pages < 1 || d.pages > 20000)) return ['f-pages', 'Pages should be between 1 and 20,000.'];
    return null;
  }

  async function saveBook(e) {
    e.preventDefault();
    readForm();
    const d = state.draft;
    const problem = validate(d);
    if (problem) { $('book-error').textContent = problem[1]; $(problem[0]).focus(); return; }
    const fields = ['title', 'author', 'year', 'pages', 'genre', 'description', 'cover_url', 'cover_data', 'cover_aspect', 'spine_color', 'isbn', 'source'];
    const payload = {};
    for (const f of fields) payload[f] = d[f] ?? null;
    payload.cover_aspect = payload.cover_aspect || 0.66;
    payload.spine_color = payload.spine_color || Books.hashSwatch(d.title).hex;
    const btn = $('book-save');
    btn.disabled = true;
    try {
      if (state.editingId) {
        const saved = await DB.updateBook(state.editingId, payload);
        state.books = state.books.map(b => (b.id === saved.id ? saved : b));
        afterBooksChanged(saved.id);
        toast('Changes saved');
        location.hash = `#/book/${saved.id}`;
      } else {
        const saved = await DB.addBook(payload);
        state.books.push(saved);
        state.decade = 'all';
        afterBooksChanged(saved.id);
        toast('Added to your shelf');
        location.hash = '#/';
      }
    } catch (err) {
      $('book-error').textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  }

  function bindEdit() {
    $('search-form').addEventListener('submit', e => {
      e.preventDefault();
      const q = $('search-q').value.trim();
      if (q.length >= 2) search(q);
    });
    $('manual-btn').addEventListener('click', () => {
      for (const b of document.querySelectorAll('.result')) b.classList.remove('is-picked');
      state.draft = { ...emptyDraft(), title: $('search-q').value.trim() };
      showForm(true);
      $('f-title').focus();
    });
    for (const id of ['f-title', 'f-author', 'f-year', 'f-pages']) {
      $(id).addEventListener('input', () => {
        if (!state.draft) return;
        readForm();
        clearTimeout(bindEdit.t);
        bindEdit.t = setTimeout(renderPreview, 120);
      });
    }
    $('f-cover').addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const { dataUrl, aspect } = await Books.processUpload(file);
        state.draft.cover_data = dataUrl;
        state.draft.cover_url = null;
        state.draft.cover_aspect = aspect;
        const colour = await Books.sampleColour(dataUrl);
        if (colour) state.draft.spine_color = colour;
        $('f-cover-clear').hidden = false;
        $('book-error').textContent = '';
        renderSwatches();
        renderPreview(true);
      } catch (err) { $('book-error').textContent = err.message; }
    });
    $('f-cover-clear').addEventListener('click', () => {
      Object.assign(state.draft, { cover_url: null, cover_data: null, cover_aspect: 0.66 });
      $('f-cover-clear').hidden = true;
      renderPreview();
    });
    $('book-form').addEventListener('submit', saveBook);
  }

  // ------------------------------------------------------------- sign in

  let mode = 'in';
  function setMode(m) {
    mode = m;
    $('tab-in').setAttribute('aria-selected', String(m === 'in'));
    $('tab-up').setAttribute('aria-selected', String(m === 'up'));
    for (const el of document.querySelectorAll('.only-up')) el.hidden = m !== 'up';
    $('auth-submit').textContent = m === 'in' ? 'Sign in' : 'Create shelf';
    $('auth-pass').autocomplete = m === 'in' ? 'current-password' : 'new-password';
    $('signin-title').textContent = m === 'in' ? 'Open your shelf' : 'Start a shelf';
    $('auth-error').textContent = '';
  }

  const AUTH_ERRORS = {
    wrong: 'That username and password don’t match.',
    locked: 'Too many wrong attempts. Wait 15 minutes and try again.',
    taken: 'That username is taken. Try another.',
    weak: 'Use a password of at least 8 characters.',
    bad_username: 'Usernames use 2–24 letters, numbers, dots, dashes or underscores.',
    bad_name: 'Add your name (up to 40 characters).',
    busy: 'Lots of new shelves right now. Try again in an hour.',
    no_session: 'Something went wrong. Please try again.'
  };

  function bindAuth() {
    $('tab-in').addEventListener('click', () => setMode('in'));
    $('tab-up').addEventListener('click', () => setMode('up'));
    $('form-auth').addEventListener('submit', async e => {
      e.preventDefault();
      const err = $('auth-error');
      const user = $('auth-user').value.trim();
      const pass = $('auth-pass').value;
      if (!user || !pass) { err.textContent = 'Enter your username and password.'; return; }
      if (mode === 'up') {
        if (pass !== $('auth-pass2').value) { err.textContent = 'The passwords don’t match.'; return; }
      }
      const btn = $('auth-submit');
      btn.disabled = true;
      err.textContent = '';
      try {
        const result = mode === 'in'
          ? await DB.signIn(user, pass)
          : await DB.signUp(user, $('auth-name').value.trim() || user, pass);
        if (result !== 'ok') { err.textContent = AUTH_ERRORS[result] || AUTH_ERRORS.no_session; return; }
        $('auth-pass').value = $('auth-pass2').value = '';
        await loadShelf();
        location.hash = '#/';
        route();
      } catch (ex) {
        err.textContent = ex.message;
      } finally {
        btn.disabled = false;
      }
    });
    $('sign-out').addEventListener('click', async () => {
      await DB.signOut();
      state.me = null;
      state.books = [];
      setHeader();
      location.hash = '#/signin';
      route();
    });
  }

  // --------------------------------------------------------------- router

  async function loadShelf() {
    state.me = await DB.whoami();
    if (!state.me) return;
    state.books = sortBooks(await DB.listBooks());
    afterBooksChanged();
  }

  function route() {
    const hash = location.hash.replace(/^#\/?/, '');
    const [page, id] = hash.split('/');
    if (!state.me) {
      show('signin');
      setHeader();
      return;
    }
    $('back').href = '#/';
    if (page === 'book' && id) { show('book'); renderBookPage(id); }
    else if (page === 'add') { show('edit'); openEditView(null); }
    else if (page === 'edit' && id) { show('edit'); openEditView(id); }
    else {
      if (hash && hash !== 'signin') { location.replace('#/'); }
      show('shelf');
      state.shelf.resize();
      if (!reduceMotion() && state.view === 'shelf') {
        gsap.fromTo('#stage .track', { opacity: 0 }, { opacity: 1, duration: 0.4 });
      }
      $('stage').focus({ preventScroll: true });
    }
    window.scrollTo(0, 0);
  }

  async function start() {
    state.shelf = new Shelf($('stage'), { onFocus, onOpen: openBook });
    $('prev').addEventListener('click', () => state.shelf.step(-1));
    $('next').addEventListener('click', () => state.shelf.step(1));
    bindAuth();
    bindEdit();
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && (state.view === 'book' || state.view === 'edit') && !$('confirm').open) {
        location.hash = $('back').getAttribute('href');
      }
    });
    try {
      await loadShelf();
    } catch (e) {
      $('auth-error').textContent = e.message;
    }
    window.addEventListener('hashchange', route);
    route();
  }

  start();
})();
