/* 0045 Zaubertaste mit Internetsuche: höchstens 20 Suchen pro Familie und Tag (deutsche Zeit).
   web_quota() zählt die Suche mit und gibt true zurück, solange das Limit nicht überschritten ist.
   Ohne Zeilenkommentare, damit es sich auch am Handy in den SQL Editor kopieren lässt. */

create table if not exists public.web_usage (
  family_id uuid not null references public.families(id) on delete cascade,
  day date not null,
  n integer not null default 0,
  primary key (family_id, day)
);
alter table public.web_usage enable row level security;

create or replace function public.web_quota() returns boolean
language plpgsql security definer set search_path = public as $$
declare fam uuid; d date := (now() at time zone 'Europe/Berlin')::date; cnt integer;
begin
  select m.family_id into fam from members m where m.user_id = auth.uid() and m.active limit 1;
  if fam is null then return false; end if;
  insert into web_usage (family_id, day, n) values (fam, d, 1)
    on conflict (family_id, day) do update set n = web_usage.n + 1
    returning n into cnt;
  delete from web_usage where day < d - 60;
  return cnt <= 20;
end $$;
revoke all on function public.web_quota() from public, anon;
grant execute on function public.web_quota() to authenticated;
