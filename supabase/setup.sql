-- ============================================================================
-- Larita's Book Shelf — database setup
--
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- It is safe to run again after changes (idempotent): it never deletes data.
--
-- How sign-in works
--   * Every visitor first gets a Supabase *anonymous* session (no email).
--   * They then sign in or sign up with a username + password. Passwords are
--     stored only as bcrypt hashes in app_private.credentials, which the
--     website can never read.
--   * app_private.sessions links the anonymous session to a profile, and every
--     rule below uses current_profile_id() to decide what you may touch.
--   * Each person can only read and change their own books.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

-- ---------------------------------------------------------------- tables ----

create table if not exists public.profiles (
  id           uuid primary key default gen_random_uuid(),
  username     text not null unique
               check (username ~ '^[a-z0-9_.-]{2,24}$'),
  display_name text not null
               check (char_length(display_name) between 1 and 40),
  created_at   timestamptz not null default now()
);

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
  title        text not null check (char_length(title) between 1 and 300),
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
create index if not exists books_profile on public.books (profile_id);

create or replace function app_private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists books_touch on public.books;
create trigger books_touch before update on public.books
  for each row execute function app_private.touch_updated_at();

-- --------------------------------------------------------------- rules ----

alter table public.profiles enable row level security;
alter table public.books    enable row level security;

revoke all on public.profiles, public.books from anon, authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.books to authenticated;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for select to authenticated using (id = public.current_profile_id());

drop policy if exists "own books read"   on public.books;
drop policy if exists "own books insert" on public.books;
drop policy if exists "own books update" on public.books;
drop policy if exists "own books delete" on public.books;
create policy "own books read"   on public.books for select to authenticated
  using (profile_id = public.current_profile_id());
create policy "own books insert" on public.books for insert to authenticated
  with check (profile_id = public.current_profile_id());
create policy "own books update" on public.books for update to authenticated
  using (profile_id = public.current_profile_id())
  with check (profile_id = public.current_profile_id());
create policy "own books delete" on public.books for delete to authenticated
  using (profile_id = public.current_profile_id());

-- ------------------------------------------------------- sign up / in ----

-- Returns: ok | no_session | bad_username | bad_name | weak | taken | busy
create or replace function public.sign_up(p_username text, p_display_name text, p_password text)
returns text
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_user text := lower(btrim(coalesce(p_username, '')));
  v_name text := btrim(coalesce(p_display_name, ''));
  v_id   uuid;
begin
  if auth.uid() is null then return 'no_session'; end if;
  if v_user !~ '^[a-z0-9_.-]{2,24}$' then return 'bad_username'; end if;
  if char_length(v_name) not between 1 and 40 then return 'bad_name'; end if;
  if char_length(coalesce(p_password, '')) < 8 or char_length(p_password) > 72 then return 'weak'; end if;

  -- Open sign-up, but no more than 30 new shelves per hour across the site.
  if (select count(*) from app_private.signups where at > now() - interval '1 hour') >= 30 then
    return 'busy';
  end if;
  if exists (select 1 from public.profiles where username = v_user) then return 'taken'; end if;

  insert into public.profiles (username, display_name) values (v_user, v_name) returning id into v_id;
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
  v_user text := lower(btrim(coalesce(p_username, '')));
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
revoke all on function public.current_profile_id()                from public, anon;
revoke all on function public.sign_up(text, text, text)           from public, anon;
revoke all on function public.sign_in(text, text)                 from public, anon;
revoke all on function public.sign_out()                          from public, anon;
revoke all on function public.whoami()                            from public, anon;
grant execute on function public.current_profile_id()             to authenticated;
grant execute on function public.sign_up(text, text, text)        to authenticated;
grant execute on function public.sign_in(text, text)              to authenticated;
grant execute on function public.sign_out()                       to authenticated;
grant execute on function public.whoami()                         to authenticated;
