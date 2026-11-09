-- Import aus dem Handy-Kalender: Termine werden private ("busy") Termine des Mitglieds,
-- ganztägige Geburtstags-Termine werden private Geburtstage. ext_id = Kennung im Handy-Kalender.
alter table public.events add column if not exists ext_id text;
alter table public.birthdays add column if not exists ext_id text;
create unique index if not exists events_owner_ext on public.events (owner, ext_id) where ext_id is not null;
create unique index if not exists birthdays_owner_ext on public.birthdays (owner, ext_id) where ext_id is not null;

create or replace function public.widget_import(p_token uuid, p_from date, p_events jsonb, p_bdays jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare w record; ne int; nb int; de int; db int;
begin
  select * into w from public.widget_member(p_token);
  if jsonb_array_length(coalesce(p_events, '[]')) > 3000 or jsonb_array_length(coalesce(p_bdays, '[]')) > 1000 then
    raise exception 'Zu viele Einträge';
  end if;

  insert into events (family_id, owner, ext_id, title, date, end_date, all_day, start_min, end_min, vis, place, notes)
  select w.family_id, w.member_id, left(e->>'ext_id', 200), left(coalesce(nullif(trim(e->>'title'), ''), 'Termin'), 200),
         (e->>'date')::date, greatest((e->>'date')::date, coalesce((e->>'end_date')::date, (e->>'date')::date)),
         coalesce((e->>'all_day')::boolean, false),
         least(1440, greatest(0, coalesce((e->>'start_min')::int, 0))), least(1440, greatest(0, coalesce((e->>'end_min')::int, 0))),
         'busy', left(coalesce(e->>'place', ''), 300), left(coalesce(e->>'notes', ''), 500)
  from jsonb_array_elements(coalesce(p_events, '[]')) e
  where coalesce(e->>'ext_id', '') <> '' and e->>'date' is not null
  on conflict (owner, ext_id) where ext_id is not null do update set
    title = excluded.title, date = excluded.date, end_date = excluded.end_date, all_day = excluded.all_day,
    start_min = excluded.start_min, end_min = excluded.end_min, place = excluded.place, notes = excluded.notes;
  get diagnostics ne = row_count;

  -- Im Handy gelöschte Termine (ab p_from) auch hier entfernen
  delete from events where owner = w.member_id and ext_id is not null and end_date >= p_from
    and ext_id not in (select e->>'ext_id' from jsonb_array_elements(coalesce(p_events, '[]')) e where e->>'ext_id' is not null);
  get diagnostics de = row_count;

  insert into birthdays (family_id, owner, ext_id, name, day, month, year)
  select w.family_id, w.member_id, left(b->>'ext_id', 200), left(trim(b->>'name'), 100), (b->>'day')::int, (b->>'month')::int, nullif(b->>'year', '')::int
  from jsonb_array_elements(coalesce(p_bdays, '[]')) b
  where coalesce(b->>'ext_id', '') <> '' and coalesce(trim(b->>'name'), '') <> ''
    and (b->>'day')::int between 1 and 31 and (b->>'month')::int between 1 and 12
  on conflict (owner, ext_id) where ext_id is not null do update set
    name = excluded.name, day = excluded.day, month = excluded.month, year = coalesce(excluded.year, birthdays.year);
  get diagnostics nb = row_count;

  delete from birthdays where owner = w.member_id and ext_id is not null
    and ext_id not in (select b->>'ext_id' from jsonb_array_elements(coalesce(p_bdays, '[]')) b where b->>'ext_id' is not null);
  get diagnostics db = row_count;

  return jsonb_build_object('events', ne, 'events_deleted', de, 'birthdays', nb, 'birthdays_deleted', db);
end $$;
revoke all on function public.widget_import(uuid, date, jsonb, jsonb) from public;
grant execute on function public.widget_import(uuid, date, jsonb, jsonb) to anon, authenticated;
