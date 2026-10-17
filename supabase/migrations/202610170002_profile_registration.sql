alter table public.profiles
  add column first_name text not null default '',
  add column last_name text not null default '',
  add column nickname text not null default '',
  add column birth_date date not null;

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
  return new;
end;
$$;
