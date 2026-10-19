create table public.post_videos (
  id uuid primary key,
  post_id uuid unique references public.posts(id) on delete set null,
  object_key text generated always as ('videos/' || id::text || '.mp4') stored,
  file_name text not null check (char_length(file_name) between 1 and 255),
  size_bytes bigint not null check (size_bytes between 12 and 1000000000),
  upload_id text,
  state text not null default 'uploading' check (state in ('uploading', 'completing', 'ready', 'deleting')),
  created_at timestamptz not null default now(),
  cleanup_after timestamptz,
  check (post_id is not null or state = 'deleting')
);

-- Retain the object identity after a post is deleted, including direct API deletes.
-- A grace period covers in-flight completion requests and outstanding signed URLs.
create function private.detach_post_video()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.post_id is null and old.post_id is not null then
    new.state = 'deleting';
    new.cleanup_after = now() + interval '1 hour';
  end if;
  return new;
end;
$$;
revoke all on function private.detach_post_video() from public, anon, authenticated;
create trigger post_videos_detach before update of post_id on public.post_videos
  for each row execute function private.detach_post_video();

alter table public.post_videos enable row level security;
revoke all on public.post_videos from anon;
grant select, insert, update, delete on public.post_videos to authenticated;

create policy "Read videos only for visible posts"
on public.post_videos for select to authenticated using (
  (select private.is_admin_or_owner())
  or (state = 'ready' and (select private.is_approved_member())
    and exists (select 1 from public.posts where posts.id = post_videos.post_id))
);
create policy "Editors can start video uploads"
on public.post_videos for insert to authenticated with check (
  (select private.is_admin_or_owner()) and state = 'uploading'
  and exists (select 1 from public.posts where posts.id = post_videos.post_id)
);
create policy "Editors can update video uploads"
on public.post_videos for update to authenticated
using ((select private.is_admin_or_owner()))
with check ((select private.is_admin_or_owner()));
create policy "Editors can clean up video uploads"
on public.post_videos for delete to authenticated
using ((select private.is_admin_or_owner()) and state = 'deleting' and cleanup_after <= now());

notify pgrst, 'reload schema';
