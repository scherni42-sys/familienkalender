import { store, useSnapshot } from '../lib/store';
import type { Draft } from '../lib/parse';
import type { CalEvent } from '../lib/types';
import { fail, toast } from './toast';
import { hm, nowMin, today } from '../lib/dates';
import { travelTime } from '../lib/ai';
import { bdLabel, depart, etaDriver, etaMin, isDriver, leg2, nameOf, target, travel, upcoming, visLabel, whenText } from '../lib/model';
import { inDays } from '../lib/dates';
import { Badges, cvar, Icon, Sheet } from './ui';
import { useEffect, useState, type ReactNode } from 'react';
import { BdayForm } from './Settings';

// Links in Notizen anklickbar machen (z. B. Teams-Besprechung)
const linkify = (t: string) => t.split(/(https?:\/\/[^\s<>"]+)/g).map((p, i) =>
  i % 2 ? <a key={i} href={p} target="_blank" rel="noopener noreferrer">{/teams\.(microsoft|live)\.com/.test(p) ? 'Teams-Besprechung öffnen' : p}</a> : p);
// Termin als Entwurf zum Bearbeiten
export const eventDraft = (e: CalEvent): Draft => ({
    id: e.id, title: e.title, date: e.date, end_date: e.end_date, all_day: e.all_day, start_min: e.start_min, end_min: e.end_min,
    persons: [...e.persons], driver: e.driver, trip: e.trip, driver2: e.driver2 ?? null, vis: e.vis === 'family' ? 'family' : 'private', busy: e.vis === 'busy', place: e.place, addr: e.addr,
    travel_min: e.travel_min, notes: e.notes, bring: [...e.bring], discreet: e.discreet, reason: '', suggested: e.vis === 'family' ? 'family' : 'private', timeFound: !e.all_day
  });
const Row = ({ k, children }: { k: string; children: ReactNode }) => <div className="r"><span>{k}</span><div>{children}</div></div>;

export function DetailSheet({ id, day, add, close, edit }: { id: string; day?: string; add?: (date: string) => void; close: () => void; edit: (d: Draft) => void }) {
  const snap = useSnapshot();
  const s = snap.family!.settings;
  const e = snap.events.find(x => x.id === id);
  const [here, setHere] = useState<{ minutes: number; km: number } | null>(null);
  const [busy, setBusy] = useState(false);
  // Fahrer öffnet den Termin am selben Tag: Fahrzeit vom aktuellen Standort automatisch berechnen
  const myTarget = e ? (e.driver === snap.me ? target(e) : e.end_min) : 0;
  const auto = !!e && !!e.addr && isDriver(e, snap.me) && !e.all_day && e.date === today() && myTarget > nowMin() && etaMin(e) === null;
  useEffect(() => {
    if (!auto || !e || !navigator.geolocation) return;
    let live = true; setBusy(true);
    navigator.geolocation.getCurrentPosition(
      p => travelTime(`${p.coords.latitude.toFixed(5)},${p.coords.longitude.toFixed(5)}`, e.addr).then(r => { if (live) setHere(r); }, () => {}).finally(() => { if (live) setBusy(false); }),
      () => { if (live) setBusy(false); }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 120000 });
    return () => { live = false; };
  }, [auto, e?.id, e?.addr]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!e) return null;
  const me = snap.members.find(m => m.id === snap.me)!;
  const canEdit = me.role !== 'guest' && (e.owner === snap.me || e.vis === 'family');
  const tr = travel(e, s), dep = depart(e, s);
  const toDraft = () => eventDraft(e);
  const nav = `https://www.google.com/maps/dir/?api=1&travelmode=driving&dir_action=navigate&destination=${encodeURIComponent(e.addr)}`;
  const iDrive = isDriver(e, snap.me);
  const l2 = leg2(e, s);
  const nm = (id?: string | null) => nameOf(snap.members, id ?? null);
  const askMe = (e.driver === snap.me && e.driver_ok == null && !!e.driver_by && e.driver_by !== snap.me) || (e.driver2 === snap.me && e.driver2_ok == null && !!e.driver_by && e.driver_by !== snap.me);
  const okMark = (ok?: boolean | null) => ok ? ' ✓' : ok === null && e.driver_by ? ' (wartet auf Zusage)' : '';
  const eta = etaMin(e);
  // Navigation starten: Google Maps öffnen; fährt man selbst, sieht die Familie „unterwegs“ mit Ankunftszeit
  const startNav = () => {
    // Erst die Ankunftszeit losschicken, dann Google Maps öffnen: In der Android-App pausiert die Seite, sobald Maps vorne ist
    eta0();
    window.open(nav, '_blank');
  };
  const eta0 = () => {
    // Ohne eingetragenen Fahrer wird, wer die Navigation startet, zum Fahrer (Kinder und Gäste nicht)
    const meM = snap.members.find(m => m.id === snap.me);
    const takeOver = !e.driver && !!meM && meM.role !== 'child' && meM.role !== 'guest';
    if (!iDrive && !takeOver) return;
    const set = (min: number) => store.setEta(e.id, new Date(Date.now() + min * 60000).toISOString(), takeOver ? snap.me : undefined).catch(() => {});
    if (here) { void set(here.minutes); return; }
    // Sofort eine vorläufige Ankunftszeit mit der Fahrzeit von zu Hause, danach genauer vom Standort
    if (e.travel_min) void set(e.travel_min);
    navigator.geolocation?.getCurrentPosition(
      p => travelTime(`${p.coords.latitude.toFixed(5)},${p.coords.longitude.toFixed(5)}`, e.addr).then(r => set(r.minutes), () => {}),
      () => {}, { enableHighAccuracy: false, timeout: 15000, maximumAge: 120000 });
  };
  const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([e.place, e.addr].filter(Boolean).join(', '))}`;
  return (
    <Sheet onClose={close} label="Termindetails">
      <h2>{e.title}</h2>
      <div className="dl">
        <Row k="Wann">{whenText(e)}</Row>
        <Row k="Wer">{e.persons.length ? <><Badges ids={e.persons} members={snap.members} /> {e.persons.map(p => nameOf(snap.members, p)).join(', ')}</> : 'Niemand bestimmtes'}</Row>
        {(e.driver || e.declined_by) && <Row k="Fahrdienst">
          {e.driver ? <>{nm(e.driver)} {e.trip === 'ab' ? 'holt ab' : e.trip === 'beides' ? 'bringt hin' : 'fährt'}{okMark(e.driver_ok)}</> : null}
          {e.trip === 'beides' && e.driver2 ? <><br />{nm(e.driver2)} holt ab{okMark(e.driver2_ok)}</> : null}
          {e.declined_by && <div className="note">{nm(e.declined_by)} kann nicht fahren{e.driver ? '' : '. Bitte jemand anderen eintragen.'}</div>}
          {askMe && <div className="nav-row one" style={{ marginTop: 6 }}>
            <button type="button" className="btn sm" onClick={() => store.driverAnswer(e.id, true).then(() => toast('Danke, die Familie weiß Bescheid.'), fail)}>Okay, mach ich</button>
            <button type="button" className="btn ghost sm" onClick={() => store.driverAnswer(e.id, false).then(() => toast('Abgesagt. Wer dich eingetragen hat, bekommt Bescheid.'), fail)}>Kann nicht</button>
          </div>}
        </Row>}
        {(e.place || e.addr) && <Row k="Ort">{e.place}{e.addr && <a className="addr" href={maps} target="_blank" rel="noreferrer">{e.addr}</a>}</Row>}
        {tr > 0 && <Row k="Fahrt"><div className="route" style={cvar(snap.members.find(m => m.id === e.driver)?.color ?? '#7a8590')}>
          {eta !== null ? <div className="rt-times"><span><b>{nm(etaDriver(e))} fährt</b></span><span>Ankunft ca. <b>{hm(eta)}</b></span></div> : <>
          <div className="rt-bar"><span className="rt-drive" style={{ flex: tr }}><Icon name="car" /> {tr} Min.</span>{s.buffer > 0 && <span className="rt-buf" style={{ flex: Math.max(s.buffer, 4) }}>{s.buffer}</span>}</div>
          <div className="rt-times"><span><b>{hm(dep)}</b> {e.trip === 'ab' ? 'zum Abholen los' : 'losfahren'}</span><span><b>{hm(target(e))}</b> {e.trip === 'ab' ? 'Ende' : 'Beginn'}</span></div>
          {l2 && <div className="rt-times"><span><b>{hm(l2.leave)}</b> {nm(l2.who)} zum Abholen los</span><span><b>{hm(l2.at)}</b> Ende</span></div>}</>}
        </div></Row>}
        {e.addr && (iDrive || (!e.driver && me.role !== 'child' && me.role !== 'guest')) && <Row k="Von hier">
          {busy && eta === null ? <span className="note">Fahrzeit vom Standort wird berechnet …</span> : here && eta === null ? <><b>{here.minutes} Min.</b> · {String(here.km).replace('.', ',')} km · los spätestens <b>{hm(myTarget - here.minutes - s.buffer)}</b></> : null}
          <div className="nav-row one" style={{ marginTop: (here || busy) && eta === null ? 6 : 0 }}>
            <button type="button" className={`btn sm nav-btn${iDrive && eta !== null ? " nav-on" : ""}`} onClick={startNav}><Icon name="car" /> {iDrive && eta !== null ? 'Navigation läuft' : 'Navigation starten'}</button>
            {iDrive && eta !== null && <button type="button" className="btn ghost sm" onClick={() => store.setEta(e.id, null).catch(fail)}>Angekommen</button>}
          </div>
          {eta !== null && <div className="note" style={{ marginTop: 6 }}>{nm(etaDriver(e))} fährt · Ankunft ca. <b>{hm(eta)}</b>{iDrive ? ' (sieht die Familie auch auf dem Display)' : ''}</div>}</Row>}
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

