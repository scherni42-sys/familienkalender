import { store, useSnapshot } from '../lib/store';
import { useFlight } from '../lib/flight';
import { alarmOn, evAlarm, hasEvAlarm, LEADS, setEvAlarm, toggleAlarm, useAlarm } from '../lib/bdalarm';
import type { Draft } from '../lib/parse';
import type { CalEvent } from '../lib/types';
import { fail, toast } from './toast';
import { hm, nowMin, today } from '../lib/dates';
import { travelTime } from '../lib/ai';
import { isOnline, meetingUrl, bdLabel, depart, etaDriver, etaMin, isDriver, leg2, nameOf, target, travel, upcoming, visLabel, whenText } from '../lib/model';
import { inDays } from '../lib/dates';
import { Badges, cvar, Icon, Sheet } from './ui';
import { useEffect, useState, type ReactNode } from 'react';
import { BdayForm } from './Settings';
import { AttachButton, FileList } from './Files';

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
  const [lead, setLead] = useState(() => evAlarm(e?.id));
  const fl = useFlight(e);
  // Fahrer öffnet den Termin am selben Tag: Fahrzeit vom aktuellen Standort automatisch berechnen
  const myTarget = e ? (e.driver === snap.me ? target(e) : e.end_min) : 0;
  const auto = !!e && !!(e.addr || e.place) && !isOnline(e) && isDriver(e, snap.me) && !e.all_day && e.date === today() && myTarget > nowMin() && etaMin(e) === null;
  useEffect(() => {
    if (!auto || !e || !navigator.geolocation) return;
    let live = true; setBusy(true);
    navigator.geolocation.getCurrentPosition(
      p => travelTime(`${p.coords.latitude.toFixed(5)},${p.coords.longitude.toFixed(5)}`, e.addr || e.place).then(r => { if (live) setHere(r); }, () => {}).finally(() => { if (live) setBusy(false); }),
      () => { if (live) setBusy(false); }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 120000 });
    return () => { live = false; };
  }, [auto, e?.id, e?.addr, e?.place]); // eslint-disable-line react-hooks/exhaustive-deps
  // Zurück aus Google Maps: Ist man schon am Ziel, endet „Navigation läuft“ von selbst
  const navOn = !!e && isDriver(e, snap.me) && etaMin(e) !== null && !!(e.addr || e.place) && !isOnline(e);
  useEffect(() => {
    if (!navOn || !e) return;
    const check = () => {
      if (document.visibilityState !== 'visible' || !navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(
        p => travelTime(`${p.coords.latitude.toFixed(5)},${p.coords.longitude.toFixed(5)}`, e.addr || e.place).then(r => {
          if (r.minutes <= 3) store.setEta(e.id, null).then(() => toast('Angekommen. Die Familie sieht das.'), () => {});
        }, () => {}),
        () => {}, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
    };
    document.addEventListener('visibilitychange', check);
    window.addEventListener('famto-resume', check);
    return () => { document.removeEventListener('visibilitychange', check); window.removeEventListener('famto-resume', check); };
  }, [navOn, e?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!e) return null;
  const me = snap.members.find(m => m.id === snap.me)!;
  const canEdit = me.role !== 'guest' && (e.owner === snap.me || e.vis === 'family');
  const tr = travel(e, s), dep = depart(e, s);
  const toDraft = () => eventDraft(e);
  const nav = `https://www.google.com/maps/dir/?api=1&travelmode=driving&dir_action=navigate&destination=${encodeURIComponent(e.addr || e.place)}`;
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
      p => travelTime(`${p.coords.latitude.toFixed(5)},${p.coords.longitude.toFixed(5)}`, e.addr || e.place).then(r => set(r.minutes), () => {}),
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
        {(e.place || e.addr) && <Row k="Ort">{e.addr ? <>{e.place}<a className="addr" href={maps} target="_blank" rel="noreferrer">{e.addr}</a></> : isOnline(e) ? <>{e.place}{meetingUrl(e) && <div style={{ marginTop: 6 }}><a className="btn sm" href={meetingUrl(e)!} target="_blank" rel="noreferrer">Besprechung öffnen</a></div>}</> : <a className="addr" href={maps} target="_blank" rel="noreferrer">{e.place}</a>}</Row>}
        {fl.number && !fl.flight && <Row k="Flug"><a className="btn sm ghost" href={`https://www.google.com/search?q=${encodeURIComponent('Flug ' + fl.number)}`} target="_blank" rel="noreferrer">✈ Flugstatus {fl.number} live ansehen</a>
          <div className="note" style={{ marginTop: 4 }}>Zeigt Gate, Verspätung und Terminal (Google-Fluginfo).</div></Row>}
        {fl.flight && <Row k="Flug"><div className="flight">
          <div><b>{fl.flight.number}</b>{fl.flight.airline ? ` · ${fl.flight.airline}` : ''}{fl.flight.status ? <> · <span className={fl.flight.canceled || (fl.flight.dep?.delay ?? 0) >= 15 ? 'fl-bad' : 'fl-ok'}>{fl.flight.status}</span></> : null}</div>
          {fl.flight.dep && <div>Abflug {fl.flight.dep.airport} <b>{fl.flight.dep.sched}</b>{fl.flight.dep.revised && fl.flight.dep.revised !== fl.flight.dep.sched ? <> → <b className="fl-bad">{fl.flight.dep.revised}</b></> : null}{fl.flight.dep.delay && fl.flight.dep.delay >= 5 ? ` (+${fl.flight.dep.delay} Min.)` : ''}
            {[fl.flight.dep.terminal && `Terminal ${fl.flight.dep.terminal}`, fl.flight.dep.gate && `Gate ${fl.flight.dep.gate}`, fl.flight.dep.checkIn && `Check-in ${fl.flight.dep.checkIn}`].filter(Boolean).map(x => <span key={x as string} className="fl-chip">{x}</span>)}</div>}
          {fl.flight.arr && <div>Ankunft {fl.flight.arr.airport} <b>{fl.flight.arr.sched}</b>{fl.flight.arr.revised && fl.flight.arr.revised !== fl.flight.arr.sched ? <> → <b>{fl.flight.arr.revised}</b></> : null}{fl.flight.arr.belt ? <span className="fl-chip">Gepäckband {fl.flight.arr.belt}</span> : null}</div>}
          <button type="button" className="small-btn" onClick={fl.refresh}>Aktualisieren</button>
          <span className="note">Stand {fl.flight.at ? new Date(fl.flight.at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : ''} · Angaben ohne Gewähr</span>
        </div></Row>}
        {tr > 0 && <Row k="Fahrt"><div className="route" style={cvar(snap.members.find(m => m.id === e.driver)?.color ?? '#7a8590')}>
          {eta !== null ? <div className="rt-times"><span><b>{nm(etaDriver(e))} fährt</b></span><span>Ankunft ca. <b>{hm(eta)}</b></span></div> : <>
          <div className="rt-bar"><span className="rt-drive" style={{ flex: tr }}><Icon name="car" /> {tr} Min.</span>{s.buffer > 0 && <span className="rt-buf" style={{ flex: Math.max(s.buffer, 4) }}>{s.buffer}</span>}</div>
          <div className="rt-times"><span><b>{hm(dep)}</b> {e.trip === 'ab' ? 'zum Abholen los' : 'losfahren'}</span><span><b>{hm(target(e))}</b> {e.trip === 'ab' ? 'Ende' : 'Beginn'}</span></div>
          {l2 && <div className="rt-times"><span><b>{hm(l2.leave)}</b> {nm(l2.who)} zum Abholen los</span><span><b>{hm(l2.at)}</b> Ende</span></div>}</>}
        </div></Row>}
        {(e.addr || e.place) && !isOnline(e) && (iDrive || (!e.driver && me.role !== 'child' && me.role !== 'guest')) && <Row k="Von hier">
          {busy && eta === null ? <span className="note">Fahrzeit vom Standort wird berechnet …</span> : here && eta === null ? <><b>{here.minutes} Min.</b> · {String(here.km).replace('.', ',')} km · los spätestens <b>{hm(myTarget - here.minutes - s.buffer)}</b></> : null}
          <div className="nav-row one" style={{ marginTop: (here || busy) && eta === null ? 6 : 0 }}>
            <button type="button" className={`btn sm nav-btn${iDrive && eta !== null ? " nav-on" : ""}`} onClick={startNav}><Icon name="car" /> {iDrive && eta !== null ? 'Navigation läuft' : 'Navigation starten'}</button>
            {iDrive && eta !== null && <button type="button" className="btn ghost sm" onClick={() => store.setEta(e.id, null).catch(fail)}>Angekommen</button>}
          </div>
          {eta !== null && <div className="note" style={{ marginTop: 6 }}>{nm(etaDriver(e))} fährt · Ankunft ca. <b>{hm(eta)}</b>{iDrive ? ' (sieht die Familie auch auf dem Display)' : ''}</div>}</Row>}
        {e.bring.length > 0 && <Row k="Mitbringen"><div className="bring">{e.bring.map(b => <span key={b}>{b}</span>)}</div></Row>}
        {e.notes && <Row k="Notiz">{linkify(e.notes)}</Row>}
        {(e.files?.length || canEdit) ? <Row k="Dokumente">
          <FileList files={e.files} from={{ event: e.id }} canEdit={canEdit} />
          {canEdit && <div style={{ marginTop: e.files?.length ? 8 : 0 }}><AttachButton to={{ event: e.id }} /></div>}
        </Row> : null}
        {hasEvAlarm() && !e.all_day && <Row k="Wecker"><select aria-label="Wecker auf diesem Handy" value={lead} onChange={x => { const v = Number(x.target.value); setLead(v); setEvAlarm({ id: e.id, lead: v, date: e.date, start: e.start_min, title: e.title }); toast(v ? `Wecker gestellt: ${LEADS.find(l => l[0] === v)?.[1]}.` : 'Wecker aus.'); }}>
          <option value={0}>aus</option>{LEADS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Row>}
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

export function BdaySheet({ close, adding, open: first }: { close: () => void; adding?: boolean; open?: string }) {
  const snap = useSnapshot();
  const s = snap.family!.settings;
  const [sel, setSel] = useState<string | null>(first ?? null);
  const b = sel ? upcoming(snap.birthdays).find(x => x.id === sel) : undefined;
  if (b) return <BdayDetail b={b} back={() => setSel(null)} close={close} />;
  return (
    <Sheet onClose={close} label="Nächste Geburtstage">
      <h2>Nächste Geburtstage</h2>
      <p>Erinnerung {s.bdLead} Tage vorher. Ändern kann das der Admin unter Einstellungen. Antippen zeigt Details, Dokumente und Wecker.</p>
      {adding && snap.members.find(m => m.id === snap.me)?.role !== 'guest' && <BdayForm focus />}
      <div>{upcoming(snap.birthdays).map(x => <button type="button" key={x.id} className={`bdrow tap${x.days <= s.bdLead ? ' soon' : ''}`} onClick={() => setSel(x.id)}><div><b>{x.owner ? <><Icon name="lock" /> </> : ''}{x.name}{x.files?.length ? <> <Icon name="clip" /></> : null}</b><small>{x.rel ? `${x.rel} · ` : ''}{bdLabel(x)}{x.age ? ` · wird ${x.age}` : ''}</small></div><span className="dd">{inDays(x.days)}</span></button>)}</div>
      <div className="btn-row"><button type="button" className="btn ghost" onClick={close}>Schließen</button></div>
    </Sheet>
  );
}

// Ein Geburtstag: Angaben, Dokumente (z. B. Einladungskarte), Wecker, Bearbeiten
function BdayDetail({ b, back, close }: { b: ReturnType<typeof upcoming>[number]; back: () => void; close: () => void }) {
  const snap = useSnapshot();
  const me = snap.members.find(m => m.id === snap.me)!;
  const can = me.role !== 'guest' && (!b.owner || b.owner === snap.me);
  const [edit, setEdit] = useState(false);
  const alarm = useAlarm();
  const raw = snap.birthdays.find(x => x.id === b.id)!;
  if (edit) return <Sheet onClose={close} label={`${b.name} bearbeiten`}><BdayForm key={b.id} edit={raw} done={() => setEdit(false)} /></Sheet>;
  return (
    <Sheet onClose={close} label={`Geburtstag ${b.name}`}>
      <h2>🎂 {b.name}</h2>
      <div className="dl">
        <Row k="Wann">{bdLabel(b)} · {inDays(b.days)}</Row>
        {b.age ? <Row k="Alter">wird {b.age}</Row> : null}
        {b.rel && <Row k="Wer">{b.rel}</Row>}
        {(raw.files?.length || can) ? <Row k="Dokumente">
          <FileList files={raw.files} from={{ birthday: b.id }} canEdit={can} />
          {can && <div style={{ marginTop: raw.files?.length ? 8 : 0 }}><AttachButton to={{ birthday: b.id }} label="Einladung oder Dokument anhängen" /></div>}
        </Row> : null}
        {alarm && <Row k="Wecker"><label className="alarm-pick"><span className="busyopt"><input type="checkbox" checked={alarmOn(alarm, b)} onChange={e => { toggleAlarm(b, e.target.checked, snap.birthdays); toast(e.target.checked ? `Wecker für ${b.name} an.` : `Wecker für ${b.name} aus.`); }} /> <Icon name="alarm" /> um {hm(alarm.min)} Uhr klingeln</span></label></Row>}
        <Row k="Sichtbar">{b.owner ? <><Icon name="lock" /> nur für {nameOf(snap.members, b.owner)}</> : 'ganze Familie'}</Row>
        {raw.ext_id && <Row k="Quelle">aus dem Handy-Kalender</Row>}
      </div>
      <div className="btn-row">
        <button type="button" className="btn ghost" onClick={back}>Alle Geburtstage</button>
        {can && <button type="button" className="btn" onClick={() => setEdit(true)}>Bearbeiten</button>}
      </div>
    </Sheet>
  );
}

