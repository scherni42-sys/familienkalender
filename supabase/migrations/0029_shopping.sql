/* Einkaufszettel: eine gemeinsame Liste pro Familie. Jedes Familienmitglied (Admin, Mitglied) darf Artikel dazuschreiben,
   abhaken und entfernen, egal wer sie eingetragen hat. Gäste und Kinder ohne Handy sehen nur.
   dish: Zutaten für ein bestimmtes Gericht (Rezept-Foto oder Zaubertaste), stehen unten auf dem Zettel;
   taker: wer diesen Artikel einkauft (übernommen), damit nicht doppelt gekauft wird; done_by: wer ihn gekauft hat;
   cat: Abteilung im Supermarkt (Obst, Gemüse, Brot & Gebäck …), danach ist der Zettel sortiert;
   servings: für wie viele Personen das Gericht gedacht ist (ändern rechnet die Mengen um). Nur Block-Kommentare. */
create table if not exists public.shopping (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  qty numeric not null default 1 check (qty > 0 and qty < 10000),
  unit text not null default '' check (char_length(unit) <= 20),
  dish text not null default '' check (char_length(dish) <= 80),
  cat text not null default '' check (char_length(cat) <= 40),
  servings integer check (servings between 1 and 99),
  done boolean not null default false,
  taker uuid references public.members(id) on delete set null,
  added_by uuid references public.members(id) on delete set null,
  done_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists shopping_family on public.shopping (family_id, created_at);

alter table public.shopping enable row level security;
drop policy if exists shop_read on public.shopping;
drop policy if exists shop_ins on public.shopping;
drop policy if exists shop_upd on public.shopping;
drop policy if exists shop_del on public.shopping;
create policy shop_read on public.shopping for select using (public.is_member(family_id));
create policy shop_ins on public.shopping for insert with check (public.can_write(family_id));
create policy shop_upd on public.shopping for update using (public.can_write(family_id)) with check (public.can_write(family_id));
create policy shop_del on public.shopping for delete using (public.can_write(family_id));

/* Änderungen sofort auf allen Handys */
do $$ begin
  alter publication supabase_realtime add table public.shopping;
exception when duplicate_object then null;
end $$;
