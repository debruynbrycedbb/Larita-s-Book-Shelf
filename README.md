# Larita's Book Shelf

A book shelf you can browse like a real one. Every book stands spine out; pick one and the shelf slides over while the book turns to show its cover. Pick a book further along and every book in between turns as the shelf passes it.

The site is in Catalan. Each person has two lists — **Llegits** (read) and **Per llegir** (wishlist) — and every signed-in member can browse everyone's shelves, read their ratings, reviews and favourite quotes, and leave comments.

Plain HTML, CSS and JavaScript — no build step. Hosted on GitHub Pages, with sign-in and books stored in Supabase.

## Set up (once)

### 1. Supabase

In the Supabase project (`bzrdbrxoewzvtuutdhnn`):

1. **Turn on anonymous sign-ins:** Authentication → Sign In / Providers → **Allow anonymous sign-ins** → on → Save.
   Visitors never see this; it's how the site gets a session before someone signs in with a username and password.
2. **Create the tables and rules:** SQL Editor → New query → paste all of [`supabase/setup.sql`](supabase/setup.sql) → **Run**.
3. **Create Lara's profile and books:** run the private `lara-seed.sql` (kept out of this repository because it contains her password), the same way. It is safe to re-run: it only adds books she doesn't have yet.

`setup.sql` is safe to run again; it never deletes data. **Any time it changes, run it again.**

### 2. GitHub Pages

Repository **Settings → Pages** → *Deploy from a branch* → branch **main**, folder **/ (root)** → Save.
The site appears at `https://debruynbrycedbb.github.io/Larita-s-Book-Shelf/` after a minute or two.

## How it works

| File | Job |
|---|---|
| `index.html` | All pages: sign in, shelf, book, add/edit |
| `js/config.js` | Supabase address and *publishable* key (safe to be public) |
| `js/db.js` | Sign-in, sign-up and reading/writing books |
| `js/books.js` | Builds a 3D book from a record: cover, generated spine, thickness from page count |
| `js/shelf.js` | The shelf: positions, the spine-to-cover turn, drag, wheel, keys, looping |
| `js/app.js` | Pages, Open Library search, add/edit/remove, routing |
| `css/style.css` | All styling |
| `supabase/setup.sql` | Database tables, sign-in functions and access rules |
| `assets/fonts/` | Newsreader, Inter and a slimmed Roboto Serif for spines (SIL Open Font Licence, included) |
| `js/vendor/` | GSAP and supabase-js, self-hosted |

**Accounts.** Anyone can create a shelf with any username (2–30 characters, accents and spaces welcome) and any password of at least 4 characters. Passwords are stored only as bcrypt hashes in a private schema the website can't read. Ten wrong passwords for one username in 15 minutes locks that username for a while; at most 30 new shelves can be created per hour.

**Sharing.** Signed-in members can see every shelf (Prestatgeries page). Only the owner can add, edit or remove their books, ratings, reviews and quotes. Any member can comment on any book; a comment can be deleted by its author or by the book's owner.

**Infantil.** A separate children's shelf (menu: *Infantil*), with its own Llegits / Per llegir lists and the same book pages. Each children's book has a recommended age range, shown with the matching Catalan school year (Llar d'infants, P3–P5, Primària, ESO, Batxillerat) in a box on the book page, where the owner can set it. The shelf filters by age or by school year instead of by decade. A book can be moved between the two shelves in *Edita els detalls*.

**Each book's page** has the synopsis under the book, a rating out of 10 stars, the owner's review, favourite quotes (with optional page) and comments.

**Adding books.** Search by title, author or ISBN — Google Books and Open Library are searched together, duplicates merged and Catalan editions listed first; «Només edicions en català» (on by default) hides the rest. Or add a book by hand. Catalan synopses usually come from Google Books; the other-language title comes from Open Library’s editions; you choose which language you're typing in. The cover's shape sets the book's width, the page count its thickness, and the spine colour is taken from the cover and toned so every spine shares the same look — all editable. Uploaded cover photos are shrunk to a small WebP and stored with the book.

**Titles** show in Catalan by default; the CA / EN switch at the top shows English titles instead (remembered in that browser). A book with only one title shows that one in both modes.

**Order.** Books stand in order of the year they were first published; the filter row shows one button per decade. Shelves with 8 or more books loop.

**Controls.** Click or tap a book to bring it to the centre; click the centred book to open it. Drag, scroll, swipe or use ← / → to move; Enter opens; Esc goes back. With *reduce motion* turned on, books cross-fade instead of turning.

## Releasing changes

Bump the `?v=` numbers in `index.html` when CSS or JS changes, so browsers fetch the new files.
