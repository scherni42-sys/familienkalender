import type { Birthday, BusySlot, CalEvent, Member, Message, Settings, Vis } from './types';
import { addDays, diffDays, fromIso, hm, longDate, MON, today } from './dates';

export const SWATCHES: [string, string][] = [
  ['#d0353a', 'Rot'], ['#c9640f', 'Orange'], ['#a57a00', 'Ocker'], ['#3c8a2e', 'Grün'], ['#0b8584', 'Petrol'],
  ['#2a8fd0', 'Hellblau'], ['#2f5bcc', 'Blau'], ['#8148c9', 'Lila'], ['#c03d8a', 'Pink'], ['#8a5a3c', 'Braun'], ['#4b5e70', 'Schiefer']
];
export const BGS: [string, string][] = [
  ['', 'Standard'], ['#fbf7ee', 'Creme'], ['#f2ece0', 'Sand'], ['#e9f4ec', 'Mint'], ['#e8f0f9', 'Hellblau'],
  ['#f0ebf7', 'Lavendel'], ['#f9edf0', 'Rosé'], ['#eceff2', 'Hellgrau']
];
export const ROLE: Record<string, string> = { admin: 'Admin', member: 'Mitglied', child: 'Kind (ohne Handy)', guest: 'Gast' };
export const NEUTRAL = '#7a8590';

export const initial = (m?: Member) => (m ? m.name.replace(/^(Oma|Opa)\s+/, '').trim()[0]?.toUpperCase() ?? '?' : '?');
export const colorOf = (members: Member[], id?: string | null) => members.find(m => m.id === id)?.color ?? NEUTRAL;
export const nameOf = (members: Member[], id?: string | null) => members.find(m => m.id === id)?.name ?? 'Unbekannt';

type Span = Pick<CalEvent, 'date' | 'end_date' | 'all_day' | 'start_min' | 'end_min'>;
export const onDay = (e: Span, d: string) => e.date <= d && d <= e.end_date;
export const byTime = (a: Span, b: Span) => (a.all_day === b.all_day ? a.start_min - b.start_min : a.all_day ? -1 : 1);
export const dayOfN = (e: Span, d: string) => `Tag ${diffDays(e.date, d) + 1} von ${diffDays(e.date, e.end_date) + 1}`;

export function whenText(e: Span) {
  const n = diffDays(today(), e.date);
  const day = n === 0 ? 'Heute' : n === 1 ? 'Morgen' : n === 2 ? 'Übermorgen' : longDate(e.date);
  if (e.all_day) return e.end_date > e.date ? `${longDate(e.date)} bis ${longDate(e.end_date)}, ganztägig` : `${day}, ganztägig`;
  return `${day}, ${hm(e.start_min)}–${hm(e.end_min)} Uhr`;
}

// Fahrzeit: aus dem Termin; Abfahrt = Beginn − Fahrzeit − Puffer
export const travel = (e: CalEvent, s: Settings) => (s.showTravel && e.driver && !e.all_day && e.travel_min ? e.travel_min : 0);
// Ziel der (ersten) Fahrt: Beginn beim Hinbringen, Ende beim Abholen
export const target = (e: CalEvent) => (e.trip === 'ab' ? e.end_min : e.start_min);
export const depart = (e: CalEvent, s: Settings) => target(e) - travel(e, s) - s.buffer;
// Zweite Fahrt bei „beides“: driver2 holt zum Ende ab
export const leg2 = (e: CalEvent, s: Settings) => (e.trip === 'beides' && e.driver2 && s.showTravel && !e.all_day && e.travel_min
  ? { who: e.driver2, leave: e.end_min - e.travel_min - s.buffer, at: e.end_min } : null);
// Wer gerade fährt (Ankunftszeit gesetzt)
export const etaDriver = (e: CalEvent) => e.eta_by ?? e.driver;
export const isDriver = (e: CalEvent, me: string | null) => !!me && (e.driver === me || e.driver2 === me);
export const tripWord = (e: CalEvent) => (e.trip === 'ab' ? 'holt ab' : 'bringt');

export function visibleOnDay(events: CalEvent[], busy: BusySlot[], d: string, me: string | null, filter: 'all' | 'family' | 'home') {
  void me;
  // home: wie der Home-Modus im Widget, Termine aus beruflichen Handy-Kalendern ausblenden
  const ev = events.filter(e => onDay(e, d)).filter(e =>
    filter === 'all' ? true : filter === 'family' ? e.vis === 'family' : !(e.ext_id ?? '').startsWith('w:'));
  // „X ist belegt“ der anderen wird in den Listen nicht mehr gezeigt; beim Eintragen warnt die Konfliktprüfung weiterhin
  void busy; void d;
  return { ev: ev.sort(byTime), busy: [] as BusySlot[] };
}

