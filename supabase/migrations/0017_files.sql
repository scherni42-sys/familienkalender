alter table public.events add column if not exists files jsonb not null default '[]'::jsonb;
alter table public.messages add column if not exists files jsonb not null default '[]'::jsonb;

insert into storage.buckets (id, name, public, file_size_limit)
values ('files', 'files', false, 15728640)
on conflict (id) do nothing;
