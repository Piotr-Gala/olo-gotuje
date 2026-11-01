-- Account settings remain available while family access is pending or suspended.
create policy "Members can read their own family profile"
  on public.family_profiles for select to authenticated
  using (id = (select auth.uid()));

create or replace function public.update_my_family_profile(p_display_name text, p_bio text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  safe_nickname text := btrim(coalesce(p_display_name, ''));
  safe_bio text := btrim(coalesce(p_bio, ''));
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if char_length(safe_nickname) not between 1 and 40
    or safe_nickname ~ '[@[:cntrl:]]' or char_length(safe_bio) > 280 then
    raise exception 'Invalid profile values' using errcode = '22023';
  end if;

  -- The unique index arbitrates concurrent claims, including case-only matches.
  -- Both updates share one transaction: a taken nickname leaves the profile intact.
  update public.profiles
  set nickname = safe_nickname, display_name = safe_nickname
  where id = current_user_id;
  if not found then raise exception 'Account not found' using errcode = '42501'; end if;

  update public.family_profiles
  set display_name = safe_nickname, bio = safe_bio, updated_at = now()
  where id = current_user_id;
  if not found then raise exception 'Profile not found' using errcode = '42501'; end if;
end;
$$;

revoke all on function public.update_my_family_profile(text, text) from public, anon;
grant execute on function public.update_my_family_profile(text, text) to authenticated;
notify pgrst, 'reload schema';
