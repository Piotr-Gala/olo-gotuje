-- Keep the existing post relation; categories are selected only when composing a post.
alter table public.sections drop constraint sections_slug_check;
alter table public.sections add constraint sections_slug_check
  check (slug in ('gotowanie', 'lego', 'muzyka', 'inne'));
insert into public.sections(slug,title,is_active,sort_order)
values ('inne','Inne',true,4);
notify pgrst, 'reload schema';
