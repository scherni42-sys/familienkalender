import type { Member, Vis } from './types';
import { addDays, diffDays, fromIso, iso, MON, today, WD } from './dates';

export interface Draft {
  id?: string;
  source?: 'ai' | 'local';
  title: string;
  date: string;
  end_date: string;
  all_day: boolean;
  start_min: number;
  end_min: number;
  persons: string[];
  driver: string | null;
  vis: Exclude<Vis, 'busy'>;
  busy: boolean;
  place: string;
  addr: string;
  travel_min: number | null;
  notes: string;
  bring: string[];
  discreet: boolean;
  reason: string;
  suggested: Exclude<Vis, 'busy'>;
  timeFound: boolean;
}

const TITLES: [RegExp, string][] = [
  [/fußballspiel/, 'Fußballspiel'], [/fußball|training/, 'Fußballtraining'], [/zahnarzt/, 'Zahnarzt'],
  [/kieferorthopäd/, 'Kieferorthopäde'], [/ärztin|arzt/, 'Arzttermin'], [/schwimm/, 'Schwimmkurs'], [/grill/, 'Grillen'],
  [/geburtstag/, 'Geburtstag'], [/elternabend/, 'Elternabend'], [/klavier/, 'Klavierstunde'], [/friseur/, 'Friseur'], [/kino/, 'Kino']
];
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Einfache, regelbasierte Erkennung. Läuft auf dem Handy, wenn die KI nicht erreichbar ist.
export function parseLocal(text: string, me: string, members: Member[]): Draft {
  const base = today();
  let t = text.toLowerCase();
  let date = base, dateFound = false;
  const MONL = MON.map(x => x.toLowerCase());
  let dm = t.match(/\b(\d{1,2})\.\s?(\d{1,2})\.(?:\s?(\d{4}|\d{2})\b)?/);
  let dy = 0, dmo = 0, dyr: string | undefined;
  if (dm) { dy = +dm[1]; dmo = +dm[2]; dyr = dm[3]; }
  else if ((dm = t.match(new RegExp(`\\b(\\d{1,2})\\.?\\s*(${MONL.join('|')})(?:\\s+(\\d{4}))?`)))) { dy = +dm[1]; dmo = MONL.indexOf(dm[2]) + 1; dyr = dm[3]; }
  if (dm && dmo >= 1 && dmo <= 12 && dy >= 1 && dy <= 31) {
    let y = dyr ? +dyr : fromIso(base).getFullYear();
    if (dyr && dyr.length === 2) y += 2000;
    let dt = iso(new Date(y, dmo - 1, dy));
    if (!dyr && dt < base) dt = iso(new Date(y + 1, dmo - 1, dy));
    date = dt; dateFound = true; t = t.replace(dm[0], ' ');
  }
  let end = date;
  const bm = dateFound ? t.match(/bis\s*(?:zum\s*)?(\d{1,2})\.\s?(\d{1,2})\.?(?:\s?(\d{4}|\d{2})\b)?/) : null;
  if (bm) {
    const y = bm[3] ? +bm[3] + (bm[3].length === 2 ? 2000 : 0) : fromIso(date).getFullYear();
    let e2 = iso(new Date(y, +bm[2] - 1, +bm[1]));
    if (!bm[3] && e2 < date) e2 = iso(new Date(y + 1, +bm[2] - 1, +bm[1]));
    end = e2; t = t.replace(bm[0], ' ');
  }
  if (!dateFound) {
    if (/übermorgen/.test(t)) date = addDays(base, 2);
    else if (/morgen/.test(t)) date = addDays(base, 1);
    else {
      const i = WD.findIndex(w => t.includes(w.toLowerCase()));
      if (i >= 0) { let n = (i - fromIso(base).getDay() + 7) % 7; if (n === 0) n = 7; date = addDays(base, n); }
    }
    end = date;
  }
  let s = 18 * 60, timeFound = false;
  let m = t.match(/(\d{1,2}):(\d{2})/) || t.match(/(\d{1,2})\.(\d{2})\s*uhr/);
  if (m) { s = +m[1] * 60 + +m[2]; timeFound = true; }
  else if ((m = t.match(/(\d{1,2})\s*uhr/))) { s = +m[1] * 60; timeFound = true; }

  const NAMES: Record<string, string> = {};
  for (const mb of members) {
    NAMES[mb.name.toLowerCase()] = mb.id;
    const first = mb.name.toLowerCase().replace(/^(oma|opa)\s+/, '');
    NAMES[first] = mb.id;
    if (/^oma /i.test(mb.name)) NAMES.oma = mb.id;
    if (/^opa /i.test(mb.name)) NAMES.opa = mb.id;
  }
  const persons = new Set<string>();
  for (const [k, id] of Object.entries(NAMES)) if (new RegExp(`\\b${esc(k)}\\b`).test(t)) persons.add(id);
  if (/mit allen|ganze familie|alle zusammen/.test(t)) members.filter(x => x.role !== 'guest').forEach(x => persons.add(x.id));
  if (/\b(ich|mich|meiner|meinem|mein)\b/.test(t) && !/ich (bringe|fahre|hole)/.test(t)) persons.add(me);
  let driver: string | null = null;
  m = t.match(/([\wäöüß]+)\s+(fährt|bringt|holt)/);
  if (m && NAMES[m[1]]) driver = NAMES[m[1]];
  if (/ich (bringe|fahre|hole)/.test(t)) driver = me;
  if (driver && persons.has(driver) && persons.size > 1 && !/mit allen/.test(t)) persons.delete(driver);
  if (!persons.size) persons.add(me);

  let title = TITLES.find(([re]) => re.test(t))?.[1] ?? '';
  if (!title) {
    title = (dm ? text.replace(new RegExp(esc(dm[0]), 'i'), ' ') : text)
      .replace(/\b\d{1,2}\.\s?\d{1,2}\.(\d{2,4})?/g, ' ')
      .replace(/,?\s*\b(mit|und)\s+[^,]*/gi, ' ').replace(/,?\s*\b\S+\s+(fährt|bringt|holt)\b.*$/i, ' ').replace(/\bich (bringe|fahre|hole)\b.*$/i, ' ')
      .replace(new RegExp(`\\b(${[...WD, ...Object.keys(NAMES).map(esc)].join('|')})\\b`, 'gi'), ' ')
      .replace(/\bbis\s*(zum\s*)?\d{1,2}\.\s?\d{1,2}\.?(\d{2,4})?/gi, ' ')
      .replace(/\b(heute|übermorgen|morgen|am|um|ab|vom|von|bis|ich|habe|hat|haben|termin|ganztägig|den ganzen tag)\b/gi, ' ')
      .replace(/\d{1,2}([:.]\d{2})?\s*(uhr)?/gi, ' ').replace(/,/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
    title = title ? title[0].toUpperCase() + title.slice(1) : 'Termin';
  }
  const pm = text.match(/\bbei ([A-ZÄÖÜ][\wäöüß]+)/);
  const place = pm && !/Ärztin|Arzt/.test(pm[1]) ? `bei ${pm[1]}` : '';
  const others = [...persons].filter(id => id !== me);
  const discreet = /arzt|ärztin|therap/.test(t);
  let vis: 'family' | 'private', reason: string;
  const nm = (id: string) => members.find(x => x.id === id)?.name ?? '';
  if (/privat/.test(t)) { vis = 'private'; reason = 'du hast „privat“ gesagt'; }
  else if (others.length || (driver && driver !== me)) {
    vis = 'family';
    const names = others.map(nm);
    reason = names.length ? `${names.join(' und ')} ${names.length > 1 ? 'sind' : 'ist'} betroffen` : `${nm(driver!)} fährt`;
  } else if (discreet) { vis = 'private'; reason = 'Arzttermin, der nur dich betrifft'; }
  else { vis = 'private'; reason = 'der Termin betrifft nur dich'; }
  const allDay = /ganztägig|ganzen tag/.test(t) || !timeFound;
  if (diffDays(date, end) < 0) end = date;
  return {
    title, date, end_date: allDay ? end : date, all_day: allDay, start_min: allDay ? 0 : s, end_min: allDay ? 1440 : Math.min(s + 60, 1439),
    persons: [...persons], driver, vis, busy: vis === 'private', place, addr: '', travel_min: null, notes: '', bring: [], discreet,
    reason, suggested: vis, timeFound
  };
}
