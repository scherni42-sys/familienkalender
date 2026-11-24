// Edge Function „websuche“ (FamTO Pro): Wissensfragen aus der Zaubertaste, die nicht im Kalender stehen
// („Wann kommt der Flug aus Stuttgart morgen Vormittag in Berlin an?“, „Hat der Baumarkt Sonntag offen?“).
// Sparsam: Claude Haiku 5.5. Flüge nur über die Ankunfts- bzw. Abflugtafel bei AeroDataBox (gleicher Schlüssel FLIGHT_API_KEY
// wie die Funktion „flight“), ohne Websuche. Alles andere mit höchstens einer Websuche (1 Cent pro Suche bei Anthropic).
// Höchstens 20 Websuchen pro Familie und Tag (Datenbankfunktion web_quota).
import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';

const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// ---------- Flugtafel (AeroDataBox) ----------
type T = { local?: string; utc?: string } | null | undefined;
type Move = { airport?: { iata?: string; name?: string; municipalityName?: string }; scheduledTime?: T; revisedTime?: T; predictedTime?: T; runwayTime?: T; terminal?: string; gate?: string; baggageBelt?: string };
type Flight = { number?: string; status?: string; airline?: { name?: string }; departure?: Move; arrival?: Move; movement?: Move; codeshareStatus?: string };

const hhmm = (t: T) => t?.local?.match(/(\d{2}:\d{2})/)?.[1] ?? null;
const ms = (t: T) => { const v = t?.utc ? Date.parse(t.utc.replace(' ', 'T').replace(/Z?$/, 'Z')) : NaN; return isNaN(v) ? null : v; };
const STATUS: Record<string, string> = {
  Expected: 'planmäßig', EnRoute: 'in der Luft', CheckIn: 'Check-in', Boarding: 'Boarding', GateClosed: 'Gate geschlossen',
  Departed: 'gestartet', Delayed: 'verspätet', Approaching: 'im Anflug', Arrived: 'gelandet', Canceled: 'annulliert',
  Diverted: 'umgeleitet', CanceledUncertain: 'evtl. annulliert', Unknown: ''
};
const where = (m?: Move) => [m?.airport?.municipalityName || m?.airport?.name, m?.airport?.iata].filter(Boolean).join(' ');
const time = (m?: Move) => {
  if (!m) return '';
  const s = hhmm(m.scheduledTime), r = hhmm(m.revisedTime ?? m.predictedTime ?? m.runwayTime);
  const a = ms(m.scheduledTime), b = ms(m.revisedTime ?? m.predictedTime ?? m.runwayTime);
  const late = a != null && b != null ? Math.round((b - a) / 60000) : 0;
  return [s ? `plan ${s}` : '', r && r !== s ? `neu ${r}${late ? ` (${late > 0 ? '+' : ''}${late} Min.)` : ''}` : '', m.terminal ? `Terminal ${m.terminal}` : '', m.gate ? `Gate ${m.gate}` : '', m.baggageBelt ? `Band ${m.baggageBelt}` : ''].filter(Boolean).join(', ');
};

