// Geburtstags-Wecker der Android-App: Uhrzeit, „für alle“ oder einzelne Geburtstage (Schlüssel „Name|Tag|Monat“).
// Die Einstellung liegt auf dem Handy, nicht in der Familie: jeder entscheidet für sein eigenes Handy.
import { useSyncExternalStore } from 'react';
import { native } from './native';
export const alarmKey = (b) => `${b.name}|${b.day}|${b.month}`;
export const hasAlarm = () => !!native()?.alarm;
let cur = null;
const subs = new Set();
function read() {
    if (cur)
        return cur;
    const n = native();
    if (!n?.alarm)
        return null;
    try {
        const a = JSON.parse(n.alarm());
        cur = { min: Number(a.min) || 540, all: !!a.all, keys: Array.isArray(a.keys) ? a.keys.map(String) : [] };
    }
    catch {
        cur = { min: 540, all: false, keys: [] };
    }
    return cur;
}
export function setAlarm(a) {
    cur = a;
    native()?.setAlarm?.(JSON.stringify(a));
    subs.forEach(f => f());
}
export const alarmOn = (a, b) => a.all || a.keys.includes(alarmKey(b));
// Einen Geburtstag ein- oder ausschalten. Ist „für alle“ an, wird daraus die Liste aller außer diesem.
export function toggleAlarm(b, on, every) {
    const a = read();
    if (!a)
        return;
    const k = alarmKey(b);
    let keys = a.all ? every.map(alarmKey) : [...a.keys];
    keys = on ? [...new Set([...keys, k])] : keys.filter(x => x !== k);
    const all = every.length > 0 && every.every(x => keys.includes(alarmKey(x)));
    setAlarm({ ...a, all, keys: all ? [] : keys });
}
// Nach dem Bearbeiten (Name oder Datum geändert) bleibt der Wecker dran
export function renameAlarm(from, to) {
    const a = read();
    if (!a || a.all)
        return;
    const k = alarmKey(from);
    if (a.keys.includes(k))
        setAlarm({ ...a, keys: [...new Set(a.keys.map(x => x === k ? alarmKey(to) : x))] });
}
export const getAlarm = read;
export const useAlarm = () => useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f); }, read);
let tones = null;
const toneSubs = new Set();
const readTones = () => {
    if (tones)
        return tones;
    const n = native();
    if (!n?.tones)
        return null;
    try {
        tones = JSON.parse(n.tones());
    }
    catch {
        tones = null;
    }
    return tones;
};
if (typeof window !== 'undefined')
    window.addEventListener('famto-tone', () => { tones = null; toneSubs.forEach(f => f()); });
export const useTones = () => useSyncExternalStore(f => { toneSubs.add(f); return () => toneSubs.delete(f); }, readTones);
export const setTone = (kind, which) => native()?.setTone?.(kind, which);
// Termin-Wecker auf diesem Handy
export const hasEvAlarm = () => !!native()?.setEvAlarm;
export const evAlarm = (id) => (id && native()?.evAlarm?.(id)) || 0;
export const setEvAlarm = (a) => native()?.setEvAlarm?.(JSON.stringify(a));
export const LEADS = [[15, '15 Min. vorher'], [30, '30 Min. vorher'], [60, '1 Std. vorher'], [120, '2 Std. vorher']];
