import type { CalEvent } from './types';
import { native } from './native';

// Termin aus FamTO an Outlook geben: in der Android-App öffnet sich Outlook mit dem fertigen Termin,
// im Browser (z. B. am PC) gibt es eine .ics-Datei, die Outlook mit Doppelklick übernimmt.
// Das Kennzeichen in der Notiz sorgt dafür, dass der Termin beim Abgleich nicht doppelt zurück nach FamTO kommt.
export const MARK = 'Aus FamTO übertragen';

const pad = (n: number) => String(n).padStart(2, '0');
const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
const at = (d: string, min: number) => new Date(`${d}T${pad(Math.floor(min / 60))}:${pad(min % 60)}:00`).getTime();

export function outlookData(e: CalEvent) {
  const where = [e.place, e.addr.replace(/^,\s*/, '')].map(x => x.trim()).filter(Boolean);
  const loc = where.length === 2 && where[1].includes(where[0]) ? where[1] : where.join(', ');
  const notes = [e.notes.trim(), e.bring.length ? `Mitbringen: ${e.bring.join(', ')}` : '', MARK].filter(Boolean).join('\n\n');
  const last = e.end_date < e.date ? e.date : e.end_date;
  // Ganztägig: Ende ist der Tag nach dem letzten Tag (so erwarten es Kalender)
  const begin = e.all_day ? Date.UTC(+e.date.slice(0, 4), +e.date.slice(5, 7) - 1, +e.date.slice(8, 10)) : at(e.date, e.start_min);
  const end = e.all_day ? begin + (Math.round((new Date(`${last}T12:00:00Z`).getTime() - new Date(`${e.date}T12:00:00Z`).getTime()) / 864e5) + 1) * 864e5
    : e.end_min >= 1440 ? at(addDays(last, 1), 0) : Math.max(at(last, e.end_min), at(e.date, e.start_min));
  return { id: e.id, title: e.title, begin, end, all_day: e.all_day, place: loc, notes, last };
}

const esc = (t: string) => t.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
// Lange Zeilen nach 73 Zeichen umbrechen (iCalendar-Regel)
const fold = (l: string) => { const out: string[] = []; let s = l; while (s.length > 73) { out.push(s.slice(0, 73)); s = ' ' + s.slice(73); } out.push(s); return out.join('\r\n'); };
const utc = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
const day = (d: string) => d.replace(/-/g, '');

export function toIcs(e: CalEvent): string {
  const o = outlookData(e);
  const when = e.all_day ? [`DTSTART;VALUE=DATE:${day(e.date)}`, `DTEND;VALUE=DATE:${day(addDays(o.last, 1))}`]
    : [`DTSTART:${utc(o.begin)}`, `DTEND:${utc(o.end)}`];
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FamTO//Familienkalender//DE', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:famto-${e.id}@famto`, `DTSTAMP:${utc(Date.now())}`, ...when, `SUMMARY:${esc(e.title)}`,
    ...(o.place ? [`LOCATION:${esc(o.place)}`] : []), `DESCRIPTION:${esc(o.notes)}`,
    'END:VEVENT', 'END:VCALENDAR'].map(fold).join('\r\n') + '\r\n';
}

const fileName = (e: CalEvent) => `${(e.title || 'Termin').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 40) || 'Termin'}.ics`;

// Liefert einen Hinweis für den Nutzer (oder null)
export function sendToOutlook(e: CalEvent): string | null {
  const n = native();
  if (n?.toOutlook) { return n.toOutlook(JSON.stringify({ ...outlookData(e), ics: toIcs(e) })) ? null : 'Outlook ließ sich nicht öffnen.'; }
  const ics = toIcs(e);
  // Ältere App ohne Outlook-Knopf: Datei über das Teilen-Menü weitergeben
  if (n?.shareFile) { n.shareFile(fileName(e), 'text/calendar', btoa(unescape(encodeURIComponent(ics)))); return 'Wähle Outlook, um den Termin zu übernehmen.'; }
  if (n) return 'Dafür bitte die App aktualisieren (Einstellungen → App-Update).';
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = fileName(e); document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'Termin heruntergeladen. Öffne die Datei, dann übernimmt Outlook ihn.';
}
