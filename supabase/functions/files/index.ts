// Edge Function „files“: Dokumente an Termine oder ans Board hängen, öffnen und entfernen.
// Die Dateien liegen im privaten Speicher „files“ unter <familie>/<zufall>-<name>; geöffnet wird über einen kurzlebigen Link.
// Zugang: angemeldet in der App (JWT) oder aus der Android-App mit persönlichem Widget-Code.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const URL_ = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const MAX = 15 * 1024 * 1024;

type FileRef = { path: string; name: string; type: string; size: number };

async function who(req: Request, token?: string): Promise<{ fam: string; me: string }> {
  if (typeof token === 'string' && token) {
    const anon = createClient(URL_, Deno.env.get('SUPABASE_ANON_KEY')!);
    const { data, error } = await anon.rpc('widget_member', { p_token: token });
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row?.member_id) throw new Error('Nur mit persönlichem Widget-Code');
    return { fam: row.family_id, me: row.member_id };
  }
  const auth = req.headers.get('Authorization') ?? '';
  const { data: u } = await admin.auth.getUser(auth.replace(/^Bearer /, ''));
  if (!u.user) throw new Error('Nicht angemeldet');
  const { data: m } = await admin.from('members').select('id, family_id, role').eq('user_id', u.user.id).eq('active', true).limit(1);
  if (!m?.length) throw new Error('Nicht angemeldet');
  if (m[0].role === 'guest') throw new Error('Gäste können keine Dateien anhängen');
  return { fam: m[0].family_id, me: m[0].id };
}

// Termin, den ich sehen und ändern darf
async function myEvent(fam: string, me: string, id: string) {
  const { data: e } = await admin.from('events').select('id, family_id, owner, vis, files').eq('id', id).maybeSingle();
  if (!e || e.family_id !== fam || (e.vis !== 'family' && e.owner !== me)) throw new Error('Termin nicht gefunden');
  return e as { id: string; files: FileRef[] | null };
}

// Geburtstag, den ich sehen darf (gemeinsam oder mein privater)
async function myBirthday(fam: string, me: string, id: string) {
  const { data: b } = await admin.from('birthdays').select('id, family_id, owner, files').eq('id', id).maybeSingle();
  if (!b || b.family_id !== fam || (b.owner && b.owner !== me)) throw new Error('Geburtstag nicht gefunden');
  return b as { id: string; files: FileRef[] | null };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const b = await req.json();
    const { fam, me } = await who(req, b.widget_token);

    if (b.action === 'upload') {
      const name = String(b.name ?? 'Datei').replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 120) || 'Datei';
      const type = typeof b.type === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(b.type) ? b.type : 'application/octet-stream';
      const bytes = Uint8Array.from(atob(String(b.data ?? '')), c => c.charCodeAt(0));
      if (!bytes.length) throw new Error('Leere Datei');
      if (bytes.length > MAX) throw new Error('Die Datei ist zu groß (höchstens 15 MB).');
      const ev = b.event_id ? await myEvent(fam, me, String(b.event_id)) : null;
      const bd = !ev && b.birthday_id ? await myBirthday(fam, me, String(b.birthday_id)) : null;
      const safe = name.normalize('NFKD').replace(/[^\w.-]+/g, '_').slice(-60);
      const path = `${fam}/${crypto.randomUUID()}-${safe}`;
      const up = await admin.storage.from('files').upload(path, bytes, { contentType: type });
      if (up.error) throw new Error('Hochladen ging nicht: ' + up.error.message);
      const ref: FileRef = { path, name, type, size: bytes.length };
      if (ev) {
        const { error } = await admin.from('events').update({ files: [...(ev.files ?? []), ref] }).eq('id', ev.id);
        if (error) throw new Error(error.message);
      } else if (bd) {
        const { error } = await admin.from('birthdays').update({ files: [...(bd.files ?? []), ref] }).eq('id', bd.id);
        if (error) throw new Error(error.message);
      } else {
        const text = String(b.text ?? '').trim().slice(0, 500) || `📎 ${name}`;
        const { error } = await admin.from('messages').insert({ family_id: fam, from_member: me, text, files: [ref], via: b.widget_token ? 'Teilen' : null });
        if (error) throw new Error(error.message);
      }
      return json({ file: ref });
    }

    if (b.action === 'sign') {
      const path = String(b.path ?? '');
      if (!path.startsWith(fam + '/')) throw new Error('Datei nicht gefunden');
      const { data, error } = await admin.storage.from('files').createSignedUrl(path, 600, { download: b.download ? String(b.name ?? true) : false });
      if (error || !data) throw new Error('Datei nicht gefunden');
      return json({ url: data.signedUrl });
    }

    if (b.action === 'remove') {
      const path = String(b.path ?? '');
      if (!path.startsWith(fam + '/')) throw new Error('Datei nicht gefunden');
      if (b.event_id) {
        const ev = await myEvent(fam, me, String(b.event_id));
        await admin.from('events').update({ files: (ev.files ?? []).filter(f => f.path !== path) }).eq('id', ev.id);
      } else if (b.birthday_id) {
        const bd = await myBirthday(fam, me, String(b.birthday_id));
        await admin.from('birthdays').update({ files: (bd.files ?? []).filter(f => f.path !== path) }).eq('id', bd.id);
      } else if (b.message_id) {
        const { data: m } = await admin.from('messages').select('id, family_id, files').eq('id', String(b.message_id)).maybeSingle();
        if (!m || m.family_id !== fam) throw new Error('Nachricht nicht gefunden');
        await admin.from('messages').update({ files: ((m.files ?? []) as FileRef[]).filter(f => f.path !== path) }).eq('id', m.id);
      }
      await admin.storage.from('files').remove([path]);
      return json({ ok: true });
    }

    throw new Error('Unbekannte Aktion');
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 400);
  }
});
