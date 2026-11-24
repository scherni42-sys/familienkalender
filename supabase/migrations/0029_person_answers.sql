-- Teilnehmer bestätigen Termine: Wer zu einem Termin hinzugefügt wird, bekommt eine Anfrage und sagt zu oder ab.
-- persons_by: wer die Teilnehmer zuletzt hinzugefügt hat (bekommt die Antworten gemeldet)
-- persons_ok: Antworten je Teilnehmer, z. B. {"<member-id>": true, "<member-id>": false}; fehlt jemand, ist die Antwort offen
-- Bestehende Termine bleiben ohne persons_by und lösen keine Anfragen aus.

alter table public.events add column if not exists persons_by uuid references public.members on delete set null;
alter table public.events add column if not exists persons_ok jsonb not null default '{}'::jsonb;

-- Neuer Termin: wer ihn anlegt, hat die Teilnehmer eingetragen und ist selbst automatisch dabei
create or replace function public.events_new_persons() returns trigger
language plpgsql security definer set search_path = public as $$
declare me uuid;
begin
  select m.id into me from members m where m.family_id = new.family_id and m.user_id = auth.uid() and m.active limit 1;
  if new.persons_by is null and coalesce(array_length(new.persons, 1), 0) > 0 then new.persons_by := coalesce(me, new.owner); end if;
  new.persons_ok := coalesce(new.persons_ok, '{}'::jsonb);
  if new.persons_by is not null and new.persons_by = any(new.persons) and not new.persons_ok ? new.persons_by::text then
    new.persons_ok := new.persons_ok || jsonb_build_object(new.persons_by::text, true);
  end if;
  return new;
end $$;

drop trigger if exists events_new_persons on public.events;
create trigger events_new_persons before insert on public.events
  for each row execute function public.events_new_persons();

-- Termin geändert:
--  * Teilnehmer entfernt: deren Antwort fällt weg
--  * jemand Neues hinzugefügt: wer das getan hat, bekommt künftig die Antworten
--  * Tag oder Uhrzeit verschoben: alle werden neu gefragt (außer dem, der verschoben hat)
create or replace function public.events_persons_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare me uuid; added boolean; moved boolean;
begin
  if new.persons_ok is distinct from old.persons_ok then return new; end if; -- eine Antwort wird gespeichert
  moved := new.date is distinct from old.date or new.start_min is distinct from old.start_min or new.all_day is distinct from old.all_day;
  if new.persons is not distinct from old.persons and not moved then return new; end if;
  select m.id into me from members m where m.family_id = new.family_id and m.user_id = auth.uid() and m.active limit 1;
  added := exists (select 1 from unnest(new.persons) p where not p = any(coalesce(old.persons, '{}')) and p is distinct from me);
  if added or (moved and me is not null) then new.persons_by := coalesce(me, new.persons_by, new.owner); end if;
  if moved then
    new.persons_ok := '{}'::jsonb;
  else
    new.persons_ok := coalesce((select jsonb_object_agg(k, v) from jsonb_each(old.persons_ok) as x(k, v)
                                 where exists (select 1 from unnest(new.persons) p where p::text = k)), '{}'::jsonb);
  end if;
  -- Wer selbst einträgt, ist dabei
  if new.persons_by is not null and new.persons_by = any(new.persons) and not new.persons_ok ? new.persons_by::text then
    new.persons_ok := new.persons_ok || jsonb_build_object(new.persons_by::text, true);
  end if;
  if me is not null and me = any(new.persons) and not new.persons_ok ? me::text then
    new.persons_ok := new.persons_ok || jsonb_build_object(me::text, true);
  end if;
  return new;
end $$;

drop trigger if exists events_persons_changed on public.events;
create trigger events_persons_changed before update on public.events
  for each row execute function public.events_persons_changed();

-- Antwort speichern (zusagen = true, absagen = false). Wer absagt, bleibt im Termin, ist aber als „kann nicht“ markiert.
create or replace function public.person_answer_core(p_member uuid, p_event uuid, p_ok boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from events where id = p_event) then raise exception 'Termin nicht gefunden'; end if;
  if not exists (select 1 from events where id = p_event and p_member = any(persons)) then raise exception 'Du bist bei diesem Termin nicht eingetragen'; end if;
  update events set persons_ok = coalesce(persons_ok, '{}'::jsonb) || jsonb_build_object(p_member::text, p_ok) where id = p_event;
end $$;

create or replace function public.person_answer(p_event uuid, p_ok boolean) returns void
language plpgsql security definer set search_path = public as $$
declare fam uuid; me uuid;
begin
  select family_id into fam from events where id = p_event;
  me := public.my_member(fam);
  if me is null then raise exception 'Nicht angemeldet'; end if;
  perform public.person_answer_core(me, p_event, p_ok);
end $$;

-- Aus der Android-Benachrichtigung (persönlicher Widget-Code)
create or replace function public.widget_person_answer(p_token uuid, p_event uuid, p_ok boolean) returns void
language plpgsql security definer set search_path = public as $$
declare w record;
begin
  select t.family_id, t.member_id into w from widget_tokens t where t.token = p_token;
  if w.member_id is null then raise exception 'Kein persönlicher Widget-Code'; end if;
  if not exists (select 1 from events where id = p_event and family_id = w.family_id) then raise exception 'Termin nicht gefunden'; end if;
  perform public.person_answer_core(w.member_id, p_event, p_ok);
end $$;

grant execute on function public.person_answer(uuid, boolean) to authenticated;
grant execute on function public.widget_person_answer(uuid, uuid, boolean) to anon, authenticated;
revoke execute on function public.person_answer_core(uuid, uuid, boolean) from public, anon, authenticated;
