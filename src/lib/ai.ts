import type { Birthday, CalEvent, Member } from './types';
import { parseLocal, type Draft } from './parse';
import { supabase } from './supabase';
import { addDays, fromIso, hm, nowMin, today, WDS } from './dates';
import { list as cashList, familyPart, type Receipt } from './cash';

// Foto verkleinern (längste Seite 1280 px, JPEG), damit es schnell hochlädt
export async function shrinkPhoto(file: File): Promise<{ type: string; data: string }> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return { type: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.82).split(',')[1] };
}

// Avatar: Mitte des Fotos quadratisch ausschneiden, 256 × 256
export async function squarePhoto(file: File): Promise<{ type: string; data: string }> {
  const bmp = await createImageBitmap(file);
  const n = Math.min(bmp.width, bmp.height);
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  c.getContext('2d')!.drawImage(bmp, (bmp.width - n) / 2, (bmp.height - n) / 2, n, n, 0, 0, 256, 256);
  return { type: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.85).split(',')[1] };
}

// KI-Erkennung über die Edge Function „parse-event“ (Text oder Foto); ohne Verbindung die einfache Erkennung auf dem Handy
export async function parseSpoken(text: string, me: string, members: Pick<Member, 'id' | 'name' | 'role'>[], image?: { type: string; data: string }, display?: string): Promise<Draft & { source: 'ai' | 'local'; why?: string; found?: boolean; more?: Draft[] }> {
  const local = parseLocal(text, me, members);
  if (!supabase) return { ...local, source: 'local' };
  try {
    const call = supabase.functions.invoke('parse-event', {
      body: { text, today: today(), me, members: members.map(m => ({ id: m.id, name: m.name, role: m.role })), image, ...(display ? { display_token: display } : {}) }
    });
    const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`keine Antwort nach ${image ? 45 : 25} s`)), image ? 45000 : 25000));
    const { data, error } = await Promise.race([call, timeout]);
    if (error || !data?.event) throw error ?? new Error('leer');
    const e = data.event;
    const ids = new Set(members.map(m => m.id));
    const persons = (e.persons as string[]).filter(id => ids.has(id));
    const allDay = !!e.all_day;
    const first: Draft = {
      ...local,
      title: e.title || local.title,
      date: e.date || local.date,
      end_date: e.end_date && e.end_date >= e.date ? e.end_date : e.date || local.date,
      all_day: allDay,
      start_min: allDay ? 0 : e.start_min ?? local.start_min,
      end_min: allDay ? 1440 : e.end_min ?? local.end_min,
      persons: persons.length ? persons : [me],
      driver: e.driver && ids.has(e.driver) ? e.driver : null,
      vis: e.vis === 'family' ? 'family' : 'private',
      suggested: e.vis === 'family' ? 'family' : 'private',
      busy: e.vis !== 'family',
      place: e.place ?? '',
      addr: e.addr ?? '',
      bring: Array.isArray(e.bring) ? e.bring : [],
      discreet: !!e.discreet,
      reason: e.reason || local.reason,
      timeFound: !allDay
    };
    // Screenshot/Foto mit mehreren Terminen (z. B. Abfuhrkalender): weitere Termine mit denselben Personen und derselben Art
    type More = { title: string; date: string; end_date: string; all_day: boolean; start_min: number; end_min: number; place: string };
    const more = (Array.isArray(e.more) ? e.more as More[] : []).filter(x => x && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && x.title).slice(0, 60).map((x): Draft => ({
      ...first, title: x.title, date: x.date, end_date: x.end_date && x.end_date >= x.date ? x.end_date : x.date,
      all_day: !!x.all_day, start_min: x.all_day ? 0 : x.start_min ?? 600, end_min: x.all_day ? 1440 : x.end_min ?? (x.start_min ?? 600) + 60,
      place: x.place ?? '', addr: '', bring: [], timeFound: !x.all_day
    }));
    return { ...first, source: 'ai', found: e.found !== false, more };
  } catch (err) {
    // Grund mitgeben, damit die Bestätigung zeigt, warum die KI nicht geholfen hat
    let why = err instanceof Error ? err.message : String(err);
    const res = (err as { context?: Response }).context;
    if (res && typeof res.json === 'function') {
      try { const b = await res.json(); why = `${res.status}: ${b?.error ?? b?.message ?? why}`; } catch { why = `HTTP ${res.status}`; }
    }
    return { ...local, source: 'local', why };
  }
}

