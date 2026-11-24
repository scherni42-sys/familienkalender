import { useState } from 'react';
import { store, useSnapshot } from '../lib/store';
import { askPerson, depart, nameOf, travel, whenText } from '../lib/model';
import { fail, toast } from './toast';
import { hm, today } from '../lib/dates';
import { cvar, Icon } from './ui';

// Erinnerung an den Fahrer und Termin-Anfragen an Teilnehmer, solange die App offen ist. Echte Push-Nachrichten im Hintergrund sind der nächste Ausbauschritt.
export function PushBanner({ now }: { now: number }) {
  const snap = useSnapshot();
  const s = snap.family!.settings;
  const [seen, setSeen] = useState<string[]>([]);
  const e = s.remind ? snap.events.find(x => x.driver === snap.me && x.date === today() && travel(x, s) && now >= depart(x, s) - s.remind && now < depart(x, s) && !seen.includes(x.id)) : undefined;
  if (!e) {
    // Jemand hat mich zu einem Termin hinzugefügt: zusagen oder absagen, solange die App offen ist
    const inv = snap.events.find(x => askPerson(x, snap.me) && x.end_date >= today() && !seen.includes('inv:' + x.id));
    if (!inv) return null;
    const by = nameOf(snap.members, inv.persons_by ?? null);
    const color = snap.members.find(m => m.id === inv.persons_by)?.color ?? '#7a8590';
    const answer = (ok: boolean) => { setSeen([...seen, 'inv:' + inv.id]); store.personAnswer(inv.id, ok).then(() => toast(`${ok ? 'Zugesagt' : 'Abgesagt'}. ${by} bekommt Bescheid.`), fail); };
    return (
      <div className="push" role="alert" style={cvar(color)}>
        <div className="ph"><span className="app"><Icon name="today" /> FamTO</span><span>neu</span></div>
        <b>📅 Neuer Termin: {inv.title}</b>
        <div>{by} hat dich eingetragen: {whenText(inv)}{inv.place ? ` · ${inv.place}` : ''}</div>
        <div className="pa">
          <button type="button" onClick={() => answer(true)}>Zusagen</button>
          <button type="button" onClick={() => answer(false)}>Absagen</button>
          <button type="button" onClick={() => setSeen([...seen, 'inv:' + inv.id])}>Später</button>
        </div>
      </div>
    );
  }
  const dep = depart(e, s);
  const color = snap.members.find(m => m.id === e.driver)?.color ?? '#7a8590';
  return (
    <div className="push" role="alert" style={cvar(color)}>
      <div className="ph"><span className="app"><Icon name="today" /> FamTO</span><span>jetzt</span></div>
      <b><Icon name="car" /> In {dep - now} Min. losfahren ({hm(dep)})</b>
      <div>{e.title} um {hm(e.start_min)} · ca. {travel(e, s)} Min. Fahrt{e.bring.length ? ` · Mitbringen: ${e.bring.join(', ')}` : ''}</div>
      <div className="pa">
        {e.addr && <button type="button" onClick={() => open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(e.addr)}`, '_blank')}>Route starten</button>}
        <button type="button" onClick={() => setSeen([...seen, e.id])}>OK</button>
      </div>
    </div>
  );
}
