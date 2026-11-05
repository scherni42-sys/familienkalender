/* Kassenbuch: Kassenbons mit Foto, Positionen, privat oder Familie. Nur Block-Kommentare (Einfügen am Handy). */

/* Freigabe „Familienkasse einsehen“ je Mitglied; Admins sehen sie immer */
alter table public.members add column if not exists cash_view boolean not null default false;

create or replace function public.cash_viewer(fam uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where family_id = fam and user_id = auth.uid() and active and (role = 'admin' or cash_view))
$$;
grant execute on function public.cash_viewer(uuid) to authenticated;

/* Ein Kassenbon */
create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  owner uuid not null references public.members(id) on delete cascade,
  created_at timestamptz not null default now(),
  bought_at timestamptz not null default now(),
  merchant text not null default '' check (length(merchant) <= 200),
  payment text not null default '' check (length(payment) <= 100),
  card text not null default '' check (length(card) <= 20),
  total numeric(12,2) not null default 0,
  currency text not null default 'EUR',
  category text not null default 'Sonstiges',
  scope text not null default 'private' check (scope in ('private', 'family')),
  photo text,
  note text not null default '' check (length(note) <= 2000),
  archived boolean not null default false
);
create index if not exists receipts_family_time on public.receipts (family_id, bought_at);
alter table public.receipts enable row level security;

/* Eine Zeile auf dem Bon; family = diese Zeile zählt als Familienausgabe (auch auf einem privaten Bon) */
create table if not exists public.receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.receipts(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  owner uuid not null references public.members(id) on delete cascade,
  pos int not null default 0,
  name text not null default '' check (length(name) <= 300),
  qty numeric(10,3) not null default 1,
  price numeric(12,2) not null default 0,
  category text not null default 'Sonstiges',
  family boolean not null default false
);
create index if not exists receipt_items_receipt on public.receipt_items (receipt_id);
alter table public.receipt_items enable row level security;

/* Sichtbar: eigene Bons immer; für Freigegebene alle Familienbons und private Bons mit Familienzeilen */
create or replace function public.receipt_visible(r public.receipts) returns boolean
language sql stable security definer set search_path = public as $$
  select r.owner = public.my_member(r.family_id)
    or (public.cash_viewer(r.family_id) and (r.scope = 'family' or exists (select 1 from receipt_items i where i.receipt_id = r.id and i.family)))
$$;

drop policy if exists rc_read on public.receipts;
create policy rc_read on public.receipts for select using (public.receipt_visible(receipts));
drop policy if exists rc_ins on public.receipts;
create policy rc_ins on public.receipts for insert with check (owner = public.my_member(family_id) and public.my_role(family_id) <> 'guest');
drop policy if exists rc_upd on public.receipts;
create policy rc_upd on public.receipts for update using (owner = public.my_member(family_id)) with check (owner = public.my_member(family_id));
drop policy if exists rc_del on public.receipts;
create policy rc_del on public.receipts for delete using (owner = public.my_member(family_id));

/* Zeilen: eigene immer; Freigegebene sehen Familienzeilen und alle Zeilen von Familienbons */
drop policy if exists ri_read on public.receipt_items;
create policy ri_read on public.receipt_items for select using (
  owner = public.my_member(family_id)
  or (public.cash_viewer(family_id) and (family or exists (select 1 from receipts r where r.id = receipt_id and r.scope = 'family'))));
drop policy if exists ri_ins on public.receipt_items;
create policy ri_ins on public.receipt_items for insert with check (owner = public.my_member(family_id)
  and exists (select 1 from receipts r where r.id = receipt_id and r.owner = receipt_items.owner));
drop policy if exists ri_upd on public.receipt_items;
create policy ri_upd on public.receipt_items for update using (owner = public.my_member(family_id)) with check (owner = public.my_member(family_id));
drop policy if exists ri_del on public.receipt_items;
create policy ri_del on public.receipt_items for delete using (owner = public.my_member(family_id));

/* Fotos der Bons: privater Speicher, Pfad familie/besitzer/zufall.jpg */
insert into storage.buckets (id, name, public, file_size_limit)
values ('receipts', 'receipts', false, 10485760)
on conflict (id) do nothing;
drop policy if exists rc_up on storage.objects;
create policy rc_up on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and public.is_member(((storage.foldername(name))[1])::uuid)
    and ((storage.foldername(name))[2])::uuid = public.my_member(((storage.foldername(name))[1])::uuid));
drop policy if exists rc_get on storage.objects;
create policy rc_get on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and (
    ((storage.foldername(name))[2])::uuid = public.my_member(((storage.foldername(name))[1])::uuid)
    or exists (select 1 from public.receipts r where r.photo = name)));
drop policy if exists rc_rm on storage.objects;
create policy rc_rm on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and ((storage.foldername(name))[2])::uuid = public.my_member(((storage.foldername(name))[1])::uuid));

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'receipts') then
    alter publication supabase_realtime add table public.receipts;
  end if;
end $$;
