/* Larita's Book Shelf — building a 3D book from a book record.
 *
 * A book is a box made of four CSS faces (front, back, spine, page edge).
 * Its size comes from the record: height is shared by every book, width from
 * the cover's proportions, thickness from the page count. The spine is drawn
 * here: colour from a small house palette, the title set vertically, a crop of
 * the cover art as an emblem, the author's surname and the year at the foot.
 */
(function () {
  'use strict';

  // House palette for spines. Every spine uses one of these so a shelf of
  // mixed covers still reads as one set.
  const PALETTE = [
    { id: 'cobalt', hex: '#2340b8', ink: '#efe9db', name: 'Cobalt' },
    { id: 'ink',    hex: '#1f1d1b', ink: '#ece5d4', name: 'Tinta' },
    { id: 'cream',  hex: '#e6dcc6', ink: '#1f1d1b', name: 'Crema' },
    { id: 'green',  hex: '#1f4f43', ink: '#ece5d4', name: 'Verd ampolla' },
    { id: 'brick',  hex: '#b4442e', ink: '#f3ecdc', name: 'Maó' },
    { id: 'ochre',  hex: '#c8973c', ink: '#1f1d1b', name: 'Ocre' },
    { id: 'slate',  hex: '#4a5b6c', ink: '#ece5d4', name: 'Pissarra' },
    { id: 'rose',   hex: '#c98f86', ink: '#1f1d1b', name: 'Rosa' }
  ];

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function swatchFor(hex) {
    if (!hex) return null;
    const h = hex.toLowerCase();
    return PALETTE.find(p => p.hex === h) || null;
  }

  // Pick a stable fallback colour from the title when the cover can't be read.
  function hashSwatch(text) {
    let h = 2166136261;
    for (const ch of String(text || '')) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
    return PALETTE[Math.abs(h) % PALETTE.length];
  }

  // Ink colour that reads on an arbitrary background (for non-palette colours).
  function inkFor(hex) {
    const [r, g, b] = hexToRgb(hex);
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return lum > 0.55 ? '#1f1d1b' : '#efe9db';
  }

  // Title in the chosen language, falling back to the other one.
  function titleOf(book, lang) {
    lang = lang || window.SHELF_LANG || 'ca';
    const ca = (book.title || '').trim(), en = (book.title_en || '').trim();
    return lang === 'en' ? (en || ca) : (ca || en);
  }

  function spineColours(book) {
    const sw = swatchFor(book.spine_color) || (book.spine_color ? null : hashSwatch(titleOf(book, 'en')));
    if (sw) return { bg: sw.hex, ink: sw.ink };
    return { bg: book.spine_color, ink: inkFor(book.spine_color) };
  }

  // Turns a cover's average colour into a spine colour: same hue as the
  // cover, but toned so every spine sits well on the shelf and the shared
  // spine typography stays readable. Light covers become pale paper spines;
  // the rest become deep, slightly muted spines.
  function toneColour([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h /= 6;
    }
    let S, L;
    if (l > 0.66) { S = Math.min(s, 0.32); L = clamp(l, 0.8, 0.87); }
    else { S = clamp(s, 0.08, 0.58); L = clamp(l, 0.2, 0.44); }
    const hue2 = (p, q, t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = L < 0.5 ? L * (1 + S) : L + S - L * S, p = 2 * L - q;
    const out = [hue2(p, q, h + 1 / 3), hue2(p, q, h), hue2(p, q, h - 1 / 3)];
    return '#' + out.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
  }

  // Reads the dominant colour of an image. Resolves null when the image
  // can't be read (e.g. a cover host that doesn't allow it).
  function sampleColour(src) {
    return new Promise(resolve => {
      if (!src) return resolve(null);
      const img = new Image();
      if (!src.startsWith('data:')) img.crossOrigin = 'anonymous';
      const done = v => { clearTimeout(timer); resolve(v); };
      const timer = setTimeout(() => done(null), 6000);
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = 24; c.height = 36;
          const ctx = c.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, 24, 36);
          const d = ctx.getImageData(0, 0, 24, 36).data;
          let R = 0, G = 0, B = 0, W = 0;
          for (let i = 0; i < d.length; i += 4) {
            const r = d[i], g = d[i + 1], b = d[i + 2];
            const max = Math.max(r, g, b), min = Math.min(r, g, b);
            const w = 0.25 + (max - min) / 255; // favour colourful pixels
            R += r * w; G += g * w; B += b * w; W += w;
          }
          done(toneColour([R / W, G / W, B / W]));
        } catch (e) { done(null); }
      };
      img.onerror = () => done(null);
      img.src = src;
    });
  }

  // Width / height of a cover image (no special permissions needed).
  function measureAspect(src) {
    return new Promise(resolve => {
      if (!src) return resolve(null);
      const img = new Image();
      const timer = setTimeout(() => resolve(null), 8000);
      img.onload = () => {
        clearTimeout(timer);
        const a = img.naturalWidth / img.naturalHeight;
        // Open Library returns a 1×1 placeholder when it has no cover.
        resolve(img.naturalWidth > 10 && isFinite(a) ? clamp(a, 0.45, 1.1) : null);
      };
      img.onerror = () => { clearTimeout(timer); resolve(null); };
      img.src = src;
    });
  }

  // Turns an uploaded photo into a compact WebP data URL (max 640px tall).
  async function processUpload(file) {
    if (!file || !/^image\//.test(file.type)) throw new Error('Tria un fitxer d’imatge.');
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 640 / bmp.height);
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    let q = 0.82, url = c.toDataURL('image/webp', q);
    if (!url.startsWith('data:image/webp')) url = c.toDataURL('image/jpeg', q); // Safari fallback
    while (url.length > 380000 && q > 0.4) {
      q -= 0.12;
      url = c.toDataURL(url.startsWith('data:image/webp') ? 'image/webp' : 'image/jpeg', q);
    }
    if (url.length > 380000) throw new Error('La imatge és massa gran. Prova amb una foto més petita.');
    return { dataUrl: url, aspect: clamp(c.width / c.height, 0.45, 1.1) };
  }

  function coverSrc(book) { return book.cover_data || book.cover_url || null; }

  // Box size in px for a given book height.
  function dims(book, H) {
    const aspect = clamp(Number(book.cover_aspect) || 0.66, 0.45, 1.1);
    const pages = Number(book.pages) || 320;
    return { W: H * aspect, H, T: H * clamp(0.1 + 0.0002 * pages, 0.11, 0.24) };
  }

  function surname(author) {
    const first = String(author || '').split(/[,;&]| and /)[0].trim();
    const parts = first.split(/\s+/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // Fit the vertical spine title: one line when it fits comfortably,
  // otherwise two lines at a smaller size.
  function fitSpineTitle(node, title, d) {
    const len = Math.max(4, [...title].length);
    const avail = d.H * 0.6;
    const one = avail / (len * 0.5);
    if (one >= d.T * 0.3) {
      node.style.fontSize = Math.min(one, d.T * 0.52) + 'px';
      node.classList.remove('two');
    } else {
      node.style.fontSize = Math.max(7, Math.min((avail * 2) / (len * 0.5) * 0.92, d.T * 0.3)) + 'px';
      node.classList.add('two');
    }
  }

  /**
   * Builds the DOM for one book.
   * opts.H      book height in px
   * opts.flat   true → no 3D faces besides front (for tiny previews)
   */
  function build(book, opts) {
    const d = dims(book, opts.H);
    const col = spineColours(book);
    const src = coverSrc(book);

    const root = el('div', 'book');
    root.style.setProperty('--w', d.W + 'px');
    root.style.setProperty('--h', d.H + 'px');
    root.style.setProperty('--t', d.T + 'px');
    root.style.setProperty('--spine', col.bg);
    root.style.setProperty('--spine-ink', col.ink);

    // Front cover
    const front = el('div', 'face front');
    if (src) {
      const img = el('img', 'cover-img');
      img.alt = '';
      img.decoding = 'async';
      img.loading = opts.eager ? 'eager' : 'lazy';
      img.draggable = false;
      img.src = src;
      img.onerror = () => { img.remove(); front.appendChild(typeCover(book)); };
      front.appendChild(img);
    } else {
      front.appendChild(typeCover(book));
    }

    // Spine
    const spine = el('div', 'face spine');
    const emblem = el('div', 'spine-emblem');
    if (src) emblem.style.backgroundImage = `url("${src.replace(/"/g, '%22')}")`;
    else emblem.classList.add('plain');
    const shown = titleOf(book);
    const title = el('div', 'spine-title', shown);
    title.lang = 'und';
    fitSpineTitle(title, shown, d);
    const foot = el('div', 'spine-foot');
    const sn = surname(book.author);
    if (sn) foot.appendChild(el('span', 'spine-author', sn));
    if (book.year) foot.appendChild(el('span', 'spine-year', String(book.year)));
    spine.append(emblem, title, foot);

    root.append(front, el('div', 'face rear'), spine, el('div', 'face pages'));
    return { root, dims: d };
  }

  // A typographic cover for books without an image.
  function typeCover(book) {
    const c = el('div', 'type-cover');
    if (book.author) c.appendChild(el('span', 'tc-author', book.author));
    c.appendChild(el('span', 'tc-title', titleOf(book)));
    c.appendChild(el('span', 'tc-rule'));
    if (book.year) c.appendChild(el('span', 'tc-year', String(book.year)));
    return c;
  }

  window.Books = {
    PALETTE, build, dims, coverSrc, sampleColour, measureAspect, processUpload,
    hashSwatch, spineColours, surname, titleOf, toneColour
  };
})();
