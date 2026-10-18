create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  role text not null default 'member'
    check (role in ('admin', 'owner', 'member')),
  is_approved boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.sections (
  slug text primary key check (slug in ('gotowanie', 'lego', 'muzyka')),
  title text not null,
  is_active boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

insert into public.sections (slug, title, sort_order)
values
  ('gotowanie', 'Gotowanie', 1),
  ('lego', 'LEGO', 2),
  ('muzyka', 'Muzyka', 3);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  section_slug text not null references public.sections (slug),
  author_id uuid not null references public.profiles (id),
  title text not null,
  slug text not null,
  excerpt text not null default '',
  content text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (section_slug, slug)
);

create table public.post_images (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  storage_path text not null,
  alt_text text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (post_id, storage_path)
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'family-post-images',
  'family-post-images',
  false,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do nothing;

create index posts_published_section_idx
  on public.posts (section_slug, published_at desc)
  where status = 'published';

create index post_images_post_order_idx
  on public.post_images (post_id, sort_order);

create function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role
  from public.profiles
  where id = (select auth.uid())
$$;

create function public.is_approved_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and is_approved
  )
$$;

create function public.is_admin_or_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role in ('admin', 'owner')
      and is_approved
  )
$$;

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', '')
  );
  return new;
end;
$$;

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create trigger posts_set_updated_at
  before update on public.posts
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.sections enable row level security;
alter table public.posts enable row level security;
alter table public.post_images enable row level security;

create policy "Members can read their own profile"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin_or_owner()));

create policy "Approved members and editors can read sections"
  on public.sections for select to authenticated
  using (
    (select public.is_admin_or_owner())
    or ((select public.is_approved_member()) and is_active)
  );

create policy "Editors can create sections"
  on public.sections for insert to authenticated
  with check ((select public.is_admin_or_owner()));

create policy "Editors can update sections"
  on public.sections for update to authenticated
  using ((select public.is_admin_or_owner()))
  with check ((select public.is_admin_or_owner()));

create policy "Editors can delete sections"
  on public.sections for delete to authenticated
  using ((select public.is_admin_or_owner()));

create policy "Members can read published posts from active sections"
  on public.posts for select to authenticated
  using (
    (select public.is_admin_or_owner())
    or (
      (select public.is_approved_member())
      and status = 'published'
      and exists (
        select 1
        from public.sections
        where sections.slug = posts.section_slug
          and sections.is_active
      )
    )
  );

create policy "Editors can create posts as themselves"
  on public.posts for insert to authenticated
  with check (
    (select public.is_admin_or_owner())
    and author_id = (select auth.uid())
  );

create policy "Editors can update posts"
  on public.posts for update to authenticated
  using ((select public.is_admin_or_owner()))
  with check ((select public.is_admin_or_owner()));

create policy "Editors can delete posts"
  on public.posts for delete to authenticated
  using ((select public.is_admin_or_owner()));

create policy "Members can read images for visible posts"
  on public.post_images for select to authenticated
  using (
    (select public.is_admin_or_owner())
    or exists (
      select 1
      from public.posts
      join public.sections on sections.slug = posts.section_slug
      where posts.id = post_images.post_id
        and posts.status = 'published'
        and sections.is_active
        and (select public.is_approved_member())
    )
  );

create policy "Editors can add images"
  on public.post_images for insert to authenticated
  with check ((select public.is_admin_or_owner()));

create policy "Editors can update images"
  on public.post_images for update to authenticated
  using ((select public.is_admin_or_owner()))
  with check ((select public.is_admin_or_owner()));

create policy "Editors can delete images"
  on public.post_images for delete to authenticated
  using ((select public.is_admin_or_owner()));

create policy "Family can read images for visible posts"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'family-post-images'
    and (
      (select public.is_admin_or_owner())
      or exists (
        select 1
        from public.post_images
        join public.posts on posts.id = post_images.post_id
        join public.sections on sections.slug = posts.section_slug
        where post_images.storage_path = storage.objects.name
          and posts.status = 'published'
          and sections.is_active
          and (select public.is_approved_member())
      )
    )
  );

create policy "Editors can upload post images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'family-post-images'
    and (select public.is_admin_or_owner())
    and exists (
      select 1 from public.posts
      where posts.id::text = (storage.foldername(storage.objects.name))[1]
    )
  );

create policy "Editors can update post images"
  on storage.objects for update to authenticated
  using (bucket_id = 'family-post-images' and (select public.is_admin_or_owner()))
  with check (bucket_id = 'family-post-images' and (select public.is_admin_or_owner()));

create policy "Editors can delete post images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'family-post-images' and (select public.is_admin_or_owner()));

-- New Supabase projects require explicit Data API grants for public tables.
grant usage on schema public to authenticated;
grant select on public.profiles, public.sections, public.posts, public.post_images to authenticated;
grant insert, update, delete on public.sections, public.posts, public.post_images to authenticated;

-- These helpers are used by RLS policies, but should not be callable anonymously.
revoke all on function public.current_user_role() from public, anon;
revoke all on function public.is_approved_member() from public, anon;
revoke all on function public.is_admin_or_owner() from public, anon;
revoke all on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.is_approved_member() to authenticated;
grant execute on function public.is_admin_or_owner() to authenticated;
