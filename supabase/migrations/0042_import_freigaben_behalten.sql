/* 0042 Import aus dem Handy-Kalender: Freigaben, Teilnehmer, Fahrer usw. bleiben erhalten.
   Bisher gingen sie verloren, wenn sich die Kennung eines Termins im Handy änderte
   (Termin in Google verschoben, Kalender neu synchronisiert, Import aus- und wieder eingeschaltet).
   Jetzt: 1. Neue Kennung wird dem bisherigen Termin zugeordnet (gleicher Termin im Handy, oder gleicher Titel am gleichen Tag).
          2. Verschwindet ein bearbeiteter Termin, merkt sich FamTO die Einstellungen 60 Tage und setzt sie wieder, sobald er zurückkommt.
   Ohne Zeilenkommentare, damit es sich auch am Handy in den SQL Editor kopieren lässt. */

create table if not exists public.event_ext_keep (
  owner uuid not null references public.members(id) on delete cascade,
  ext_id text not null,
  title text not null default '',
  date date not null,
  start_min int not null default 0,
  keep jsonb not null,
  saved_at timestamptz not null default now(),
  primary key (owner, ext_id)
);
alter table public.event_ext_keep enable row level security;
revoke all on table public.event_ext_keep from anon, authenticated;

create or replace function public.ext_key(p text) returns text language sql immutable as $$ select regexp_replace(p, ':[^:]*$', '') $$;

