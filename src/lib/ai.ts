import type { Member } from './types';
import { parseLocal, type Draft } from './parse';
import { supabase } from './supabase';
import { today } from './dates';

// KI-Erkennung über die Edge Function „parse-event“; ohne Verbindung die einfache Erkennung auf dem Handy
export async function parseSpoken(text: string, me: string, members: Member[]): Promise<Draft & { source: 'ai' | 'local'; why?: string }> {
  const local = parseLocal(text, me, members);
  if (!supabase) return { ...local, source: 'local' };
  try {
    const call = supabase.functions.invoke('parse-event', {
      body: { text, today: today(), me, members: members.map(m => ({ id: m.id, name: m.name, role: m.role })) }
    });
    const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('keine Antwort nach 25 s')), 25000));
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
      source: 'ai'
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
