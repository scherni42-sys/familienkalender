// Edge Function „push“: Push-Nachrichten über Firebase Cloud Messaging an die Handys der Familie.
// Anlässe: SOS (Start, neuer Standort, „Ich kümmere mich“, Entwarnung) und neue Chat-Nachrichten.
// Zugriff: persönlicher Widget-Code (Android-App) oder angemeldete Nutzer (Web-App).
// Secret FCM_SERVICE_ACCOUNT: Inhalt der Dienstkonto-JSON aus Firebase (Projekteinstellungen → Dienstkonten).
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

type SA = { client_email: string; private_key: string; project_id: string };
let cached: { token: string; until: number } | null = null;
const b64url = (b: ArrayBuffer | string) => btoa(typeof b === 'string' ? b : String.fromCharCode(...new Uint8Array(b))).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

async function accessToken(sa: SA) {
  if (cached && cached.until > Date.now()) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${claim}`));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${b64url(sig)}` })
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('Firebase-Anmeldung fehlgeschlagen: ' + JSON.stringify(j).slice(0, 200));
  cached = { token: j.access_token, until: Date.now() + 50 * 60_000 };
  return cached.token;
}

// An alle Handys der genannten Mitglieder senden; abgemeldete Geräte gleich aufräumen
async function send(members: string[], data: Record<string, string>) {
  const raw = Deno.env.get('FCM_SERVICE_ACCOUNT');
  if (!raw) return { sent: 0, why: 'FCM_SERVICE_ACCOUNT fehlt' };
  const sa = JSON.parse(raw) as SA;
  const { data: rows } = await admin.from('push_tokens').select('token').in('member_id', members);
  if (!rows?.length) return { sent: 0, why: 'keine Geräte' };
  const at = await accessToken(sa);
  let sent = 0;
  await Promise.all(rows.map(async ({ token }) => {
    const r = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: 'POST', headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { token, data, android: { priority: 'HIGH', ttl: data.type === 'sos' ? '3600s' : '86400s' } } })
    });
    if (r.ok) { sent++; return; }
    const t = await r.text();
    console.log('fcm', r.status, t.slice(0, 200));
    if (r.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/.test(t)) await admin.from('push_tokens').delete().eq('token', token);
  }));
  return { sent };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = await req.json();
    // Wer schickt? Widget-Code oder angemeldeter Nutzer → Familienmitglied
    let me: { id: string; family_id: string; name: string } | null = null;
    if (body.widget_token) {
      const { data } = await admin.from('widget_tokens').select('member_id').eq('token', String(body.widget_token)).maybeSingle();
      if (data?.member_id) me = (await admin.from('members').select('id, family_id, name').eq('id', data.member_id).eq('active', true).maybeSingle()).data;
    } else {
      const auth = req.headers.get('Authorization') ?? '';
      const { data: u } = await admin.auth.getUser(auth.replace(/^Bearer /, ''));
      if (u?.user) me = (await admin.from('members').select('id, family_id, name').eq('user_id', u.user.id).eq('active', true).limit(1).maybeSingle()).data;
    }
    if (!me) return json({ error: 'nicht angemeldet' }, 401);
    const family = async () => ((await admin.from('members').select('id').eq('family_id', me!.family_id).eq('active', true).neq('id', me!.id)).data ?? []).map(m => m.id as string);

    if (body.kind === 'chat') {
      const { data: c } = await admin.from('chats').select('*').eq('id', String(body.chat_id)).maybeSingle();
      if (!c || c.from_member !== me.id) return json({ error: 'nicht erlaubt' }, 403);
      const txt = c.kind === 'image' ? `📷 ${c.text || 'Foto'}` : c.kind === 'voice' ? '🎤 Sprachnachricht' : c.kind === 'place' ? '📍 Standort' : c.media ? `📎 ${c.text || 'Dokument'}` : c.text;
      return json(await send([c.to_member], { type: 'chat', id: c.id, from: me.id, from_name: me.name, text: String(txt).slice(0, 300) }));
    }
    if (String(body.kind).startsWith('sos')) {
      const { data: s } = await admin.from('sos').select('*').eq('id', String(body.sos_id)).maybeSingle();
      if (!s || s.family_id !== me.family_id) return json({ error: 'nicht erlaubt' }, 403);
      const own = s.from_member === me.id;
      const { data: from } = await admin.from('members').select('name').eq('id', s.from_member).maybeSingle();
      const base = { id: s.id, from: s.from_member, from_name: from?.name ?? 'Jemand', lat: s.lat == null ? '' : String(s.lat), lon: s.lon == null ? '' : String(s.lon), acc: s.acc == null ? '' : String(Math.round(s.acc)), at: s.created_at };
      if (body.kind === 'sos' && own) return json(await send(await family(), { type: 'sos', ...base }));
      if (body.kind === 'sos_loc' && own) return json(await send(await family(), { type: 'sos_loc', ...base }));
      if (body.kind === 'sos_end' && own) return json(await send(await family(), { type: 'sos_end', ...base }));
      if (body.kind === 'sos_ack') return json(await send([s.from_member, ...(await family()).filter(x => x !== s.from_member)], { type: 'sos_ack', ...base, who: me.id, who_name: me.name }));
      return json({ error: 'nicht erlaubt' }, 403);
    }
    return json({ error: 'unbekannt' }, 400);
  } catch (e) {
    console.log('fehler', String(e));
    return json({ error: String(e) }, 500);
  }
});
