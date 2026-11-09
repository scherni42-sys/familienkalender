-- Familienkalender: Tabellen, Zugriffsregeln (RLS) und Funktionen
-- Im Supabase-Dashboard unter „SQL Editor“ einmal komplett ausführen.

create extension if not exists pgcrypto;

create table public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families on delete cascade,
  user_id uuid references auth.users on delete set null,
  name text not null,
  role text not null check (role in ('admin', 'member', 'child', 'guest')),
  color text not null default '#2f5bcc',
  adult boolean not null default true,
  app_bg text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index members_user_family on public.members (user_id, family_id) where user_id is not null;

create table public.invites (
  code text primary key,
  family_id uuid not null references public.families on delete cascade,
  member_id uuid not null references public.members on delete cascade,
  expires_at timestamptz not null default now() + interval '7 days'
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families on delete cascade,
  owner uuid not null references public.members on delete cascade,
  title text not null,
  date date not null,
  end_date date not null,
  all_day boolean not null default false,
  start_min int not null default 0 check (start_min between 0 and 1440),
  end_min int not null default 0 check (end_min between 0 and 1440),
  persons uuid[] not null default '{}',
  driver uuid references public.members on delete set null,
  vis text not null default 'family' check (vis in ('family', 'private', 'busy')),
  place text not null default '',
  addr text not null default '',
  travel_min int,
  notes text not null default '',
  bring text[] not null default '{}',
  discreet boolean not null default false,
  created_at timestamptz not null default now(),
  check (end_date >= date)
);
create index events_family_date on public.events (family_id, end_date);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families on delete cascade,
  from_member uuid not null references public.members on delete cascade,
  text text not null check (length(text) between 1 and 500),
  created_at timestamptz not null default now(),
  pinned boolean not null default false,
  done boolean not null default false,
  taker uuid references public.members on delete set null,
  via text
);

create table public.replies (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families on delete cascade,
  message_id uuid not null references public.messages on delete cascade,
  from_member uuid not null references public.members on delete cascade,
  text text not null check (length(text) between 1 and 300),
  created_at timestamptz not null default now()
);

create table public.birthdays (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families on delete cascade,
  name text not null,
  rel text not null default '',
  day int not null check (day between 1 and 31),
  month int not null check (month between 1 and 12),
  year int
);

create table public.displays (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families on delete cascade,
  name text not null default 'Flur',
  token uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now()
);

