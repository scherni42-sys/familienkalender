-- Korrektur: Einladungscode (pgcrypto liegt bei Supabase im Schema „extensions“)
-- Im SQL Editor einmal ausführen, falls 0001 vor dieser Korrektur eingespielt wurde.

create or replace function public.create_invite(p_member uuid) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare fam uuid; c text := ''; b bytea := gen_random_bytes(6);
  abc constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
begin
  select family_id into fam from members where id = p_member and active;
  if fam is null or not public.is_admin(fam) then raise exception 'Nur der Admin kann einladen'; end if;
  delete from invites where member_id = p_member or expires_at < now();
  for i in 0..5 loop c := c || substr(abc, get_byte(b, i) % 31 + 1, 1); end loop;
  insert into invites (code, family_id, member_id) values (c, fam, p_member);
  return c;
end $$;
