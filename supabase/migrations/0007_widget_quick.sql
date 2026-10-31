-- Schnelleingabe in der Widget-App: Nachricht ans Board und Termin speichern mit dem persönlichen Widget-Code
create or replace function public.widget_member(p_token uuid, out family_id uuid, out member_id uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  select t.family_id, t.member_id into family_id, member_id from widget_tokens t
    join members m on m.id = t.member_id and m.active and m.role in ('admin', 'member')
    where t.token = p_token;
  if member_id is null then raise exception 'Nur mit persönlichem Widget-Code'; end if;
end $$;
revoke all on function public.widget_member(uuid) from public;
grant execute on function public.widget_member(uuid) to anon, authenticated;

create or replace function public.widget_post(p_token uuid, p_text text) returns uuid
language plpgsql security definer set search_path = public as $$
declare w record; id uuid;
begin
  select * into w from public.widget_member(p_token);
  insert into messages (family_id, from_member, text, via) values (w.family_id, w.member_id, trim(p_text), 'Widget') returning messages.id into id;
  return id;
end $$;
revoke all on function public.widget_post(uuid, text) from public;
grant execute on function public.widget_post(uuid, text) to anon, authenticated;

create or replace function public.widget_save_event(p_token uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare w record; id uuid; ppl uuid[]; drv uuid;
begin
  select * into w from public.widget_member(p_token);
  -- Nur Personen dieser Familie übernehmen
  select coalesce(array_agg(m.id), '{}') into ppl from members m
    where m.family_id = w.family_id and m.id::text in (select jsonb_array_elements_text(coalesce(p->'persons', '[]')));
  select m.id into drv from members m where m.family_id = w.family_id and m.id::text = p->>'driver';
  insert into events (family_id, owner, title, date, end_date, all_day, start_min, end_min, persons, driver, vis, place, addr, travel_min, notes, bring, discreet)
  values (w.family_id, w.member_id, left(coalesce(nullif(trim(p->>'title'), ''), 'Termin'), 200), (p->>'date')::date,
          greatest((p->>'date')::date, coalesce((p->>'end_date')::date, (p->>'date')::date)),
          coalesce((p->>'all_day')::boolean, false), coalesce((p->>'start_min')::int, 0), coalesce((p->>'end_min')::int, 0),
          ppl, drv, case when p->>'vis' in ('family', 'private', 'busy') then p->>'vis' else 'family' end,
          coalesce(p->>'place', ''), coalesce(p->>'addr', ''), nullif(p->>'travel_min', '')::int, coalesce(p->>'notes', ''),
          coalesce(array(select jsonb_array_elements_text(coalesce(p->'bring', '[]'))), '{}'), coalesce((p->>'discreet')::boolean, false))
  returning events.id into id;
  return id;
end $$;
revoke all on function public.widget_save_event(uuid, jsonb) from public;
grant execute on function public.widget_save_event(uuid, jsonb) to anon, authenticated;
