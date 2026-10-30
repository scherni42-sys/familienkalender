import type { Member } from './types';
import { parseLocal, type Draft } from './parse';
import { supabase } from './supabase';
import { today } from './dates';

// KI-Erkennung über die Edge Function „parse-event“; ohne Verbindung die einfache Erkennung auf dem Handy
export async function parseSpoken(text: string, me: string, members: Member[]): Promise<Draft & { source: 'ai' | 'local' }> {
  const local = parseLocal(text, me, members);
  if (!supabase) return { ...local, source: 'local' };
  try {
    const call = supabase.functions.invoke('parse-event', {
      body: { text, today: today(), me, members: members.map(m => ({ id: m.id, name: m.name, role: m.role })) }
    });
    const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 9000));
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
  } catch {
    return { ...local, source: 'local' };
  }
}
