alter table public.events add column if not exists trip text not null default 'hin';
alter table public.events drop constraint if exists events_trip_check;
alter table public.events add constraint events_trip_check check (trip in ('hin', 'ab', 'beides'));
alter table public.events add column if not exists driver2 uuid references public.members on delete set null;
alter table public.events add column if not exists driver_by uuid references public.members on delete set null;
alter table public.events add column if not exists driver_ok boolean;
alter table public.events add column if not exists driver2_ok boolean;
alter table public.events add column if not exists declined_by uuid references public.members on delete set null;
alter table public.events add column if not exists eta_by uuid references public.members on delete set null;
alter table public.events add column if not exists arrived_at timestamptz;

create or replace function public.events_clear_eta() returns trigger
language plpgsql security definer set search_path = public as $$
declare me uuid;
begin
  select m.id into me from members m where m.family_id = new.family_id and m.user_id = auth.uid() and m.active limit 1;
  if (new.driver is distinct from old.driver or new.driver2 is distinct from old.driver2) and new.declined_by is not distinct from old.declined_by then
    if me is not null and new.driver_by is not distinct from old.driver_by then new.driver_by := me; end if;
    if new.driver is distinct from old.driver then new.driver_ok := case when new.driver = new.driver_by then true else null end; end if;
    if new.driver2 is distinct from old.driver2 then new.driver2_ok := case when new.driver2 = new.driver_by then true else null end; end if;
    if new.declined_by is not distinct from old.declined_by then new.declined_by := null; end if;
  end if;
  if (new.eta_by is not null and new.eta_by is distinct from new.driver and new.eta_by is distinct from new.driver2)
     or (new.eta_by is null and new.driver is distinct from old.driver)
     or new.date is distinct from old.date or new.addr is distinct from old.addr then
    new.eta := null;
    new.eta_by := null;
  end if;
  return new;
end $$;

create or replace function public.events_new_driver() returns trigger
language plpgsql security definer set search_path = public as $$
declare me uuid;
begin
  select m.id into me from members m where m.family_id = new.family_id and m.user_id = auth.uid() and m.active limit 1;
  if new.driver_by is null then new.driver_by := coalesce(me, new.owner); end if;
  if new.driver is not null and new.driver_ok is null and new.driver = new.driver_by then new.driver_ok := true; end if;
  if new.driver2 is not null and new.driver2_ok is null and new.driver2 = new.driver_by then new.driver2_ok := true; end if;
  return new;
end $$;

drop trigger if exists events_new_driver on public.events;
create trigger events_new_driver before insert on public.events
  for each row execute function public.events_new_driver();

create or replace function public.driver_answer_core(p_member uuid, p_event uuid, p_ok boolean) returns void
language plpgsql security definer set search_path = public as $$
declare e record;
begin
  select * into e from events where id = p_event;
  if e.id is null then raise exception 'Termin nicht gefunden'; end if;
  if e.driver = p_member then
    if p_ok then update events set driver_ok = true where id = p_event;
    else update events set driver = null, driver_ok = null, declined_by = p_member, eta = null, eta_by = null where id = p_event; end if;
  elsif e.driver2 = p_member then
    if p_ok then update events set driver2_ok = true where id = p_event;
    else update events set driver2 = null, driver2_ok = null, declined_by = p_member where id = p_event; end if;
  else
    raise exception 'Du bist hier nicht als Fahrer eingetragen';
  end if;
end $$;

create or replace function public.driver_answer(p_event uuid, p_ok boolean) returns void
language plpgsql security definer set search_path = public as $$
declare fam uuid; me uuid;
begin
  select family_id into fam from events where id = p_event;
  me := public.my_member(fam);
  if me is null then raise exception 'Nicht angemeldet'; end if;
  perform public.driver_answer_core(me, p_event, p_ok);
end $$;

