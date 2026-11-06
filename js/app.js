/* Larita's Book Shelf — pages and flow (interface in Catalan).
 *
 * Routes (in the address after #):
 *   #/                    my shelf (books I've read)
 *   #/per-llegir          my wishlist
 *   #/u/<id>              someone else's shelf      (#/u/<id>/per-llegir)
 *   #/llibre/<id>         one book
 *   #/afegeix             add a book                (#/afegeix/per-llegir)
 *   #/edita/<id>          edit a book
 *   #/prestatgeries       everyone's shelves
 *   #/entra               sign in or create a shelf
 */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const app = $('app');
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const T = b => Books.titleOf(b);
  const dateFmt = new Intl.DateTimeFormat('ca', { day: 'numeric', month: 'long', year: 'numeric' });

  const state = {
    me: null,
    owner: null,        // { id, name } of the shelf being viewed
    list: 'shelf',      // 'shelf' | 'wishlist'
    decade: 'all',
    cache: new Map(),   // profile id → books
    books: [],          // books of the shelf being viewed (both lists)
    shelfKey: '',
    shelf: null,
    view: 'loading',
    draft: null,
    editingId: null,
    searchSeq: 0,
    titleLang: 'ca',
    book: null          // book on the book page
  };

  // Title language for the whole site, remembered in this browser.
  try { window.SHELF_LANG = localStorage.getItem('shelf-lang') === 'en' ? 'en' : 'ca'; }
  catch (_) { window.SHELF_LANG = 'ca'; }

  // ---------------------------------------------------------------- utils

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  function sortBooks(list) {
    return list.slice().sort((a, b) => {
      const ay = a.year ?? 99999, by = b.year ?? 99999;
      if (ay !== by) return ay - by;
      return T(a).localeCompare(T(b), 'ca');
    });
  }

  const decadeOf = b => (b.year != null ? Math.floor(b.year / 10) * 10 : null);
  const isMine = () => state.me && state.owner && state.owner.id === state.me.id;

  function listBooks(list) { return state.books.filter(b => (b.list || 'shelf') === list); }

  function visibleBooks() {
    const inList = listBooks(state.list);
    if (state.decade === 'all') return inList;
    return inList.filter(b => decadeOf(b) === state.decade);
  }

  // "de Lara" / "d’Anna"
  function deName(name) { return /^[aeiouàèéíòóúh]/i.test(name) ? `d’${name}` : `de ${name}`; }

  function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

  function metaLine(b) {
    const parts = [];
    if (b.year != null) parts.push(b.year);
    if (b.genre) parts.push(b.genre);
    if (b.pages) parts.push(`${b.pages} pàgines`);
    return parts.join(' / ');
  }

  function shelfHref(ownerId, list) {
    const base = state.me && ownerId === state.me.id ? '#/' : `#/u/${ownerId}`;
    if (list === 'wishlist') return base === '#/' ? '#/per-llegir' : `${base}/per-llegir`;
    return base;
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // ---------------------------------------------------------------- views

  function show(name) {
    state.view = name;
    app.dataset.view = name;
    for (const v of document.querySelectorAll('.view')) v.hidden = v.dataset.name !== name;
    const signedIn = !!state.me;
    const sub = name === 'book' || name === 'edit';
    $('back').hidden = !sub;
    $('topnav').hidden = !signedIn || sub;
    $('lang').hidden = !signedIn || name === 'edit' || name === 'members';
    $('add-link').hidden = !(signedIn && name === 'shelf' && isMine());
    $('foot-right').hidden = !signedIn;
    $('nav-mine').setAttribute('aria-current', String(name === 'shelf' && isMine()));
    $('nav-all').setAttribute('aria-current', String(name === 'members'));
  }

  function setHeader() {
    const owner = state.owner;
    $('brand-sub').textContent = state.me && owner ? `La prestatgeria ${deName(owner.name)}` : '';
    $('foot-user').textContent = state.me ? state.me.display_name : '';
    let left = 'Larita’s Book Shelf';
    if (state.me && owner && (state.view === 'shelf' || state.view === 'book')) {
      const list = listBooks(state.list);
      left = plural(list.length, 'llibre', 'llibres');
      const years = list.map(b => b.year).filter(y => y != null);
      if (years.length > 1) left += ` · ${Math.min(...years)}–${Math.max(...years)}`;
    }
    $('foot-left').textContent = left;
    $('count-shelf').textContent = listBooks('shelf').length || '';
    $('count-wishlist').textContent = listBooks('wishlist').length || '';
    for (const b of document.querySelectorAll('#lang button')) b.setAttribute('aria-pressed', String(b.dataset.lang === window.SHELF_LANG));
  }

  // -------------------------------------------------------------- loading

  async function loadOwner(ownerId) {
    if (state.owner && state.owner.id === ownerId && state.cache.has(ownerId)) {
      state.books = state.cache.get(ownerId);
      return;
    }
    let name = state.me.display_name;
    if (ownerId !== state.me.id) {
      const shelves = await DB.listShelves();
      const s = shelves.find(x => x.id === ownerId);
      if (!s) throw new Error('Aquesta prestatgeria no existeix.');
      name = s.display_name;
    }
    if (!state.cache.has(ownerId)) state.cache.set(ownerId, sortBooks(await DB.listBooks(ownerId)));
    state.owner = { id: ownerId, name };
    state.books = state.cache.get(ownerId);
  }

  function storeBooks(ownerId, books) {
    const sorted = sortBooks(books);
    state.cache.set(ownerId, sorted);
    state.shelfKey = ''; // shelf needs rebuilding next time it's shown
    if (state.owner && state.owner.id === ownerId) state.books = sorted;
  }

  // ---------------------------------------------------------------- shelf

  function renderTabs() {
    for (const b of document.querySelectorAll('#list-tabs button')) {
      b.setAttribute('aria-pressed', String(b.dataset.list === state.list));
    }
  }

  function renderFilters() {
    const box = $('filters');
    const inList = listBooks(state.list);
    const decades = [...new Set(inList.map(decadeOf).filter(d => d != null))].sort((a, b) => a - b);
    box.innerHTML = '';
    if (decades.length < 2) { box.hidden = true; state.decade = 'all'; return; }
    box.hidden = false;
    if (state.decade !== 'all' && !decades.includes(state.decade)) state.decade = 'all';
    const add = (value, label, aria) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (aria) b.setAttribute('aria-label', aria);
      b.setAttribute('aria-pressed', String(state.decade === value));
      b.addEventListener('click', () => {
        if (state.decade === value) return;
        state.decade = value;
        renderFilters();
        fillShelf();
      });
      box.appendChild(b);
    };
    add('all', 'Tots');
    for (const d of decades) add(d, `${d}–${String(d + 9).slice(-2)}`, `De ${d} a ${d + 9}`);
  }

  function fillShelf(focusId) {
    const list = visibleBooks();
    const mine = isMine();
    $('empty').hidden = list.length > 0;
    $('empty-add').hidden = !mine;
    $('empty-add').href = state.list === 'wishlist' ? '#/afegeix/per-llegir' : '#/afegeix';
    if (state.list === 'wishlist') {
      $('empty-title').textContent = mine ? 'Encara no hi ha cap llibre per llegir' : 'Aquesta llista encara és buida';
      $('empty-text').textContent = mine ? 'Desa aquí els llibres que vols llegir.' : '';
    } else {
      $('empty-title').textContent = mine ? 'La prestatgeria és buida' : 'Aquesta prestatgeria encara és buida';
      $('empty-text').textContent = mine ? 'Afegeix el primer llibre i apareixerà aquí, amb el llom a la vista.' : '';
    }
    $('prev').hidden = $('next').hidden = list.length < 2;
    $('caption').hidden = !list.length;
    if (!list.length) $('cap-title').textContent = '';
    state.shelf.setBooks(list, focusId);
    const ol = $('book-list');
    ol.innerHTML = '';
    for (const b of list) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = `#/llibre/${b.id}`;
      a.textContent = [T(b), b.author && `de ${b.author}`, b.year].filter(Boolean).join(', ');
      li.appendChild(a);
      ol.appendChild(li);
    }
    setHeader();
  }

  function refreshShelf(focusId) {
    renderTabs();
    renderFilters();
    fillShelf(focusId);
  }

  let capTween = null;
  function onFocus(book, i, n) {
    $('live').textContent = `${T(book)}${book.author ? ', ' + book.author : ''}. ${i + 1} de ${n}.`;
    const cap = $('caption');
    const write = () => {
      $('cap-title').textContent = T(book);
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

  function openBook(book) { location.hash = `#/llibre/${book.id}`; }

  function setLang(lang) {
    if (lang === window.SHELF_LANG) return;
    window.SHELF_LANG = lang;
    try { localStorage.setItem('shelf-lang', lang); } catch (_) { /* fine */ }
    const current = state.shelf.currentBook();
    for (const [id, books] of state.cache) state.cache.set(id, sortBooks(books));
    if (state.owner) state.books = state.cache.get(state.owner.id) || state.books;
    if (state.view === 'shelf') { refreshShelf(current && current.id); }
    else if (state.view === 'book' && state.book) { renderBookPage(state.book.id); }
    setHeader();
  }

  // ------------------------------------------------------------- one book

  // A single large book, centred in `box`, with a soft shadow beneath.
  function figure(box, book, H) {
    const { root, dims } = Books.build(book, { H, eager: true });
    const holder = el('div', 'figure-book');
    holder.appendChild(root);
    const shadow = el('div', 'figure-shadow');
    shadow.style.width = dims.W * 1.25 + 'px';
    shadow.style.top = `calc(50% + ${H / 2 - 14}px)`;
    box.append(shadow, holder);
    return root;
  }

  const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.9 6.1 6.7.8-4.9 4.6 1.3 6.6L12 17.4l-5.9 3.3 1.3-6.6-4.9-4.6 6.7-.8z"/></svg>';

  function renderStars(book, editable) {
    const box = $('stars');
    box.innerHTML = '';
    box.classList.toggle('is-editable', editable);
    const r = book.rating || 0;
    const score = el('span', 'score', r ? `${r}/10` : (editable ? 'Sense valorar' : 'Sense valoració'));
    if (editable) {
      box.setAttribute('role', 'radiogroup');
      box.setAttribute('aria-label', 'Valoració de 10');
    } else {
      box.removeAttribute('role');
      box.setAttribute('aria-label', r ? `Valoració: ${r} de 10` : 'Sense valoració');
    }
    const stars = el('span', 'star-row');
    for (let i = 1; i <= 10; i++) {
      let s;
      if (editable) {
        s = el('button', 'star');
        s.type = 'button';
        s.setAttribute('role', 'radio');
        s.setAttribute('aria-checked', String(i === r));
        s.setAttribute('aria-label', `${i} de 10`);
        s.addEventListener('click', () => saveRating(book, i === r ? null : i));
        s.addEventListener('mouseenter', () => paint(i));
        s.addEventListener('focus', () => paint(i));
      } else {
        s = el('span', 'star');
        s.setAttribute('aria-hidden', 'true');
      }
      s.innerHTML = STAR;
      s.classList.toggle('on', i <= r);
      stars.appendChild(s);
    }
    function paint(n) { [...stars.children].forEach((s, j) => s.classList.toggle('preview', j < n)); }
    stars.addEventListener('mouseleave', () => paint(0));
    stars.addEventListener('focusout', () => paint(0));
    box.append(stars, score);
  }

  async function saveRating(book, value) {
    try {
      const saved = await DB.updateBook(book.id, { rating: value });
      replaceBook(saved);
      renderStars(saved, true);
      toast(value ? 'Valoració desada' : 'Valoració esborrada');
    } catch (e) { toast(e.message); }
  }

  function replaceBook(saved) {
    const books = (state.cache.get(saved.profile_id) || []).map(b => (b.id === saved.id ? saved : b));
    storeBooks(saved.profile_id, books);
    if (state.book && state.book.id === saved.id) state.book = saved;
  }

  async function renderBookPage(id) {
    let book = state.books.find(b => b.id === id);
    if (!book) {
      try { book = await DB.getBook(id); } catch (e) { toast(e.message); }
      if (!book) { location.hash = '#/'; return; }
      await loadOwner(book.profile_id);
      book = state.books.find(b => b.id === id) || book;
    }
    state.book = book;
    const mine = state.me && book.profile_id === state.me.id;
    const owner = state.owner;
    const list = (book.list || 'shelf');
    if (state.list !== list) { state.list = list; state.decade = 'all'; }
    $('back').href = shelfHref(book.profile_id, list);
    $('back-label').textContent = list === 'wishlist' ? 'Per llegir' : 'Prestatgeria';
    setHeader();

    $('book-author').textContent = book.author || '';
    $('book-title').textContent = T(book);
    const other = Books.titleOf(book, window.SHELF_LANG === 'en' ? 'ca' : 'en');
    $('book-other-title').textContent = other && other !== T(book) ? other : '';
    $('book-meta').textContent = metaLine(book);

    const desc = $('book-desc');
    desc.innerHTML = '';
    const paras = String(book.description || '').split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
    for (const para of paras) desc.appendChild(el('p', null, para));
    if (!paras.length) desc.appendChild(el('p', 'muted', mine ? 'Encara no hi ha sinopsi. La pots afegir a «Edita els detalls».' : 'Sense sinopsi.'));

    // Rating, actions
    $('rating').hidden = list === 'wishlist' && !book.rating;
    renderStars(book, mine);
    $('book-actions').hidden = !mine;
    $('book-read').hidden = !(mine && list === 'wishlist');
    $('book-read').onclick = () => markRead(book);
    $('book-edit').href = `#/edita/${book.id}`;
    $('book-remove').textContent = list === 'wishlist' ? 'Treu de la llista' : 'Treu de la prestatgeria';
    $('book-remove').onclick = () => removeBook(book);

    // Review
    $('review-label').textContent = mine ? 'La meva ressenya' : `Ressenya ${deName(owner ? owner.name : '')}`;
    renderReview(book, mine);

    // Quotes and comments
    $('quote-form').hidden = !mine;
    $('quotes').innerHTML = '';
    $('comments').innerHTML = '';
    loadExtras(book);

    // Prev / next within the same list
    const siblings = listBooks(list);
    const i = siblings.findIndex(b => b.id === book.id);
    const prev = i >= 0 && siblings.length > 1 ? siblings[(i - 1 + siblings.length) % siblings.length] : null;
    const next = i >= 0 && siblings.length > 1 ? siblings[(i + 1) % siblings.length] : null;
    for (const [a, b] of [[$('book-prev'), prev], [$('book-next'), next]]) {
      a.hidden = !b;
      if (b) { a.href = `#/llibre/${b.id}`; a.querySelector('span').textContent = T(b); }
    }

    const fig = $('book-figure');
    fig.innerHTML = '';
    const H = Math.round(Math.min(fig.clientHeight || 520, window.innerHeight * 0.6, 580));
    const root = figure(fig, book, Math.max(240, H));
    if (reduceMotion()) {
      gsap.set(root, { rotationY: 20 });
    } else {
      gsap.fromTo(root, { rotationY: 90, x: -40, opacity: 0.4 },
        { rotationY: 20, x: 0, opacity: 1, duration: 0.95, ease: 'power3.out' });
      gsap.fromTo('.book-head > *', { y: 14, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.55, stagger: 0.05, ease: 'power2.out', delay: 0.1 });
    }
  }

  function renderReview(book, mine) {
    const text = $('review-text');
    text.innerHTML = '';
    const paras = String(book.review || '').split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
    for (const p of paras) text.appendChild(el('p', null, p));
    if (!paras.length && !mine) text.appendChild(el('p', 'muted', 'Encara no hi ha ressenya.'));
    $('review-form').hidden = true;
    $('review-open').hidden = !mine;
    $('review-open').textContent = paras.length ? 'Edita la ressenya' : 'Escriu una ressenya';
  }

  async function loadExtras(book) {
    const id = book.id;
    try {
      const [quotes, comments] = await Promise.all([DB.listQuotes(id), DB.listComments(id)]);
      if (!state.book || state.book.id !== id) return;
      renderQuotes(book, quotes);
      renderComments(book, comments);
    } catch (e) {
      $('quotes').innerHTML = '';
      $('quotes').appendChild(el('li', 'muted', e.message));
    }
  }

  function renderQuotes(book, quotes) {
    const ul = $('quotes');
    ul.innerHTML = '';
    const mine = state.me && book.profile_id === state.me.id;
    ul.dataset.items = quotes.length;
    if (!quotes.length) {
      ul.appendChild(el('li', 'muted empty-note', mine ? 'Encara no hi ha cites. Afegeix-hi la primera.' : 'Encara no hi ha cites.'));
      return;
    }
    for (const q of quotes) {
      const li = el('li', 'quote');
      const bq = el('blockquote', null, q.body);
      li.appendChild(bq);
      if (q.page) li.appendChild(el('p', 'quote-page', `Pàgina ${q.page}`));
      if (mine) {
        const x = el('button', 'icon-btn', '×');
        x.type = 'button';
        x.setAttribute('aria-label', 'Esborra la cita');
        x.addEventListener('click', async () => {
          try {
            await DB.removeQuote(q.id);
            renderQuotes(book, quotes.filter(o => o.id !== q.id));
            toast('Cita esborrada');
          } catch (e) { toast(e.message); }
        });
        li.appendChild(x);
      }
      ul.appendChild(li);
    }
  }

  function renderComments(book, comments) {
    const ul = $('comments');
    ul.innerHTML = '';
    if (!comments.length) {
      ul.appendChild(el('li', 'muted empty-note', 'Encara no hi ha comentaris. Sigues el primer.'));
      return;
    }
    const ownsBook = state.me && book.profile_id === state.me.id;
    for (const c of comments) {
      const li = el('li', 'comment');
      const head = el('p', 'comment-head');
      const who = (c.author && c.author.display_name) || '—';
      head.append(el('span', 'comment-author', who), el('span', 'comment-date', dateFmt.format(new Date(c.created_at))));
      li.append(head, el('p', 'comment-body', c.body));
      if (ownsBook || (state.me && c.author_id === state.me.id)) {
        const x = el('button', 'btn-link small', 'Esborra');
        x.type = 'button';
        x.setAttribute('aria-label', `Esborra el comentari de ${who}`);
        x.addEventListener('click', async () => {
          try {
            await DB.removeComment(c.id);
            renderComments(book, comments.filter(o => o.id !== c.id));
            toast('Comentari esborrat');
          } catch (e) { toast(e.message); }
        });
        head.appendChild(x);
      }
      ul.appendChild(li);
    }
  }

  function bindBookPage() {
    $('review-open').addEventListener('click', () => {
      $('review-input').value = state.book.review || '';
      $('review-form').hidden = false;
      $('review-open').hidden = true;
      $('review-text').hidden = true;
      $('review-input').focus();
    });
    $('review-cancel').addEventListener('click', () => {
      $('review-text').hidden = false;
      renderReview(state.book, true);
    });
    $('review-form').addEventListener('submit', async e => {
      e.preventDefault();
      try {
        const saved = await DB.updateBook(state.book.id, { review: $('review-input').value.trim() || null });
        replaceBook(saved);
        $('review-text').hidden = false;
        renderReview(saved, true);
        toast('Ressenya desada');
      } catch (err) { toast(err.message); }
    });
    $('quote-form').addEventListener('submit', async e => {
      e.preventDefault();
      const body = $('quote-input').value.trim();
      if (!body) { $('quote-input').focus(); return; }
      try {
        await DB.addQuote(state.book.id, body, $('quote-page').value.trim());
        $('quote-input').value = $('quote-page').value = '';
        renderQuotes(state.book, await DB.listQuotes(state.book.id));
        toast('Cita afegida');
      } catch (err) { toast(err.message); }
    });
    $('comment-form').addEventListener('submit', async e => {
      e.preventDefault();
      const body = $('comment-input').value.trim();
      if (!body) { $('comment-input').focus(); return; }
      const btn = e.submitter;
      if (btn) btn.disabled = true;
      try {
        await DB.addComment(state.book.id, body);
        $('comment-input').value = '';
        renderComments(state.book, await DB.listComments(state.book.id));
        toast('Comentari publicat');
      } catch (err) { toast(err.message); }
      finally { if (btn) btn.disabled = false; }
    });
  }

  async function markRead(book) {
    try {
      const saved = await DB.updateBook(book.id, { list: 'shelf' });
      replaceBook(saved);
      state.list = 'shelf';
      state.decade = 'all';
      toast('Mogut a Llegits');
      renderBookPage(saved.id);
    } catch (e) { toast(e.message); }
  }

  function removeBook(book) {
    const dlg = $('confirm');
    const where = (book.list || 'shelf') === 'wishlist' ? 'de la llista Per llegir' : 'de la prestatgeria';
    $('confirm-title').textContent = 'Vols treure aquest llibre?';
    $('confirm-text').textContent = `«${T(book)}» sortirà ${where}, amb les seves cites i comentaris. No es pot desfer.`;
    dlg.returnValue = '';
    dlg.showModal();
    dlg.addEventListener('close', async () => {
      if (dlg.returnValue !== 'yes') return;
      try {
        await DB.removeBook(book.id);
        storeBooks(book.profile_id, (state.cache.get(book.profile_id) || []).filter(b => b.id !== book.id));
        toast('Llibre tret');
        location.hash = shelfHref(book.profile_id, book.list || 'shelf');
      } catch (e) { toast(e.message); }
    }, { once: true });
  }

  // ------------------------------------------------------- add / edit

  const PREVIEW_H = () => Math.round(Math.min(($('preview-stage').clientHeight || 400) * 0.82, window.innerHeight * 0.5, 440));

  const GENRES = {
    fiction: 'Ficció', novel: 'Novel·la', novels: 'Novel·la', poetry: 'Poesia', essays: 'Assaig', essay: 'Assaig',
    biography: 'Biografia', history: 'Història', philosophy: 'Filosofia', memoir: 'Memòries',
    'short stories': 'Contes', 'science fiction': 'Ciència-ficció', fantasy: 'Fantasia', romance: 'Romàntica',
    thriller: 'Thriller', thrillers: 'Thriller', mystery: 'Misteri', drama: 'Teatre', 'young adult fiction': 'Juvenil',
    'literary criticism': 'Assaig', 'juvenile fiction': 'Infantil', 'biography & autobiography': 'Biografia',
    'literary collections': 'Antologia', 'comics & graphic novels': 'Còmic', cooking: 'Cuina', travel: 'Viatges'
  };

  function emptyDraft(list) {
    return { title: '', title_en: '', author: '', year: null, pages: null, genre: '', description: '',
      cover_url: null, cover_data: null, cover_aspect: 0.66, spine_color: null, cover_tone: null,
      isbn: null, source: null, list: list || 'shelf' };
  }

  function setTitleLang(lang) {
    state.titleLang = lang;
    for (const b of document.querySelectorAll('#title-lang button')) b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
    for (const f of document.querySelectorAll('.title-field')) f.hidden = f.dataset.lang !== lang;
    const other = lang === 'ca' ? $('f-title-en') : $('f-title');
    const otherName = lang === 'ca' ? 'anglès' : 'català';
    $('title-hint').textContent = other.value.trim()
      ? `També té títol en ${otherName}: «${other.value.trim()}».`
      : `Pots posar-hi també el títol en ${otherName}: tria la llengua per escriure’l.`;
  }

  function setDraftList(list) {
    state.draft.list = list;
    for (const b of document.querySelectorAll('#f-list button')) b.setAttribute('aria-pressed', String(b.dataset.list === list));
    if (!state.editingId) $('book-save').textContent = list === 'wishlist' ? 'Afegeix a Per llegir' : 'Afegeix a la prestatgeria';
  }

  function renderSwatches() {
    const box = $('swatches');
    box.innerHTML = '';
    const d = state.draft;
    const current = (d.spine_color || d.cover_tone || Books.hashSwatch(d.title_en || d.title).hex).toLowerCase();
    const options = [];
    if (d.cover_tone) options.push({ hex: d.cover_tone.toLowerCase(), name: 'Color de la coberta', cover: true });
    for (const p of Books.PALETTE) if (!options.some(o => o.hex === p.hex)) options.push(p);
    if (!options.some(o => o.hex === current)) options.unshift({ hex: current, name: 'Color actual' });
    for (const p of options) {
      const label = el('label', 'swatch' + (p.cover ? ' is-cover' : ''));
      label.style.setProperty('--c', p.hex);
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'spine';
      input.value = p.hex;
      input.checked = p.hex === current;
      input.addEventListener('change', () => { d.spine_color = p.hex; renderPreview(); });
      label.append(input, el('span', 'sr-only', p.name));
      box.appendChild(label);
    }
  }

  function renderPreview(animate) {
    const stage = $('preview-stage');
    stage.innerHTML = '';
    const d = state.draft;
    if (!d || !(d.title || d.title_en)) { $('preview-note').hidden = false; return; }
    $('preview-note').hidden = true;
    const root = figure(stage, d, PREVIEW_H());
    if (animate && !reduceMotion()) gsap.fromTo(root, { rotationY: 90 }, { rotationY: 38, duration: 1.1, ease: 'power3.out' });
    else gsap.set(root, { rotationY: 38 });
  }

  function fillForm() {
    const d = state.draft;
    $('f-title').value = d.title || '';
    $('f-title-en').value = d.title_en || '';
    $('f-author').value = d.author || '';
    $('f-year').value = d.year ?? '';
    $('f-pages').value = d.pages ?? '';
    $('f-genre').value = d.genre || '';
    $('f-desc').value = d.description || '';
    $('f-cover').value = '';
    $('f-cover-clear').hidden = !(d.cover_url || d.cover_data);
    $('book-error').textContent = '';
    setTitleLang(d.title || !d.title_en ? 'ca' : 'en');
    setDraftList(d.list || 'shelf');
    renderSwatches();
  }

  function showForm(animate) {
    $('book-form').hidden = false;
    fillForm();
    renderPreview(animate);
  }

  function openEditView(id, list) {
    state.searchSeq++;
    $('results').innerHTML = '';
    $('search-status').textContent = '';
    $('search-q').value = '';
    if (id) {
      const book = (state.cache.get(state.me.id) || []).find(b => b.id === id);
      if (!book) { location.hash = '#/'; return; }
      state.editingId = id;
      state.draft = { ...book, cover_tone: null };
      $('edit-title').textContent = 'Edita els detalls';
      $('book-save').textContent = 'Desa els canvis';
      $('book-cancel').href = `#/llibre/${id}`;
      $('back').href = `#/llibre/${id}`;
      $('back-label').textContent = 'Llibre';
      $('search-form').hidden = true;
      $('list-field').hidden = true;
      showForm(false);
      const src = Books.coverSrc(book);
      if (src) Books.sampleColour(src).then(c => { if (c && state.draft && state.editingId === id) { state.draft.cover_tone = c; renderSwatches(); } });
    } else {
      state.editingId = null;
      state.draft = null;
      state.newList = list || 'shelf';
      $('edit-title').textContent = list === 'wishlist' ? 'Afegeix a Per llegir' : 'Afegeix un llibre';
      $('book-cancel').href = list === 'wishlist' ? '#/per-llegir' : '#/';
      $('back').href = $('book-cancel').href;
      $('back-label').textContent = list === 'wishlist' ? 'Per llegir' : 'Prestatgeria';
      $('search-form').hidden = false;
      $('list-field').hidden = false;
      $('book-form').hidden = true;
      renderPreview();
      setTimeout(() => $('search-q').focus(), 50);
    }
  }

  // ------------------------------------------------------------ search
  //
  // Google Books and Open Library are asked at the same time. Results are
  // merged (same ISBN or same title + author counts as one book), Catalan
  // editions first. "Només edicions en català" keeps only Catalan editions.

  const LANG3 = { cat: 'ca', eng: 'en', spa: 'es', fre: 'fr', ger: 'de', ita: 'it', por: 'pt' };
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const httpsUrl = u => (u ? u.replace(/^http:/, 'https:') : null);
  const stripHtml = t => String(t || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>\s*<p>/gi, '\n\n').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, '’').trim();

  function onlyCatalan() { return $('only-ca').checked; }

  async function searchGoogle(q, isbn, ca) {
    const key = window.SHELF_CONFIG.googleBooksKey;
    if (!key) return [];
    const p = new URLSearchParams({ q: isbn ? `isbn:${isbn}` : q, maxResults: '20', printType: 'books', key });
    if (ca) p.set('langRestrict', 'ca');
    const res = await fetch(`https://www.googleapis.com/books/v1/volumes?${p}`);
    if (!res.ok) throw new Error('google ' + res.status);
    const json = await res.json();
    return (json.items || []).map(it => {
      const v = it.volumeInfo || {};
      const ids = v.industryIdentifiers || [];
      const isbn13 = (ids.find(x => x.type === 'ISBN_13') || ids.find(x => x.type === 'ISBN_10') || {}).identifier || null;
      const img = v.imageLinks && (v.imageLinks.thumbnail || v.imageLinks.smallThumbnail);
      return {
        src: 'google', id: it.id,
        title: v.title,
        authors: v.authors || [],
        year: v.publishedDate ? parseInt(v.publishedDate, 10) || null : null,
        pages: v.pageCount || null,
        lang: v.language || null,
        isbn: isbn13,
        thumb: httpsUrl(img),
        cover: img ? httpsUrl(img).replace(/&edge=curl/, '').replace(/&zoom=\d/, '&zoom=1') + '&fife=w600' : null,
        description: stripHtml(v.description),
        categories: v.categories || []
      };
    }).filter(r => r.title);
  }

  async function searchOpenLibrary(q, isbn, ca) {
    const p = new URLSearchParams({
      fields: 'key,title,author_name,first_publish_year,number_of_pages_median,cover_i,isbn,subject,language',
      limit: '12'
    });
    if (isbn) p.set('isbn', isbn); else p.set('q', q);
    if (ca) p.set('language', 'cat');
    const res = await fetch(`https://openlibrary.org/search.json?${p}`);
    if (!res.ok) throw new Error('openlibrary ' + res.status);
    const json = await res.json();
    return (json.docs || []).filter(d => d.title).map(d => {
      const langs = (d.language || []).map(l => LANG3[l] || l);
      return {
        src: 'ol', key: d.key,
        title: d.title,
        authors: d.author_name || [],
        year: d.first_publish_year ?? null,
        pages: d.number_of_pages_median ?? null,
        lang: ca ? 'ca' : (langs.length === 1 ? langs[0] : null),
        langs,
        isbn: (d.isbn || [])[0] || null,
        thumb: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-S.jpg` : null,
        cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : null,
        description: '',
        categories: d.subject || []
      };
    });
  }

  function mergeResults(google, ol, ca) {
    const out = [];
    const sameBook = (a, b) =>
      (a.isbn && b.isbn && a.isbn === b.isbn) ||
      (norm(a.title) === norm(b.title) && norm(a.authors[0]) === norm(b.authors[0]) && (a.lang === b.lang || !a.lang || !b.lang));
    for (const r of [...google, ...ol]) {
      if (ca && r.lang && r.lang !== 'ca') continue;
      const twin = out.find(o => sameBook(o, r));
      if (!twin) { out.push(r); continue; }
      // Fill gaps from the second source
      for (const k of ['year', 'pages', 'isbn', 'thumb', 'cover', 'lang']) if (!twin[k] && r[k]) twin[k] = r[k];
      if (!twin.description && r.description) twin.description = r.description;
      if (r.src === 'ol') twin.olKey = r.key;
      if (r.src === 'google') twin.googleId = r.id;
    }
    const score = r => (r.lang === 'ca' ? 0 : 2) + (r.cover ? 0 : 1);
    return out.map((r, i) => ({ r, i })).sort((a, b) => score(a.r) - score(b.r) || a.i - b.i).map(x => x.r).slice(0, 16);
  }

  async function search(q) {
    const seq = ++state.searchSeq;
    const status = $('search-status');
    const list = $('results');
    list.innerHTML = '';
    status.textContent = 'Cercant…';
    const digits = q.replace(/[-\s]/g, '');
    const isbn = /^(\d{9}[\dXx]|\d{13})$/.test(digits) ? digits : null;
    const ca = onlyCatalan();
    const [g, o] = await Promise.allSettled([searchGoogle(q, isbn, ca), searchOpenLibrary(q, isbn, ca)]);
    if (seq !== state.searchSeq) return;
    if (g.status === 'rejected') console.error(g.reason);
    if (o.status === 'rejected') console.error(o.reason);
    if (g.status === 'rejected' && o.status === 'rejected') {
      status.textContent = 'La cerca no està disponible ara mateix. Encara pots afegir el llibre a mà.';
      return;
    }
    const results = mergeResults(g.value || [], o.value || [], ca);
    if (!results.length) {
      status.textContent = ca
        ? 'No s’ha trobat cap edició en català. Prova amb altres paraules o desmarca «Només edicions en català».'
        : 'No s’ha trobat res. Prova amb altres paraules o afegeix-lo a mà.';
      return;
    }
    status.textContent = plural(results.length, 'resultat', 'resultats');
    for (const r of results) list.appendChild(resultItem(r));
  }

  const LANG_LABEL = { ca: 'CA', en: 'EN', es: 'ES', fr: 'FR', de: 'DE', it: 'IT', pt: 'PT' };

  function resultItem(r) {
    const li = document.createElement('li');
    const btn = el('button', 'result');
    btn.type = 'button';
    const thumb = el('span', 'result-thumb');
    if (r.thumb) {
      const img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.src = r.thumb;
      img.onerror = () => img.remove();
      thumb.appendChild(img);
    }
    const text = el('span', 'result-text');
    text.append(
      el('span', 'result-title', r.title),
      el('span', 'result-meta', [r.authors.slice(0, 2).join(', '), r.year].filter(Boolean).join(' · '))
    );
    btn.append(thumb, text);
    if (r.lang && LANG_LABEL[r.lang]) {
      const tag = el('span', 'result-lang' + (r.lang === 'ca' ? ' ca' : ''), LANG_LABEL[r.lang]);
      tag.title = r.lang === 'ca' ? 'Edició en català' : 'Edició en una altra llengua';
      btn.appendChild(tag);
    }
    btn.addEventListener('click', () => pickResult(r, btn));
    li.appendChild(btn);
    return li;
  }

  function genreFrom(subjects) {
    for (const s of subjects || []) {
      for (const part of String(s).split('/')) {
        const k = part.toLowerCase().trim();
        if (GENRES[k]) return GENRES[k];
      }
    }
    return '';
  }

  const getJson = url => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null);

  // Colour for the spine. Google's images can't be read by the page, so try
  // Open Library's copy of the same cover (by ISBN) before giving up.
  async function coverColour(r) {
    if (r.cover && r.cover.includes('openlibrary.org')) return Books.sampleColour(r.cover);
    if (r.isbn) {
      const ol = `https://covers.openlibrary.org/b/isbn/${r.isbn}-M.jpg?default=false`;
      if (await Books.measureAspect(ol)) return Books.sampleColour(ol);
    }
    return null;
  }

  async function pickResult(r, btn) {
    for (const b of document.querySelectorAll('.result')) b.classList.toggle('is-picked', b === btn);
    const isCa = r.lang === 'ca';
    state.draft = {
      ...emptyDraft(state.newList),
      title: isCa ? r.title : '',
      title_en: r.lang === 'en' || (!isCa && !r.lang) ? r.title : '',
      author: r.authors.join(', '),
      year: r.year,
      pages: r.pages,
      genre: genreFrom(r.categories),
      description: r.description ? r.description.slice(0, 4000) : '',
      cover_url: r.cover,
      isbn: r.isbn,
      source: r.src === 'google' ? `google:${r.id}` : `openlibrary:${r.key}`
    };
    // A title in another language (e.g. Spanish) goes in the Catalan box so it
    // isn't lost; it can be corrected there.
    if (!state.draft.title && !state.draft.title_en) state.draft.title = r.title;
    showForm(true);
    $('book-form').scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });

    const draft = state.draft;
    // Find the Open Library work for the other-language title and, if needed,
    // a synopsis.
    let olKey = r.src === 'ol' ? r.key : r.olKey;
    if (!olKey && r.isbn) {
      const j = await getJson(`https://openlibrary.org/search.json?isbn=${r.isbn}&fields=key&limit=1`);
      olKey = j && j.docs && j.docs[0] && j.docs[0].key;
    }
    const [aspect, colour, work, editions] = await Promise.all([
      Books.measureAspect(r.cover),
      coverColour(r),
      olKey && !draft.description ? getJson(`https://openlibrary.org${olKey}.json`) : null,
      olKey ? getJson(`https://openlibrary.org${olKey}/editions.json?limit=200`) : null
    ]);
    if (state.draft !== draft) return;
    if (r.cover && aspect == null) { draft.cover_url = null; $('f-cover-clear').hidden = true; }
    if (aspect) draft.cover_aspect = aspect;
    if (colour) { draft.cover_tone = colour; draft.spine_color = colour; }
    const text = work && (typeof work.description === 'string' ? work.description : work.description && work.description.value);
    if (text && !$('f-desc').value.trim()) {
      draft.description = text.replace(/\r/g, '').replace(/\(\[source\]\[\d+\]\)|\[\d+\]:.*$/gm, '').replace(/-{3,}[\s\S]*$/, '').trim().slice(0, 4000);
      $('f-desc').value = draft.description;
    }
    const entries = (editions && editions.entries) || [];
    const inLang = code => entries.find(e => (e.languages || []).some(l => l.key === `/languages/${code}`) && e.title);
    const ca = inLang('cat'), en = inLang('eng');
    if (ca && !$('f-title').value.trim()) { draft.title = ca.title; $('f-title').value = ca.title; }
    if (en && !$('f-title-en').value.trim()) { draft.title_en = en.title; $('f-title-en').value = en.title; }
    readForm();
    setTitleLang(draft.title ? 'ca' : 'en');
    renderSwatches();
    renderPreview();
  }

  function readForm() {
    const d = state.draft;
    const num = v => { const n = parseInt(String(v).trim(), 10); return Number.isFinite(n) ? n : null; };
    d.title = $('f-title').value.trim();
    d.title_en = $('f-title-en').value.trim();
    d.author = $('f-author').value.trim() || null;
    d.year = num($('f-year').value);
    d.pages = num($('f-pages').value);
    d.genre = $('f-genre').value.trim() || null;
    d.description = $('f-desc').value.trim() || null;
  }

  function validate(d) {
    if (!d.title && !d.title_en) return ['f-title', 'Escriu el títol del llibre (en català o en anglès).'];
    if (d.year != null && (d.year < -3000 || d.year > 2100)) return ['f-year', 'L’any no sembla correcte.'];
    if (d.pages != null && (d.pages < 1 || d.pages > 20000)) return ['f-pages', 'Les pàgines han d’estar entre 1 i 20.000.'];
    return null;
  }

  async function saveBook(e) {
    e.preventDefault();
    readForm();
    const d = state.draft;
    const problem = validate(d);
    if (problem) {
      $('book-error').textContent = problem[1];
      if (problem[0] === 'f-title') setTitleLang(state.titleLang);
      $(problem[0] === 'f-title' && state.titleLang === 'en' ? 'f-title-en' : problem[0]).focus();
      return;
    }
    const fields = ['title', 'title_en', 'author', 'year', 'pages', 'genre', 'description', 'cover_url', 'cover_data', 'cover_aspect', 'spine_color', 'isbn', 'source', 'list'];
    const payload = {};
    for (const f of fields) payload[f] = d[f] === '' ? null : (d[f] ?? null);
    payload.cover_aspect = payload.cover_aspect || 0.66;
    payload.spine_color = payload.spine_color || d.cover_tone || Books.hashSwatch(d.title_en || d.title).hex;
    payload.list = payload.list || 'shelf';
    const btn = $('book-save');
    btn.disabled = true;
    try {
      const mine = state.cache.get(state.me.id) || [];
      if (state.editingId) {
        delete payload.list;
        const saved = await DB.updateBook(state.editingId, payload);
        storeBooks(state.me.id, mine.map(b => (b.id === saved.id ? saved : b)));
        toast('Canvis desats');
        location.hash = `#/llibre/${saved.id}`;
      } else {
        const saved = await DB.addBook(payload);
        storeBooks(state.me.id, [...mine, saved]);
        state.list = saved.list;
        state.decade = 'all';
        state.pendingFocus = saved.id;
        toast(saved.list === 'wishlist' ? 'Afegit a Per llegir' : 'Afegit a la prestatgeria');
        location.hash = shelfHref(state.me.id, saved.list);
      }
    } catch (err) {
      $('book-error').textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  }

  function bindEdit() {
    try { $('only-ca').checked = localStorage.getItem('shelf-only-ca') !== '0'; } catch (_) { $('only-ca').checked = true; }
    $('only-ca').addEventListener('change', () => {
      try { localStorage.setItem('shelf-only-ca', $('only-ca').checked ? '1' : '0'); } catch (_) { /* fine */ }
      const q = $('search-q').value.trim();
      if (q.length >= 2 && $('results').childElementCount) search(q);
    });
    $('search-form').addEventListener('submit', e => {
      e.preventDefault();
      const q = $('search-q').value.trim();
      if (q.length >= 2) search(q);
    });
    $('manual-btn').addEventListener('click', () => {
      for (const b of document.querySelectorAll('.result')) b.classList.remove('is-picked');
      state.draft = { ...emptyDraft(state.newList), title: $('search-q').value.trim() };
      showForm(true);
      $('f-title').focus();
    });
    for (const b of document.querySelectorAll('#title-lang button')) {
      b.addEventListener('click', () => {
        readForm();
        setTitleLang(b.dataset.lang);
        (b.dataset.lang === 'ca' ? $('f-title') : $('f-title-en')).focus();
      });
    }
    for (const b of document.querySelectorAll('#f-list button')) b.addEventListener('click', () => setDraftList(b.dataset.list));
    for (const id of ['f-title', 'f-title-en', 'f-author', 'f-year', 'f-pages']) {
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
        Object.assign(state.draft, { cover_data: dataUrl, cover_url: null, cover_aspect: aspect });
        const colour = await Books.sampleColour(dataUrl);
        if (colour) { state.draft.cover_tone = colour; state.draft.spine_color = colour; }
        $('f-cover-clear').hidden = false;
        $('book-error').textContent = '';
        renderSwatches();
        renderPreview(true);
      } catch (err) { $('book-error').textContent = err.message; }
    });
    $('f-cover-clear').addEventListener('click', () => {
      Object.assign(state.draft, { cover_url: null, cover_data: null, cover_aspect: 0.66, cover_tone: null });
      $('f-cover-clear').hidden = true;
      renderSwatches();
      renderPreview();
    });
    $('book-form').addEventListener('submit', saveBook);
  }

  // -------------------------------------------------------------- members

  async function renderMembers() {
    const ul = $('members');
    ul.innerHTML = '';
    ul.appendChild(el('li', 'muted', 'Carregant…'));
    try {
      const shelves = await DB.listShelves();
      ul.innerHTML = '';
      const sorted = shelves.slice().sort((a, b) => (a.id === state.me.id ? -1 : b.id === state.me.id ? 1 : a.display_name.localeCompare(b.display_name, 'ca')));
      for (const s of sorted) {
        const li = el('li');
        const a = el('a', 'member');
        a.href = shelfHref(s.id, 'shelf');
        const spines = el('span', 'member-spines');
        spines.setAttribute('aria-hidden', 'true');
        const n = Math.min(Number(s.read_count) || 0, 7);
        for (let i = 0; i < Math.max(n, 1); i++) {
          const sp = el('span');
          sp.style.setProperty('--c', n ? Books.PALETTE[(i * 3 + s.display_name.length) % Books.PALETTE.length].hex : 'transparent');
          if (!n) sp.classList.add('ghost');
          spines.appendChild(sp);
        }
        const name = el('span', 'member-name', s.display_name);
        if (s.id === state.me.id) name.appendChild(el('span', 'member-you', 'tu'));
        const counts = el('span', 'member-counts',
          `${plural(Number(s.read_count), 'llegit', 'llegits')} · ${Number(s.wish_count)} per llegir`);
        a.append(spines, name, counts);
        li.appendChild(a);
        ul.appendChild(li);
      }
    } catch (e) {
      ul.innerHTML = '';
      ul.appendChild(el('li', 'muted', e.message));
    }
  }

  // ------------------------------------------------------------- sign in

  let mode = 'in';
  function setMode(m) {
    mode = m;
    $('tab-in').setAttribute('aria-selected', String(m === 'in'));
    $('tab-up').setAttribute('aria-selected', String(m === 'up'));
    for (const n of document.querySelectorAll('.only-up')) n.hidden = m !== 'up';
    $('auth-submit').textContent = m === 'in' ? 'Entra' : 'Crea la prestatgeria';
    $('auth-pass').autocomplete = m === 'in' ? 'current-password' : 'new-password';
    $('signin-title').textContent = m === 'in' ? 'Obre la teva prestatgeria' : 'Comença una prestatgeria';
    $('auth-error').textContent = '';
  }

  const AUTH_ERRORS = {
    wrong: 'El nom d’usuari i la contrasenya no coincideixen.',
    locked: 'Massa intents fallits. Torna-ho a provar d’aquí a 15 minuts.',
    taken: 'Aquest nom d’usuari ja existeix. Prova’n un altre.',
    weak: 'La contrasenya ha de tenir com a mínim 4 caràcters.',
    bad_username: 'El nom d’usuari ha de tenir entre 2 i 30 caràcters.',
    busy: 'Ara mateix s’estan creant moltes prestatgeries. Torna-ho a provar d’aquí a una hora.',
    no_session: 'Alguna cosa no ha funcionat. Torna-ho a provar.'
  };

  function bindAuth() {
    $('tab-in').addEventListener('click', () => setMode('in'));
    $('tab-up').addEventListener('click', () => setMode('up'));
    $('form-auth').addEventListener('submit', async e => {
      e.preventDefault();
      const err = $('auth-error');
      const user = $('auth-user').value.trim();
      const pass = $('auth-pass').value;
      if (!user || !pass) { err.textContent = 'Escriu el nom d’usuari i la contrasenya.'; return; }
      if (mode === 'up') {
        if ([...user].length < 2) { err.textContent = AUTH_ERRORS.bad_username; return; }
        if ([...pass].length < 4) { err.textContent = AUTH_ERRORS.weak; return; }
        if (pass !== $('auth-pass2').value) { err.textContent = 'Les contrasenyes no coincideixen.'; return; }
      }
      const btn = $('auth-submit');
      btn.disabled = true;
      err.textContent = '';
      try {
        const result = mode === 'in' ? await DB.signIn(user, pass) : await DB.signUp(user, pass);
        if (result !== 'ok') { err.textContent = AUTH_ERRORS[result] || AUTH_ERRORS.no_session; return; }
        $('auth-pass').value = $('auth-pass2').value = '';
        state.me = await DB.whoami();
        state.cache.clear();
        state.owner = null;
        if (location.hash === '#/' || !location.hash) route(); else location.hash = '#/';
      } catch (ex) {
        err.textContent = ex.message;
      } finally {
        btn.disabled = false;
      }
    });
    $('sign-out').addEventListener('click', async () => {
      await DB.signOut();
      state.me = null;
      state.owner = null;
      state.cache.clear();
      state.books = [];
      setHeader();
      location.hash = '#/entra';
    });
  }

  // --------------------------------------------------------------- router

  async function showShelf(ownerId, list) {
    const changed = !state.owner || state.owner.id !== ownerId || state.list !== list;
    if (changed && state.list !== list) state.decade = 'all';
    state.list = list;
    await loadOwner(ownerId);
    show('shelf');
    const key = `${ownerId}:${list}:${window.SHELF_LANG}`;
    const focus = state.pendingFocus;
    state.pendingFocus = null;
    if (key !== state.shelfKey || focus) {
      state.shelfKey = key;
      state.decade = changed ? 'all' : state.decade;
      refreshShelf(focus);
    } else {
      renderTabs();
      renderFilters();
      setHeader();
    }
    state.shelf.resize();
    if (!reduceMotion()) gsap.fromTo('#stage .track', { opacity: 0 }, { opacity: 1, duration: 0.4 });
    $('stage').focus({ preventScroll: true });
  }

  async function route() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(x => { try { return decodeURIComponent(x); } catch (_) { return x; } });
    const [page, a, b] = parts;
    if (!state.me) {
      show('signin');
      setHeader();
      return;
    }
    try {
      if (page === 'llibre' && a) {
        show('book');
        await renderBookPage(a);
      } else if (page === 'afegeix') {
        await loadOwner(state.me.id);
        show('edit');
        openEditView(null, a === 'per-llegir' ? 'wishlist' : 'shelf');
      } else if (page === 'edita' && a) {
        await loadOwner(state.me.id);
        show('edit');
        openEditView(a);
      } else if (page === 'prestatgeries') {
        show('members');
        state.owner = null;
        setHeader();
        renderMembers();
      } else if (page === 'u' && a) {
        if (a === state.me.id) { location.replace(b === 'per-llegir' ? '#/per-llegir' : '#/'); return; }
        await showShelf(a, b === 'per-llegir' ? 'wishlist' : 'shelf');
      } else if (page === 'per-llegir') {
        await showShelf(state.me.id, 'wishlist');
      } else {
        if (page && page !== 'entra') { location.replace('#/'); return; }
        await showShelf(state.me.id, 'shelf');
      }
    } catch (e) {
      toast(e.message);
      if (page) location.replace('#/');
    }
    window.scrollTo(0, 0);
  }

  async function start() {
    state.shelf = new Shelf($('stage'), { onFocus, onOpen: openBook });
    $('prev').addEventListener('click', () => state.shelf.step(-1));
    $('next').addEventListener('click', () => state.shelf.step(1));
    for (const b of document.querySelectorAll('#list-tabs button')) {
      b.addEventListener('click', () => {
        if (!state.owner || b.dataset.list === state.list) return;
        location.hash = shelfHref(state.owner.id, b.dataset.list);
      });
    }
    for (const b of document.querySelectorAll('#lang button')) b.addEventListener('click', () => setLang(b.dataset.lang));
    bindAuth();
    bindEdit();
    bindBookPage();
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || $('confirm').open) return;
      if (/^(INPUT|TEXTAREA)$/.test(document.activeElement && document.activeElement.tagName)) return;
      if (state.view === 'book' || state.view === 'edit') location.hash = $('back').getAttribute('href');
    });
    try {
      state.me = await DB.whoami();
    } catch (e) {
      $('auth-error').textContent = e.message;
    }
    window.addEventListener('hashchange', route);
    route();
  }

  start();
})();
