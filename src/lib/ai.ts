import type { Member } from './types';
import { parseLocal, type Draft } from './parse';
import { supabase } from './supabase';
import { today } from './dates';

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
export async function parseSpoken(text: string, me: string, members: Pick<Member, 'id' | 'name' | 'role'>[], image?: { type: string; data: string }, display?: string): Promise<Draft & { source: 'ai' | 'local'; why?: string; found?: boolean }> {
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
    return {
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
      timeFound: !allDay,
      source: 'ai',
      found: e.found !== false
    };
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
