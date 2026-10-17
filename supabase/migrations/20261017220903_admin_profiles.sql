-- Allow approved family admins to manage account roles and approval state.
-- Owners remain protected, and users cannot change their own profile.
revoke update on public.profiles from authenticated;
grant update (role, is_approved) on public.profiles to authenticated;

create policy "Admins can manage family account roles and approval"
  on public.profiles for update to authenticated
  using (
    (select public.current_user_role()) = 'admin'
    and (select public.is_approved_member())
    and id <> (select auth.uid())
    and role <> 'owner'
  )
  with check (
    (select public.current_user_role()) = 'admin'
    and (select public.is_approved_member())
    and id <> (select auth.uid())
    and role in ('member', 'admin')
  );