create or replace function public.widget_driver_answer(p_token uuid, p_event uuid, p_ok boolean) returns void
language plpgsql security definer set search_path = public as $$
declare w record;
begin
  select t.family_id, t.member_id into w from widget_tokens t where t.token = p_token;
  if w.member_id is null then raise exception 'Kein persönlicher Widget-Code'; end if;
  if not exists (select 1 from events where id = p_event and family_id = w.family_id) then raise exception 'Termin nicht gefunden'; end if;
  perform public.driver_answer_core(w.member_id, p_event, p_ok);
end $$;

create or replace function public.widget_eta(p_token uuid, p_event uuid, p_eta timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare w record;
begin
  select t.family_id, t.member_id into w from widget_tokens t where t.token = p_token;
  if w.member_id is null then raise exception 'Kein persönlicher Widget-Code'; end if;
  if p_eta is null then
    update events set eta = null, eta_by = null, arrived_at = case when eta is not null then now() else arrived_at end
      where id = p_event and family_id = w.family_id and (driver = w.member_id or driver2 = w.member_id);
  else
    update events set eta = p_eta, eta_by = w.member_id, arrived_at = null
      where id = p_event and family_id = w.family_id and (driver = w.member_id or driver2 = w.member_id)
        and p_eta between now() - interval '1 hour' and now() + interval '12 hours';
  end if;
end $$;

create or replace function public.display_update_event(p_token uuid, p_member uuid, p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare fam uuid; ppl uuid[]; drv uuid; drv2 uuid; old record;
begin
  fam := public.display_writer(p_token, p_member);
  select * into old from events e where e.id = p_id and e.family_id = fam and e.vis = 'family';
  if old.id is null then raise exception 'Termin nicht gefunden'; end if;
  select coalesce(array_agg(m.id), '{}') into ppl from members m
    where m.family_id = fam and m.id::text in (select jsonb_array_elements_text(coalesce(p->'persons', '[]')));
  select m.id into drv from members m where m.family_id = fam and m.id::text = p->>'driver';
  select m.id into drv2 from members m where m.family_id = fam and m.id::text = p->>'driver2';
  update events set
    title = left(coalesce(nullif(trim(p->>'title'), ''), title), 200),
    date = coalesce((p->>'date')::date, date),
    end_date = greatest(coalesce((p->>'date')::date, date), coalesce((p->>'end_date')::date, (p->>'date')::date, end_date)),
    all_day = coalesce((p->>'all_day')::boolean, all_day),
    start_min = coalesce((p->>'start_min')::int, start_min),
    end_min = coalesce((p->>'end_min')::int, end_min),
    persons = ppl, driver = drv,
    trip = coalesce(nullif(p->>'trip', ''), trip),
    driver2 = case when coalesce(nullif(p->>'trip', ''), trip) = 'beides' then drv2 else null end,
    driver_by = case when drv is distinct from old.driver or drv2 is distinct from old.driver2 then p_member else driver_by end,
    place = coalesce(p->>'place', place), addr = coalesce(p->>'addr', addr),
    travel_min = nullif(p->>'travel_min', '')::int,
    notes = coalesce(p->>'notes', notes)
  where id = p_id and family_id = fam;
end $$;

grant execute on function public.driver_answer(uuid, boolean) to authenticated;
grant execute on function public.widget_driver_answer(uuid, uuid, boolean) to anon, authenticated;
grant execute on function public.widget_eta(uuid, uuid, timestamptz) to anon, authenticated;
grant execute on function public.display_update_event(uuid, uuid, uuid, jsonb) to anon, authenticated;
revoke execute on function public.driver_answer_core(uuid, uuid, boolean) from public, anon, authenticated;

create or replace function public.widget_eta_stop(p_token uuid, p_event uuid, p_arrived boolean) returns void
language plpgsql security definer set search_path = public as $$
declare w record;
begin
  select t.family_id, t.member_id into w from widget_tokens t where t.token = p_token;
  if w.member_id is null then raise exception 'Kein persönlicher Widget-Code'; end if;
  update events set eta = null, eta_by = null, arrived_at = case when p_arrived and eta is not null then now() else arrived_at end
    where id = p_event and family_id = w.family_id and eta_by = w.member_id;
end $$;

grant execute on function public.widget_eta_stop(uuid, uuid, boolean) to anon, authenticated;
