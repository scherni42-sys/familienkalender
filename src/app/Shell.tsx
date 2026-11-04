import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { demoLink, store, useSnapshot } from '../lib/store';
import { micStart } from '../lib/micstart';
import { native } from '../lib/native';
import { SUPA } from '../lib/supabase';
import type { BusySlot, CalEvent, Snapshot } from '../lib/types';
import { addDays, dayLabel, fromIso, hm, isoWeek, longDate, MON, mondayOf, nowMin, today, WDS } from '../lib/dates';
import { bdOn, colorOf, depart, driveDone, etaDriver, etaMin, leg2, nameOf, target, travel, upcoming, visibleOnDay } from '../lib/model';
import type { Draft } from '../lib/parse';
import { Badge, cvar, Icon, useLong } from './ui';
import { fail, toast, useToast } from './toast';
import { Board } from './Board';
import { Settings } from './Settings';
import { MicSheet } from './MicSheet';
import { AskSheet } from './AskSheet';
import { Clip } from './Files';
import { EventSheet } from './EventSheet';
import { DetailSheet, BdaySheet, eventDraft } from './DetailSheet';
import { flightShort, useFlight } from '../lib/flight';
import { PushBanner } from './PushBanner';
import { WidgetView } from './WidgetView';
import { Chat } from './Chat';

type Tab = 'today' | 'week' | 'board' | 'chat' | 'settings';
type Filter = 'all' | 'family' | 'home';
const savedFilter = (): Filter => { try { const v = localStorage.getItem('fk-filter'); return v === 'home' ? v : 'all'; } catch { return 'all'; } };
// Widget-Schnellknöpfe: ?mic=private|family|board legt die Art fest, das Mikrofon startet man selbst (Seitentaste ?mic=1 startet sofort)
const micPreset = (v: string | null) => v === 'private' || v === 'family' || v === 'board' ? v : undefined;

export type SheetState = { kind: 'mic'; auto?: boolean; quick?: boolean; preset?: 'private' | 'family' | 'board'; photo?: boolean } | { kind: 'edit'; draft: Draft; fresh: boolean } | { kind: 'detail'; id: string; day?: string } | { kind: 'bdays'; adding?: boolean; open?: string } | { kind: 'ask' } | null;

// Uhr, die jede Minute neu zeichnet (für „vorbei“, „los in X Min.“)
export function useMinute() {
  const [, set] = useState(0);
  useEffect(() => { const t = setInterval(() => set(x => x + 1), 30000); return () => clearInterval(t); }, []);
  return nowMin();
}

