-- Run through a trusted SQL connection after applying all migrations.
-- All fixtures and section changes are rolled back, including on assertion failure.
begin;

do $test$
declare
  original_role text := current_user;
  user_ids uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  post_ids uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  roles text[] := array['admin', 'owner', 'member', 'member'];
  expected_editor boolean;
  expected_approved boolean;
  actual_count integer;
  inserted_post uuid;
  i integer;
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('current_user_role', 'is_approved_member', 'is_admin_or_owner')
  ) then
    raise exception 'RLS helpers are still exposed in public';
  end if;

  for i in 1..4 loop
    insert into auth.users (id, raw_user_meta_data)
    values (user_ids[i], '{"birth_date":"2000-01-01","nickname":"Security regression fixture"}');
    update public.profiles set role = roles[i], is_approved = (i <> 4)
    where id = user_ids[i];
  end loop;

  update public.sections set is_active = (slug = 'gotowanie')
  where slug in ('gotowanie', 'lego');

  insert into public.posts (id, section_slug, author_id, title, slug, status)
  values
    (post_ids[1], 'gotowanie', user_ids[1], 'Security fixture', post_ids[1]::text, 'published'),
    (post_ids[2], 'gotowanie', user_ids[1], 'Security fixture', post_ids[2]::text, 'draft'),
    (post_ids[3], 'lego', user_ids[1], 'Security fixture', post_ids[3]::text, 'published');
  insert into public.post_images (post_id, storage_path)
  select id, id::text || '/security-fixture.png' from public.posts where id = any(post_ids);

  for i in 1..4 loop
    expected_editor := i <= 2;
    expected_approved := i <> 4;
    perform set_config('request.jwt.claims', jsonb_build_object('sub', user_ids[i], 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', user_ids[i]::text, true);
    set local role authenticated;

    if private.current_user_role() is distinct from roles[i]
      or private.is_admin_or_owner() is distinct from expected_editor
      or private.is_approved_member() is distinct from expected_approved then
      raise exception 'Incorrect helper result for persona %', i;
    end if;
    select count(*) into actual_count from public.profiles where id = any(user_ids);
    if actual_count <> (case when expected_editor then 4 else 1 end) then
      raise exception 'Incorrect profile visibility for persona %', i;
    end if;
    select count(*) into actual_count from public.sections where slug in ('gotowanie', 'lego');
    if actual_count <> (case when expected_editor then 2 when expected_approved then 1 else 0 end) then
      raise exception 'Incorrect section visibility for persona %', i;
    end if;
    select count(*) into actual_count from public.posts where id = any(post_ids);
    if actual_count <> (case when expected_editor then 3 when expected_approved then 1 else 0 end) then
      raise exception 'Incorrect post visibility for persona %', i;
    end if;
    select count(*) into actual_count from public.post_images where post_id = any(post_ids);
    if actual_count <> (case when expected_editor then 3 when expected_approved then 1 else 0 end) then
      raise exception 'Incorrect image visibility for persona %', i;
    end if;
    -- Compile and evaluate the storage policies under each authenticated persona.
    perform count(*) from storage.objects where bucket_id = 'family-post-images';

    update public.profiles set is_approved = false where id = user_ids[4];
    get diagnostics actual_count = row_count;
    if actual_count <> (case when i = 1 then 1 else 0 end) then
      raise exception 'Incorrect profile management permission for persona %', i;
    end if;
    update public.sections set is_active = is_active where slug = 'gotowanie';
    get diagnostics actual_count = row_count;
    if actual_count <> (case when expected_editor then 1 else 0 end) then
      raise exception 'Incorrect section write permission for persona %', i;
    end if;

    if expected_editor then
      insert into public.posts (section_slug, author_id, title, slug)
      values ('gotowanie', user_ids[i], 'Security write fixture', gen_random_uuid()::text)
      returning id into inserted_post;
      update public.posts set title = 'Updated fixture' where id = inserted_post;
      get diagnostics actual_count = row_count;
      if actual_count <> 1 then raise exception 'Editor update denied'; end if;
      delete from public.posts where id = inserted_post;
      get diagnostics actual_count = row_count;
      if actual_count <> 1 then raise exception 'Editor delete denied'; end if;
    else
      begin
        insert into public.posts (section_slug, author_id, title, slug)
        values ('gotowanie', user_ids[i], 'Forbidden fixture', gen_random_uuid()::text);
        raise exception 'Member insert unexpectedly allowed';
      exception when insufficient_privilege then null;
      end;
      update public.posts set title = 'Forbidden update' where id = post_ids[1];
      get diagnostics actual_count = row_count;
      if actual_count <> 0 then raise exception 'Member update unexpectedly allowed'; end if;
      delete from public.posts where id = post_ids[1];
      get diagnostics actual_count = row_count;
      if actual_count <> 0 then raise exception 'Member delete unexpectedly allowed'; end if;
    end if;
    execute format('set local role %I', original_role);
  end loop;

  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  begin
    perform private.is_admin_or_owner();
    raise exception 'Anonymous helper execution unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    select count(*) into actual_count from public.posts where id = any(post_ids);
    if actual_count <> 0 then raise exception 'Anonymous post access unexpectedly allowed'; end if;
  exception when insufficient_privilege then null;
  end;
  execute format('set local role %I', original_role);
end;
$test$;

rollback;
select 'PASS: helper isolation; admin/owner/approved/pending RLS; post CRUD; anonymous denial; fixtures rolled back' as result;
