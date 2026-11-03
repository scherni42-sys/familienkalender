// Flugstatus für Termine mit Flugnummer (z. B. „Flug nach Stuttgart (EW7040)“): Gate, Verspätung, Terminal, Gepäckband.
// Daten über die Edge Function „flight“; kurz zwischengespeichert, damit die Gratis-Abfragen reichen.
import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { today, addDays } from './dates';
// Flugnummer nur, wenn der Termin nach Flug aussieht (sonst wäre jedes „A4“ ein Flug)
export function flightNo(e) {
    const text = `${e.title} ${e.place ?? ''} ${e.notes ?? ''}`;
    if (!/flug|flight|✈|abflug|airline|boarding/i.test(text))
        return null;
    const m = text.match(/\b(?:Flugnummer|Flug-Nr\.?|Flight)\s*:?\s*([A-Z0-9]{2})\s?(\d{1,4}[A-Z]?)\b/i) ?? text.match(/\b(?!KW)([A-Z]{2}|[A-Z]\d|\d[A-Z])\s?(\d{2,4})\b/);
    return m ? (m[1] + m[2]).toUpperCase() : null;
}
const KEY = (n, d) => `flight:${n}:${d}`;
const read = (n, d) => { try {
    return JSON.parse(localStorage.getItem(KEY(n, d)) || 'null');
}
catch {
    return null;
} };
export async function loadFlight(n, d, force = false) {
    const c = read(n, d);
    const fresh = d === today() ? 10 * 60_000 : 60 * 60_000;
    if (c && !force && Date.now() - c.t < fresh)
        return c.f;
    if (!supabase)
        return null;
    const { data, error } = await supabase.functions.invoke('flight', { body: { number: n, date: d } });
    if (error || !data || data.error)
        return c?.f ?? null;
    try {
        localStorage.setItem(KEY(n, d), JSON.stringify({ f: data, t: Date.now() }));
    }
    catch { /* egal */ }
    return data;
}
// Nur rund um den Flugtag nachsehen (gestern bis übermorgen)
export function useFlight(e) {
    const n = e ? flightNo(e) : null;
    const d = e?.date ?? '';
    const near = !!d && d >= addDays(today(), -1) && d <= addDays(today(), 2);
    const [f, setF] = useState(() => (n && near ? read(n, d)?.f ?? null : null));
    const [tick, setTick] = useState(0);
    useEffect(() => {
        if (!n || !near)
            return;
        let live = true;
        void loadFlight(n, d, tick > 0).then(x => { if (live && x)
            setF(x); });
        const t = setInterval(() => void loadFlight(n, d).then(x => { if (live && x)
            setF(x); }), 5 * 60_000);
        return () => { live = false; clearInterval(t); };
    }, [n, d, near, tick]);
    return { number: n, flight: f?.found ? f : null, refresh: () => setTick(x => x + 1) };
}
// Kurzfassung, z. B. „Gate B12 · +25 Min. · ab 07:05“
export function flightShort(f) {
    const p = [];
    if (f.canceled)
        return 'annulliert';
    if (f.dep?.gate)
        p.push(`Gate ${f.dep.gate}`);
    else if (f.dep?.terminal)
        p.push(`Terminal ${f.dep.terminal}`);
    if (f.dep?.delay && f.dep.delay >= 5)
        p.push(`+${f.dep.delay} Min.`);
    if (f.dep?.revised && f.dep.revised !== f.dep.sched)
        p.push(`ab ${f.dep.revised}`);
    if (!p.length && f.status)
        p.push(f.status);
    return p.join(' · ');
}
