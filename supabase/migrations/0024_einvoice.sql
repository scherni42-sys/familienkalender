/* Kassenbuch: Angaben für die E-Rechnung (Verkäufer, Käufer, Fälligkeit, Bankverbindung) je Beleg und die eigene Rechnungsanschrift. Nur Block-Kommentare. */
alter table public.receipts add column if not exists einv jsonb not null default '{}'::jsonb;
alter table public.cash_prefs add column if not exists addr jsonb not null default '{}'::jsonb;
