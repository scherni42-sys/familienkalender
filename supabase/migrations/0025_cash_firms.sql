/* Kassenbuch: mehrere Firmen je Person (Name und Rechnungsanschrift) und die Firma je Beleg. Nur Block-Kommentare. */
alter table public.cash_prefs add column if not exists firms jsonb not null default '[]'::jsonb;
alter table public.receipts add column if not exists firm text not null default '';
alter table public.receipts drop constraint if exists receipts_firm_len;
alter table public.receipts add constraint receipts_firm_len check (char_length(firm) <= 200);
