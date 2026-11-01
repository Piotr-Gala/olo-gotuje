-- Retain ownership after deletion so attachment cleanup remains author-only.
create table private.post_authors (
  post_id uuid primary key,
  author_id uuid not null references public.profiles(id)
);
insert into private.post_authors select id, author_id from public.posts;
alter table private.post_authors enable row level security;
grant select on private.post_authors to authenticated;
create policy "Authors can read their ownership records" on private.post_authors
  for select to authenticated using (author_id = (select auth.uid()));

create function private.owns_post(target_id text) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from private.post_authors
    where post_id::text = target_id and author_id = (select auth.uid()));
$$;
revoke all on function private.owns_post(text) from public, anon;
grant execute on function private.owns_post(text) to authenticated;

create function private.record_post_author() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.author_id <> old.author_id then
      raise exception 'Post identity and author are immutable' using errcode = '42501';
    end if;
  else
    if auth.uid() is not null and new.author_id <> auth.uid() then
      raise exception 'Cannot create a post for another author' using errcode = '42501';
    end if;
    insert into private.post_authors values (new.id, new.author_id) on conflict (post_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function private.record_post_author() from public, anon, authenticated;
create trigger posts_record_author before insert or update on public.posts
  for each row execute function private.record_post_author();

alter policy "Members can read published posts from active sections" on public.posts
using ((select private.is_approved_member()) and (
  author_id = (select auth.uid()) or (status = 'published' and exists (
    select 1 from public.sections where slug = posts.section_slug and is_active))));
alter policy "Editors can update posts" on public.posts
using ((select private.is_admin_or_owner()) and author_id = (select auth.uid()))
with check ((select private.is_admin_or_owner()) and author_id = (select auth.uid()));
alter policy "Editors can delete posts" on public.posts
using ((select private.is_admin_or_owner()) and author_id = (select auth.uid()));

alter policy "Members can read images for visible posts" on public.post_images
using (exists (select 1 from public.posts where id = post_images.post_id));
alter policy "Editors can add images" on public.post_images
with check ((select private.is_admin_or_owner()) and private.owns_post(post_id::text)
  and (storage.foldername(storage_path))[1] = post_id::text
  and exists (select 1 from public.posts where id = post_images.post_id));
alter policy "Editors can update images" on public.post_images
using ((select private.is_admin_or_owner()) and private.owns_post(post_id::text))
with check ((select private.is_admin_or_owner()) and private.owns_post(post_id::text)
  and (storage.foldername(storage_path))[1] = post_id::text
  and exists (select 1 from public.posts where id = post_images.post_id));
alter policy "Editors can delete images" on public.post_images
using ((select private.is_admin_or_owner()) and private.owns_post(post_id::text));

alter policy "Family can read images for visible posts" on storage.objects
using (bucket_id = 'family-post-images' and (select private.is_approved_member()) and (
  private.owns_post((storage.foldername(name))[1]) or exists (
    select 1 from public.post_images where storage_path = storage.objects.name)));
alter policy "Editors can upload post images" on storage.objects
with check (bucket_id = 'family-post-images' and (select private.is_admin_or_owner())
  and private.owns_post((storage.foldername(name))[1])
  and exists (select 1 from public.posts where id::text = (storage.foldername(name))[1]));
alter policy "Editors can update post images" on storage.objects
using (bucket_id = 'family-post-images' and (select private.is_admin_or_owner()) and private.owns_post((storage.foldername(name))[1]))
with check (bucket_id = 'family-post-images' and (select private.is_admin_or_owner()) and private.owns_post((storage.foldername(name))[1]));
alter policy "Editors can delete post images" on storage.objects
using (bucket_id = 'family-post-images' and (select private.is_admin_or_owner()) and private.owns_post((storage.foldername(name))[1]));

-- A detached video keeps its author for retries and delayed R2 cleanup.
alter table public.post_videos add column author_id uuid references public.profiles(id);
update public.post_videos v set author_id = p.author_id from public.posts p where p.id = v.post_id;
-- Legacy detached cleanup rows have no recoverable author and remain inaccessible to clients.
create function private.set_video_author() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    select author_id into new.author_id from public.posts where id = new.post_id;
    if new.author_id is null or new.author_id <> auth.uid() then
      raise exception 'Video requires own post' using errcode = '42501';
    end if;
  elsif new.author_id is distinct from old.author_id or new.id <> old.id then
    raise exception 'Video identity and author are immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.set_video_author() from public, anon, authenticated;
create trigger post_videos_set_author before insert or update on public.post_videos
  for each row execute function private.set_video_author();
alter policy "Read videos only for visible posts" on public.post_videos
using ((select private.is_approved_member()) and (author_id = (select auth.uid())
  or (state = 'ready' and exists (select 1 from public.posts where id = post_videos.post_id))));
alter policy "Editors can start video uploads" on public.post_videos
with check ((select private.is_admin_or_owner()) and author_id = (select auth.uid()) and state = 'uploading'
  and exists (select 1 from public.posts where id = post_videos.post_id and author_id = (select auth.uid())));
alter policy "Editors can update video uploads" on public.post_videos
using ((select private.is_admin_or_owner()) and author_id = (select auth.uid()))
with check ((select private.is_admin_or_owner()) and author_id = (select auth.uid()) and
  (post_id is null or exists (select 1 from public.posts where id = post_videos.post_id and author_id = (select auth.uid()))));
alter policy "Editors can clean up video uploads" on public.post_videos
using ((select private.is_admin_or_owner()) and author_id = (select auth.uid()) and state = 'deleting' and cleanup_after <= now());
notify pgrst, 'reload schema';
