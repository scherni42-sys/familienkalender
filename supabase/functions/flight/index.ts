// Edge Function „flight“: aktueller Flugstatus (Gate, Verspätung, Terminal, Gepäckband) für eine Flugnummer und ein Datum.
// Daten von AeroDataBox (über RapidAPI); der Schlüssel liegt als Secret FLIGHT_API_KEY in Supabase.
// Zugang: angemeldet in der App (JWT) oder aus der Android-App mit persönlichem Widget-Code.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const URL_ = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

async function allowed(req: Request, token?: string) {
  if (typeof token === 'string' && token) {
    const anon = createClient(URL_, Deno.env.get('SUPABASE_ANON_KEY')!);
    const { data, error } = await anon.rpc('widget_member', { p_token: token });
    const row = Array.isArray(data) ? data[0] : data;
    return !error && !!row?.member_id;
  }
  const { data: u } = await admin.auth.getUser((req.headers.get('Authorization') ?? '').replace(/^Bearer /, ''));
  if (!u.user) return false;
  const { data: m } = await admin.from('members').select('id').eq('user_id', u.user.id).eq('active', true).limit(1);
  return !!m?.length;
}

// „2026-11-03 06:40+01:00“ → „06:40“
const hhmm = (t?: { local?: string } | null) => t?.local?.match(/(\d{2}:\d{2})/)?.[1] ?? null;
const mins = (t?: { utc?: string } | null) => { const v = t?.utc ? Date.parse(t.utc.replace(' ', 'T').replace(/Z?$/, 'Z')) : NaN; return isNaN(v) ? null : v; };

type Move = { airport?: { iata?: string; name?: string; municipalityName?: string }; scheduledTime?: { local?: string; utc?: string }; revisedTime?: { local?: string; utc?: string }; predictedTime?: { local?: string; utc?: string }; runwayTime?: { local?: string; utc?: string }; terminal?: string; gate?: string; checkInDesk?: string; baggageBelt?: string };

function side(m: Move = {}) {
  const sched = mins(m.scheduledTime), rev = mins(m.revisedTime ?? m.predictedTime ?? m.runwayTime);
  return {
    airport: m.airport?.municipalityName || m.airport?.name || m.airport?.iata || '',
    iata: m.airport?.iata ?? '',
    sched: hhmm(m.scheduledTime),
    revised: hhmm(m.revisedTime ?? m.predictedTime ?? m.runwayTime),
    delay: sched != null && rev != null ? Math.round((rev - sched) / 60000) : null,
    terminal: m.terminal ?? null, gate: m.gate ?? null, checkIn: m.checkInDesk ?? null, belt: m.baggageBelt ?? null
  };
}

const STATUS: Record<string, string> = {
  Expected: 'planmäßig', EnRoute: 'in der Luft', CheckIn: 'Check-in', Boarding: 'Boarding', GateClosed: 'Gate geschlossen',
  Departed: 'gestartet', Delayed: 'verspätet', Approaching: 'im Anflug', Arrived: 'gelandet', Canceled: 'annulliert',
  Diverted: 'umgeleitet', CanceledUncertain: 'evtl. annulliert', Unknown: ''
};

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const b = await req.json();
    if (!(await allowed(req, b.widget_token))) return json({ error: 'Nicht angemeldet' }, 401);
    const key = Deno.env.get('FLIGHT_API_KEY');
    if (!key) return json({ error: 'kein Schlüssel' }, 400);
    const number = String(b.number ?? '').toUpperCase().replace(/\s+/g, '');
    const date = String(b.date ?? '');
    if (!/^[A-Z0-9]{2}\d{1,4}[A-Z]?$/.test(number) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Flugnummer oder Datum fehlt');
    // Schlüssel von RapidAPI oder von API.Market: erst RapidAPI, bei abgelehntem Schlüssel API.Market
    const path = `/flights/number/${number}/${date}?withAircraftImage=false&withLocation=false`;
    let r = await fetch(`https://aerodatabox.p.rapidapi.com${path}`, { headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com' } });
    if (r.status === 401 || r.status === 403) r = await fetch(`https://prod.api.market/api/v1/aedbx/aerodatabox${path}`, { headers: { 'x-magicapi-key': key, accept: 'application/json' } });
    if (r.status === 204 || r.status === 404) return json({ found: false });
    if (!r.ok) throw new Error(`Flugdaten nicht erreichbar (${r.status})`);
    const list = await r.json();
    const f = Array.isArray(list) ? list[0] : null;
    if (!f) return json({ found: false });
    return json({
      found: true, number: f.number ?? number, airline: f.airline?.name ?? '',
      status: STATUS[f.status] ?? f.status ?? '', canceled: /cancel/i.test(f.status ?? ''),
      dep: side(f.departure), arr: side(f.arrival), at: new Date().toISOString()
    });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 400);
  }
});
