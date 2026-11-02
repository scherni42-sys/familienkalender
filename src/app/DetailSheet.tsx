import { store, useSnapshot } from '../lib/store';
import type { Draft } from '../lib/parse';
import { fail, toast } from './toast';
import { hm, today } from '../lib/dates';
import { travelTime } from '../lib/ai';
import { bdLabel, depart, etaMin, nameOf, travel, upcoming, visLabel, whenText } from '../lib/model';
import { inDays } from '../lib/dates';
import { Badges, cvar, Icon, Sheet } from './ui';
import { useState, type ReactNode } from 'react';
import { BdayForm } from './Settings';

// Links in Notizen anklickbar machen (z. B. Teams-Besprechung)
const linkify = (t: string) => t.split(/(https?:\/\/[^\s<>"]+)/g).map((p, i) =>
  i % 2 ? <a key={i} href={p} target="_blank" rel="noopener noreferrer">{/teams\.(microsoft|live)\.com/.test(p) ? 'Teams-Besprechung öffnen' : p}</a> : p);
const Row = ({ k, children }: { k: string; children: ReactNode }) => <div className="r"><span>{k}</span><div>{children}</div></div>;

export function DetailSheet({ id, day, add, close, edit }: { id: string; day?: string; add?: (date: string) => void; close: () => void; edit: (d: Draft) => void }) {
  const snap = useSnapshot();
  const s = snap.family!.settings;
  const e = snap.events.find(x => x.id === id);
  const [here, setHere] = useState<{ minutes: number; km: number } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!e) return null;
  const me = snap.members.find(m => m.id === snap.me)!;
  const canEdit = me.role !== 'guest' && (e.owner === snap.me || e.vis === 'family');
  const tr = travel(e, s), dep = depart(e, s);
  const toDraft = (): Draft => ({
    id: e.id, title: e.title, date: e.date, end_date: e.end_date, all_day: e.all_day, start_min: e.start_min, end_min: e.end_min,
    persons: [...e.persons], driver: e.driver, vis: e.vis === 'family' ? 'family' : 'private', busy: e.vis === 'busy', place: e.place, addr: e.addr,
    travel_min: e.travel_min, notes: e.notes, bring: [...e.bring], discreet: e.discreet, reason: '', suggested: e.vis === 'family' ? 'family' : 'private', timeFound: !e.all_day
  });
  const nav = `https://www.google.com/maps/dir/?api=1&travelmode=driving&dir_action=navigate&destination=${encodeURIComponent(e.addr)}`;
  const iDrive = e.driver === snap.me;
  const eta = etaMin(e);
  // Navigation starten: Google Maps öffnen; fährt man selbst, sieht die Familie „unterwegs“ mit Ankunftszeit
  const startNav = () => {
    window.open(nav, '_blank');
    // Ohne eingetragenen Fahrer wird, wer die Navigation startet, zum Fahrer (Kinder und Gäste nicht)
    const meM = snap.members.find(m => m.id === snap.me);
    const takeOver = !e.driver && !!meM && meM.role !== 'child' && meM.role !== 'guest';
    if (!iDrive && !takeOver) return;
    const set = (min: number) => store.setEta(e.id, new Date(Date.now() + min * 60000).toISOString(), takeOver ? snap.me : undefined).catch(() => {});
    if (here) { void set(here.minutes); return; }
    navigator.geolocation?.getCurrentPosition(
      p => travelTime(`${p.coords.latitude.toFixed(5)},${p.coords.longitude.toFixed(5)}`, e.addr).then(r => set(r.minutes), () => {}),
      () => {}, { enableHighAccuracy: false, timeout: 15000, maximumAge: 120000 });
  };
  const fromHere = () => {
    if (!navigator.geolocation) { toast('Standort ist auf diesem Gerät nicht verfügbar.'); return; }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      p => travelTime(`${p.coords.latitude.toFixed(5)},${p.coords.longitude.toFixed(5)}`, e.addr).then(setHere, fail).finally(() => setBusy(false)),
      () => { setBusy(false); toast('Standort nicht freigegeben. Bitte in den Einstellungen des Handys erlauben.'); },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 120000 });
  };
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
          {eta !== null ? <div className="rt-times"><span><b>{nameOf(snap.members, e.driver)} fährt</b></span><span>Ankunft ca. <b>{hm(eta)}</b></span></div> : <>
          <div className="rt-bar"><span className="rt-drive" style={{ flex: tr }}><Icon name="car" /> {tr} Min.</span>{s.buffer > 0 && <span className="rt-buf" style={{ flex: Math.max(s.buffer, 4) }}>{s.buffer}</span>}</div>
          <div className="rt-times"><span><b>{hm(dep)}</b> losfahren</span><span><b>{hm(e.start_min)}</b> Beginn</span></div></>}
          {e.addr && <a className="btn ghost sm" href={maps} target="_blank" rel="noreferrer">Route von zu Hause</a>}
        </div></Row>}
        {e.addr && <Row k="Von hier">{here ? <><b>{here.minutes} Min.</b> · {String(here.km).replace('.', ',')} km{!e.all_day && e.date === today() ? <> · los spätestens <b>{hm(e.start_min - here.minutes - s.buffer)}</b></> : null}</> : null}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: here ? 6 : 0 }}>
            <button type="button" className="btn ghost sm" disabled={busy} onClick={fromHere}>{busy ? 'Suche Standort …' : here ? 'Neu berechnen' : 'Fahrzeit von hier'}</button>
            <button type="button" className={`btn sm nav-btn${iDrive && eta !== null ? " nav-on" : ""}`} onClick={startNav}><Icon name="car" /> {iDrive && eta !== null ? 'Navigation läuft' : 'Navigation starten'}</button>
            {iDrive && eta !== null && <button type="button" className="btn ghost sm" onClick={() => store.setEta(e.id, null).catch(fail)}>Angekommen</button>}
          </div>
          {eta !== null && <div className="note" style={{ marginTop: 6 }}>{nameOf(snap.members, e.driver)} fährt · Ankunft ca. <b>{hm(eta)}</b>{iDrive ? ' (sieht die Familie auch auf dem Display)' : ''}</div>}</Row>}
        {e.bring.length > 0 && <Row k="Mitbringen"><div className="bring">{e.bring.map(b => <span key={b}>{b}</span>)}</div></Row>}
        {e.notes && <Row k="Notiz">{linkify(e.notes)}</Row>}
        <Row k="Sichtbar">{visLabel(e.vis)}{e.discreet ? ' · diskret' : ''}</Row>
        <Row k="Angelegt von">{nameOf(snap.members, e.owner)}</Row>
      </div>
      <div className="btn-row"><button type="button" className="btn ghost" onClick={close}>Schließen</button>{canEdit && <button type="button" className="btn" onClick={() => edit(toDraft())}>Bearbeiten</button>}
        {canEdit && <button type="button" className="btn ghost del-btn" aria-label="Termin löschen" onClick={async () => {
          try { await store.deleteEvent(e.id); toast(e.ext_id ? 'Gelöscht. Im Handy-Kalender bleibt er, beim nächsten Abgleich kommt er wieder.' : 'Termin gelöscht.'); close(); } catch (x) { fail(x); }
        }}><Icon name="trash" /></button>}</div>
      {add && me.role !== 'guest' && <button type="button" className="btn ghost" style={{ width: '100%', marginTop: 8 }} onClick={() => add(day ?? e.date)}>＋ Weiterer Termin an diesem Tag</button>}
    </Sheet>
  );
}

export function BdaySheet({ close, adding }: { close: () => void; adding?: boolean }) {
  const snap = useSnapshot();
  const s = snap.family!.settings;
  return (
    <Sheet onClose={close} label="Nächste Geburtstage">
      <h2>Nächste Geburtstage</h2>
      <p>Erinnerung {s.bdLead} Tage vorher. Ändern kann das der Admin unter Einstellungen.</p>
      {adding && snap.members.find(m => m.id === snap.me)?.role !== 'guest' && <BdayForm focus />}
      <div>{upcoming(snap.birthdays).map(b => <div key={b.id} className={`bdrow${b.days <= s.bdLead ? ' soon' : ''}`}><div><b>{b.owner ? '🔒 ' : ''}{b.name}</b><small>{b.rel ? `${b.rel} · ` : ''}{bdLabel(b)}{b.age ? ` · wird ${b.age}` : ''}</small></div><span className="dd">{inDays(b.days)}</span></div>)}</div>
      <div className="btn-row"><button type="button" className="btn ghost" onClick={close}>Schließen</button></div>
    </Sheet>
  );
}

