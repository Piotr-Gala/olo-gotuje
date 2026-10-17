alter table public.posts
  add column author_name text not null default '';

update public.posts as post
set author_name = coalesce(
  nullif(btrim(profile.nickname), ''),
  nullif(btrim(profile.display_name), ''),
  nullif(btrim(concat_ws(' ', nullif(btrim(profile.first_name), ''), nullif(btrim(profile.last_name), ''))), ''),
  'Członek rodziny'
)
from public.profiles as profile
where profile.id = post.author_id;

alter table public.posts
  alter column author_name drop default;

create function public.set_post_author_name()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  profile_name text;
begin
  select coalesce(
    nullif(btrim(profile.nickname), ''),
    nullif(btrim(profile.display_name), ''),
    nullif(btrim(concat_ws(' ', nullif(btrim(profile.first_name), ''), nullif(btrim(profile.last_name), ''))), ''),
    'Członek rodziny'
  )
  into profile_name
  from public.profiles as profile
  where profile.id = new.author_id;

  if profile_name is null then
    raise exception 'Post author profile not found';
  end if;

  new.author_name := profile_name;
  return new;
end;
$$;

create trigger posts_set_author_name
  before insert or update on public.posts
  for each row execute function public.set_post_author_name();

revoke all on function public.set_post_author_name() from public, anon, authenticated;
