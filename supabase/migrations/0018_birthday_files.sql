alter table public.birthdays add column if not exists files jsonb not null default '[]'::jsonb;
