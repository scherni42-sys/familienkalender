-- Private Geburtstage: owner gesetzt = nur diese Person sieht ihn (App und persönliches Widget), nie das Flur-Display
alter table public.birthdays add column if not exists owner uuid references public.members on delete cascade;

drop policy if exists bd_read on public.birthdays;
drop policy if exists bd_ins on public.birthdays;
drop policy if exists bd_del on public.birthdays;
create policy bd_read on public.birthdays for select
  using (public.is_member(family_id) and (owner is null or owner = public.my_member(family_id)));
create policy bd_ins on public.birthdays for insert
  with check (public.can_write(family_id) and (owner is null or owner = public.my_member(family_id)));
create policy bd_del on public.birthdays for delete
  using (public.can_write(family_id) and (owner is null or owner = public.my_member(family_id)));

create or replace function public.display_feed(p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with d as (select family_id, null::uuid as member_id from displays where token = p_token
             union all select family_id, member_id from widget_tokens where token = p_token)
  select jsonb_build_object(
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