create or replace function public.widget_import(p_token uuid, p_from date, p_events jsonb, p_bdays jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare w record; r record; ne int; nb int; de int; db int; hit uuid; k record; rst jsonb := '{}'; used text[] := '{}'; moved int := 0;
begin
  select * into w from public.widget_member(p_token);
  if jsonb_array_length(coalesce(p_events, '[]')) > 3000 or jsonb_array_length(coalesce(p_bdays, '[]')) > 1000 then
    raise exception 'Zu viele Einträge';
  end if;

  for r in
    select distinct on (x.ext) x.* from (
      select left(e->>'ext_id', 200) ext, lower(trim(coalesce(e->>'title', ''))) t, (e->>'date')::date d,
             least(1440, greatest(0, coalesce((e->>'start_min')::int, 0))) s
      from jsonb_array_elements(coalesce(p_events, '[]')) e
      where coalesce(e->>'ext_id', '') <> '' and e->>'date' is not null) x
    where not exists (select 1 from events v where v.owner = w.member_id and v.ext_id = x.ext)
  loop
    select o.id into hit from events o
    where o.owner = w.member_id and o.ext_id is not null and o.end_date >= p_from
      and not exists (select 1 from jsonb_array_elements(coalesce(p_events, '[]')) e2 where left(e2->>'ext_id', 200) = o.ext_id)
      and ((ext_key(o.ext_id) = ext_key(r.ext) and abs(o.date - r.d) <= 14) or (lower(trim(o.title)) = r.t and o.date = r.d))
    order by case when ext_key(o.ext_id) = ext_key(r.ext) and o.date = r.d then 1
                  when lower(trim(o.title)) = r.t and o.date = r.d and o.start_min = r.s then 2
                  when lower(trim(o.title)) = r.t and o.date = r.d then 3 else 4 end,
             abs(o.date - r.d), o.created_at
    limit 1;
    if hit is not null then
      update events set ext_id = r.ext where id = hit;
      moved := moved + 1;
      continue;
    end if;
    select * into k from event_ext_keep q
    where q.owner = w.member_id and not (q.ext_id = any(used))
      and (q.ext_id = r.ext or (ext_key(q.ext_id) = ext_key(r.ext) and q.date = r.d) or (q.title = r.t and q.date = r.d))
    order by case when q.ext_id = r.ext then 0 when ext_key(q.ext_id) = ext_key(r.ext) then 1 when q.start_min = r.s then 2 else 3 end, q.saved_at desc
    limit 1;
    if found then
      rst := rst || jsonb_build_object(r.ext, k.keep);
      used := used || k.ext_id;
    end if;
  end loop;

  insert into events (family_id, owner, ext_id, title, date, end_date, all_day, start_min, end_min, vis, place, notes,
                      persons, persons_by, persons_ok, driver, driver2, driver_by, driver_ok, driver2_ok, addr, travel_min, trip, bring, discreet, files)
  select w.family_id, w.member_id, left(e->>'ext_id', 200), left(coalesce(nullif(trim(e->>'title'), ''), 'Termin'), 200),
         (e->>'date')::date, greatest((e->>'date')::date, coalesce((e->>'end_date')::date, (e->>'date')::date)),
         coalesce((e->>'all_day')::boolean, false),
         least(1440, greatest(0, coalesce((e->>'start_min')::int, 0))), least(1440, greatest(0, coalesce((e->>'end_min')::int, 0))),
         coalesce(kp->>'vis', 'busy'), left(coalesce(e->>'place', ''), 300), left(coalesce(e->>'notes', ''), 500),
         coalesce((select array_agg(m.id) from members m where m.family_id = w.family_id and m.id::text in (select jsonb_array_elements_text(coalesce(kp->'persons', '[]')))), '{}'),
         (select m.id from members m where m.family_id = w.family_id and m.id::text = kp->>'persons_by'),
         coalesce(kp->'persons_ok', '{}'),
         (select m.id from members m where m.family_id = w.family_id and m.id::text = kp->>'driver'),
         (select m.id from members m where m.family_id = w.family_id and m.id::text = kp->>'driver2'),
         (select m.id from members m where m.family_id = w.family_id and m.id::text = kp->>'driver_by'),
         (kp->>'driver_ok')::boolean, (kp->>'driver2_ok')::boolean,
         coalesce(kp->>'addr', ''), (kp->>'travel_min')::int, coalesce(kp->>'trip', 'hin'),
         coalesce((select array_agg(b) from jsonb_array_elements_text(coalesce(kp->'bring', '[]')) b), '{}'),
         coalesce((kp->>'discreet')::boolean, false), coalesce(kp->'files', '[]')
  from jsonb_array_elements(coalesce(p_events, '[]')) e
  left join lateral (select rst -> left(e->>'ext_id', 200) as kp) z on true
  where coalesce(e->>'ext_id', '') <> '' and e->>'date' is not null
  on conflict (owner, ext_id) where ext_id is not null do update set
    title = excluded.title, date = excluded.date, end_date = excluded.end_date, all_day = excluded.all_day,
    start_min = excluded.start_min, end_min = excluded.end_min, place = excluded.place, notes = excluded.notes;
  get diagnostics ne = row_count;

  delete from event_ext_keep where owner = w.member_id and (ext_id = any(used) or saved_at < now() - interval '60 days');

  insert into event_ext_keep (owner, ext_id, title, date, start_min, keep)
  select o.owner, o.ext_id, lower(trim(o.title)), o.date, o.start_min,
         jsonb_build_object('vis', o.vis, 'persons', to_jsonb(o.persons), 'persons_by', o.persons_by, 'persons_ok', o.persons_ok,
           'driver', o.driver, 'driver2', o.driver2, 'driver_by', o.driver_by, 'driver_ok', o.driver_ok, 'driver2_ok', o.driver2_ok,
           'addr', o.addr, 'travel_min', o.travel_min, 'trip', o.trip, 'bring', to_jsonb(o.bring), 'discreet', o.discreet, 'files', o.files)
  from events o
  where o.owner = w.member_id and o.ext_id is not null and o.end_date >= p_from
    and not exists (select 1 from jsonb_array_elements(coalesce(p_events, '[]')) e where left(e->>'ext_id', 200) = o.ext_id)
    and (o.vis <> 'busy' or cardinality(o.persons) > 0 or o.driver is not null or o.driver2 is not null or o.addr <> ''
         or cardinality(o.bring) > 0 or o.discreet or o.files <> '[]'::jsonb)
  on conflict (owner, ext_id) do update set title = excluded.title, date = excluded.date, start_min = excluded.start_min, keep = excluded.keep, saved_at = now();

  delete from events where owner = w.member_id and ext_id is not null and end_date >= p_from
    and ext_id not in (select left(e->>'ext_id', 200) from jsonb_array_elements(coalesce(p_events, '[]')) e where e->>'ext_id' is not null);
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

  return jsonb_build_object('events', ne, 'events_deleted', de, 'events_kept', moved + cardinality(used), 'birthdays', nb, 'birthdays_deleted', db);
end $$;
revoke all on function public.widget_import(uuid, date, jsonb, jsonb) from public;
grant execute on function public.widget_import(uuid, date, jsonb, jsonb) to anon, authenticated;
