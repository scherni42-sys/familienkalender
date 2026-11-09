/* Fotos am Board: Bild liegt im Speicher-Bucket board unter familie/zufall.jpg, die Nachricht merkt sich den Pfad */
alter table public.messages add column if not exists image text;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('board', 'board', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
drop policy if exists board_ins on storage.objects;
create policy board_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'board' and public.can_write(((storage.foldername(name))[1])::uuid));
drop policy if exists board_del on storage.objects;
create policy board_del on storage.objects for delete to authenticated
  using (bucket_id = 'board' and public.can_write(((storage.foldername(name))[1])::uuid));
