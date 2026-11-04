/* Push-Nachrichten (Firebase) und SOS-Notruf an die Familie. Nur Block-Kommentare, damit es auch eingefügt ohne Zeilenumbrüche läuft. */

/* Geräte-Adressen für Push: je Handy eine, gehört einem Familienmitglied. Lesen nur der Server (Edge Function). */
create table if not exists public.push_tokens (
  token text primary key,
  family_id uuid not null references public.families(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  updated_at timestamptz not null default now()
);
alter table public.push_tokens enable row level security;

create or replace function public.widget_push_register(p_token uuid, p_fcm text) returns void
language plpgsql security definer set search_path = public as $$
declare w record;
begin
  select * into w from public.widget_member(p_token);
  if length(coalesce(p_fcm, '')) < 20 then raise exception 'Ungültige Push-Adresse'; end if;
  insert into push_tokens (token, family_id, member_id) values (p_fcm, w.family_id, w.member_id)
  on conflict (token) do update set family_id = excluded.family_id, member_id = excluded.member_id, updated_at = now();
end $$;
revoke all on function public.widget_push_register(uuid, text) from public;
grant execute on function public.widget_push_register(uuid, text) to anon, authenticated;

/* SOS: wer Hilfe braucht, wo (laufend aktualisiert), wer sich kümmert, wann beendet */
create table if not exists public.sos (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  from_member uuid not null references public.members(id) on delete cascade,
  created_at timestamptz not null default now(),
  lat double precision,
  lon double precision,
  acc double precision,
  loc_at timestamptz,
  ack jsonb not null default '[]'::jsonb,
  ended_at timestamptz
);
create index if not exists sos_family_time on public.sos (family_id, created_at);
alter table public.sos enable row level security;
drop policy if exists sos_read on public.sos;
create policy sos_read on public.sos for select using (public.is_member(family_id));

create or replace function public.widget_sos_start(p_token uuid, p_lat double precision, p_lon double precision, p_acc double precision) returns uuid
language plpgsql security definer set search_path = public as $$
declare w record; nid uuid;
begin
  select * into w from public.widget_member(p_token);
  update sos set ended_at = now() where from_member = w.member_id and ended_at is null;
  insert into sos (family_id, from_member, lat, lon, acc, loc_at)
  values (w.family_id, w.member_id, p_lat, p_lon, p_acc, case when p_lat is null then null else now() end)
  returning id into nid;
  return nid;
end $$;

create or replace function public.widget_sos_loc(p_token uuid, p_id uuid, p_lat double precision, p_lon double precision, p_acc double precision) returns void
language plpgsql security definer set search_path = public as $$
declare w record;
begin
  select * into w from public.widget_member(p_token);
  update sos set lat = p_lat, lon = p_lon, acc = p_acc, loc_at = now()
  where id = p_id and from_member = w.member_id and ended_at is null;
end $$;

create or replace function public.widget_sos_end(p_token uuid, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare w record;
begin
  select * into w from public.widget_member(p_token);
  update sos set ended_at = now() where id = p_id and from_member = w.member_id and ended_at is null;
end $$;

/* „Ich kümmere mich“: vom Handy (Widget-Code) oder aus der Web-App (angemeldet) */
create or replace function public.widget_sos_ack(p_token uuid, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare w record;
begin
  select * into w from public.widget_member(p_token);
  update sos set ack = ack || jsonb_build_array(jsonb_build_object('member', w.member_id, 'at', now()))
  where id = p_id and family_id = w.family_id and not ack @> jsonb_build_array(jsonb_build_object('member', w.member_id));
end $$;

create or replace function public.sos_ack(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare fam uuid; me uuid;
begin
  select family_id into fam from sos where id = p_id;
  me := public.my_member(fam);
  if me is null then raise exception 'Kein Zugriff'; end if;
  update sos set ack = ack || jsonb_build_array(jsonb_build_object('member', me, 'at', now()))
  where id = p_id and not ack @> jsonb_build_array(jsonb_build_object('member', me));
end $$;

revoke all on function public.widget_sos_start(uuid, double precision, double precision, double precision) from public;
revoke all on function public.widget_sos_loc(uuid, uuid, double precision, double precision, double precision) from public;
revoke all on function public.widget_sos_end(uuid, uuid) from public;
revoke all on function public.widget_sos_ack(uuid, uuid) from public;
grant execute on function public.widget_sos_start(uuid, double precision, double precision, double precision) to anon, authenticated;
grant execute on function public.widget_sos_loc(uuid, uuid, double precision, double precision, double precision) to anon, authenticated;
grant execute on function public.widget_sos_end(uuid, uuid) to anon, authenticated;
grant execute on function public.widget_sos_ack(uuid, uuid) to anon, authenticated;
grant execute on function public.sos_ack(uuid) to authenticated;

/* Laufende Notrufe der eigenen Familie fürs Handy (Alarm-Fenster, Widget) */
create or replace function public.widget_sos_active(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare w record;
begin
  select * into w from public.widget_member(p_token);
  return coalesce((select jsonb_agg(to_jsonb(s) - 'family_id' order by s.created_at desc) from sos s
    where s.family_id = w.family_id and s.ended_at is null and s.created_at > now() - interval '2 hours'), '[]'::jsonb);
end $$;
revoke all on function public.widget_sos_active(uuid) from public;
grant execute on function public.widget_sos_active(uuid) to anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'sos') then
    alter publication supabase_realtime add table public.sos;
  end if;
end $$;
