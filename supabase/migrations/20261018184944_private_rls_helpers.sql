-- RLS helpers must not be exposed as privileged Data API RPC endpoints.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

-- SET SCHEMA preserves function identities, grants, and existing RLS dependencies.
-- Keep SECURITY DEFINER to avoid recursive RLS lookups on public.profiles.
alter function public.current_user_role() set schema private;
alter function public.is_approved_member() set schema private;
alter function public.is_admin_or_owner() set schema private;

notify pgrst, 'reload schema';
