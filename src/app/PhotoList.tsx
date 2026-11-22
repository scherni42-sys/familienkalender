import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { store, useSnapshot } from '../lib/store';
import type { Draft } from '../lib/parse';
import type { CalEvent } from '../lib/types';
import { hm, shortDate } from '../lib/dates';
import { toNewEvent } from './EventSheet';
import { Sheet } from './ui';
import { fail, toast } from './toast';
import './PhotoList.css';

// Titel vergleichbar machen: klein, ohne Satzzeichen und Klammerzusätze („Bioabfall (14-täglich)“ = „bioabfall“)
const norm = (s: string) => s.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// Steht der Termin schon im Kalender? Gleicher Tag und ähnlicher Titel (bei Uhrzeit auch gleicher Beginn)
export function findTwin(d: Draft, events: CalEvent[]): CalEvent | undefined {
  const t = norm(d.title);
  if (!t) return undefined;
  return events.find(e => {
    if (e.date > d.date || e.end_date < d.date) return false;
    if (!d.all_day && !e.all_day && e.start_min !== d.start_min) return false;
    const o = norm(e.title);
    return !!o && (o === t || o.includes(t) || t.includes(o));
  });
}

// Mehrere Termine von einem Foto/Screenshot: Liste zum Abhaken, dann alle auf einmal anlegen
// Öffnet die Liste über der App (an derselben Stelle wie das gerade offene Fenster), unabhängig vom übrigen Aufbau
export function openPhotoList(drafts: Draft[]) {
  const host = document.querySelector('.sheet')?.parentElement ?? document.getElementById('root') ?? document.body;
  const el = document.createElement('div');
  el.style.display = 'contents';
  host.appendChild(el);
  const root = createRoot(el);
  const close = () => { root.unmount(); el.remove(); };
  root.render(<StrictMode><PhotoList drafts={drafts} close={close} /></StrictMode>);
}

function PhotoList({ drafts, close }: { drafts: Draft[]; close: () => void }) {
  const snap = useSnapshot();
  const [rows, setRows] = useState(() => drafts.map(d => { const twin = findTwin(d, snap.events); return { d, on: !twin, twin }; }));
  const [busy, setBusy] = useState(false);
  const picked = rows.filter(r => r.on && r.d.title.trim());
  const twins = rows.filter(r => r.twin).length;
  const set = (i: number, p: Partial<(typeof rows)[number]>) => setRows(rs => rs.map((r, k) => k === i ? { ...r, ...p } : r));

  const saveAll = async () => {
    if (!picked.length) return;
    setBusy(true);
    let n = 0;
    try {
      for (const r of picked) { await store.saveEvent(toNewEvent(r.d)); n++; }
      toast(`${n} ${n === 1 ? 'Termin' : 'Termine'} eingetragen${picked[0].d.vis === 'family' ? ', auch auf dem Display' : ''}.`);
      close();
    } catch (e) {
      // Was schon gespeichert ist, bleibt; die übrigen bleiben in der Liste
      if (n) { setRows(rs => rs.filter(r => !picked.slice(0, n).includes(r))); toast(`${n} eingetragen, der Rest hat nicht geklappt.`); }
      fail(e);
    } finally { setBusy(false); }
  };

  return (
    <Sheet onClose={close} label="Termine vom Bild">
      <h2>{rows.length === 1 ? '1 Termin gefunden' : `${rows.length} Termine gefunden`}</h2>
      <p className="note">Hake ab, was in den Kalender soll. Den Titel kannst du direkt ändern.
        {twins ? ` ${twins === 1 ? 'Einer steht' : `${twins} stehen`} schon im Kalender und ${twins === 1 ? 'ist' : 'sind'} deshalb abgewählt.` : ''}</p>
      <ul className="plist">
        {rows.map((r, i) => (
          <li key={i} className={r.on ? 'on' : ''}>
            <input type="checkbox" checked={r.on} aria-label={`${r.d.title} übernehmen`} onChange={e => set(i, { on: e.target.checked })} />
            <div>
              <span className="when">{shortDate(r.d.date)}{r.d.end_date > r.d.date ? ` – ${shortDate(r.d.end_date)}` : ''}{r.d.all_day ? ' · ganztägig' : ` · ${hm(r.d.start_min)}`}</span>
              <input className="ttl" value={r.d.title} maxLength={120} onChange={e => set(i, { d: { ...r.d, title: e.target.value } })} />
              {r.twin && <span className="twin">Steht schon drin: {r.twin.title}{r.twin.all_day ? '' : `, ${hm(r.twin.start_min)}`}</span>}
            </div>
          </li>
        ))}
      </ul>
      <div className="btn-row">
        <button type="button" className="btn ghost" onClick={close} disabled={busy}>Abbrechen</button>
        <button type="button" className="btn" disabled={busy || !picked.length} onClick={() => void saveAll()}>
          {busy ? <span className="spin" /> : picked.length === rows.length ? `Alle ${picked.length} anlegen` : `${picked.length} anlegen`}</button>
      </div>
    </Sheet>
  );
}
