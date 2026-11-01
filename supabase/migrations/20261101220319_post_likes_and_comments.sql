create table public.post_likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index post_likes_user_idx on public.post_likes(user_id);

create table public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  content text not null check (char_length(btrim(content)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index post_comments_post_idx on public.post_comments(post_id, created_at, id);
create index post_comments_author_idx on public.post_comments(author_id);

alter table public.post_likes enable row level security;
alter table public.post_comments enable row level security;
revoke all on public.post_likes, public.post_comments from anon, authenticated;
grant select, insert, delete on public.post_likes, public.post_comments to authenticated;

create policy "Family can read likes on visible posts" on public.post_likes
  for select to authenticated using (
    (select private.is_approved_member())
    and exists (select 1 from public.posts where id = post_id)
  );
create policy "Family can like visible posts as themselves" on public.post_likes
  for insert to authenticated with check (
    user_id = (select auth.uid()) and (select private.is_approved_member())
    and exists (select 1 from public.posts where id = post_id)
  );
create policy "Family can remove their own likes" on public.post_likes
  for delete to authenticated using (
    user_id = (select auth.uid()) and (select private.is_approved_member())
    and exists (select 1 from public.posts where id = post_id)
  );

create policy "Family can read comments on visible posts" on public.post_comments
  for select to authenticated using (
    (select private.is_approved_member())
    and exists (select 1 from public.posts where id = post_id)
  );
create policy "Family can comment as themselves" on public.post_comments
  for insert to authenticated with check (
    author_id = (select auth.uid()) and (select private.is_approved_member())
    and exists (select 1 from public.posts where id = post_id)
  );
create policy "Authors and editors can delete comments" on public.post_comments
  for delete to authenticated using (
    (author_id = (select auth.uid()) or (select private.is_admin_or_owner()))
    and (select private.is_approved_member())
    and exists (select 1 from public.posts where id = post_id)
  );
notify pgrst, 'reload schema';
