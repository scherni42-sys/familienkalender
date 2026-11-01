import { useState } from 'react';
import { useSnapshot } from '../lib/store';
import { depart, travel } from '../lib/model';
import { hm, today } from '../lib/dates';
import { cvar, Icon } from './ui';

// Erinnerung an den Fahrer, solange die App offen ist. Echte Push-Nachrichten im Hintergrund sind der nächste Ausbauschritt.
export function PushBanner({ now }: { now: number }) {
  const snap = useSnapshot();
  const s = snap.family!.settings;
  const [seen, setSeen] = useState<string[]>([]);
  if (!s.remind) return null;
  const e = snap.events.find(x => x.driver === snap.me && x.date === today() && travel(x, s) && now >= depart(x, s) - s.remind && now < depart(x, s) && !seen.includes(x.id));
  if (!e) return null;
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