// Tafel eines Flughafens für ein Zeitfenster (höchstens 12 Stunden), optional nur Flüge von/nach einem anderen Ort
async function board(i: { airport: string; direction: 'Arrival' | 'Departure'; from: string; to: string; other?: string | null }): Promise<string> {
  const key = Deno.env.get('FLIGHT_API_KEY');
  if (!key) return 'Flugtafel nicht verfügbar (kein Schlüssel). Nutze die Websuche.';
  const ap = String(i.airport ?? '').toUpperCase();
  const dt = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
  if (!/^[A-Z]{3}$/.test(ap) || !dt.test(i.from) || !dt.test(i.to)) return 'Ungültige Angaben: airport als IATA-Code (z. B. BER), from/to als YYYY-MM-DDTHH:mm.';
  const span = (Date.parse(i.to) - Date.parse(i.from)) / 3600000;
  if (!(span > 0 && span <= 12)) return 'Das Zeitfenster muss zwischen 1 Minute und 12 Stunden lang sein.';
  const path = `/flights/airports/iata/${ap}/${i.from}/${i.to}?direction=${i.direction}&withLeg=true&withCancelled=true&withCodeshared=false&withCargo=false&withPrivate=false&withLocation=false`;
  let r = await fetch(`https://aerodatabox.p.rapidapi.com${path}`, { headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com' } });
  if (r.status === 401 || r.status === 403) r = await fetch(`https://prod.api.market/api/v1/aedbx/aerodatabox${path}`, { headers: { 'x-magicapi-key': key, accept: 'application/json' } });
  console.log('websuche flugtafel', ap, i.direction, i.from, i.to, 'status', r.status);
  if (r.status === 204 || r.status === 404) return 'Keine Flüge in diesem Zeitfenster gefunden.';
  if (!r.ok) return `Flugtafel gerade nicht erreichbar (${r.status}). Nutze die Websuche.`;
  const d = await r.json() as { arrivals?: Flight[]; departures?: Flight[] };
  let list = (i.direction === 'Arrival' ? d.arrivals : d.departures) ?? [];
  // Gegenstelle: bei Ankünften der Abflugort, bei Abflügen das Ziel
  const otherOf = (f: Flight) => i.direction === 'Arrival' ? (f.departure ?? f.movement) : (f.arrival ?? f.movement);
  const o = String(i.other ?? '').trim().toLowerCase();
  if (o) list = list.filter(f => { const m = otherOf(f); return [m?.airport?.iata, m?.airport?.name, m?.airport?.municipalityName].some(x => x && x.toLowerCase().includes(o)); });
  if (!list.length) return o ? `Keine Flüge von/nach „${i.other}“ in diesem Zeitfenster.` : 'Keine Flüge in diesem Zeitfenster.';
  return list.slice(0, 40).map(f => {
    const here = i.direction === 'Arrival' ? (f.arrival ?? f.movement) : (f.departure ?? f.movement);
    const there = otherOf(f);
    return [f.number, f.airline?.name, i.direction === 'Arrival' ? `aus ${where(there)}` : `nach ${where(there)}`,
      i.direction === 'Arrival' ? `Abflug ${time(f.departure)}` : '', `${i.direction === 'Arrival' ? 'Ankunft' : 'Abflug'} ${time(here)}`,
      STATUS[f.status ?? ''] ?? f.status ?? ''].filter(Boolean).join(' | ');
  }).join('\n');
}

// ---------- Werkzeuge für Claude ----------
const tools: Anthropic.Beta.BetaToolUnion[] = [
  { type: 'web_search_20250305', name: 'web_search', max_uses: 1, user_location: { type: 'approximate', country: 'DE', timezone: 'Europe/Berlin' } },
  {
    name: 'flugtafel', strict: true,
    description: 'Ankunfts- oder Abflugtafel eines Flughafens mit Live-Zeiten (Verspätung, Terminal, Gate, Gepäckband). Für Fragen nach Flügen genauer als die Websuche. Zeitfenster höchstens 12 Stunden, Ortszeit des Flughafens.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['airport', 'direction', 'from', 'to', 'other'],
      properties: {
        airport: { type: 'string', description: 'IATA-Code des Flughafens, dessen Tafel abgefragt wird, z. B. BER für Ankünfte in Berlin' },
        direction: { type: 'string', enum: ['Arrival', 'Departure'] },
        from: { type: 'string', description: 'Beginn, Ortszeit, Format YYYY-MM-DDTHH:mm' },
        to: { type: 'string', description: 'Ende, Ortszeit, Format YYYY-MM-DDTHH:mm, höchstens 12 Stunden nach from' },
        other: { type: ['string', 'null'], description: 'Nur Flüge von bzw. nach diesem Ort: IATA-Code oder Stadt, z. B. STR oder Stuttgart; null für alle' }
      }
    }
  },
  {
    name: 'antwort', strict: true,
    description: 'Gibt die fertige Antwort an die App. Immer zum Schluss genau einmal aufrufen.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['text', 'quellen', 'termin'],
      properties: {
        text: { type: 'string', description: 'Antwort auf Deutsch, duzen, 1 bis 4 kurze Sätze, ohne Links und ohne Markdown' },
        quellen: { type: 'array', description: 'Höchstens 2 Quellen, die die Antwort belegen', items: { type: 'object', additionalProperties: false, required: ['titel', 'url'], properties: { titel: { type: 'string' }, url: { type: 'string' } } } },
        termin: { type: ['string', 'null'], description: 'Nur wenn sich die Antwort als Termin eignet (Ankunft, Abflug, Veranstaltung, Öffnungszeit für einen bestimmten Tag): ein Satz für den Kalender, z. B. „Mittwoch 25.11. 10:45 Abholung Flughafen BER, EW 2034 aus Stuttgart“. Sonst null.' }
      }
    }
  }
];

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { q = '', today, now, weekday } = await req.json();
    const auth = req.headers.get('Authorization') ?? '';
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { data: u } = await sb.auth.getUser(auth.replace(/^Bearer /, ''));
    const { data: mine } = u.user ? await sb.from('members').select('id').eq('user_id', u.user.id).eq('active', true).limit(1) : { data: null };
    if (!mine?.length) return json({ error: 'Nicht angemeldet' }, 401);
    const { data: pro } = await sb.rpc('ai_allowed', {});
    if (pro !== true) return json({ error: 'Die KI-Funktionen gibt es in FamTO Pro.', pro: true }, 402);
    if (typeof q !== 'string' || !q.trim() || q.length > 500) throw new Error('Keine Frage');
    // Tageslimit der Familie: zählt diese Suche mit und sagt, ob sie noch erlaubt ist
    const { data: ok, error: qe } = await sb.rpc('web_quota', {});
    if (qe) console.log('websuche web_quota', qe.message);
    if (ok === false) return json({ error: 'Für heute sind die 20 Internetsuchen eurer Familie aufgebraucht. Morgen geht es wieder.' }, 429);

    const wd = weekday ?? (/^\d{4}-\d{2}-\d{2}$/.test(String(today)) ? ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'][new Date(`${today}T12:00:00Z`).getUTCDay()] : '');
    const system = `Du bist die Internetsuche im Familienkalender FamTO. Heute ist ${wd} ${today}, jetzt ${now} Uhr (deutsche Zeit).
Beantworte die Frage kurz und genau. Rechne Angaben wie „morgen Vormittag“ in echte Daten und Uhrzeiten um (Vormittag 6 bis 12 Uhr, Nachmittag 12 bis 18 Uhr, Abend 18 bis 23 Uhr).
- Fragen nach Flügen: nimm nur das Werkzeug „flugtafel“, keine Websuche (bei Ankünften die Tafel des Zielflughafens mit other = Abflugort, bei Abflügen die des Startflughafens). Berlin ist BER, Hamburg HAM, München MUC, Frankfurt FRA, Stuttgart STR, Düsseldorf DUS, Köln/Bonn CGN. Gibt es mehrere passende Flüge, nenne alle (höchstens 4) mit Flugnummer und Zeit. Nenne Verspätungen.
- Nur wenn die Flugtafel nicht verfügbar ist, darfst du für Flüge die Websuche nehmen.
- Alles andere (Öffnungszeiten, Züge, Wetter, Veranstaltungen, Ergebnisse, Fakten): genau eine Websuche mit einer guten, knappen Suchanfrage. Weißt du es sicher ohne Suche (z. B. allgemeines Wissen), antworte ohne Suche.
- Erfinde nichts. Wenn du nichts Sicheres findest, sag das ehrlich in einem Satz.
- Zum Schluss rufst du genau einmal „antwort“ auf. Schreib danach nichts mehr.`;

    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: q.trim() }];
    let boards = 0;
    for (let round = 0; round < 5; round++) {
      const m = await client.beta.messages.create({
        model: 'claude-haiku-5-5', max_tokens: 3000,
        output_config: { effort: 'low' },
        system, tools, messages
      });
      if (m.stop_reason === 'refusal') throw new Error('abgelehnt');
      messages.push({ role: 'assistant', content: m.content });
      const fin = m.content.find(b => b.type === 'tool_use' && b.name === 'antwort');
      if (fin && fin.type === 'tool_use') {
        const a = fin.input as { text: string; quellen: { titel: string; url: string }[]; termin: string | null };
        const quellen = (a.quellen ?? []).filter(s => /^https:\/\//.test(s.url)).slice(0, 2);
        return json({ result: { text: a.text, quellen, termin: a.termin || null } });
      }
      if (m.stop_reason === 'pause_turn') continue;
      const calls = m.content.filter(b => b.type === 'tool_use');
      if (m.stop_reason === 'tool_use' && calls.length) {
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const c of calls) {
          if (c.type !== 'tool_use') continue;
          let out = 'Unbekanntes Werkzeug';
          if (c.name === 'flugtafel') out = ++boards > 2 ? 'Genug Tafeln abgefragt, antworte jetzt.' : await board(c.input as Parameters<typeof board>[0]).catch(e => `Fehler: ${e instanceof Error ? e.message : e}`);
          results.push({ type: 'tool_result', tool_use_id: c.id, content: out });
        }
        messages.push({ role: 'user', content: results });
        continue;
      }
      // Claude hat ohne „antwort“ geschlossen: Text nehmen, Quellen aus den Zitaten
      const text = m.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join(' ').replace(/\s+/g, ' ').trim();
      const seen = new Map<string, string>();
      for (const b of m.content) if (b.type === 'text') for (const c of b.citations ?? []) if ('url' in c && c.url && !seen.has(c.url)) seen.set(c.url, ('title' in c && c.title) || c.url);
      if (!text) break;
      return json({ result: { text, quellen: [...seen].slice(0, 2).map(([url, titel]) => ({ titel, url })), termin: null } });
    }
    throw new Error('Keine Antwort gefunden');
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 400);
  }
});
