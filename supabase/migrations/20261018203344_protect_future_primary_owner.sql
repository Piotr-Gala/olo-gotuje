-- Only the first approved owner receives protection, including future promotions.
create unique index profiles_single_primary_owner_idx
  on public.profiles (is_primary_owner) where is_primary_owner;

create function private.assign_primary_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = 'owner' and new.is_approved and not new.is_primary_owner then
    -- Serialize concurrent promotions before checking for an existing owner.
    perform pg_advisory_xact_lock(184233, 1);
    if not exists (select 1 from public.profiles where is_primary_owner) then
      new.is_primary_owner := true;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.assign_primary_owner() from public, anon, authenticated;

create trigger profiles_assign_primary_owner
  before insert or update of role, is_approved on public.profiles
  for each row execute function private.assign_primary_owner();

-- Backfill an approved owner if none was present when the previous migration ran.
update public.profiles set role = role
where id = (
  select id from public.profiles
  where role = 'owner' and is_approved
  order by created_at, id limit 1
) and not exists (select 1 from public.profiles where is_primary_owner);

drop policy "Admins can manage family account roles and approval" on public.profiles;
create policy "Admins can manage family account roles and approval"
  on public.profiles for update to authenticated
  using (
    (select private.current_user_role()) = 'admin'
    and (select private.is_approved_member())
    and id <> (select auth.uid())
    and not is_primary_owner
  )
  with check (
    (select private.current_user_role()) = 'admin'
    and (select private.is_approved_member())
    and id <> (select auth.uid())
    and role in ('member', 'admin', 'owner')
  );
-- USING protects existing primary owners. Column grants prevent clients from
-- setting the flag; WITH CHECK allows the trigger to assign it on promotion.
