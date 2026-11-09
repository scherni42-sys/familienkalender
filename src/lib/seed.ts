import type { Snapshot } from './types';
import { DEFAULT_SETTINGS } from './types';
import { addDays, today } from './dates';

// Beispielfamilie für den Demo-Modus
export function seed(): Snapshot {
  const t = today(), d = (n: number) => addDays(t, n);
  const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();
  const ev = (id: string, o: Partial<Snapshot['events'][number]>) => ({
    id, owner: 'jan', title: '', date: t, end_date: o.date ?? t, all_day: false, start_min: 0, end_min: 0, persons: [], driver: null,
    vis: 'family' as const, trip: 'hin' as const, driver2: null, place: '', addr: '', travel_min: null, notes: '', bring: [], discreet: false, ...o
  });
  return {
    family: { id: 'demo', name: 'Familie Beispiel', settings: { ...DEFAULT_SETTINGS, home: 'Beispielweg 7, 24105 Kiel' }, plan: 'pro', tester: true },
    me: 'jan',
    members: [
      { id: 'jan', name: 'Jan', role: 'admin', color: '#2f5bcc', adult: true, linked: true, app_bg: null },
      { id: 'anna', name: 'Anna', role: 'member', color: '#0b8584', adult: true, linked: true, app_bg: null },
      { id: 'mia', name: 'Mia', role: 'member', color: '#c9640f', adult: false, linked: true, app_bg: null },
      { id: 'ben', name: 'Ben', role: 'child', color: '#8148c9', adult: false, linked: false, app_bg: null },
      { id: 'helga', name: 'Oma Helga', role: 'guest', color: '#c03d8a', adult: true, linked: true, app_bg: null }
    ],
    events: [
      ev('e1', { title: 'Zahnarzt', start_min: 930, end_min: 990, persons: ['ben'], driver: 'anna', owner: 'anna', place: 'Praxis Holtenauer Straße', addr: 'Holtenauer Str. 120, 24105 Kiel', travel_min: 12, discreet: true, bring: ['Versichertenkarte'] }),
      ev('e2', { title: 'Fußballtraining', start_min: 1020, end_min: 1110, persons: ['mia'], driver: 'jan', place: 'Sportplatz Nord', addr: 'Projensdorfer Str. 300, 24106 Kiel', travel_min: 15, notes: 'Abholen um 18:30 am Vereinsheim.', bring: ['Schienbeinschoner', 'Trinkflasche'] }),
      ev('e3', { title: 'Elternabend Klasse 4b', start_min: 1170, end_min: 1260, persons: ['jan'], place: 'Grundschule, Raum 12' }),
      ev('e4', { title: 'Gelbe Tonne rausstellen', all_day: true, start_min: 0, end_min: 1440, persons: [] }),
      ev('e5', { date: d(1), end_date: d(1), title: 'Kita-Ausflug, Brotdose mitgeben', start_min: 450, end_min: 780, persons: ['ben'], owner: 'anna', bring: ['Brotdose', 'Regenjacke'] }),
      ev('e6', { date: d(1), end_date: d(1), title: 'Geburtstag Oma Helga', start_min: 960, end_min: 1140, persons: ['anna', 'jan', 'mia', 'ben'], owner: 'anna', place: 'bei Oma' }),
      ev('e7', { date: d(1), end_date: d(3), title: 'Opa Klaus zu Besuch', all_day: true, start_min: 0, end_min: 1440, persons: ['anna', 'jan', 'mia', 'ben'] }),
      ev('e8', { date: d(2), end_date: d(2), title: 'Schwimmkurs', start_min: 900, end_min: 960, persons: ['ben'], driver: 'anna', owner: 'anna', place: 'Hallenbad', travel_min: 18, bring: ['Badesachen'] }),
      ev('e9', { date: d(3), end_date: d(3), title: 'Fußballspiel', start_min: 600, end_min: 720, persons: ['mia'], driver: 'jan', place: 'Kronshagen', travel_min: 22 }),
      ev('e10', { title: 'Teammeeting', start_min: 510, end_min: 555, persons: ['jan'], vis: 'private' })
    ],
    busy: [{ id: 'b1', owner: 'anna', date: t, end_date: t, all_day: false, start_min: 1080, end_min: 1200 }],
    messages: [
      { id: 'm1', from_member: 'jan', text: 'Wasserhahn im Bad tropft, bitte nicht voll aufdrehen', created_at: ago(2900), pinned: true, done: false, taker: null, via: null, replies: [] },
      { id: 'm2', from_member: 'anna', text: 'Wer kann Ben morgen von der Kita holen?', created_at: ago(15), pinned: false, done: false, taker: null, via: null, replies: [] },
      { id: 'm3', from_member: 'mia', text: 'Darf ich nach dem Training bei Lea essen?', created_at: ago(220), pinned: false, done: false, taker: null, via: null, replies: [{ id: 'r1', from_member: 'anna', text: 'Ja, aber bis 19 Uhr zurück', created_at: ago(200) }] }
    ],
    chats: [
      { id: 'c1', from_member: 'anna', to_member: 'jan', kind: 'text', text: 'Kannst du auf dem Rückweg Milch mitbringen?', media: null, dur: null, lat: null, lon: null, created_at: ago(95), read_at: ago(90) },
      { id: 'c2', from_member: 'jan', to_member: 'anna', kind: 'text', text: 'Mach ich 👍', media: null, dur: null, lat: null, lon: null, created_at: ago(88), read_at: ago(80) },
      { id: 'c3', from_member: 'mia', to_member: 'jan', kind: 'text', text: 'Papa, holst du mich um 18 Uhr ab?', media: null, dur: null, lat: null, lon: null, created_at: ago(12), read_at: null }
    ],
    birthdays: [
      { id: 'g1', name: 'Oma Helga', rel: 'Oma', day: Number(d(1).slice(8)), month: Number(d(1).slice(5, 7)), year: Number(d(1).slice(0, 4)) - 75 },
      { id: 'g2', name: 'Ben', rel: 'Sohn', day: Number(d(9).slice(8)), month: Number(d(9).slice(5, 7)), year: Number(d(9).slice(0, 4)) - 7 },
      { id: 'g3', name: 'Onkel Tom', rel: 'Onkel', day: Number(d(20).slice(8)), month: Number(d(20).slice(5, 7)), year: null }
    ],
    displays: [{ id: 'd1', name: 'Flur', token: 'demo' }]
  };
}
