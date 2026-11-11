/* Widget: Zahl der offenen Artikel auf dem Einkaufszettel. Das Widget zeigt dann rechts neben „Board“
   das grüne Zettel-Symbol (wie in der App). Über den Widget-Code, wie widget_chats. Nur Block-Kommentare. */
create or replace function public.widget_shop(p_token uuid) returns integer
language plpgsql stable security definer set search_path = public as $$
declare w record;
begin
  select * into w from public.widget_member(p_token);
  if w.family_id is null then return 0; end if;
  return (select count(*) from shopping s where s.family_id = w.family_id and not s.done);
end $$;
revoke all on function public.widget_shop(uuid) from public;
grant execute on function public.widget_shop(uuid) to anon, authenticated;
