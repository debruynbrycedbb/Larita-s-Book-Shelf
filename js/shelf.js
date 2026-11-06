/* Larita's Book Shelf — the shelf.
 *
 * One number drives everything: `f`, the shelf's focus position. f = 7 means
 * book 7 is centred and facing you; f = 7.5 means books 7 and 8 are both half
 * turned. Every book's turn is worked out from its distance to f, so when f
 * glides from 3 to 9, books 4–8 each swing round to their cover and back as f
 * passes them — the "flip through" when you pick a book further along.
 *
 * Slots are keyed by a virtual index k (…, -1, 0, 1, …). Book k is
 * books[k mod n], so larger shelves loop seamlessly. Only slots near the
 * screen exist in the DOM.
 */
(function () {
  'use strict';

  const LOOP_MIN = 8;        // shelves with at least this many books wrap around
  const DRAG_START = 6;      // px before a press becomes a drag
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const mod = (a, n) => ((a % n) + n) % n;
  const smooth = x => x * x * (3 - 2 * x);

  class Shelf {
    constructor(stage, opts) {
      this.stage = stage;
      this.track = document.createElement('div');
      this.track.className = 'track';
      stage.appendChild(this.track);
      this.onFocus = opts.onFocus || (() => {});
      this.onOpen = opts.onOpen || (() => {});
      this.books = [];
      this.slots = new Map(); // k → { el, bookEl, shadow, dims, id }
      this.f = 0;
      this.targetK = 0;
      this.tween = null;
      this.focusedK = null;
      this.H = 400;
      this.bindInput();
      this.resizeObs = new ResizeObserver(() => this.resize());
      this.resizeObs.observe(stage);
    }

    get n() { return this.books.length; }
    get loop() { return this.n >= LOOP_MIN; }

    // ---------------------------------------------------------------- data

    setBooks(books, focusId) {
      this.books = books.slice();
      this.clearSlots();
      let idx = 0;
      if (focusId) {
        const i = this.books.findIndex(b => b.id === focusId);
        if (i >= 0) idx = i;
      } else if (this.n) {
        idx = clamp(Math.round(this.f), 0, this.n - 1);
        if (this.loop) idx = mod(Math.round(this.f), this.n);
      }
      this.killTween();
      this.f = this.targetK = idx;
      this.focusedK = null;
      this.render();
    }

    currentBook() {
      return this.n ? this.books[mod(Math.round(this.f), this.n)] : null;
    }

    clearSlots() {
      for (const s of this.slots.values()) s.el.remove();
      this.slots.clear();
    }

    resize() {
      const r = this.stage.getBoundingClientRect();
      if (!r.width || !r.height) return;
      // Height of every book: fill the stage, but keep the open cover narrow
      // enough to leave neighbours visible on phones.
      const H = Math.round(clamp(Math.min(r.height * (r.width < 640 ? 0.84 : 0.74), (r.width * 0.5) / 0.66), 180, 540));
      if (Math.abs(H - this.H) > 1) {
        this.H = H;
        this.clearSlots();
      }
      this.width = r.width;
      this.render();
    }

    // ------------------------------------------------------------ geometry

    slotFor(k) {
      let s = this.slots.get(k);
      if (s) return s;
      const book = this.books[mod(k, this.n)];
      const { root, dims } = Books.build(book, { H: this.H });
      const el = document.createElement('div');
      el.className = 'slot';
      el.dataset.k = k;
      el.style.setProperty('--h', dims.H + 'px');
      const shadow = document.createElement('div');
      shadow.className = 'slot-shadow';
      el.append(shadow, root);
      this.track.appendChild(el);
      s = { el, bookEl: root, shadow, dims, id: book.id };
      this.slots.set(k, s);
      return s;
    }

    turnOf(k) { return smooth(clamp(1 - Math.abs(k - this.f), 0, 1)); }

    footprint(d, t) {
      const a = (Math.PI / 2) * (1 - t);
      return d.W * Math.cos(a) + d.T * Math.sin(a);
    }

    render() {
      if (!this.width) return;
      const n = this.n;
      this.stage.classList.toggle('is-empty', !n);
      if (!n) { this.clearSlots(); return; }

      const H = this.H;
      const gap = H * 0.022;
      const k0 = Math.floor(this.f);
      const frac = this.f - k0;
      const reach = Math.ceil(this.width / (H * 0.12 + gap) / 2) + 3;
      let kMin = k0 - reach, kMax = k0 + reach + 1;
      if (!this.loop) { kMin = Math.max(kMin, 0); kMax = Math.min(kMax, n - 1); }

      // Widths and turns for the window of slots
      const info = new Map();
      for (let k = kMin; k <= kMax; k++) {
        const book = this.books[mod(k, n)];
        const d = Books.dims(book, H);
        const t = this.turnOf(k);
        info.set(k, { d, t, w: this.footprint(d, t) });
      }
      const gapBetween = (a, b) => gap + (info.get(a).t + info.get(b).t) * H * 0.045;

      // Centre positions relative to slot k0 (or nearest existing slot)
      const anchor = clamp(k0, kMin, kMax);
      const cx = new Map([[anchor, 0]]);
      for (let k = anchor + 1; k <= kMax; k++) {
        cx.set(k, cx.get(k - 1) + info.get(k - 1).w / 2 + gapBetween(k - 1, k) + info.get(k).w / 2);
      }
      for (let k = anchor - 1; k >= kMin; k--) {
        cx.set(k, cx.get(k + 1) - info.get(k + 1).w / 2 - gapBetween(k, k + 1) - info.get(k).w / 2);
      }
      let camera = cx.get(anchor);
      if (cx.has(anchor + 1) && anchor === k0) camera += (cx.get(anchor + 1) - cx.get(anchor)) * frac;
      else if (!this.loop) {
        // Rubber-band past the ends of a short shelf
        const over = this.f - anchor;
        camera += over * H * 0.25;
      }

      const mid = this.width / 2;
      const keep = new Set();
      for (let k = kMin; k <= kMax; k++) {
        const { w, t } = info.get(k);
        const x = mid + cx.get(k) - camera;
        if (x + w / 2 < -60 || x - w / 2 > this.width + 60) continue;
        keep.add(k);
        const s = this.slotFor(k);
        const angle = 90 * (1 - t) - 9 * t;
        const lift = -t * H * 0.035;
        s.el.style.transform = `translate3d(${x.toFixed(2)}px,0,${(t * 70).toFixed(1)}px)`;
        s.bookEl.style.transform = `translateY(${lift.toFixed(2)}px) rotateY(${angle.toFixed(2)}deg)`;
        s.shadow.style.width = `${(w * 1.08).toFixed(1)}px`;
        s.shadow.style.opacity = (0.55 + t * 0.45).toFixed(2);
        s.el.classList.toggle('is-front', t > 0.98);
      }
      for (const [k, s] of this.slots) {
        if (!keep.has(k)) { s.el.remove(); this.slots.delete(k); }
      }

      const fk = Math.round(this.f);
      if (fk !== this.focusedK) {
        this.focusedK = fk;
        const i = mod(fk, n);
        this.onFocus(this.books[i], i, n);
      }
    }

    // ----------------------------------------------------------- movement

    killTween() { if (this.tween) { this.tween.kill(); this.tween = null; } }

    // Glide to virtual index k. Books in between turn as the shelf passes them.
    goTo(k, opts = {}) {
      if (!this.n) return;
      if (!this.loop) k = clamp(k, 0, this.n - 1);
      this.targetK = k;
      this.killTween();
      const dist = Math.abs(k - this.f);
      if (dist < 0.001) { this.f = k; this.render(); return; }

      if (reduceMotion() || opts.instant) {
        if (opts.instant) { this.f = k; this.render(); return; }
        gsap.to(this.track, {
          opacity: 0, duration: 0.14, onComplete: () => {
            this.f = k; this.render();
            gsap.to(this.track, { opacity: 1, duration: 0.18 });
          }
        });
        return;
      }
      // Single step ≈ 0.65s; long jumps speed up per book but stay under 2s.
      const duration = clamp(0.65 + 0.16 * (dist - 1), 0.5, 1.9);
      this.tween = gsap.to(this, {
        f: k, duration, ease: dist > 1.5 ? 'power2.inOut' : 'power3.out',
        onUpdate: () => this.render(),
        onComplete: () => { this.tween = null; }
      });
    }

    step(dir) {
      const base = this.tween ? this.targetK : Math.round(this.f);
      this.goTo(base + dir);
    }

    // Move to a book by id, taking the shortest way round on a looping shelf.
    goToId(id) {
      const i = this.books.findIndex(b => b.id === id);
      if (i < 0) return;
      const cur = Math.round(this.f);
      let k = i;
      if (this.loop) {
        const base = cur - mod(cur, this.n);
        k = base + i;
        if (k - cur > this.n / 2) k -= this.n;
        if (cur - k > this.n / 2) k += this.n;
      }
      this.goTo(k);
    }

    // --------------------------------------------------------------- input

    bindInput() {
      const st = this.stage;
      let press = null;

      st.addEventListener('pointerdown', e => {
        if (e.button !== 0 || !this.n) return;
        press = { x: e.clientX, y: e.clientY, f0: this.f, dragging: false, last: [{ x: e.clientX, t: e.timeStamp }] };
      });

      window.addEventListener('pointermove', e => {
        if (!press) return;
        const dx = e.clientX - press.x;
        if (!press.dragging && Math.abs(dx) > DRAG_START && Math.abs(dx) > Math.abs(e.clientY - press.y)) {
          press.dragging = true;
          this.killTween();
          st.classList.add('is-dragging');
          try { st.setPointerCapture(e.pointerId); } catch (_) { /* fine */ }
        }
        if (!press.dragging) return;
        const stepPx = this.H * 0.2;
        let f = press.f0 - dx / stepPx;
        if (!this.loop) {
          const lo = 0, hi = this.n - 1;
          if (f < lo) f = lo - (lo - f) * 0.3;
          if (f > hi) f = hi + (f - hi) * 0.3;
        }
        this.f = f;
        press.last.push({ x: e.clientX, t: e.timeStamp });
        if (press.last.length > 5) press.last.shift();
        this.render();
      });

      const end = e => {
        if (!press) return;
        const p = press; press = null;
        st.classList.remove('is-dragging');
        if (p.dragging) {
          const a = p.last[0], b = p.last[p.last.length - 1];
          const v = (b.x - a.x) / Math.max(16, b.t - a.t); // px per ms
          const fling = clamp(-v * 260 / (this.H * 0.2), -6, 6);
          this.goTo(Math.round(this.f + fling));
          this.suppressClick = true;
          setTimeout(() => { this.suppressClick = false; }, 0);
          return;
        }
        if (e.type === 'pointercancel') return;
        const slot = e.target.closest && e.target.closest('.slot');
        if (!slot) return;
        const k = Number(slot.dataset.k);
        if (k === Math.round(this.f) && Math.abs(this.f - k) < 0.05 && !this.tween) {
          this.onOpen(this.books[mod(k, this.n)]);
        } else {
          this.goTo(k);
        }
      };
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);

      // Wheel and trackpad: scroll the shelf, then settle on the nearest book.
      let settle = null;
      st.addEventListener('wheel', e => {
        if (!this.n) return;
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        if (!delta) return;
        e.preventDefault();
        this.killTween();
        const px = e.deltaMode === 1 ? delta * 32 : delta;
        let f = this.f + px / (this.H * 0.45);
        if (!this.loop) f = clamp(f, -0.3, this.n - 0.7);
        this.f = f;
        this.render();
        clearTimeout(settle);
        settle = setTimeout(() => this.goTo(Math.round(this.f)), 130);
      }, { passive: false });

      st.addEventListener('keydown', e => {
        if (!this.n) return;
        if (e.key === 'ArrowRight') { e.preventDefault(); this.step(1); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); this.step(-1); }
        else if (e.key === 'Home' && !this.loop) { e.preventDefault(); this.goTo(0); }
        else if (e.key === 'End' && !this.loop) { e.preventDefault(); this.goTo(this.n - 1); }
        else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          const b = this.currentBook();
          if (b) this.onOpen(b);
        }
      });
    }
  }

  window.Shelf = Shelf;
})();