// Fahrzeit mit dem Auto von zu Hause zur Adresse (Edge Function „travel-time“, OpenStreetMap)
export async function travelTime(from: string, to: string): Promise<{ minutes: number; km: number }> {
  if (!supabase) return { minutes: 12, km: 6.4 }; // Beispielfamilie: feste Werte
  const { data, error } = await supabase.functions.invoke('travel-time', { body: { from, to } });
  if (error) {
    const msg = await (error as { context?: Response }).context?.json?.().then((j: { error?: string }) => j.error).catch(() => '');
    throw new Error(msg || 'Fahrzeit konnte nicht berechnet werden');
  }
  return data;
}

// Ortsvorschläge beim Tippen (OpenStreetMap) und, wenn nichts passt, Suche im Internet
export type PlaceHit = { name: string; addr: string };
export async function suggestPlaces(q: string, home: string, web = false): Promise<PlaceHit[]> {
  if (!supabase) return web ? [{ name: q, addr: 'Holstenstraße 1, 24103 Kiel' }] : /sport/i.test(q) ? [{ name: 'Sportplatz Nord', addr: 'Projensdorfer Str. 300, 24106 Kiel' }, { name: 'Sportplatz Süd', addr: 'Hamburger Chaussee 20, 24113 Kiel' }] : [];
  const { data, error } = await supabase.functions.invoke('travel-time', { body: web ? { web: q, home } : { suggest: q, home } });
  if (error) throw new Error('Suche gerade nicht möglich');
  return data?.hits ?? [];
}

// Zaubertaste: Frage an Claude zu den eigenen Terminen (Edge Function „ask“)
export type AskResult = { answer: string; events: CalEvent[]; birthdays: Birthday[]; receipts: Receipt[]; action: 'none' | 'open' | 'edit' | 'new' | 'bdays'; target: CalEvent | null; newText: string | null; local?: boolean };
export async function askClaude(q: string, me: string, members: Member[], events: CalEvent[], birthdays: Birthday[]): Promise<AskResult> {
  const t = today(), from = addDays(t, -365), to = addDays(t, 730);
  const evs = events.filter(e => e.end_date >= from && e.date <= to).sort((a, b) => a.date.localeCompare(b.date) || a.start_min - b.start_min).slice(0, 2500);
  const nm = (id: string | null) => members.find(m => m.id === id)?.name ?? '';
  const line = (e: CalEvent) => [
    `${e.date}${e.end_date !== e.date ? ` bis ${e.end_date}` : ''} ${WDS[fromIso(e.date).getDay()]}`,
    e.all_day ? 'ganztägig' : `${hm(e.start_min)}-${hm(e.end_min)}`,
    e.title, e.persons.map(nm).filter(Boolean).join(', '),
    e.driver ? `Fahrer ${nm(e.driver)}${e.trip === 'beides' && e.driver2 ? `, holt ab ${nm(e.driver2)}` : e.trip === 'ab' ? ' (abholen)' : ''}` : '',
    [e.place, e.addr].filter(Boolean).join(', '), e.notes ? e.notes.replace(/\s+/g, ' ').slice(0, 80) : ''
  ].join(' | ');
  const bdLine = (b: Birthday) => `${b.name}${b.rel ? ` (${b.rel})` : ''}: ${b.day}.${b.month}.${b.year ? b.year : ''}`;
  // Kassenbuch: Belege der letzten zwei Jahre, die ich sehen darf (fehlt das Kassenbuch, einfach ohne)
  const rcs: Receipt[] = supabase ? await cashList('2000-01-01', addDays(t, 1)).then(r => r.slice(0, 600)).catch(() => []) : [];
  const eu = (n: number) => n.toFixed(2).replace('.', ',') + ' €';
  const rcLine = (r: Receipt) => [
    r.bought_at.slice(0, 10), r.merchant, eu(r.total), r.owner === me ? 'von mir' : `von ${nm(r.owner ?? null)}`,
    r.scope === 'family' ? 'Familie' : r.scope === 'business' ? (r.firm ? `Firma ${r.firm}` : 'Firma') : r.owner !== me ? `Familienanteil ${eu(familyPart(r))}` : 'privat',
    r.category, r.kind === 'rechnung' ? `Rechnung ${r.invoice_no}` : '',
    r.einv?.seller?.name && r.einv.seller.name !== r.merchant ? `von ${r.einv.seller.name}` : '',
    r.einv?.buyer?.name ? `an ${[r.einv.buyer.name, r.einv.buyer.street, r.einv.buyer.city].filter(Boolean).join(', ')}` : '', r.payment, r.grp ? `Gruppe ${r.grp}` : '',
    r.items.slice(0, 25).map(i => `${i.name} ${eu(i.price)}`).join('; ').slice(0, 400), r.note.slice(0, 80)
  ].filter(Boolean).join(' | ');
  const pick = (r: { answer: string; events: number[]; birthdays: number[]; receipts?: number[]; action: AskResult['action']; target: number | null; new_text: string | null }): AskResult => ({
    answer: r.answer, action: r.action, newText: r.new_text,
    receipts: [...new Set(r.receipts ?? [])].map(i => rcs[i]).filter(Boolean),
    events: [...new Set(r.events)].map(i => evs[i]).filter(Boolean),
    birthdays: r.birthdays.map(i => birthdays[i]).filter(Boolean),
    target: r.target != null ? evs[r.target] ?? null : null
  });
  if (!supabase) return { receipts: [], ...askLocal(q, evs, birthdays, members), local: true };
  const call = supabase.functions.invoke('ask', {
    body: { q, today: t, now: hm(nowMin()), me, members: members.map(m => ({ id: m.id, name: m.name, role: m.role })), events: evs.map(line), birthdays: birthdays.map(bdLine), receipts: rcs.map(rcLine) }
  });
  const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Claude antwortet gerade nicht. Bitte gleich noch einmal.')), 60000));
  const { data, error } = await Promise.race([call, timeout]);
  if (error || !data?.result) {
    const res = (error as { context?: Response } | null)?.context;
    let why = data?.error ?? (error instanceof Error ? error.message : 'keine Antwort');
    if (res && typeof res.json === 'function') { try { const b = await res.json(); why = b?.error ?? why; } catch { /* egal */ } }
    throw new Error(`Claude ist gerade nicht erreichbar (${why}).`);
  }
  return pick(data.result);
}

