create table public.family_profiles (
  id uuid primary key references public.profiles (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 40),
  bio text not null default '' check (char_length(bio) <= 280),
  is_visible boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.family_profiles (id, display_name, is_visible)
select id, coalesce(nullif(btrim(nickname), ''), 'Członek rodziny'), is_approved
from public.profiles;

alter table public.family_profiles enable row level security;

create policy "Approved family members can read family profiles"
  on public.family_profiles for select to authenticated
  using (is_visible and (select private.is_approved_member()));

create policy "Members can update their own family profile"
  on public.family_profiles for update to authenticated
  using (id = (select auth.uid()) and (select private.is_approved_member()))
  with check (id = (select auth.uid()) and (select private.is_approved_member()));

grant select on public.family_profiles to authenticated;
grant update (display_name, bio) on public.family_profiles to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, first_name, last_name, nickname, birth_date, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'first_name', ''),
    coalesce(new.raw_user_meta_data ->> 'last_name', ''),
    coalesce(new.raw_user_meta_data ->> 'nickname', ''),
    nullif(new.raw_user_meta_data ->> 'birth_date', '')::date,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'nickname', ''),
      nullif(concat_ws(' ', new.raw_user_meta_data ->> 'first_name', new.raw_user_meta_data ->> 'last_name'), ''),
      ''
    )
  );

  insert into public.family_profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'nickname'), ''), 'Członek rodziny')
  );
  return new;
end;
$$;

create function private.sync_family_profile_visibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and auth.uid() <> new.id and not private.is_admin_or_owner() then
    raise exception 'Only an editor can change family account approval' using errcode = '42501';
  end if;
  update public.family_profiles
  set is_visible = new.is_approved, updated_at = now()
  where id = new.id;
  return new;
end;
$$;

revoke all on function private.sync_family_profile_visibility() from public, anon, authenticated;

create trigger profiles_sync_family_profile_visibility
  after update of is_approved on public.profiles
  for each row execute function private.sync_family_profile_visibility();

create or replace function public.update_my_family_profile(p_display_name text, p_bio text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  safe_display_name text := btrim(coalesce(p_display_name, ''));
  safe_bio text := btrim(coalesce(p_bio, ''));
begin
  if current_user_id is null or not private.is_approved_member() then
    raise exception 'Approved family access required' using errcode = '42501';
  end if;
  if char_length(safe_display_name) not between 1 and 40 or char_length(safe_bio) > 280 then
    raise exception 'Invalid family profile values' using errcode = '22023';
  end if;

  update public.family_profiles
  set display_name = safe_display_name, bio = safe_bio, updated_at = now()
  where id = current_user_id;
  if not found then raise exception 'Family profile not found'; end if;

end;
$$;

create or replace function public.set_post_author_name()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  profile_name text;
begin
  select nullif(btrim(family_profile.display_name), '')
  into profile_name
  from public.family_profiles as family_profile
  where family_profile.id = new.author_id;

  if profile_name is null then
    select coalesce(
      nullif(btrim(profile.nickname), ''),
      nullif(btrim(profile.display_name), ''),
      nullif(btrim(concat_ws(' ', nullif(btrim(profile.first_name), ''), nullif(btrim(profile.last_name), ''))), ''),
      'Członek rodziny'
    )
    into profile_name
    from public.profiles as profile
    where profile.id = new.author_id;
  end if;

  if profile_name is null then raise exception 'Post author profile not found'; end if;

  new.author_name := profile_name;
  return new;
end;
$$;

revoke all on function public.update_my_family_profile(text, text) from public, anon, authenticated;
grant execute on function public.update_my_family_profile(text, text) to authenticated;

notify pgrst, 'reload schema';
