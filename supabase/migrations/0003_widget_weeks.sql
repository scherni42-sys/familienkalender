-- Handy-Widget: persönlicher Widget-Code je Person (zeigt zusätzlich die eigenen privaten Termine)
-- und Wochenvorschau (Termine ab Montag dieser Woche bis 9 Wochen voraus)
create table if not exists public.widget_tokens (
  token uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families on delete cascade,
  member_id uuid not null unique references public.members on delete cascade,
  created_at timestamptz not null default now()
);
-- Kein direkter Zugriff, nur über die Funktionen unten
alter table public.widget_tokens enable row level security;

create or replace function public.my_widget_token(fam uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare m uuid := public.my_member(fam); t uuid;
begin
  if m is null then raise exception 'not a member'; end if;
  select token into t from widget_tokens where member_id = m;
  if t is null then insert into widget_tokens (family_id, member_id) values (fam, m) returning token into t; end if;
  return t;
end $$;
revoke all on function public.my_widget_token(uuid) from public;
grant execute on function public.my_widget_token(uuid) to authenticated;

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
                          and e.end_date >= least(current_date - 1, date_trunc('week', current_date)::date) and e.date <= current_date + 63), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(to_jsonb(m) - 'family_id' || jsonb_build_object('replies',
                          coalesce((select jsonb_agg(to_jsonb(r) - 'family_id' - 'message_id' order by r.created_at) from replies r where r.message_id = m.id), '[]'::jsonb)))
                          from messages m where m.family_id = (select family_id from d) and not m.done
                            and (m.pinned or m.created_at > now() - interval '8 days')), '[]'::jsonb),
    'birthdays', coalesce((select jsonb_agg(to_jsonb(b) - 'family_id') from birthdays b where b.family_id = (select family_id from d)), '[]'::jsonb)
  )
  where exists (select 1 from d)
$$;
