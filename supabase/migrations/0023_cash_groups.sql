/* Kassenbuch: Buchungsgruppen (z. B. „Urlaub Dänemark 2026“) für Übersichten und Kostenumlage. Nur Block-Kommentare. */
alter table public.receipts add column if not exists grp text not null default '';
alter table public.receipts drop constraint if exists receipts_grp_len;
alter table public.receipts add constraint receipts_grp_len check (length(grp) <= 100);
create index if not exists receipts_family_grp on public.receipts (family_id, grp) where grp <> '';
