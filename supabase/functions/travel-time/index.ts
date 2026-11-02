// Edge Function: Fahrzeit mit dem Auto von zu Hause zur Termin-Adresse.
// Adressen werden über OpenStreetMap (Nominatim) gefunden, die Route über OSRM berechnet. Kein Schlüssel nötig.
// Nur angemeldete Nutzer dürfen die Funktion verwenden.
import { createClient } from 'npm:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
const UA = 'FamTO-Familienkalender/1.0 (https://scherni42-sys.github.io/familienkalender/)';
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function geocode(q: string): Promise<[number, number] | null> {
  // Aktueller Standort kommt als „lat,lon“
  const c = q.match(/^\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/);
  if (c) return [Number(c[2]), Number(c[1])];
  const u = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=de,at,ch,dk,nl&q=${encodeURIComponent(q)}`;
  const r = await fetch(u, { headers: { 'User-Agent': UA, 'Accept-Language': 'de' } });
  if (!r.ok) return null;
  const a = await r.json();
  return a?.[0] ? [Number(a[0].lon), Number(a[0].lat)] : null;
}

// Vorschläge beim Tippen (Photon, OpenStreetMap), Treffer in der Nähe von zu Hause zuerst
const near = new Map<string, [number, number] | null>();
type Hit = { name: string; addr: string };
const fmt = (p: Record<string, string>) => {
  const street = [p.street ?? '', p.housenumber ?? ''].join(' ').trim();
  const town = [p.postcode ?? '', p.city ?? p.town ?? p.village ?? p.district ?? ''].join(' ').trim();
  return [street, town].filter(Boolean).join(', ');
};
async function suggest(q: string, home?: string): Promise<Hit[]> {
  let bias = '';
  if (home) {
    if (!near.has(home)) {
      const h = await fetch(`https://photon.komoot.io/api/?limit=1&lang=de&q=${encodeURIComponent(home)}`, { headers: { 'User-Agent': UA } }).then(r => r.json()).catch(() => null);
      const c = h?.features?.[0]?.geometry?.coordinates;
      near.set(home, c ? [c[0], c[1]] : null);
    }
    const c = near.get(home);
    if (c) bias = `&lon=${c[0]}&lat=${c[1]}&location_bias_scale=0.5`;
  }
  const r = await fetch(`https://photon.komoot.io/api/?limit=6&lang=de&q=${encodeURIComponent(q)}${bias}`, { headers: { 'User-Agent': UA } });
  if (!r.ok) return [];
  const j = await r.json();
  const out: Hit[] = [];
  for (const f of j?.features ?? []) {
    const p = f.properties ?? {};
    if (!['DE', 'AT', 'CH', 'DK', 'NL'].includes(p.countrycode)) continue;
    const addr = fmt(p);
    if (!addr || !p.street) continue;
    const name = p.name && p.name !== p.street ? p.name : '';
    if (!out.some(o => o.addr === addr && o.name === name)) out.push({ name, addr });
  }
  return out.slice(0, 5);
}

// Nichts in OpenStreetMap: im Internet suchen lassen (z. B. Arztpraxen)
async function webFind(q: string, home?: string): Promise<Hit[]> {
  const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content:
    `Finde die Postanschrift von: „${q}“${home ? ` (wahrscheinlich in der Nähe von ${home})` : ''}. ` +
    'Suche im Internet. Antworte am Ende mit genau einer Zeile JSON: {"name": "...", "addr": "Straße Hausnummer, PLZ Ort"} oder {"addr": ""}, wenn du nichts Sicheres findest.' }];
  for (let i = 0; i < 3; i++) {
    const m = await client.messages.create({ model: 'claude-sonnet-5-5', max_tokens: 2000, tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }], messages });
    if (m.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: m.content }); continue; }
    const text = m.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('\n');
    const js = text.match(/\{[^{}]*"addr"[^{}]*\}/g)?.pop();
    if (!js) return [];
    try { const o = JSON.parse(js); return o.addr ? [{ name: String(o.name ?? ''), addr: String(o.addr) }] : []; } catch { return []; }
  }
  return [];
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const auth = req.headers.get('Authorization') ?? '';
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { data: u } = await sb.auth.getUser(auth.replace(/^Bearer /, ''));
    if (!u?.user) return json({ error: 'nicht angemeldet' }, 401);

    const body = await req.json();
    if (body.suggest) return json({ hits: await suggest(String(body.suggest).slice(0, 120), body.home ? String(body.home).slice(0, 200) : undefined) });
    if (body.web) return json({ hits: await webFind(String(body.web).slice(0, 160), body.home ? String(body.home).slice(0, 200) : undefined) });
    // Adresse zu einem Ortsnamen suchen, z. B. „Mediamarkt Kiel Citti-Park“
    if (body.find) {
      const u = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&countrycodes=de,at,ch,dk,nl&q=${encodeURIComponent(String(body.find).slice(0, 200))}`;
      const r = await fetch(u, { headers: { 'User-Agent': UA, 'Accept-Language': 'de' } });
      const a = r.ok ? (await r.json())?.[0]?.address : null;
      if (!a) return json({ error: 'Keine Adresse gefunden' }, 404);
      const street = [a.road ?? a.pedestrian ?? a.footway ?? '', a.house_number ?? ''].join(' ').trim();
      const town = [a.postcode ?? '', a.city ?? a.town ?? a.village ?? a.municipality ?? ''].join(' ').trim();
      if (!street && !town) return json({ error: 'Keine Adresse gefunden' }, 404);
      return json({ addr: [street, town].filter(Boolean).join(', ') });
    }
    const { from, to } = body;
    if (!from || !to) return json({ error: 'Zuhause-Adresse oder Ziel fehlt' }, 400);
    const a = await geocode(String(from).slice(0, 200));
    if (!/^\s*-?\d{1,2}\.\d+\s*,/.test(String(from))) await new Promise(r => setTimeout(r, 1100)); // Nominatim: höchstens eine Anfrage pro Sekunde
    const b = await geocode(String(to).slice(0, 200));
    if (!a) return json({ error: 'Zuhause-Adresse nicht gefunden' }, 404);
    if (!b) return json({ error: 'Ziel-Adresse nicht gefunden' }, 404);
    const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${a[0]},${a[1]};${b[0]},${b[1]}?overview=false`, { headers: { 'User-Agent': UA } });
    const route = (await r.json())?.routes?.[0];
    if (!route) return json({ error: 'keine Route gefunden' }, 404);
    return json({ minutes: Math.max(1, Math.ceil(route.duration / 60)), km: Math.round(route.distance / 100) / 10 });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
