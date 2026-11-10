/* Tarife: FamTO (Basis, ohne KI) und FamTO Pro (mit KI). Ohne Eintrag gilt Basis.
   Nutzer dürfen den Tarif nur lesen. Ändern geht nur über set_test_plan, und nur für Familien mit tester = true
   (Test-Umschalter in den Einstellungen; fällt weg, sobald es eine Bezahlung gibt). Nur Block-Kommentare. */
create table if not exists public.family_plans (
  family_id uuid primary key references public.families(id) on delete cascade,
  plan text not null default 'basis' check (plan in ('basis', 'pro')),
  tester boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.family_plans enable row level security;
drop policy if exists plan_read on public.family_plans;
create policy plan_read on public.family_plans for select using (public.is_member(family_id));

create or replace function public.plan_of(fam uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select plan from family_plans where family_id = fam), 'basis')
$$;

/* Für die Edge Functions: darf diese Anfrage die KI nutzen? Familie über Display-Code, Widget-Code oder Anmeldung */
create or replace function public.ai_allowed(p_widget uuid default null, p_display uuid default null) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare fam uuid;
begin
  if p_display is not null then
    select family_id into fam from displays where token = p_display;
  elsif p_widget is not null then
    select family_id into fam from widget_tokens where token = p_widget;
  else
    select m.family_id into fam from members m where m.user_id = auth.uid() and m.active limit 1;
  end if;
  return fam is not null and plan_of(fam) = 'pro';
end $$;

create or replace function public.set_test_plan(fam uuid, p_plan text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin(fam) then raise exception 'Nur für Admins'; end if;
  if not coalesce((select tester from family_plans where family_id = fam), false) then raise exception 'Umschalter nur für Testfamilien'; end if;
  if p_plan not in ('basis', 'pro') then raise exception 'Unbekannter Tarif'; end if;
  update family_plans set plan = p_plan, updated_at = now() where family_id = fam;
end $$;

revoke all on function public.plan_of(uuid) from public, anon, authenticated;
revoke all on function public.set_test_plan(uuid, text) from public, anon;
grant execute on function public.plan_of(uuid) to service_role;
grant execute on function public.ai_allowed(uuid, uuid) to anon, authenticated, service_role;
grant execute on function public.set_test_plan(uuid, text) to authenticated;

/* Bestehende Familien behalten ihre KI-Funktionen. Den Test-Umschalter bekommt eine Familie von Hand:
   update public.family_plans set tester = true where family_id = '…'; */
insert into public.family_plans (family_id, plan) select id, 'pro' from public.families on conflict do nothing;
