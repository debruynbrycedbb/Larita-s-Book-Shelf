-- ============================================================================
-- Larita's Book Shelf — database setup (version 3)
--
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- It is safe to run again after changes (idempotent) and it upgrades an
-- earlier version in place: it never deletes books, profiles or comments.
--
-- How sign-in works
--   * Every visitor first gets a Supabase *anonymous* session (no email).
--   * They then sign in or create a shelf with a username + password.
--     Passwords are stored only as bcrypt hashes in app_private.credentials,
--     which the website can never read.
--   * app_private.sessions links the anonymous session to a profile, and every
--     rule below uses current_profile_id() to decide what you may touch.
--
-- Who can do what
--   * Signed-in members can see every shelf: books, ratings, reviews, quotes
--     and comments.
--   * Only a shelf's owner can add, change or remove its books and quotes.
--   * Any member can comment on any book; a comment can be deleted by its
--     author or by the owner of the book.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

-- ---------------------------------------------------------------- tables ----

create table if not exists public.profiles (
  id           uuid primary key default gen_random_uuid(),
  username     text not null unique,
  display_name text not null,
  created_at   timestamptz not null default now()
);
-- Usernames: anything people like (letters with accents, numbers, spaces,
-- symbols), 2–30 characters. Stored lower-case for matching; display_name
-- keeps the spelling they typed.
alter table public.profiles drop constraint if exists profiles_username_check;
alter table public.profiles drop constraint if exists profiles_display_name_check;
alter table public.profiles add constraint profiles_username_check
  check (char_length(username) between 2 and 30 and username = lower(btrim(username)) and username !~ '[[:cntrl:]]');
alter table public.profiles add constraint profiles_display_name_check
  check (char_length(display_name) between 1 and 40 and display_name !~ '[[:cntrl:]]');

create table if not exists app_private.credentials (
  profile_id    uuid primary key references public.profiles(id) on delete cascade,
  password_hash text not null
);

