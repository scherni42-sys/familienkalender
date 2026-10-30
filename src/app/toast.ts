import { useSyncExternalStore } from 'react';

let msg: string | null = null, timer: ReturnType<typeof setTimeout> | undefined;
const subs = new Set<() => void>();
const emit = () => subs.forEach(f => f());

export function toast(text: string) {
  msg = text; emit();
  clearTimeout(timer); timer = setTimeout(() => { msg = null; emit(); }, 3200);
}
export const useToast = () => useSyncExternalStore(cb => { subs.add(cb); return () => { subs.delete(cb); }; }, () => msg);

// Fehler aus der Datenbank verständlich anzeigen
export const fail = (e: unknown) => toast(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
