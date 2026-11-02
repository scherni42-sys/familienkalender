alter table public.events add column if not exists eta timestamptz;

create or replace function public.widget_eta(p_token uuid, p_event uuid, p_eta timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare w record;
begin
  select t.family_id, t.member_id into w from widget_tokens t where t.token = p_token;
  if w.member_id is null then raise exception 'Kein persönlicher Widget-Code'; end if;
  update events set eta = p_eta
    where id = p_event and family_id = w.family_id and driver = w.member_id
      and (p_eta is null or p_eta between now() - interval '1 hour' and now() + interval '12 hours');
end $$;

grant execute on function public.widget_eta(uuid, uuid, timestamptz) to anon, authenticated;
