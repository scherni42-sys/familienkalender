-- Widget als Steuerzentrale: Board-Knöpfe (👍, Mach ich, erledigt) mit dem persönlichen Widget-Code
-- und die eigene Person im Feed (für Erinnerungen und das Mini-Widget)
create or replace function public.widget_act(p_token uuid, p_msg uuid, p_action text) returns void
language plpgsql security definer set search_path = public as $$
declare w record;
begin
  select t.family_id, t.member_id into w from widget_tokens t
    join members m on m.id = t.member_id and m.active and m.role in ('admin', 'member')
    where t.token = p_token;
  if w.member_id is null then raise exception 'Nur mit persönlichem Widget-Code'; end if;
  if not exists (select 1 from messages where id = p_msg and family_id = w.family_id) then raise exception 'Nachricht nicht gefunden'; end if;
  if p_action = 'like' then
    insert into replies (family_id, message_id, from_member, text) values (w.family_id, p_msg, w.member_id, '👍');
  elsif p_action = 'take' then
    update messages set taker = w.member_id where id = p_msg;
    insert into replies (family_id, message_id, from_member, text) values (w.family_id, p_msg, w.member_id, 'Mach ich');
  elsif p_action = 'done' then
    update messages set done = true where id = p_msg;
  else
    raise exception 'Unbekannte Aktion';
  end if;
end $$;
revoke all on function public.widget_act(uuid, uuid, text) from public;
grant execute on function public.widget_act(uuid, uuid, text) to anon, authenticated;

create or replace function public.display_feed(p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with d as (select family_id, null::uuid as member_id from displays where token = p_token
             union all select family_id, member_id from widget_tokens where token = p_token)
  select jsonb_build_object(
    'me', (select member_id from d),
    'family', (select jsonb_build_object('name', f.name, 'settings', f.settings) from families f where f.id = (select family_id from d)),
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'color', m.color) order by m.created_at)
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
$$;
