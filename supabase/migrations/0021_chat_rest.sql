/* Chat, zweiter Teil (falls 0020 nur bis „chat_days“ durchlief). Nur Block-Kommentare, damit es auch ohne Zeilenumbrüche läuft. */
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