export function Shell() {
  const snap = useSnapshot();
  const [tab, setTab] = useState<Tab>('today');
  const [wk, setWk] = useState(0);
  // Große Schrift: passt der Titel nicht, kürzer schreiben („Mi, 4. Nov.“ bzw. „KW 45“)
  const titleRef = useRef<HTMLElement>(null);
  const [shortT, setShortT] = useState(false);
  const [filter, setFilter] = useState<Filter>(savedFilter);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [nonce, setNonce] = useState(0);
  const snapRef = useRef(snap); snapRef.current = snap;
  const [flash, setFlash] = useState<string | null>(null);
  const [focusMsg, setFocusMsg] = useState<string | null>(null);
  const [replyMsg, setReplyMsg] = useState<string | null>(null);
  const [chatWith, setChatWith] = useState<string | null>(null);
  // Sprung aus dem Android-Widget: ?open=event:<id> oder ?open=msg:<id>
  const deep = useRef(new URLSearchParams(location.search).get('open'));
  const toastMsg = useToast();
  const now = useMinute();
  const me = snap.members.find(m => m.id === snap.me)!;
  const s = snap.family!.settings;
  const next = upcoming(snap.birthdays)[0];
  const cake = next && s.bdLead > 0 && next.days <= s.bdLead ? next : null;
  const titles: Record<Tab, string> = { today: 'Heute', week: 'Kalender', board: 'Board', chat: 'Chat', settings: 'Einstellungen' };
  // Antippen: Details; lange drücken: gleich bearbeiten (wenn man darf)
  const open = (id: string, how?: 'edit') => {
    const ev = snapRef.current.events.find(x => x.id === id);
    if (how === 'edit' && ev && me.role !== 'guest' && (ev.owner === snap.me || ev.vis === 'family')) setSheet({ kind: 'edit', draft: eventDraft(ev), fresh: false });
    else setSheet({ kind: 'detail', id });
  };
  // Leerer Termin an einem Tag (aus dem Widget oder „Weiterer Termin“ im Termin)
  const newOn = (date: string) => setSheet({ kind: 'edit', fresh: true, draft: { title: '', date, end_date: date, all_day: false, start_min: 600, end_min: 660, persons: [me.id], driver: null, vis: 'family', busy: false, place: '', addr: '', travel_min: null, notes: '', bring: [], discreet: false, reason: '', suggested: 'family', timeFound: true } });
  const saved = (id: string) => { setFlash(id); setTimeout(() => setFlash(null), 4000); };

  // iPhone-App: persönlichen Widget-Code einmal an die App geben, damit das Widget die Familiendaten laden kann
  useEffect(() => {
    const n = native();
    if (!n?.setCode || n.code() || store.demo || me.role === 'guest') return;
    store.widgetToken().then(t => n.setCode!('FK1:' + btoa(JSON.stringify({ u: SUPA.url, k: SUPA.key, t, a: `${location.origin}${location.pathname}` }))), () => {});
  }, [me.id]);

  // Schnellstart: ?mic=1 (Verknüpfung) oder Geräte-Einstellung öffnet beim Start und beim Zurückkehren sofort die Spracheingabe
  useEffect(() => {
    // Aus dem Widget (oder einer Benachrichtigung): erst alles Offene schließen, dann das Gewünschte zeigen
    const go = (o: string) => {
      setSheet(null); setNonce(n => n + 1);
      const [k, id] = o.split(':');
      if (k === 'event' && snapRef.current.events.some(e => e.id === id)) setSheet({ kind: 'detail', id, day: o.split(':')[2] });
      if (k === 'bdays') setSheet({ kind: 'bdays' });
      if (k === 'bday' && id) setSheet({ kind: 'bdays', open: id });
      if (k === 'bdadd') setSheet({ kind: 'bdays', adding: true });
      // Tag im Widget angetippt: leerer Termin an diesem Datum
      if (k === 'new' && /^\d{4}-\d{2}-\d{2}$/.test(id)) newOn(id);
      if (k === 'settings') setTab('settings');
      if (k === 'home') setTab('today');
      if (k === 'ask' && me.role !== 'guest') setSheet({ kind: 'ask' });
      if (k === 'chat') { setChatWith(id || null); setTab('chat'); }
      if (k === 'msg') { setTab('board'); setFocusMsg(id); if (o.split(':')[2] === 'reply') setReplyMsg(id); setTimeout(() => setFocusMsg(null), 4000); }
    };
    const o = deep.current;
    if (o) { history.replaceState(null, '', location.pathname + location.hash); go(o); }
    const onOpen = (e: Event) => { const v = String((e as CustomEvent).detail ?? ''); if (v) go(v); };
    window.addEventListener('famto-open', onOpen);
    (window as unknown as { __famtoOpen?: (v: string) => void }).__famtoOpen = go;
    if (me.role === 'guest') return;
    const q = new URLSearchParams(location.search);
    if (q.has('mic')) { history.replaceState(null, '', location.pathname + location.hash); { const v = q.get('mic'), preset = micPreset(v); if (v !== 'photo' && native()) setSheet({ kind: 'mic', preset }); else setSheet(v === 'photo' ? { kind: 'mic', photo: true } : { kind: 'mic', auto: !preset, quick: true, preset }); } }
    else if (micStart() && !o) setSheet({ kind: 'mic', auto: true, quick: true });
    // Falls Chrome die laufende App nur nach vorn holt: Startadresse über die Launch-Queue auswerten
    (window as unknown as { launchQueue?: { setConsumer: (f: (p: { targetURL?: string }) => void) => void } }).launchQueue
      ?.setConsumer(p => { const m = p.targetURL ? new URL(p.targetURL).searchParams : null; if (m?.has('mic')) { const v = m.get('mic'), preset = micPreset(v); setSheet(v === 'photo' ? { kind: 'mic', photo: true } : { kind: 'mic', auto: !preset, quick: true, preset }); } });
    const onShow = () => { if (document.visibilityState === 'visible' && micStart()) setSheet(x => x ?? { kind: 'mic', auto: true, quick: true }); };
    document.addEventListener('visibilitychange', onShow);
    // Android-App schon offen: ＋ im Widget öffnet das Fenster ohne Neuladen
    const onMic = (e: Event) => { const v = String((e as CustomEvent).detail ?? ''); setSheet(v === 'photo' ? { kind: 'mic', photo: true } : { kind: 'mic', preset: micPreset(v) }); };
    window.addEventListener('famto-mic', onMic);
    return () => { document.removeEventListener('visibilitychange', onShow); window.removeEventListener('famto-mic', onMic); window.removeEventListener('famto-open', onOpen); };
  }, [me.role]);

  useLayoutEffect(() => { setShortT(false); }, [tab, wk]);
  useLayoutEffect(() => { const el = titleRef.current; if (el && !shortT && el.scrollWidth > el.clientWidth + 1) setShortT(true); });
  useEffect(() => { const r = () => setShortT(false); addEventListener('resize', r); return () => removeEventListener('resize', r); }, []);
  return (
    <div className="screen" style={me.app_bg ? { background: me.app_bg } : undefined}>
      {/* Kopfzeile wie im Widget: Datum (bzw. Woche), Zahnrad, Haus */}
      <div className="ph-head wlike">
        <button type="button" className="ph-title" onClick={() => setTab('today')} aria-label="Zurück zu heute">
          <strong ref={titleRef} className={tab === 'today' || tab === 'board' || tab === 'chat' ? 'date' : undefined}>{tab === 'today' || tab === 'board' || tab === 'chat' ? (shortT ? shortDate(today()) : longDate(today())) : tab === 'week' ? (shortT ? `KW ${isoWeek(addDays(mondayOf(today()), wk * 7))}` : kwTitle(wk)) : titles[tab]}</strong></button>
        <span className="head-r">
          <button type="button" className={`head-i${tab === 'settings' ? ' on' : ''}`} aria-label="Einstellungen" aria-pressed={tab === 'settings'} onClick={() => setTab(tab === 'settings' ? 'today' : 'settings')}><Icon name="gear" /></button>
          <button type="button" className={`home-t${filter === 'home' ? ' on' : ''}`} aria-pressed={filter === 'home'} aria-label="Home-Modus: berufliche Termine ausblenden"
            onClick={() => { const k: Filter = filter === 'home' ? 'all' : 'home'; setFilter(k); try { localStorage.setItem('fk-filter', k); } catch { /* egal */ } }}><Icon name="home" /></button>
        </span>
      </div>
      {demoLink && <div className="demo-bar">Testversion mit Beispielfamilie. Was du änderst, bleibt nur in diesem Browser.</div>}
      <div className={`ph-body${tab === 'today' || tab === 'board' || tab === 'chat' ? ' today' : ''}`}>
        {(tab === 'today' || tab === 'board' || tab === 'chat') && <WidgetView big={tab === 'board' || tab === 'chat' ? tab : null} bigEl={tab === 'board' ? <Board focus={focusMsg} reply={replyMsg} /> : tab === 'chat' ? <Chat open={chatWith} opened={() => setChatWith(null)} /> : undefined} toggle={w => setTab(tab === w ? 'today' : w)} chat={id => { setChatWith(id); setTab('chat'); }} snap={snap} filter={filter} now={now} go={{ open: (id, day) => setSheet({ kind: 'detail', id, day }), edit: id => open(id, 'edit'), bday: id => setSheet({ kind: 'bdays', open: id }), add: newOn, msg: id => { setTab('board'); setFocusMsg(id); setTimeout(() => setFocusMsg(null), 4000); } }} />}
        {tab === 'week' && <CalendarTab snap={snap} filter={filter} now={now} open={open} add={newOn} flash={flash} wk={wk} />}
        {tab === 'settings' && <Settings key={nonce} />}
      </div>
      {me.role !== 'guest' && <button type="button" className="magic fab" onClick={() => setSheet({ kind: 'ask' })} aria-label="Claude fragen">✨</button>}
      {/* Fußzeile wie im Widget: Geburtstage, Kalenderwoche blättern, neuer Eintrag */}
      <nav className="wbar" aria-label="Bereiche">
        <button type="button" className="ring-b" onClick={() => setSheet({ kind: 'bdays' })} aria-label={cake ? `Geburtstage, nächster ${cake.days === 0 ? 'heute' : `in ${cake.days} Tagen`}` : 'Geburtstage'}>B{cake && <small>{cake.days === 0 ? '🎂' : cake.days}</small>}</button>
        <span className="kw">
          <button type="button" className="arr" style={{ visibility: tab === 'week' && wk > MIN_WK ? 'visible' : 'hidden' }} aria-label="Woche zurück" onClick={() => setWk(w => Math.max(MIN_WK, w - 1))}>◀</button>
          <button type="button" className={`kw-p${tab === 'week' ? ' on' : ''}`} aria-pressed={tab === 'week'} aria-label="Wochenansicht" onClick={() => { if (tab === 'week' && wk !== 0) setWk(0); else { setWk(0); setTab(tab === 'week' ? 'today' : 'week'); } }}>KW{tab === 'week' ? ` ${isoWeek(addDays(mondayOf(today()), wk * 7))}` : ''}</button>
          <button type="button" className="arr" style={{ visibility: tab === 'week' ? 'visible' : 'hidden' }} aria-label="Woche vor" onClick={() => setWk(w => w + 1)}>▶</button>
        </span>
        {me.role === 'guest' ? <span className="ring-a ghost" /> : <button type="button" className="ring-a" aria-label="Termin oder Nachricht eintragen" onClick={() => setSheet({ kind: 'mic' })}>＋</button>}
      </nav>
      {sheet?.kind === 'mic' && <MicSheet auto={sheet.auto} quick={sheet.quick} preset={sheet.preset} photoFirst={sheet.photo} close={() => setSheet(null)} toDraft={(draft) => setSheet({ kind: 'edit', draft, fresh: true })} posted={() => { setSheet(null); setTab('board'); }} saved={(id) => { setSheet(null); saved(id); }} />}
      {sheet?.kind === 'edit' && <EventSheet draft={sheet.draft} fresh={sheet.fresh} close={() => setSheet(null)} back={() => setSheet({ kind: 'mic' })} saved={(id) => { setSheet(null); saved(id); }} />}
      {sheet?.kind === 'detail' && <DetailSheet id={sheet.id} day={sheet.day} add={newOn} close={() => setSheet(null)} edit={(draft) => setSheet({ kind: 'edit', draft, fresh: false })} />}
      {sheet?.kind === 'ask' && <AskSheet close={() => setSheet(null)} open={id => setSheet({ kind: 'detail', id })} edit={draft => setSheet({ kind: 'edit', draft, fresh: false })} toDraft={draft => setSheet({ kind: 'edit', draft, fresh: true })} bdays={() => setSheet({ kind: 'bdays' })} />}
      {sheet?.kind === 'bdays' && <BdaySheet key={sheet.open ?? ''} adding={sheet.adding} open={sheet.open} close={() => setSheet(null)} />}
      <PushBanner now={now} />
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </div>
  );
}


