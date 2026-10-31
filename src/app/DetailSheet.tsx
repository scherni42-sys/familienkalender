import { useSnapshot } from '../lib/store';
import type { Draft } from '../lib/parse';
import { hm } from '../lib/dates';
import { bdLabel, depart, nameOf, travel, upcoming, visLabel, whenText } from '../lib/model';
import { inDays } from '../lib/dates';
import { Badges, cvar, Icon, Sheet } from './ui';
import type { ReactNode } from 'react';

const Row = ({ k, children }: { k: string; children: ReactNode }) => <div className="r"><span>{k}</span><div>{children}</div></div>;

export function DetailSheet({ id, day, add, close, edit }: { id: string; day?: string; add?: (date: string) => void; close: () => void; edit: (d: Draft) => void }) {
  const snap = useSnapshot();
  const s = snap.family!.settings;
  const e = snap.events.find(x => x.id === id);
  if (!e) return null;
  const me = snap.members.find(m => m.id === snap.me)!;
  const canEdit = me.role !== 'guest' && (e.owner === snap.me || e.vis === 'family');
  const tr = travel(e, s), dep = depart(e, s);
  const toDraft = (): Draft => ({
    id: e.id, title: e.title, date: e.date, end_date: e.end_date, all_day: e.all_day, start_min: e.start_min, end_min: e.end_min,
    persons: [...e.persons], driver: e.driver, vis: e.vis === 'family' ? 'family' : 'private', busy: e.vis === 'busy', place: e.place, addr: e.addr,
    travel_min: e.travel_min, notes: e.notes, bring: [...e.bring], discreet: e.discreet, reason: '', suggested: e.vis === 'family' ? 'family' : 'private', timeFound: !e.all_day
  });
  const maps = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(e.addr)}${s.home ? `&origin=${encodeURIComponent(s.home)}` : ''}`;
  return (
    <Sheet onClose={close} label="Termindetails">
      <h2>{e.title}</h2>
      <div className="dl">
        <Row k="Wann">{whenText(e)}</Row>
        <Row k="Wer">{e.persons.length ? <><Badges ids={e.persons} members={snap.members} /> {e.persons.map(p => nameOf(snap.members, p)).join(', ')}</> : 'Niemand bestimmtes'}</Row>
        {e.driver && <Row k="Fahrdienst">{nameOf(snap.members, e.driver)} fährt</Row>}
        {(e.place || e.addr) && <Row k="Ort">{e.place}{e.addr && <small className="addr">{e.addr}</small>}</Row>}
        {tr > 0 && <Row k="Fahrt"><div className="route" style={cvar(snap.members.find(m => m.id === e.driver)?.color ?? '#7a8590')}>
          <div className="rt-bar"><span className="rt-drive" style={{ flex: tr }}><Icon name="car" /> {tr} Min.</span>{s.buffer > 0 && <span className="rt-buf" style={{ flex: Math.max(s.buffer, 4) }}>{s.buffer}</span>}</div>
          <div className="rt-times"><span><b>{hm(dep)}</b> losfahren</span><span><b>{hm(e.start_min)}</b> Beginn</span></div>
          {e.addr && <a className="btn ghost sm" href={maps} target="_blank" rel="noreferrer">Route öffnen</a>}
        </div></Row>}
        {e.bring.length > 0 && <Row k="Mitbringen"><div className="bring">{e.bring.map(b => <span key={b}>{b}</span>)}</div></Row>}
        {e.notes && <Row k="Notiz">{e.notes}</Row>}
        <Row k="Sichtbar">{visLabel(e.vis)}{e.discreet ? ' · diskret' : ''}</Row>
        <Row k="Angelegt von">{nameOf(snap.members, e.owner)}</Row>
      </div>
      <div className="btn-row"><button type="button" className="btn ghost" onClick={close}>Schließen</button>{canEdit && <button type="button" className="btn" onClick={() => edit(toDraft())}>Bearbeiten</button>}</div>
      {add && me.role !== 'guest' && <button type="button" className="btn ghost" style={{ width: '100%', marginTop: 8 }} onClick={() => add(day ?? e.date)}>＋ Weiterer Termin an diesem Tag</button>}
    </Sheet>
  );
}

export function BdaySheet({ close }: { close: () => void }) {
  const snap = useSnapshot();
  const s = snap.family!.settings;
  return (
    <Sheet onClose={close} label="Nächste Geburtstage">
      <h2>Nächste Geburtstage</h2>
      <p>Erinnerung {s.bdLead} Tage vorher. Ändern kann das der Admin unter Einstellungen.</p>
      <div>{upcoming(snap.birthdays).map(b => <div key={b.id} className={`bdrow${b.days <= s.bdLead ? ' soon' : ''}`}><div><b>{b.name}</b><small>{b.rel} · {bdLabel(b)}{b.age ? ` · wird ${b.age}` : ''}</small></div><span className="dd">{inDays(b.days)}</span></div>)}</div>
      <div className="btn-row"><button type="button" className="btn ghost" onClick={close}>Schließen</button></div>
    </Sheet>
  );
}

