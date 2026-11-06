# Larita's Book Shelf

A book shelf you can browse like a real one. Every book stands spine out; pick one and the shelf slides over while the book turns to show its cover. Pick a book further along and every book in between turns as the shelf passes it.

Plain HTML, CSS and JavaScript — no build step. Hosted on GitHub Pages, with sign-in and books stored in Supabase.

## Set up (once)

### 1. Supabase

In the Supabase project (`bzrdbrxoewzvtuutdhnn`):

1. **Turn on anonymous sign-ins:** Authentication → Sign In / Providers → **Allow anonymous sign-ins** → on → Save.
   Visitors never see this; it's how the site gets a session before someone signs in with a username and password.
2. **Create the tables and rules:** SQL Editor → New query → paste all of [`supabase/setup.sql`](supabase/setup.sql) → **Run**.
3. **Create Lara's profile:** run the private `lara-seed.sql` (kept out of this repository because it contains her password), the same way.

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

**Accounts.** Anyone can create a shelf with a username and password. Passwords are stored only as bcrypt hashes in a private schema the website can't read. Each person can read and change only their own books. Ten wrong passwords for one username in 15 minutes locks that username for a while; at most 30 new shelves can be created per hour.

**Adding books.** Search Open Library by title, author or ISBN, or add a book by hand. The cover's shape sets the book's width, the page count sets its thickness, and the spine colour is picked from the cover (from the house palette) — all editable. Uploaded cover photos are shrunk to a small WebP and stored with the book.

**Titles** are entered in the language the book was first published in.

**Order.** Books stand in order of the year they were first published; the filter row shows one button per decade on the shelf. Shelves with 8 or more books loop.

**Controls.** Click or tap a book to bring it to the centre; click the centred book to open it. Drag, scroll, swipe or use ← / → to move; Enter opens; Esc goes back. With *reduce motion* turned on, books cross-fade instead of turning.

## Releasing changes

Bump the `?v=` numbers in `index.html` when CSS or JS changes, so browsers fetch the new files.