/* ---------- Terminkarte ---------- */
// Flugstatus unter dem Termin (nur rund um den Flugtag)
function FlightLine({ e }: { e: CalEvent }) {
  const { flight } = useFlight(e);
  if (!flight) return null;
  const txt = flightShort(flight);
  return txt ? <div className={`fl-line${flight.canceled || (flight.dep?.delay ?? 0) >= 15 ? ' bad' : ''}`}>✈ {txt}</div> : null;
}

export function EvCard({ e, d, snap, now, open, flash }: { e: CalEvent; d: string; snap: Snapshot; now: number; open: (id: string, how?: 'edit') => void; flash?: string | null }) {
  const s = snap.family!.settings;
  const isToday = d === today();
  const past = d < today() || (isToday && !e.all_day && e.end_min <= now);
  const tr = travel(e, s), dep = depart(e, s);
  const soon = tr && isToday && dep > now && dep - now <= 30;
  const eta = e.driver || e.driver2 ? etaMin(e) : null;
  const l2 = leg2(e, s);
  const soon2 = !!l2 && isToday && l2.leave > now && l2.leave - now <= 30;
  // Lange drücken: Papierkorb erscheint, ein Tipp darauf löscht sofort
  const [armed, setArmed] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const longed = useRef(false);
  const mayDelete = e.owner === snap.me || e.vis === 'family';
  // Lange drücken: gleich das Bearbeiten-Fenster (Löschen gibt es dort)
  const press = () => { longed.current = false; window.clearTimeout(timer.current); if (mayDelete) timer.current = window.setTimeout(() => { longed.current = true; navigator.vibrate?.(20); open(e.id, 'edit'); }, 550); };
  const release = () => window.clearTimeout(timer.current);
  const del = async (ev: React.MouseEvent) => {
    ev.stopPropagation();
    try {
      await store.deleteEvent(e.id);
      toast(e.ext_id ? 'Gelöscht. Im Handy-Kalender bleibt er, beim nächsten Abgleich kommt er wieder.' : 'Termin gelöscht.');
    } catch (x) { fail(x); setArmed(false); }
  };
  return (
    <div className={`ev${e.files?.length ? ' has-clip' : ''}${e.vis === 'family' ? '' : ' private'}${past ? ' past' : ''}${flash === e.id ? ' isnew' : ''}${armed ? ' armed' : ''}`} style={cvar(colorOf(snap.members, e.persons[0] ?? e.owner))}
      data-ev role="button" tabIndex={0}
      onPointerDown={press} onPointerUp={release} onPointerLeave={release} onPointerCancel={release} onContextMenu={x => { if (mayDelete) x.preventDefault(); }}
      onClick={() => { if (longed.current) { longed.current = false; return; } if (armed) { setArmed(false); return; } open(e.id); }}
      onKeyDown={k => { if (k.key === 'Enter') open(e.id); if (k.key === 'Delete' && mayDelete) setArmed(true); }} aria-label={`${e.title}, Details öffnen, lange drücken zum Bearbeiten`}>
      {armed && <button type="button" className="ev-del" onClick={del} aria-label={`${e.title} löschen`}><Icon name="trash" /></button>}
      <Time e={e} d={d} />
      <div style={{ minWidth: 0 }}>
        <div className="t">{e.vis !== 'family' && <span className="lock-i"><Icon name="lock" /></span>}<span>{e.title}</span></div>
        <div className="meta">
          {e.persons.length > 0 && <span>{e.persons.map(p => nameOf(snap.members, p)).join(', ')}</span>}
          {e.driver && !(eta === null && driveDone(e)) && <span><Icon name="car" /> {nameOf(snap.members, e.driver)} {e.trip === 'ab' ? 'holt ab' : e.trip === 'beides' ? 'bringt' : 'fährt'}</span>}
          {e.trip === 'beides' && e.driver2 && <span><Icon name="car" /> {nameOf(snap.members, e.driver2)} holt ab</span>}
          {e.place && <span className="pl">{e.place}</span>}
        </div>
        <FlightLine e={e} />
        {eta !== null ? (
          <div className="go"><Icon name="car" /><b>{nameOf(snap.members, etaDriver(e))} fährt · Ankunft ca. {hm(eta)}</b></div>
        ) : tr > 0 && !(isToday && target(e) <= now) ? (
          <div className={`go${soon ? ' soon' : ''}`}><Icon name="car" /><b>{soon ? `In ${dep - now} Min. ${e.trip === 'ab' ? 'zum Abholen ' : ''}losfahren` : `${e.trip === 'ab' ? 'Zum Abholen los' : 'Los'} um ${hm(dep)}`}</b><span>ca. {tr} Min. Fahrt{s.buffer ? ` + ${s.buffer} Min. Puffer` : ''}</span></div>
        ) : l2 && !(isToday && l2.at <= now) ? (
          <div className={`go${soon2 ? ' soon' : ''}`}><Icon name="car" /><b>{nameOf(snap.members, l2.who)}: {soon2 ? `in ${l2.leave - now} Min. zum Abholen los` : `zum Abholen los um ${hm(l2.leave)}`}</b><span>ca. {tr} Min. Fahrt</span></div>
        ) : null}
      </div>
      <Clip files={e.files} more={() => open(e.id)} />
    </div>
  );
}