export function upcoming(birthdays: Birthday[]) {
  const t = today(), y = fromIso(t).getFullYear();
  return birthdays.map(b => {
    let next = `${y}-${String(b.month).padStart(2, '0')}-${String(b.day).padStart(2, '0')}`;
    if (next < t) next = `${y + 1}-${next.slice(5)}`;
    return { ...b, days: diffDays(t, next), age: b.year ? Number(next.slice(0, 4)) - b.year : null, date: next };
  }).sort((a, b) => a.days - b.days);
}
export const bdOn = (birthdays: Birthday[], d: string) => upcoming(birthdays).filter(b => b.date === d);
export const bdLabel = (b: Birthday) => `${b.day}. ${MON[b.month - 1]}`;

export const ageMin = (m: Message) => (Date.now() - new Date(m.created_at).getTime()) / 60000;
export const leftMin = (m: Message, s: Settings) => s.ttlHours * 60 - ageMin(m);
export const liveMsgs = (msgs: Message[], s: Settings) =>
  msgs.filter(m => !m.done && (m.pinned || leftMin(m, s) > 0)).sort((a, b) => Number(b.pinned) - Number(a.pinned) || ageMin(a) - ageMin(b));
export function whenM(m: Message) {
  const d = new Date(m.created_at), t = today(), dd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const n = diffDays(dd, t), time = hm(d.getHours() * 60 + d.getMinutes());
  return n === 0 ? time : n === 1 ? `gestern ${time}` : `vor ${n} Tagen`;
}
export function leftTxt(m: Message, s: Settings) {
  if (m.pinned) return 'angeheftet';
  const h = Math.ceil(leftMin(m, s) / 60);
  return h > 48 ? `noch ${Math.round(h / 24)} Tage` : `noch ${h} Std.`;
}

export function conflicts(events: CalEvent[], busy: BusySlot[], draft: { date: string; all_day: boolean; start_min: number; end_min: number; persons: string[]; driver: string | null }, members: Member[], skipId?: string) {
  if (draft.all_day) return [];
  const who = new Set([...draft.persons, ...(draft.driver ? [draft.driver] : [])]);
  const out: string[] = [];
  for (const e of events) {
    if (e.id === skipId || e.all_day || !onDay(e, draft.date)) continue;
    if (e.start_min < draft.end_min && draft.start_min < e.end_min) {
      const hit = [...who].filter(id => e.persons.includes(id) || e.driver === id || e.owner === id && e.persons.length === 0);
      if (hit.length) out.push(`${hit.map(id => nameOf(members, id)).join(', ')}: ${e.title} ${hm(e.start_min)}–${hm(e.end_min)}`);
    }
  }
  for (const b of busy) {
    if (b.all_day || !onDay(b, draft.date) || !who.has(b.owner)) continue;
    if (b.start_min < draft.end_min && draft.start_min < b.end_min) out.push(`${nameOf(members, b.owner)} ist belegt ${hm(b.start_min)}–${hm(b.end_min)}`);
  }
  return out;
}

export const visLabel = (v: Vis) => (v === 'family' ? 'Familie: alle und das Display' : v === 'busy' ? 'Privat: nur du (andere sehen bei Überschneidung „belegt“)' : 'Privat: nur du');
export { addDays };

// Fahrer ist unterwegs: Ankunft in Minuten nach Mitternacht (nur heute und solange sinnvoll), sonst null
export const etaMin = (e: { eta?: string | null; start_min: number; date: string }) => {
  if (!e.eta) return null;
  const t = new Date(e.eta), now = Date.now();
  if (isNaN(t.getTime()) || t.getTime() < now - 30 * 60000 || t.getTime() > now + 12 * 3600000) return null;
  return t.getHours() * 60 + t.getMinutes();
};

// Fahrt erledigt: „Angekommen“ getippt, oder die Ankunftszeit liegt über 30 Minuten zurück (Ankommen vergessen)
export const driveDone = (e: { eta?: string | null; arrived_at?: string | null; trip?: string | null }) =>
  (!!e.arrived_at && e.trip !== 'beides') || (!!e.eta && new Date(e.eta).getTime() < Date.now() - 30 * 60000);

// Online-Termine (Teams, Zoom, Meet …): kein Ort zum Hinfahren, also keine Navigation und keine Fahrzeit
const ONLINE = /teams|zoom|webex|google meet|meet\.google|skype|gotomeeting|jitsi|online|videokonferenz|videocall|telefonkonferenz|https?:\/\//i;
export const isOnline = (e: { place?: string; addr?: string }) => !(e.addr ?? '').replace(/^,\s*/, '').trim() && ONLINE.test(e.place ?? '');
// Einwahl-Link aus Ort oder Notiz
export const meetingUrl = (e: { place?: string; notes?: string }) =>
  `${e.place ?? ''} ${e.notes ?? ''}`.match(/https?:\/\/[^\s<>"]*(teams\.microsoft\.com|teams\.live\.com|zoom\.us|meet\.google\.com|webex\.com|jitsi)[^\s<>"]*/i)?.[0] ?? null;
