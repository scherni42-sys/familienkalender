export const WD = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
export const WDS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
export const MON = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

const pad = (n: number) => String(n).padStart(2, '0');
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromIso = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const today = () => iso(new Date());
export const addDays = (s: string, n: number) => { const d = fromIso(s); d.setDate(d.getDate() + n); return iso(d); };
export const diffDays = (a: string, b: string) => Math.round((fromIso(b).getTime() - fromIso(a).getTime()) / 86400000);
export const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
export const hm = (m: number) => `${pad(Math.floor(((m % 1440) + 1440) % 1440 / 60))}:${pad(((m % 60) + 60) % 60)}`;
export const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + (m || 0); };

export function dayLabel(s: string) {
  const n = diffDays(today(), s), d = fromIso(s);
  const base = `${WD[d.getDay()]}, ${d.getDate()}. ${MON[d.getMonth()]}`;
  return n === 0 ? `Heute · ${base}` : n === 1 ? `Morgen · ${base}` : n === 2 ? `Übermorgen · ${base}` : base;
}
export const longDate = (s: string) => { const d = fromIso(s); return `${WD[d.getDay()]}, ${d.getDate()}. ${MON[d.getMonth()]}`; };
export const shortDate = (s: string) => { const d = fromIso(s); return `${WDS[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.`; };

// ISO-Kalenderwoche
export function isoWeek(s: string) {
  const d = fromIso(s); d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const w1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d.getTime() - w1.getTime()) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7);
}
export const mondayOf = (s: string) => addDays(s, -((fromIso(s).getDay() + 6) % 7));

export const inDays = (n: number) => n === 0 ? 'heute' : n === 1 ? 'morgen' : `in ${n} Tagen`;
