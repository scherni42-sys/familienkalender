import { addDays, diffDays, fromIso, hm, longDate, MON, today } from './dates';
export const SWATCHES = [
    ['#d0353a', 'Rot'], ['#c9640f', 'Orange'], ['#a57a00', 'Ocker'], ['#3c8a2e', 'Grün'], ['#0b8584', 'Petrol'],
    ['#2a8fd0', 'Hellblau'], ['#2f5bcc', 'Blau'], ['#8148c9', 'Lila'], ['#c03d8a', 'Pink'], ['#8a5a3c', 'Braun'], ['#4b5e70', 'Schiefer']
];
export const BGS = [
    ['', 'Standard'], ['#fbf7ee', 'Creme'], ['#f2ece0', 'Sand'], ['#e9f4ec', 'Mint'], ['#e8f0f9', 'Hellblau'],
    ['#f0ebf7', 'Lavendel'], ['#f9edf0', 'Rosé'], ['#eceff2', 'Hellgrau']
];
export const ROLE = { admin: 'Admin', member: 'Mitglied', child: 'Kind (ohne Handy)', guest: 'Gast' };
export const NEUTRAL = '#7a8590';
export const initial = (m) => (m ? m.name.replace(/^(Oma|Opa)\s+/, '').trim()[0]?.toUpperCase() ?? '?' : '?');
export const colorOf = (members, id) => members.find(m => m.id === id)?.color ?? NEUTRAL;
export const nameOf = (members, id) => members.find(m => m.id === id)?.name ?? 'Unbekannt';
export const onDay = (e, d) => e.date <= d && d <= e.end_date;
export const byTime = (a, b) => (a.all_day === b.all_day ? a.start_min - b.start_min : a.all_day ? -1 : 1);
export const dayOfN = (e, d) => `Tag ${diffDays(e.date, d) + 1} von ${diffDays(e.date, e.end_date) + 1}`;
export function whenText(e) {
    const n = diffDays(today(), e.date);
    const day = n === 0 ? 'Heute' : n === 1 ? 'Morgen' : n === 2 ? 'Übermorgen' : longDate(e.date);
    if (e.all_day)
        return e.end_date > e.date ? `${longDate(e.date)} bis ${longDate(e.end_date)}, ganztägig` : `${day}, ganztägig`;
    return `${day}, ${hm(e.start_min)}–${hm(e.end_min)} Uhr`;
}
// Fahrzeit: aus dem Termin; Abfahrt = Beginn − Fahrzeit − Puffer
export const travel = (e, s) => (s.showTravel && e.driver && !e.all_day && e.travel_min ? e.travel_min : 0);
export const depart = (e, s) => e.start_min - travel(e, s) - s.buffer;
export function visibleOnDay(events, busy, d, me, filter) {
    void me;
    // home: wie der Home-Modus im Widget, Termine aus beruflichen Handy-Kalendern ausblenden
    const ev = events.filter(e => onDay(e, d)).filter(e => filter === 'all' ? true : filter === 'family' ? e.vis === 'family' : !(e.ext_id ?? '').startsWith('w:'));
    // „X ist belegt“ der anderen wird in den Listen nicht mehr gezeigt; beim Eintragen warnt die Konfliktprüfung weiterhin
    void busy;
    void d;
    return { ev: ev.sort(byTime), busy: [] };
}
export function upcoming(birthdays) {
    const t = today(), y = fromIso(t).getFullYear();
    return birthdays.map(b => {
        let next = `${y}-${String(b.month).padStart(2, '0')}-${String(b.day).padStart(2, '0')}`;
        if (next < t)
            next = `${y + 1}-${next.slice(5)}`;
        return { ...b, days: diffDays(t, next), age: b.year ? Number(next.slice(0, 4)) - b.year : null, date: next };
    }).sort((a, b) => a.days - b.days);
}
export const bdOn = (birthdays, d) => upcoming(birthdays).filter(b => b.date === d);
export const bdLabel = (b) => `${b.day}. ${MON[b.month - 1]}`;
export const ageMin = (m) => (Date.now() - new Date(m.created_at).getTime()) / 60000;
export const leftMin = (m, s) => s.ttlHours * 60 - ageMin(m);
export const liveMsgs = (msgs, s) => msgs.filter(m => !m.done && (m.pinned || leftMin(m, s) > 0)).sort((a, b) => Number(b.pinned) - Number(a.pinned) || ageMin(a) - ageMin(b));
export function whenM(m) {
    const d = new Date(m.created_at), t = today(), dd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const n = diffDays(dd, t), time = hm(d.getHours() * 60 + d.getMinutes());
    return n === 0 ? time : n === 1 ? `gestern ${time}` : `vor ${n} Tagen`;
}
export function leftTxt(m, s) {
    if (m.pinned)
        return 'angeheftet';
    const h = Math.ceil(leftMin(m, s) / 60);
    return h > 48 ? `noch ${Math.round(h / 24)} Tage` : `noch ${h} Std.`;
}
export function conflicts(events, busy, draft, members, skipId) {
    if (draft.all_day)
        return [];
    const who = new Set([...draft.persons, ...(draft.driver ? [draft.driver] : [])]);
    const out = [];
    for (const e of events) {
        if (e.id === skipId || e.all_day || !onDay(e, draft.date))
            continue;
        if (e.start_min < draft.end_min && draft.start_min < e.end_min) {
            const hit = [...who].filter(id => e.persons.includes(id) || e.driver === id || e.owner === id && e.persons.length === 0);
            if (hit.length)
                out.push(`${hit.map(id => nameOf(members, id)).join(', ')}: ${e.title} ${hm(e.start_min)}–${hm(e.end_min)}`);
        }
    }
    for (const b of busy) {
        if (b.all_day || !onDay(b, draft.date) || !who.has(b.owner))
            continue;
        if (b.start_min < draft.end_min && draft.start_min < b.end_min)
            out.push(`${nameOf(members, b.owner)} ist belegt ${hm(b.start_min)}–${hm(b.end_min)}`);
    }
    return out;
}
export const visLabel = (v) => (v === 'family' ? 'Familie: alle und das Display' : v === 'busy' ? 'Privat: nur du (andere sehen bei Überschneidung „belegt“)' : 'Privat: nur du');
export { addDays };
