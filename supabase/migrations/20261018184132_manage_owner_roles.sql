-- Keep the original owner protected while allowing admins to manage other owner roles.
alter table public.profiles
  add column is_primary_owner boolean not null default false;

update public.profiles
set is_primary_owner = true
where id = (
  select id
  from public.profiles
  where role = 'owner'
  order by created_at asc, id asc
  limit 1
);

drop policy "Admins can manage family account roles and approval" on public.profiles;

create policy "Admins can manage family account roles and approval"
  on public.profiles for update to authenticated
  using (
    (select public.current_user_role()) = 'admin'
    and (select public.is_approved_member())
    and id <> (select auth.uid())
    and not is_primary_owner
  )
  with check (
    (select public.current_user_role()) = 'admin'
    and (select public.is_approved_member())
    and id <> (select auth.uid())
    and not is_primary_owner
    and role in ('member', 'admin', 'owner')
  );
