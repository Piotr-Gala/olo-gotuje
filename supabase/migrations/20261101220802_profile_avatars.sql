alter table public.family_profiles
  add column avatar_path text,
  add column avatar_x integer not null default 50 check (avatar_x between 0 and 100),
  add column avatar_y integer not null default 50 check (avatar_y between 0 and 100),
  add column avatar_zoom numeric not null default 1 check (avatar_zoom between 1 and 3);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('family-avatars','family-avatars',false,6291456,array['image/webp','image/jpeg','image/png']);

create policy "Family can read visible avatars" on storage.objects for select to authenticated
  using (bucket_id = 'family-avatars' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or ((select private.is_approved_member()) and exists (
      select 1 from public.family_profiles p where p.avatar_path = name and p.is_visible
    ))
  ));
create policy "Members can upload their own avatars" on storage.objects for insert to authenticated
  with check (bucket_id = 'family-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Members can delete their own avatars" on storage.objects for delete to authenticated
  using (bucket_id = 'family-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create function public.update_my_avatar(p_path text, p_x integer, p_y integer, p_zoom numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare current_user_id uuid := auth.uid();
begin
  if current_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_x is null or p_y is null or p_zoom is null or p_x not between 0 and 100
    or p_y not between 0 and 100 or p_zoom not between 1 and 3 or p_zoom = 'NaN'::numeric then
    raise exception 'Invalid avatar position' using errcode = '22023';
  end if;
  if p_path is not null and (
    split_part(p_path, '/', 1) <> current_user_id::text
    or not exists (select 1 from storage.objects where bucket_id='family-avatars' and name=p_path)
  ) then raise exception 'Avatar must belong to this account' using errcode = '42501'; end if;
  update public.family_profiles set avatar_path=p_path,avatar_x=p_x,avatar_y=p_y,avatar_zoom=p_zoom,updated_at=now()
  where id=current_user_id;
  if not found then raise exception 'Profile not found' using errcode = '42501'; end if;
end;
$$;
revoke all on function public.update_my_avatar(text,integer,integer,numeric) from public,anon;
grant execute on function public.update_my_avatar(text,integer,integer,numeric) to authenticated;
notify pgrst, 'reload schema';
