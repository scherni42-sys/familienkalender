create or replace function public.events_clear_eta() returns trigger
language plpgsql as $$
begin
  if new.driver is distinct from old.driver or new.date is distinct from old.date or new.addr is distinct from old.addr then
    new.eta := null;
  end if;
  return new;
end $$;

drop trigger if exists events_clear_eta on public.events;
create trigger events_clear_eta before update on public.events
  for each row execute function public.events_clear_eta();
