-- Owners are ordinary manageable roles; admins still cannot change themselves.
drop trigger profiles_assign_primary_owner on public.profiles;
drop function private.assign_primary_owner();
drop policy "Admins can manage family account roles and approval" on public.profiles;
alter table public.profiles drop column is_primary_owner;

create policy "Admins can manage family account roles and approval"
  on public.profiles for update to authenticated
  using (
    (select private.current_user_role()) = 'admin'
    and (select private.is_approved_member())
    and id <> (select auth.uid())
  )
  with check (
    (select private.current_user_role()) = 'admin'
    and (select private.is_approved_member())
    and id <> (select auth.uid())
    and role in ('member', 'admin', 'owner')
  );

-- Login nicknames are stable private account identifiers, separate from public display names.
create unique index profiles_login_nickname_idx
  on public.profiles (lower(btrim(nickname))) where btrim(nickname) <> '';

-- Only the server-side Edge Function can resolve a nickname to an Auth address.
-- SECURITY INVOKER relies on the service role's existing access; no client bypass.
create function public.login_user_for_nickname(login_nickname text)
returns uuid
language sql stable security invoker
set search_path = ''
as $$
  select p.id
  from public.profiles p
  where lower(btrim(p.nickname)) = lower(btrim(login_nickname))
    and btrim(login_nickname) <> '';
$$;
revoke all on function public.login_user_for_nickname(text) from public, anon, authenticated;
grant execute on function public.login_user_for_nickname(text) to service_role;
notify pgrst, 'reload schema';
