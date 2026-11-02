create or replace function public.display_update_event(p_token uuid, p_member uuid, p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare fam uuid; ppl uuid[]; drv uuid;
begin
  fam := public.display_writer(p_token, p_member);
  if not exists (select 1 from events e where e.id = p_id and e.family_id = fam and e.vis = 'family') then
    raise exception 'Termin nicht gefunden';
  end if;
  select coalesce(array_agg(m.id), '{}') into ppl from members m
    where m.family_id = fam and m.id::text in (select jsonb_array_elements_text(coalesce(p->'persons', '[]')));
  select m.id into drv from members m where m.family_id = fam and m.id::text = p->>'driver';
  update events set
    title = left(coalesce(nullif(trim(p->>'title'), ''), title), 200),
    date = coalesce((p->>'date')::date, date),
    end_date = greatest(coalesce((p->>'date')::date, date), coalesce((p->>'end_date')::date, (p->>'date')::date, end_date)),
    all_day = coalesce((p->>'all_day')::boolean, all_day),
    start_min = coalesce((p->>'start_min')::int, start_min),
    end_min = coalesce((p->>'end_min')::int, end_min),
    persons = ppl, driver = drv,
    place = coalesce(p->>'place', place), addr = coalesce(p->>'addr', addr),
    travel_min = nullif(p->>'travel_min', '')::int,
    notes = coalesce(p->>'notes', notes)
  where id = p_id and family_id = fam;
end $$;

create or replace function public.display_delete_event(p_token uuid, p_member uuid, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare fam uuid;
begin
  fam := public.display_writer(p_token, p_member);
  delete from events where id = p_id and family_id = fam and vis = 'family';
  if not found then raise exception 'Termin nicht gefunden'; end if;
end $$;

grant execute on function public.display_update_event(uuid, uuid, uuid, jsonb) to anon, authenticated;
grant execute on function public.display_delete_event(uuid, uuid, uuid) to anon, authenticated;
