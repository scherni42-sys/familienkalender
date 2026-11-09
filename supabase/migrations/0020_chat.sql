/* Chat: Nachrichten von Person zu Person. Sichtbar nur für Absender und Empfänger, nie auf dem Display.
   Nach einer einstellbaren Zeit (families.settings.chatDays, 1 bis 30 Tage, Standard 7) verschwinden sie. */
create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  from_member uuid not null references public.members(id) on delete cascade,
  to_member uuid not null references public.members(id) on delete cascade,
  kind text not null default 'text' check (kind in ('text', 'image', 'voice', 'place')),
  text text not null default '' check (length(text) <= 2000),
  media text,
  dur int,
  lat double precision,
  lon double precision,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check (from_member <> to_member)
);
create index if not exists chats_family_time on public.chats (family_id, created_at);
alter table public.chats enable row level security;

create or replace function public.chat_days(fam uuid) returns int
language sql stable security definer set search_path = public as $$
  select greatest(1, least(30, coalesce((settings->>'chatDays')::int, 7))) from families where id = fam
$$;
grant execute on function public.chat_days(uuid) to authenticated;

drop policy if exists chat_read on public.chats;
create policy chat_read on public.chats for select
  using (public.my_member(family_id) in (from_member, to_member) and created_at > now() - make_interval(days => public.chat_days(family_id)));
drop policy if exists chat_ins on public.chats;
create policy chat_ins on public.chats for insert
  with check (from_member = public.my_member(family_id) and public.my_role(family_id) <> 'guest'
    and exists (select 1 from public.members m where m.id = to_member and m.family_id = chats.family_id and m.active and m.role <> 'guest'));
drop policy if exists chat_del on public.chats;
create policy chat_del on public.chats for delete using (from_member = public.my_member(family_id));

/* Gelesen: nur der Empfänger markiert die Nachrichten eines Absenders als gelesen */
create or replace function public.chat_seen(p_with uuid) returns void
language sql security definer set search_path = public as $$
  update chats c set read_at = now()
  where c.from_member = p_with and c.read_at is null
    and c.to_member = public.my_member(c.family_id)
$$;
grant execute on function public.chat_seen(uuid) to authenticated;

/* Abgelaufene Nachrichten der eigenen Familie löschen; liefert die Pfade der Bilder und Sprachnachrichten zum Aufräumen */
create or replace function public.chat_purge() returns setof text
language sql security definer set search_path = public as $$
  delete from chats c
  where public.is_member(c.family_id) and c.created_at < now() - make_interval(days => public.chat_days(c.family_id))
  returning c.media
$$;
grant execute on function public.chat_purge() to authenticated;

/* Bilder und Sprachnachrichten: privater Speicher, Pfad familie/absender/zufall.ext */
insert into storage.buckets (id, name, public, file_size_limit)
values ('chat', 'chat', false, 10485760)
on conflict (id) do nothing;
drop policy if exists chat_up on storage.objects;
create policy chat_up on storage.objects for insert to authenticated
  with check (bucket_id = 'chat' and public.is_member(((storage.foldername(name))[1])::uuid)
    and ((storage.foldername(name))[2])::uuid = public.my_member(((storage.foldername(name))[1])::uuid));
drop policy if exists chat_get on storage.objects;
create policy chat_get on storage.objects for select to authenticated
  using (bucket_id = 'chat' and exists (select 1 from public.chats c where c.media = name));
drop policy if exists chat_rm on storage.objects;
create policy chat_rm on storage.objects for delete to authenticated
  using (bucket_id = 'chat' and public.is_member(((storage.foldername(name))[1])::uuid));

/* Widget: eigene Chats mit dem persönlichen Widget-Code (nicht mit einem Display-Code) */
create or replace function public.widget_chats(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare w record;
begin
  select * into w from public.widget_member(p_token);
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'from', c.from_member, 'to', c.to_member, 'kind', c.kind,
      'text', c.text, 'created_at', c.created_at, 'read_at', c.read_at) order by c.created_at)
    from chats c where c.family_id = w.family_id and w.member_id in (c.from_member, c.to_member)
      and c.created_at > now() - make_interval(days => public.chat_days(c.family_id))), '[]'::jsonb);
end $$;
revoke all on function public.widget_chats(uuid) from public;
grant execute on function public.widget_chats(uuid) to anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'chats') then
    alter publication supabase_realtime add table public.chats;
  end if;
end $$;
