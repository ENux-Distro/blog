-- Blog database schema for Supabase.
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Passwords are handled by Supabase Auth (bcrypt-hashed, stored in auth.users),
-- never in this repo and never in these tables.

-- ───────────────────────── Tables ─────────────────────────

create table public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  username        text not null unique
                    check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  is_admin        boolean not null default false,
  tos_accepted_at timestamptz not null,
  created_at      timestamptz not null default now()
);
-- Case-insensitive uniqueness ("Emir" and "emir" can't both exist).
create unique index profiles_username_lower on public.profiles (lower(username));

create table public.posts (
  id         bigint generated always as identity primary key,
  author_id  uuid not null references public.profiles (id) on delete cascade,
  subject    text not null check (char_length(subject) between 1 and 30),
  title      text not null check (char_length(title) between 1 and 300),
  body       text not null check (char_length(body) between 1 and 40000),
  created_at timestamptz not null default now()
);
create index posts_created_at on public.posts (created_at desc);

create table public.votes (
  post_id    bigint not null references public.posts (id) on delete cascade,
  user_id    uuid   not null references public.profiles (id) on delete cascade,
  value      smallint not null check (value in (-1, 1)),  -- 1 = like, -1 = dislike
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table public.comments (
  id         bigint generated always as identity primary key,
  post_id    bigint not null references public.posts (id) on delete cascade,
  author_id  uuid   not null references public.profiles (id) on delete cascade,
  body       text   not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);
create index comments_post on public.comments (post_id, created_at);

-- ───────────────────────── Helpers ─────────────────────────

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- Lets the signup form check a username before creating the account.
create or replace function public.username_available(name text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.profiles where lower(username) = lower(name));
$$;

-- Creates the profile row automatically when someone signs up.
-- The signup form passes username + ToS acceptance as user metadata.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce((new.raw_user_meta_data ->> 'tos_accepted')::boolean, false) is not true then
    raise exception 'You must accept the Terms of Service';
  end if;
  insert into public.profiles (id, username, tos_accepted_at)
  values (new.id, new.raw_user_meta_data ->> 'username', now());
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Admin-only: deletes a user's login, profile, posts, votes and comments.
create or replace function public.admin_delete_user(target uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can delete users';
  end if;
  if target = auth.uid() then
    raise exception 'Admins cannot delete themselves here';
  end if;
  delete from auth.users where id = target;  -- cascades to everything else
end;
$$;

revoke execute on function public.admin_delete_user(uuid) from public, anon;
grant execute on function public.admin_delete_user(uuid) to authenticated;

-- ───────────────────────── Feed view ─────────────────────────
-- security_invoker = the caller's row-level security applies.

create view public.post_feed with (security_invoker = true) as
select
  p.id, p.subject, p.title, p.body, p.created_at, p.author_id,
  pr.username as author_username,
  pr.is_admin as author_is_admin,
  coalesce((select count(*) from public.votes v where v.post_id = p.id and v.value =  1), 0)::int as likes,
  coalesce((select count(*) from public.votes v where v.post_id = p.id and v.value = -1), 0)::int as dislikes,
  coalesce((select count(*) from public.comments c where c.post_id = p.id), 0)::int as comment_count,
  (select v.value from public.votes v where v.post_id = p.id and v.user_id = auth.uid()) as my_vote
from public.posts p
join public.profiles pr on pr.id = p.author_id;

-- ───────────────────────── Row-level security ─────────────────────────
-- Everyone (even logged out) can read. Only logged-in users can write,
-- and only their own rows. Admins can additionally delete anything.

alter table public.profiles enable row level security;
alter table public.posts    enable row level security;
alter table public.votes    enable row level security;
alter table public.comments enable row level security;

create policy "profiles readable by all" on public.profiles for select using (true);
-- No insert/update/delete policies: profiles are created by the trigger only,
-- so nobody can make themselves admin.

create policy "posts readable by all"   on public.posts for select using (true);
create policy "users create own posts"  on public.posts for insert to authenticated
  with check (author_id = auth.uid());
create policy "author or admin deletes" on public.posts for delete to authenticated
  using (author_id = auth.uid() or public.is_admin());

create policy "votes readable by all"  on public.votes for select using (true);
create policy "users vote as self"     on public.votes for insert to authenticated
  with check (user_id = auth.uid());
create policy "users change own vote"  on public.votes for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "users remove own vote"  on public.votes for delete to authenticated
  using (user_id = auth.uid());

create policy "comments readable by all"   on public.comments for select using (true);
create policy "users comment as self"      on public.comments for insert to authenticated
  with check (author_id = auth.uid());
create policy "author or admin deletes c"  on public.comments for delete to authenticated
  using (author_id = auth.uid() or public.is_admin());

grant select on public.post_feed to anon, authenticated;

-- ───────────────────────── Image storage ─────────────────────────
-- Public bucket: anyone can view images; logged-in users upload into
-- a folder named after their own user id. Max 5 MB, images only.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-images', 'post-images', true, 5242880,
        array['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

create policy "upload own images" on storage.objects for insert to authenticated
  with check (bucket_id = 'post-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "delete own images" on storage.objects for delete to authenticated
  using (bucket_id = 'post-images' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- ───────────────────────── Make yourself admin ─────────────────────────
-- After you sign up on the site, run this once (with your username):
--   update public.profiles set is_admin = true where username = 'emir';
