/* Konto zurückholen: wer seinen persönlichen Widget-Code hat, verbindet dieses Gerät wieder mit seinem Familienmitglied (z. B. nach gelöschten Browserdaten) */
create or replace function public.reclaim_member(p_token uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare w record;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  select * into w from public.widget_member(p_token);
  delete from members where user_id = auth.uid() and family_id = w.family_id and id <> w.member_id
    and not exists (select 1 from events where owner = members.id);
  update members set user_id = auth.uid() where id = w.member_id;
  return w.family_id;
end $$;
revoke all on function public.reclaim_member(uuid) from public;
grant execute on function public.reclaim_member(uuid) to authenticated;