function Time({ e, d }: { e: Pick<CalEvent, 'all_day' | 'date' | 'end_date' | 'start_min' | 'end_min'>; d: string }) {
  if (e.all_day) return <time className="ad">ganz&shy;tägig{e.end_date > e.date ? <span>{`Tag ${Math.round((fromIso(d).getTime() - fromIso(e.date).getTime()) / 864e5) + 1}/${Math.round((fromIso(e.end_date).getTime() - fromIso(e.date).getTime()) / 864e5) + 1}`}</span> : null}</time>;
  return <time>{hm(e.start_min)}<span>{hm(e.end_min)}</span></time>;
}

function BusyCard({ b, d, snap, now }: { b: BusySlot; d: string; snap: Snapshot; now: number }) {
  const past = d < today() || (d === today() && !b.all_day && b.end_min <= now);
  return (
    <div className={`ev busy${past ? ' past' : ''}`}>
      <Time e={b} d={d} />
      <div><div className="t"><Badge m={snap.members.find(m => m.id === b.owner)} /><span>{nameOf(snap.members, b.owner)} ist belegt</span></div>
        <div className="meta"><span className="vis-tag busy"><Icon name="lock" /> belegt</span><span>Details privat</span></div></div>
    </div>
  );
}

function DayList({ snap, d, filter, now, open, flash, empty, add }: { snap: Snapshot; d: string; filter: Filter; now: number; open: (id: string, how?: 'edit') => void; flash: string | null; empty: 'big' | 'small'; add?: (d: string) => void }) {
  const s = snap.family!.settings;
  const { ev, busy } = visibleOnDay(snap.events, snap.busy, d, snap.me, filter);
  const isToday = d === today();
  const hide = (x: { all_day: boolean; end_min: number }) => s.pastMode === 'hide' && isToday && !x.all_day && x.end_min <= now;
  const items: ({ k: 'e'; e: CalEvent } | { k: 'b'; b: BusySlot })[] = [
    ...ev.filter(e => !hide(e)).map(e => ({ k: 'e' as const, e })), ...busy.filter(b => !hide(b)).map(b => ({ k: 'b' as const, b }))
  ].sort((a, b) => {
    const x = a.k === 'e' ? a.e : a.b, y = b.k === 'e' ? b.e : b.b;
    return x.all_day === y.all_day ? x.start_min - y.start_min : x.all_day ? -1 : 1;
  });
  const bds = bdOn(snap.birthdays, d);
  return <>
    {bds.map(b => <div key={b.id} className="bd-line"><Icon name="cake" /><span><b>{b.name}</b> hat Geburtstag{b.age ? ` und wird ${b.age}` : ''}</span></div>)}
    {items.length ? items.map(it => it.k === 'e'
      ? <EvCard key={it.e.id} e={it.e} d={d} snap={snap} now={now} open={open} flash={flash} />
      : <BusyCard key={it.b.id} b={it.b} d={d} snap={snap} now={now} />)
      : empty === 'big'
        ? <div className="free"><Icon name="smile" /><b>Frei</b><span>{isToday ? 'Heute steht nichts mehr an.' : 'Nichts geplant.'}</span></div>
        : add && d >= today() ? <button type="button" className="empty tap" onClick={() => add(d)}><b>＋ Termin</b></button> : <div className="empty past-free">frei</div>}
  </>;
}

