/* Kassenbuch: eigene Postfächer je Mitglied (FamTO Pro). Jedes Mitglied kann ein oder mehrere Postfächer eintragen
   (IMAP mit App-Passwort oder Outlook über die Microsoft-Anmeldung). Die Edge Function „mailin“ liest sie alle 15 Minuten
   und legt erkannte Rechnungen als Belege an. Zugangsdaten liegen nur verschlüsselt in der Spalte secret und sind
   für die App nicht lesbar. Doppelte Rechnungen erkennt die Function über den Fingerabdruck der PDF (file_hash)
   und über Rechnungsnummer, Betrag und Datum. Nur Block-Kommentare. */

/* Teil aus 0026, falls der noch fehlt */
alter table public.receipts add column if not exists inbox boolean not null default false;
create index if not exists receipts_inbox on public.receipts (owner) where inbox;
create table if not exists public.cash_mail (
  id text primary key,
  family_id uuid references public.families(id) on delete cascade,
  created_at timestamptz not null default now(),
  subject text not null default '',
  sender text not null default '',
  status text not null default '',
  receipts int not null default 0
);
alter table public.cash_mail enable row level security;
create table if not exists public.cash_mailkey (id int primary key default 1 check (id = 1), key text not null default encode(extensions.gen_random_bytes(24), 'hex'));
alter table public.cash_mailkey enable row level security;
insert into public.cash_mailkey (id) values (1) on conflict do nothing;

/* Doppelte erkennen */
alter table public.receipts add column if not exists file_hash text;
create index if not exists receipts_file_hash on public.receipts (family_id, file_hash) where file_hash is not null;
create index if not exists receipts_invoice_no on public.receipts (family_id, invoice_no) where invoice_no <> '';

/* Postfächer */
create table if not exists public.mailboxes (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  owner uuid not null references public.members(id) on delete cascade,
  kind text not null check (kind in ('imap', 'outlook')),
  address text not null,
  host text not null default '',
  secret text not null,
  only_invoices boolean not null default true,
  active boolean not null default true,
  last_check timestamptz,
  last_status text not null default '',
  found int not null default 0,
  created_at timestamptz not null default now(),
  unique (owner, address)
);
alter table public.mailboxes enable row level security;
drop policy if exists mailbox_own_read on public.mailboxes;
create policy mailbox_own_read on public.mailboxes for select using (owner = public.my_member(family_id));
drop policy if exists mailbox_own_update on public.mailboxes;
create policy mailbox_own_update on public.mailboxes for update using (owner = public.my_member(family_id));
drop policy if exists mailbox_own_delete on public.mailboxes;
create policy mailbox_own_delete on public.mailboxes for delete using (owner = public.my_member(family_id));
/* Die App sieht nie die Zugangsdaten und darf nur „nur Rechnungen“ und „aktiv“ ändern. Anlegen geht nur über die Function. */
revoke all on public.mailboxes from anon, authenticated;
grant select (id, family_id, owner, kind, address, host, only_invoices, active, last_check, last_status, found, created_at) on public.mailboxes to authenticated;
grant update (only_invoices, active) on public.mailboxes to authenticated;
grant delete on public.mailboxes to authenticated;

alter table public.cash_mail add column if not exists mailbox uuid references public.mailboxes(id) on delete cascade;

/* Zeitplan: alle 15 Minuten alle Postfächer lesen */
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule(jobid) from cron.job where jobname = 'famto-mailin';
select cron.schedule('famto-mailin', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://zjmdhjzjqgaqtlsbrtaf.supabase.co/functions/v1/mailin',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-famto-cron', (select key from public.cash_mailkey where id = 1)),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
$$);
