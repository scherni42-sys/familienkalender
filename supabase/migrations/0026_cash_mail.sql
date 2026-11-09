/* Kassenbuch: Rechnungen aus E-Mails. Neue Belege landen im Eingang (inbox), bis sie geprüft und gespeichert sind.
   cash_mail merkt sich, welche Mails schon gelesen wurden (nur für die Edge Function, keine Rechte für Nutzer).
   Der Zeitplan ruft die Funktion alle 15 Minuten mit einem zufälligen Schlüssel aus cash_mailkey auf. Nur Block-Kommentare. */
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
create extension if not exists pg_cron;
create extension if not exists pg_net;
alter table public.cash_prefs add column if not exists mailin boolean not null default false;
create table if not exists public.cash_mailkey (id int primary key default 1 check (id = 1), key text not null default encode(extensions.gen_random_bytes(24), 'hex'));
alter table public.cash_mailkey enable row level security;
insert into public.cash_mailkey (id) values (1) on conflict do nothing;
select cron.unschedule(jobid) from cron.job where jobname = 'famto-mailin';
select cron.schedule('famto-mailin', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://zjmdhjzjqgaqtlsbrtaf.supabase.co/functions/v1/mailin',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-famto-cron', (select key from public.cash_mailkey where id = 1)),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
$$);