// Beispielfamilie ohne Server: einfache Stichwortsuche
function askLocal(q: string, evs: CalEvent[], birthdays: Birthday[], members: Member[]): Omit<AskResult, 'receipts'> {
  const stop = new Set(['ich', 'mich', 'mir', 'mein', 'meine', 'alle', 'allen', 'termine', 'termin', 'wann', 'das', 'die', 'der', 'den', 'dem', 'mit', 'und', 'oder', 'nächste', 'nächsten', 'mal', 'eine', 'einen', 'über', 'übersicht', 'möchte', 'gerne', 'wissen', 'bearbeiten', 'ändern', 'treffe', 'sehe', 'von', 'zum', 'zur', 'bitte', 'zeig', 'zeige', 'claude']);
  const words = q.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(w => w.length > 2 && !stop.has(w)).map(w => w.replace(/s$/, ''));
  const nm = (id: string | null) => members.find(m => m.id === id)?.name ?? '';
  const hay = (e: CalEvent) => [e.title, e.place, e.notes, ...e.persons.map(nm), nm(e.driver)].join(' ').toLowerCase();
  const t = today();
  const hits = words.length ? evs.filter(e => words.some(w => hay(e).includes(w))) : [];
  const future = hits.filter(e => e.end_date >= t);
  const bds = words.length ? birthdays.filter(b => words.some(w => b.name.toLowerCase().includes(w))) : [];
  const edit = /bearbeit|änder|verschieb/i.test(q);
  if (bds.length && !hits.length) return { answer: `${bds[0].name} hat am ${bds[0].day}.${bds[0].month}. Geburtstag.`, events: [], birthdays: bds, action: edit ? 'bdays' : 'none', target: null, newText: null };
  if (!future.length) return { answer: 'Dazu habe ich nichts gefunden. (In der Beispielfamilie suche ich nur nach Stichwörtern; mit eurer Familie antwortet Claude.)', events: [], birthdays: [], action: 'none', target: null, newText: null };
  return { answer: future.length === 1 ? 'Das habe ich gefunden:' : `Ich habe ${future.length} Termine gefunden.`, events: future.slice(0, 30), birthdays: [], action: edit ? 'edit' : 'none', target: edit ? future[0] : null, newText: null };
}