-- ---------- Hilfsfunktionen für die Zugriffsregeln ----------
create or replace function public.my_member(fam uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select id from members where family_id = fam and user_id = auth.uid() and active limit 1
$$;

create or replace function public.my_role(fam uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from members where family_id = fam and user_id = auth.uid() and active limit 1
$$;

create or replace function public.is_member(fam uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where family_id = fam and user_id = auth.uid() and active)
$$;

create or replace function public.can_write(fam uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role(fam) in ('admin', 'member'), false)
$$;

create or replace function public.is_admin(fam uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role(fam) = 'admin', false)
$$;

-- ---------- Zugriffsregeln ----------
alter table public.families enable row level security;
alter table public.members enable row level security;
alter table public.invites enable row level security;
alter table public.events enable row level security;
alter table public.messages enable row level security;
alter table public.replies enable row level security;
alter table public.birthdays enable row level security;
alter table public.displays enable row level security;

create policy fam_read on public.families for select using (public.is_member(id));
create policy fam_admin on public.families for update using (public.is_admin(id)) with check (public.is_admin(id));

create policy mem_read on public.members for select using (public.is_member(family_id));
create policy mem_admin_ins on public.members for insert with check (public.is_admin(family_id));
create policy mem_admin_upd on public.members for update using (public.is_admin(family_id)) with check (public.is_admin(family_id));
create policy mem_admin_del on public.members for delete using (public.is_admin(family_id));

-- Einladungscodes laufen nur über die Funktionen unten
create policy inv_admin on public.invites for select using (public.is_admin(family_id));

-- Termine: Familientermine sehen alle, private nur der Besitzer. „Belegt“ liefert busy_slots() ohne Details.
create policy ev_read on public.events for select
  using (public.is_member(family_id) and (vis = 'family' or owner = public.my_member(family_id)));
create policy ev_ins on public.events for insert
  with check (public.can_write(family_id) and owner = public.my_member(family_id));
create policy ev_upd on public.events for update
  using (public.can_write(family_id) and (owner = public.my_member(family_id) or vis = 'family'))
  with check (public.can_write(family_id) and (owner = public.my_member(family_id) or vis = 'family'));
create policy ev_del on public.events for delete
  using (public.can_write(family_id) and (owner = public.my_member(family_id) or vis = 'family'));

create policy msg_read on public.messages for select using (public.is_member(family_id));
create policy msg_ins on public.messages for insert
  with check (public.can_write(family_id) and from_member = public.my_member(family_id));
create policy msg_upd on public.messages for update using (public.can_write(family_id)) with check (public.can_write(family_id));
create policy msg_del on public.messages for delete
  using (public.is_admin(family_id) or from_member = public.my_member(family_id));

create policy rep_read on public.replies for select using (public.is_member(family_id));
create policy rep_ins on public.replies for insert
  with check (public.can_write(family_id) and from_member = public.my_member(family_id));

create policy bd_read on public.birthdays for select using (public.is_member(family_id));
create policy bd_ins on public.birthdays for insert with check (public.can_write(family_id));
create policy bd_del on public.birthdays for delete using (public.can_write(family_id));

create policy disp_admin on public.displays for all using (public.is_admin(family_id)) with check (public.is_admin(family_id));

-- ---------- Funktionen für die App ----------
create or replace function public.create_family(fam_name text, my_name text, my_color text default '#2f5bcc')
returns uuid language plpgsql security definer set search_path = public as $$
declare fam uuid;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  insert into families (name) values (fam_name) returning id into fam;
  insert into members (family_id, user_id, name, role, color, adult) values (fam, auth.uid(), my_name, 'admin', my_color, true);
  insert into displays (family_id, name) values (fam, 'Flur');
  return fam;
end $$;

create or replace function public.create_invite(p_member uuid) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare fam uuid; c text := ''; b bytea := gen_random_bytes(6);
  abc constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
begin
  select family_id into fam from members where id = p_member and active;
  if fam is null or not public.is_admin(fam) then raise exception 'Nur der Admin kann einladen'; end if;
  delete from invites where member_id = p_member or expires_at < now();
  for i in 0..5 loop c := c || substr(abc, get_byte(b, i) % 31 + 1, 1); end loop;
  insert into invites (code, family_id, member_id) values (c, fam, p_member);
  return c;
end $$;

create or replace function public.redeem_invite(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare inv invites;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  select * into inv from invites where code = upper(p_code) and expires_at > now();
  if inv.code is null then raise exception 'Code unbekannt oder abgelaufen'; end if;
  update members set user_id = auth.uid() where id = inv.member_id;
  delete from invites where code = inv.code;
  return inv.family_id;
end $$;

-- Eigene Farbe und eigenen App-Hintergrund darf jeder selbst ändern
create or replace function public.update_my_member(p_color text, p_app_bg text) returns void
language sql security definer set search_path = public as $$
  update members set color = p_color, app_bg = p_app_bg where user_id = auth.uid() and active;
$$;

create or replace function public.busy_slots(fam uuid)
returns table (id uuid, owner uuid, date date, end_date date, all_day boolean, start_min int, end_min int)
language sql stable security definer set search_path = public as $$
  select e.id, e.owner, e.date, e.end_date, e.all_day, e.start_min, e.end_min
  from events e
  where e.family_id = fam and e.vis = 'busy' and public.is_member(fam) and e.end_date >= current_date - 62
$$;

-- Daten für das Flur-Display: nur Familientermine, abrufbar mit dem geheimen Token ohne Anmeldung
create or replace function public.display_feed(p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with d as (select family_id from displays where token = p_token)
  select jsonb_build_object(
    'family', (select jsonb_build_object('name', f.name, 'settings', f.settings) from families f where f.id = (select family_id from d)),
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'color', m.color) order by m.created_at)
                         from members m where m.family_id = (select family_id from d) and m.active), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(e) - 'family_id' - 'created_at')
                        from events e where e.family_id = (select family_id from d) and e.vis = 'family'
                          and e.end_date >= current_date - 1 and e.date <= current_date + 9), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(to_jsonb(m) - 'family_id' || jsonb_build_object('replies',
                          coalesce((select jsonb_agg(to_jsonb(r) - 'family_id' - 'message_id' order by r.created_at) from replies r where r.message_id = m.id), '[]'::jsonb)))
                          from messages m where m.family_id = (select family_id from d) and not m.done
                            and (m.pinned or m.created_at > now() - interval '8 days')), '[]'::jsonb),
    'birthdays', coalesce((select jsonb_agg(to_jsonb(b) - 'family_id') from birthdays b where b.family_id = (select family_id from d)), '[]'::jsonb)
  )
  where exists (select 1 from d)
$$;

revoke all on function public.display_feed(uuid) from public;
grant execute on function public.display_feed(uuid) to anon, authenticated;

-- Realtime für die App
alter publication supabase_realtime add table public.events, public.messages, public.replies, public.members, public.birthdays, public.families, public.displays;
