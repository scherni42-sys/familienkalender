alter table public.displays add column if not exists touch boolean not null default false;

create or replace function public.display_writer(p_token uuid, p_member uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare fam uuid;
begin
  select d.family_id into fam from displays d where d.token = p_token and d.touch;
  if fam is null then raise exception 'Eingabe ist an diesem Display nicht eingeschaltet'; end if;
  if not exists (select 1 from members m where m.id = p_member and m.family_id = fam and m.active and m.role <> 'guest') then
    raise exception 'Person gehört nicht zur Familie';
  end if;
  return fam;
end $$;

create or replace function public.display_family(p_token uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select family_id from displays where token = p_token and touch
$$;

create or replace function public.display_post(p_token uuid, p_member uuid, p_text text) returns uuid
language plpgsql security definer set search_path = public as $$
declare fam uuid; id uuid;
begin
  fam := public.display_writer(p_token, p_member);
  if coalesce(trim(p_text), '') = '' then raise exception 'Leere Nachricht'; end if;
  insert into messages (family_id, from_member, text, via) values (fam, p_member, left(trim(p_text), 500), 'Display') returning messages.id into id;
  return id;
end $$;

create or replace function public.display_save_event(p_token uuid, p_member uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare fam uuid; id uuid; ppl uuid[]; drv uuid;
begin
  fam := public.display_writer(p_token, p_member);
  select coalesce(array_agg(m.id), '{}') into ppl from members m
    where m.family_id = fam and m.id::text in (select jsonb_array_elements_text(coalesce(p->'persons', '[]')));
  select m.id into drv from members m where m.family_id = fam and m.id::text = p->>'driver';
  insert into events (family_id, owner, title, date, end_date, all_day, start_min, end_min, persons, driver, vis, place, addr, travel_min, notes, bring, discreet)
  values (fam, p_member, left(coalesce(nullif(trim(p->>'title'), ''), 'Termin'), 200), (p->>'date')::date,
          greatest((p->>'date')::date, coalesce((p->>'end_date')::date, (p->>'date')::date)),
          coalesce((p->>'all_day')::boolean, false), coalesce((p->>'start_min')::int, 0), coalesce((p->>'end_min')::int, 0),
          ppl, drv, 'family',
          coalesce(p->>'place', ''), coalesce(p->>'addr', ''), nullif(p->>'travel_min', '')::int, coalesce(p->>'notes', ''),
          coalesce(array(select jsonb_array_elements_text(coalesce(p->'bring', '[]'))), '{}'), coalesce((p->>'discreet')::boolean, false))
  returning events.id into id;
  return id;
end $$;


create or replace function public.display_feed(p_token uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with d as (select family_id, null::uuid as member_id from displays where token = p_token
             union all select family_id, member_id from widget_tokens where token = p_token)
  select jsonb_build_object(
    'me', (select member_id from d),
    'touch', coalesce((select x.touch from displays x where x.token = p_token), false),
    'family', (select jsonb_build_object('name', f.name, 'settings', f.settings) from families f where f.id = (select family_id from d)),
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'color', m.color, 'avatar', m.avatar, 'role', m.role) order by m.created_at)
                         from members m where m.family_id = (select family_id from d) and m.active), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(e) - 'family_id' - 'created_at')
                        from events e where e.family_id = (select family_id from d) and (e.vis = 'family' or e.owner = (select member_id from d))
                          and e.end_date >= least(current_date - 1, date_trunc('week', current_date)::date) and e.date <= current_date + 371), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(to_jsonb(m) - 'family_id' || jsonb_build_object('replies',
                          coalesce((select jsonb_agg(to_jsonb(r) - 'family_id' - 'message_id' order by r.created_at) from replies r where r.message_id = m.id), '[]'::jsonb)))
                          from messages m where m.family_id = (select family_id from d) and not m.done
                            and (m.pinned or m.created_at > now() - interval '8 days')), '[]'::jsonb),
    'birthdays', coalesce((select jsonb_agg(to_jsonb(b) - 'family_id') from birthdays b where b.family_id = (select family_id from d)
                           and (b.owner is null or b.owner = (select member_id from d))), '[]'::jsonb)
  )
  where exists (select 1 from d)
$function$;

grant execute on function public.display_family(uuid) to anon, authenticated;
grant execute on function public.display_post(uuid, uuid, text) to anon, authenticated;
grant execute on function public.display_save_event(uuid, uuid, jsonb) to anon, authenticated;
