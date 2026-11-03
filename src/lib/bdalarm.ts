// Geburtstags-Wecker der Android-App: Uhrzeit, „für alle“ oder einzelne Geburtstage (Schlüssel „Name|Tag|Monat“).
// Die Einstellung liegt auf dem Handy, nicht in der Familie: jeder entscheidet für sein eigenes Handy.
import { useSyncExternalStore } from 'react';
import { native } from './native';

export type Alarm = { min: number; all: boolean; keys: string[] };
type B = { name: string; day: number; month: number };

export const alarmKey = (b: B) => `${b.name}|${b.day}|${b.month}`;
export const hasAlarm = () => !!native()?.alarm;

let cur: Alarm | null = null;
const subs = new Set<() => void>();

function read(): Alarm | null {
  if (cur) return cur;
  const n = native();
  if (!n?.alarm) return null;
  try { const a = JSON.parse(n.alarm()); cur = { min: Number(a.min) || 540, all: !!a.all, keys: Array.isArray(a.keys) ? a.keys.map(String) : [] }; }
  catch { cur = { min: 540, all: false, keys: [] }; }
  return cur;
}

export function setAlarm(a: Alarm) {
  cur = a;
  native()?.setAlarm?.(JSON.stringify(a));
  subs.forEach(f => f());
}

export const alarmOn = (a: Alarm, b: B) => a.all || a.keys.includes(alarmKey(b));

// Einen Geburtstag ein- oder ausschalten. Ist „für alle“ an, wird daraus die Liste aller außer diesem.
export function toggleAlarm(b: B, on: boolean, every: B[]) {
  const a = read(); if (!a) return;
  const k = alarmKey(b);
  let keys = a.all ? every.map(alarmKey) : [...a.keys];
  keys = on ? [...new Set([...keys, k])] : keys.filter(x => x !== k);
  const all = every.length > 0 && every.every(x => keys.includes(alarmKey(x)));
  setAlarm({ ...a, all, keys: all ? [] : keys });
}

// Nach dem Bearbeiten (Name oder Datum geändert) bleibt der Wecker dran
export function renameAlarm(from: B, to: B) {
  const a = read(); if (!a || a.all) return;
  const k = alarmKey(from);
  if (a.keys.includes(k)) setAlarm({ ...a, keys: [...new Set(a.keys.map(x => x === k ? alarmKey(to) : x))] });
}

export const getAlarm = read;
export const useAlarm = () => useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f); }, read);