create table if not exists app_private.sessions (
  auth_uid   uuid primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists app_private.login_attempts (
  id       bigserial primary key,
  username text not null,
  success  boolean not null,
  at       timestamptz not null default now()
);
create index if not exists login_attempts_user_at on app_private.login_attempts (username, at);

create table if not exists app_private.signups (
  id bigserial primary key,
  at timestamptz not null default now()
);

-- ------------------------------------------------------------- helpers ----

create or replace function public.current_profile_id()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select s.profile_id from app_private.sessions s where s.auth_uid = auth.uid()
$$;

create table if not exists public.books (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null default public.current_profile_id()
               references public.profiles(id) on delete cascade,
  title        text,            -- title in Catalan
  author       text check (author is null or char_length(author) <= 200),
  year         int  check (year is null or year between -3000 and 2100),
  pages        int  check (pages is null or pages between 1 and 20000),
  genre        text check (genre is null or char_length(genre) <= 60),
  description  text check (description is null or char_length(description) <= 4000),
  cover_url    text check (cover_url is null or (cover_url ~ '^https://' and char_length(cover_url) <= 1000)),
  cover_data   text check (cover_data is null or (cover_data ~ '^data:image/(webp|jpeg|png);base64,' and char_length(cover_data) <= 400000)),
  cover_aspect real not null default 0.66 check (cover_aspect between 0.4 and 1.2),
  spine_color  text check (spine_color is null or spine_color ~ '^#[0-9a-fA-F]{6}$'),
  isbn         text check (isbn is null or char_length(isbn) <= 20),
  source       text check (source is null or char_length(source) <= 120),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Version 2 additions
alter table public.books alter column title drop not null;
alter table public.books add column if not exists title_en text;
alter table public.books add column if not exists list   text not null default 'shelf';
alter table public.books add column if not exists rating smallint;
alter table public.books add column if not exists review text;

-- Version 3: children's shelf ('kids') beside the main one, with an age range
alter table public.books add column if not exists section text not null default 'main';
alter table public.books add column if not exists age_min smallint;
alter table public.books add column if not exists age_max smallint;

alter table public.books drop constraint if exists books_title_check;
alter table public.books drop constraint if exists books_titles_check;
alter table public.books drop constraint if exists books_title_en_check;
alter table public.books drop constraint if exists books_list_check;
alter table public.books drop constraint if exists books_rating_check;
alter table public.books drop constraint if exists books_review_check;
alter table public.books drop constraint if exists books_section_check;
alter table public.books drop constraint if exists books_age_check;
alter table public.books add constraint books_titles_check
  check (coalesce(char_length(btrim(title)), 0) + coalesce(char_length(btrim(title_en)), 0) > 0);
alter table public.books add constraint books_title_check    check (title is null or char_length(title) <= 300);
alter table public.books add constraint books_title_en_check check (title_en is null or char_length(title_en) <= 300);
alter table public.books add constraint books_list_check     check (list in ('shelf', 'wishlist'));
alter table public.books add constraint books_rating_check   check (rating is null or rating between 1 and 10);
alter table public.books add constraint books_review_check   check (review is null or char_length(review) <= 6000);
alter table public.books add constraint books_section_check  check (section in ('main', 'kids'));
alter table public.books add constraint books_age_check      check (
  (age_min is null or age_min between 0 and 18) and
  (age_max is null or age_max between 0 and 18) and
  (age_min is null or age_max is null or age_min <= age_max));

create index if not exists books_profile on public.books (profile_id);

create table if not exists public.quotes (
  id         uuid primary key default gen_random_uuid(),
  book_id    uuid not null references public.books(id) on delete cascade,
  body       text not null check (char_length(btrim(body)) between 1 and 1500),
  page       text check (page is null or char_length(page) <= 20),
  created_at timestamptz not null default now()
);
create index if not exists quotes_book on public.quotes (book_id);

create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  book_id    uuid not null references public.books(id) on delete cascade,
  author_id  uuid not null default public.current_profile_id()
             references public.profiles(id) on delete cascade,
  body       text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists comments_book on public.comments (book_id);

create or replace function app_private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists books_touch on public.books;
create trigger books_touch before update on public.books
  for each row execute function app_private.touch_updated_at();

-- Is the caller signed in to a shelf?
create or replace function public.is_member()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from app_private.sessions s where s.auth_uid = auth.uid())
$$;

-- Does the caller own this book?
create or replace function public.owns_book(p_book uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.books b
    join app_private.sessions s on s.profile_id = b.profile_id
    where b.id = p_book and s.auth_uid = auth.uid()
  )
$$;

-- --------------------------------------------------------------- rules ----

alter table public.profiles enable row level security;
alter table public.books    enable row level security;
alter table public.quotes   enable row level security;
alter table public.comments enable row level security;

revoke all on public.profiles, public.books, public.quotes, public.comments from anon, authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.books to authenticated;
grant select, insert, delete on public.quotes, public.comments to authenticated;

-- profiles: every member can see who has a shelf
drop policy if exists "own profile"     on public.profiles;
drop policy if exists "members profiles" on public.profiles;
create policy "members profiles" on public.profiles
  for select to authenticated using (public.is_member());

-- books: members read all; owners write their own
drop policy if exists "own books read"     on public.books;
drop policy if exists "members books read" on public.books;
drop policy if exists "own books insert"   on public.books;
drop policy if exists "own books update"   on public.books;
drop policy if exists "own books delete"   on public.books;
create policy "members books read" on public.books for select to authenticated
  using (public.is_member());
create policy "own books insert" on public.books for insert to authenticated
  with check (profile_id = public.current_profile_id());
create policy "own books update" on public.books for update to authenticated
  using (profile_id = public.current_profile_id())
  with check (profile_id = public.current_profile_id());
create policy "own books delete" on public.books for delete to authenticated
  using (profile_id = public.current_profile_id());

-- quotes: members read; the book's owner adds and removes
drop policy if exists "members quotes read" on public.quotes;
drop policy if exists "owner quotes insert" on public.quotes;
drop policy if exists "owner quotes delete" on public.quotes;
create policy "members quotes read" on public.quotes for select to authenticated
  using (public.is_member());
create policy "owner quotes insert" on public.quotes for insert to authenticated
  with check (public.owns_book(book_id));
create policy "owner quotes delete" on public.quotes for delete to authenticated
  using (public.owns_book(book_id));

-- comments: members read and write; delete by author or book owner
drop policy if exists "members comments read"   on public.comments;
drop policy if exists "members comments insert" on public.comments;
drop policy if exists "comments delete"         on public.comments;
create policy "members comments read" on public.comments for select to authenticated
  using (public.is_member());
create policy "members comments insert" on public.comments for insert to authenticated
  with check (author_id = public.current_profile_id());
create policy "comments delete" on public.comments for delete to authenticated
  using (author_id = public.current_profile_id() or public.owns_book(book_id));

-- ------------------------------------------------------- sign up / in ----

create or replace function app_private.norm_username(p text)
returns text language sql immutable set search_path = '' as $$
  select lower(btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g')))
$$;

-- Version 1 had a three-argument sign_up; version 2 takes username + password.
drop function if exists public.sign_up(text, text, text);

-- Returns: ok | no_session | bad_username | weak | taken | busy
create or replace function public.sign_up(p_username text, p_password text)
returns text
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_display text := btrim(regexp_replace(coalesce(p_username, ''), '\s+', ' ', 'g'));
  v_user    text := app_private.norm_username(p_username);
  v_id      uuid;
begin
  if auth.uid() is null then return 'no_session'; end if;
  if char_length(v_user) not between 2 and 30 or v_user ~ '[[:cntrl:]]' then return 'bad_username'; end if;
  if char_length(coalesce(p_password, '')) < 4 or octet_length(p_password) > 72 then return 'weak'; end if;

  -- Open sign-up, but no more than 30 new shelves per hour across the site.
  if (select count(*) from app_private.signups where at > now() - interval '1 hour') >= 30 then
    return 'busy';
  end if;
  if exists (select 1 from public.profiles where username = v_user) then return 'taken'; end if;

  insert into public.profiles (username, display_name) values (v_user, left(v_display, 40)) returning id into v_id;
  insert into app_private.credentials (profile_id, password_hash)
    values (v_id, extensions.crypt(p_password, extensions.gen_salt('bf', 10)));
  insert into app_private.signups default values;
  insert into app_private.sessions (auth_uid, profile_id) values (auth.uid(), v_id)
    on conflict (auth_uid) do update set profile_id = excluded.profile_id, created_at = now();
  return 'ok';
end $$;

-- Returns: ok | no_session | wrong | locked
-- 10 wrong passwords for one username within 15 minutes locks that username for a while.
create or replace function public.sign_in(p_username text, p_password text)
returns text
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_user text := app_private.norm_username(p_username);
  v_id   uuid;
  v_hash text;
begin
  if auth.uid() is null then return 'no_session'; end if;

  if (select count(*) from app_private.login_attempts
        where username = v_user and not success and at > now() - interval '15 minutes') >= 10 then
    return 'locked';
  end if;

  select p.id, c.password_hash into v_id, v_hash
    from public.profiles p join app_private.credentials c on c.profile_id = p.id
   where p.username = v_user;

  if v_id is null then
    perform extensions.crypt(coalesce(p_password, ''), extensions.gen_salt('bf', 10)); -- same timing either way
    insert into app_private.login_attempts (username, success) values (v_user, false);
    return 'wrong';
  end if;

  if extensions.crypt(coalesce(p_password, ''), v_hash) <> v_hash then
    insert into app_private.login_attempts (username, success) values (v_user, false);
    return 'wrong';
  end if;

  insert into app_private.login_attempts (username, success) values (v_user, true);
  insert into app_private.sessions (auth_uid, profile_id) values (auth.uid(), v_id)
    on conflict (auth_uid) do update set profile_id = excluded.profile_id, created_at = now();
  return 'ok';
end $$;

create or replace function public.sign_out()
returns void
language sql volatile security definer
set search_path = ''
as $$
  delete from app_private.sessions where auth_uid = auth.uid()
$$;

-- Who am I? Empty when this browser isn't signed in to a shelf.
create or replace function public.whoami()
returns table (id uuid, username text, display_name text)
language sql stable security definer
set search_path = ''
as $$
  select p.id, p.username, p.display_name
    from app_private.sessions s join public.profiles p on p.id = s.profile_id
   where s.auth_uid = auth.uid()
$$;

-- Every shelf with its counts, for the members page. Members only.
-- (Version 3 added kids_count, so the old function is dropped first.)
drop function if exists public.list_shelves();
create function public.list_shelves()
returns table (id uuid, display_name text, read_count bigint, wish_count bigint, kids_count bigint, created_at timestamptz)
language sql stable security definer
set search_path = ''
as $$
  select p.id, p.display_name,
         count(b.id) filter (where b.section = 'main' and b.list = 'shelf'),
         count(b.id) filter (where b.section = 'main' and b.list = 'wishlist'),
         count(b.id) filter (where b.section = 'kids'),
         p.created_at
    from public.profiles p
    left join public.books b on b.profile_id = p.id
   where public.is_member()
   group by p.id
   order by p.display_name
$$;

-- Old attempt rows are only needed for the lockout window.
create or replace function app_private.prune_attempts()
returns trigger language plpgsql set search_path = '' as $$
begin
  delete from app_private.login_attempts where at < now() - interval '1 day';
  delete from app_private.signups        where at < now() - interval '1 day';
  return null;
end $$;
drop trigger if exists prune_attempts on app_private.login_attempts;
create trigger prune_attempts after insert on app_private.login_attempts
  for each statement execute function app_private.prune_attempts();

-- Only signed-in (incl. anonymous) sessions may call these; the bare anon key may not.
revoke all on function public.current_profile_id()     from public, anon;
revoke all on function public.is_member()              from public, anon;
revoke all on function public.owns_book(uuid)          from public, anon;
revoke all on function public.sign_up(text, text)      from public, anon;
revoke all on function public.sign_in(text, text)      from public, anon;
revoke all on function public.sign_out()               from public, anon;
revoke all on function public.whoami()                 from public, anon;
revoke all on function public.list_shelves()           from public, anon;
grant execute on function public.current_profile_id()  to authenticated;
grant execute on function public.is_member()           to authenticated;
grant execute on function public.owns_book(uuid)       to authenticated;
grant execute on function public.sign_up(text, text)   to authenticated;
grant execute on function public.sign_in(text, text)   to authenticated;
grant execute on function public.sign_out()            to authenticated;
grant execute on function public.whoami()              to authenticated;
grant execute on function public.list_shelves()        to authenticated;
