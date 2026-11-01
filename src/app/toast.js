import { useSyncExternalStore } from 'react';
let msg = null, timer;
const subs = new Set();
const emit = () => subs.forEach(f => f());
export function toast(text) {
    msg = text;
    emit();
    clearTimeout(timer);
    timer = setTimeout(() => { msg = null; emit(); }, 3200);
}
export const useToast = () => useSyncExternalStore(cb => { subs.add(cb); return () => { subs.delete(cb); }; }, () => msg);
// Fehler aus der Datenbank verständlich anzeigen
export const fail = (e) => toast(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