// So weit zurück lädt die App Termine (rund 3 Monate)
const MIN_WK = -12, MIN_MO = -2;
const shortDate = (d: string) => { const x = fromIso(d); return `${WDS[x.getDay()]}, ${x.getDate()}. ${MON[x.getMonth()].slice(0, 3)}.`; };
const kwTitle = (wk: number) => { const mon = addDays(mondayOf(today()), wk * 7), sun = addDays(mon, 6); return `KW ${isoWeek(mon)} · ${fromIso(mon).getDate()}.–${fromIso(sun).getDate()}. ${MON[fromIso(sun).getMonth()].slice(0, 3)}`; };
// Tag lange drücken: neuer Termin an diesem Tag (wie Antippen des Tages im Widget)
function DayHead({ d, add }: { d: string; add: (d: string) => void }) {
  const l = useLong(() => add(d));
  return <div className="day-h" {...l.on} title="Lange drücken für neuen Termin"><span>{dayLabel(d)}</span></div>;
}
function Cell({ d, add, pick, className, label, children }: { d: string; add: (d: string) => void; pick: (d: string) => void; className: string; label: string; children: React.ReactNode }) {
  const l = useLong(() => add(d));
  return <button type="button" className={className} {...l.on} onClick={() => { if (l.longed.current) { l.longed.current = false; return; } pick(d); }} aria-label={label}>{children}</button>;
}
function CalendarTab({ snap, filter, now, open, add, flash, wk }: { snap: Snapshot; filter: Filter; now: number; open: (id: string, how?: 'edit') => void; add: (d: string) => void; flash: string | null; wk: number }) {
  const [view, setView] = useState<'week' | 'month'>('week');
  const [mo, setMo] = useState(0);
  const [sel, setSel] = useState(today());
  const t = today();
  const seg = <div className="seg" role="group" aria-label="Ansicht">
    {([['week', 'Woche'], ['month', 'Monat']] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)}>{l}</button>)}
  </div>;
  if (view === 'week') {
    const mon = addDays(mondayOf(t), wk * 7);
    const days = Array.from({ length: 7 }, (_, i) => addDays(mon, i));
    return <>
      {seg}
      {days.map(d => <div key={d} className={d < t ? 'day-past' : undefined} style={{ display: 'grid', gap: 8 }}>
        <DayHead d={d} add={add} />
        <DayList snap={snap} d={d} filter={filter} now={now} open={open} flash={flash} empty="small" add={add} />
      </div>)}
    </>;
  }
  const first = fromIso(t); first.setDate(1); first.setMonth(first.getMonth() + mo);
  const y = first.getFullYear(), m = first.getMonth();
  const start = (first.getDay() + 6) % 7, len = new Date(y, m + 1, 0).getDate();
  const iso0 = `${y}-${String(m + 1).padStart(2, '0')}-`;
  return <>
    {seg}
    <div className="calnav">
      <button type="button" className="nav" aria-label="Voriger Monat" disabled={mo <= MIN_MO} onClick={() => setMo(Math.max(MIN_MO, mo - 1))}>‹</button>
      <div className="ttl">{MON[m]} {y}</div>
      <button type="button" className="nav" aria-label="Nächster Monat" onClick={() => setMo(mo + 1)}>›</button>
    </div>
    <div className="mgrid">
      {[1, 2, 3, 4, 5, 6, 0].map(i => <div key={i} className="wd">{WDS[i]}</div>)}
      {Array.from({ length: start }, (_, i) => <div key={`x${i}`} />)}
      {Array.from({ length: len }, (_, i) => {
        const d = iso0 + String(i + 1).padStart(2, '0');
        const { ev, busy } = visibleOnDay(snap.events, snap.busy, d, snap.me, filter);
        const dots = [...ev.map(e => colorOf(snap.members, e.persons[0] ?? e.owner)), ...busy.map(() => 'var(--line)')].slice(0, 3);
        return <Cell key={d} d={d} add={add} pick={setSel} className={`cell${d === t ? ' today' : ''}${d === sel ? ' sel' : ''}${d < t ? ' past' : ''}`} label={`${longDate(d)}, ${ev.length} Termine, lange drücken für neuen Termin`}>
          {i + 1}<span className="dots">{dots.map((c, j) => <i key={j} style={cvar(c)} />)}{bdOn(snap.birthdays, d).length > 0 && <i className="bdot" />}</span>
        </Cell>;
      })}
    </div>
    <div className="day-h"><span>{dayLabel(sel)}</span></div>
    <DayList snap={snap} d={sel} filter={filter} now={now} open={open} flash={flash} empty="small" add={add} />
  </>;
}
