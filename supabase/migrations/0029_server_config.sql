/* Einstellungen des Betreibers für die Edge Functions, z. B. der Zugang zur Microsoft-App für Outlook-Postfächer.
   Nur der Server (Dienstschlüssel) liest und schreibt hier, die App hat keinen Zugriff. Geheime Werte liegen verschlüsselt. Nur Block-Kommentare. */
create table if not exists public.server_config (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.server_config enable row level security;
revoke all on public.server_config from anon, authenticated;
