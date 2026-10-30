import { useEffect, useState } from 'react';
import { useSnapshot } from '../lib/store';
import { micStart } from '../lib/micstart';
import type { BusySlot, CalEvent, Snapshot } from '../lib/types';
import { addDays, dayLabel, fromIso, hm, isoWeek, longDate, MON, mondayOf, nowMin, today, WDS } from '../lib/dates';
import { bdOn, colorOf, depart, nameOf, travel, upcoming, visibleOnDay } from '../lib/model';
import type { Draft } from '../lib/parse';
import { Badge, Badges, cvar, Icon } from './ui';
import { useToast } from './toast';
import { Board } from './Board';
import { Settings } from './Settings';
import { MicSheet } from './MicSheet';
import { EventSheet } from './EventSheet';
import { DetailSheet, BdaySheet } from './DetailSheet';
import { PushBanner } from './PushBanner';

type Tab = 'today' | 'week' | 'board' | 'settings';
type Filter = 'all' | 'family' | 'mine';
export type SheetState = { kind: 'mic' } | { kind: 'edit'; draft: Draft; fresh: boolean } | { kind: 'detail'; id: string } | { kind: 'bdays' } | null;

// Uhr, die jede Minute neu zeichnet (für „vorbei“, „los in X Min.“)
export function useMinute() {
  const [, set] = useState(0);
  useEffect(() => { const t = setInterval(() => set(x => x + 1), 30000); return () => clearInterval(t); }, []);
  return nowMin();
}

export function Shell() {
  const snap = useSnapshot();
  const [tab, setTab] = useState<Tab>('today');
  const [filter, setFilter] = useState<Filter>('all');
  const [sheet, setSheet] = useState<SheetState>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const toastMsg = useToast();
  const now = useMinute();
  const me = snap.members.find(m => m.id === snap.me)!;
  const s = snap.family!.settings;
  const next = upcoming(snap.birthdays)[0];
  const cake = next && s.bdLead > 0 && next.days <= s.bdLead ? next : null;
  const titles: Record<Tab, string> = { today: 'Heute', week: 'Kalender', board: 'Pinnwand', settings: 'Einstellungen' };
  const open = (id: string) => setSheet({ kind: 'detail', id });
  const saved = (id: string) => { setFlash(id); setTimeout(() => setFlash(null), 4000); };

  // Schnellstart: ?mic=1 (Verknüpfung) oder Geräte-Einstellung öffnet beim Start und beim Zurückkehren sofort die Spracheingabe
  useEffect(() => {
    if (me.role === 'guest') return;
    const q = new URLSearchParams(location.search);
    if (q.has('mic')) { history.replaceState(null, '', location.pathname + location.hash); setSheet({ kind: 'mic' }); }
    else if (micStart()) setSheet({ kind: 'mic' });
    const onShow = () => { if (document.visibilityState === 'visible' && micStart()) setSheet(x => x ?? { kind: 'mic' }); };
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  }, [me.role]);

  return (
    <div className="screen" style={me.app_bg ? { background: me.app_bg } : undefined}>
      <div className="ph-head">
        <div><small>{snap.family!.name}</small><strong>{titles[tab]}</strong></div>
        <span className="head-r">
          {cake && <button type="button" className="cake" onClick={() => setSheet({ kind: 'bdays' })} aria-label={`Nächster Geburtstag ${cake.days === 0 ? 'heute' : `in ${cake.days} Tagen`}`}>{cake.days === 0 ? 'Heute' : cake.days}<Icon name="cake" /></button>}
          <span className="me"><Badge m={me} /></span>
        </span>
      </div>
      {(tab === 'today' || tab === 'week') && (
        <div className="seg filter" role="group" aria-label="Filter">
          {([['all', 'Alle'], ['family', 'Familie'], ['mine', 'Nur ich']] as [Filter, string][]).map(([k, l]) =>
            <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}
        </div>
      )}
      <div className={`ph-body${tab === 'today' ? ' today' : ''}`}>
        {tab === 'today' && <TodayTab snap={snap} filter={filter} now={now} open={open} flash={flash} />}
        {tab === 'week' && <CalendarTab snap={snap} filter={filter} now={now} open={open} flash={flash} />}
        {tab === 'board' && <Board />}
        {tab === 'settings' && <Settings />}
      </div>
      <nav className="tabs" aria-label="Bereiche">
        <TabBtn on={tab === 'today'} icon="today" label="Heute" go={() => setTab('today')} />
        <TabBtn on={tab === 'week'} icon="week" label="Kalender" go={() => setTab('week')} />
        {me.role === 'guest'
          ? <span />
          : <button type="button" className="mic" aria-label="Termin oder Nachricht sprechen" onClick={() => setSheet({ kind: 'mic' })}><Icon name="mic" /></button>}
        <TabBtn on={tab === 'board'} icon="board" label="Pinnwand" go={() => setTab('board')} />
        <TabBtn on={tab === 'settings'} icon="gear" label="Einstellungen" go={() => setTab('settings')} />
      </nav>
      {sheet?.kind === 'mic' && <MicSheet close={() => setSheet(null)} toDraft={(draft) => setSheet({ kind: 'edit', draft, fresh: true })} posted={() => { setSheet(null); setTab('board'); }} />}
      {sheet?.kind === 'edit' && <EventSheet draft={sheet.draft} fresh={sheet.fresh} close={() => setSheet(null)} back={() => setSheet({ kind: 'mic' })} saved={(id) => { setSheet(null); saved(id); }} />}
      {sheet?.kind === 'detail' && <DetailSheet id={sheet.id} close={() => setSheet(null)} edit={(draft) => setSheet({ kind: 'edit', draft, fresh: false })} />}
      {sheet?.kind === 'bdays' && <BdaySheet close={() => setSheet(null)} />}
      <PushBanner now={now} />
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </div>
  );
}

function TabBtn({ on, icon, label, go }: { on: boolean; icon: 'today' | 'week' | 'board' | 'gear'; label: string; go: () => void }) {
  return <button type="button" aria-pressed={on} onClick={go}><Icon name={icon} />{label}</button>;
}

/* ---------- Terminkarte ---------- */
export function EvCard({ e, d, snap, now, open, flash }: { e: CalEvent; d: string; snap: Snapshot; now: number; open: (id: string) => void; flash?: string | null }) {
  const s = snap.family!.settings;
  const isToday = d === today();
  const past = isToday && !e.all_day && e.end_min <= now;
  const tag = e.vis === 'family' ? <span className="vis-tag family"><Icon name="home" /> Familie</span>
    : e.vis === 'busy' ? <span className="vis-tag busy"><Icon name="lock" /> Privat, Familie sieht „belegt“</span>
    : <span className="vis-tag private"><Icon name="lock" /> Privat</span>;
  const tr = travel(e, s), dep = depart(e, s);
  const soon = tr && isToday && dep > now && dep - now <= 30;
  return (
    <div className={`ev${e.vis === 'family' ? '' : ' private'}${past ? ' past' : ''}${flash === e.id ? ' isnew' : ''}`} style={cvar(colorOf(snap.members, e.persons[0] ?? e.owner))}
      data-ev role="button" tabIndex={0} onClick={() => open(e.id)} onKeyDown={k => { if (k.key === 'Enter') open(e.id); }} aria-label={`${e.title}, Details öffnen`}>
      <Time e={e} d={d} />
      <div style={{ minWidth: 0 }}>
        <div className="t"><span>{e.title}</span></div>
        <div className="meta">
          {e.persons.length > 0 && <Badges ids={e.persons} members={snap.members} />}
          {tag}
          {e.driver && <span><Icon name="car" /> {nameOf(snap.members, e.driver)} fährt</span>}
          {e.place && <span className="pl">{e.place}</span>}
        </div>
        {tr > 0 && !(isToday && e.start_min <= now) && (
          <div className={`go${soon ? ' soon' : ''}`}><Icon name="car" /><b>{soon ? `In ${dep - now} Min. losfahren` : `Los um ${hm(dep)}`}</b><span>ca. {tr} Min. Fahrt{s.buffer ? ` + ${s.buffer} Min. Puffer` : ''}</span></div>
        )}
      </div>
    </div>
  );
}

function Time({ e, d }: { e: Pick<CalEvent, 'all_day' | 'date' | 'end_date' | 'start_min' | 'end_min'>; d: string }) {
  if (e.all_day) return <time className="ad">ganz&shy;tägig{e.end_date > e.date ? <span>{`Tag ${Math.round((fromIso(d).getTime() - fromIso(e.date).getTime()) / 864e5) + 1}/${Math.round((fromIso(e.end_date).getTime() - fromIso(e.date).getTime()) / 864e5) + 1}`}</span> : null}</time>;
  return <time>{hm(e.start_min)}<span>{hm(e.end_min)}</span></time>;
}

function BusyCard({ b, d, snap, now }: { b: BusySlot; d: string; snap: Snapshot; now: number }) {
  const past = d === today() && !b.all_day && b.end_min <= now;
  return (
    <div className={`ev busy${past ? ' past' : ''}`}>
      <Time e={b} d={d} />
      <div><div className="t"><Badge m={snap.members.find(m => m.id === b.owner)} /><span>{nameOf(snap.members, b.owner)} ist belegt</span></div>
        <div className="meta"><span className="vis-tag busy"><Icon name="lock" /> belegt</span><span>Details privat</span></div></div>
    </div>
  );
}

function DayList({ snap, d, filter, now, open, flash, empty }: { snap: Snapshot; d: string; filter: Filter; now: number; open: (id: string) => void; flash: string | null; empty: 'big' | 'small' }) {
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
        : <div className="empty smile"><Icon name="smile" />Frei</div>}
  </>;
}

function TodayTab({ snap, filter, now, open, flash }: { snap: Snapshot; filter: Filter; now: number; open: (id: string) => void; flash: string | null }) {
  const t = today();
  const n = visibleOnDay(snap.events, snap.busy, t, snap.me, filter).ev.length;
  return <>
    <div className="day-h"><span>{longDate(t)}</span><span>{n ? `${n} ${n === 1 ? 'Termin' : 'Termine'}` : ''}</span></div>
    <DayList snap={snap} d={t} filter={filter} now={now} open={open} flash={flash} empty="big" />
  </>;
}

function CalendarTab({ snap, filter, now, open, flash }: { snap: Snapshot; filter: Filter; now: number; open: (id: string) => void; flash: string | null }) {
  const [view, setView] = useState<'week' | 'month'>('week');
  const [wk, setWk] = useState(0), [mo, setMo] = useState(0);
  const [sel, setSel] = useState(today());
  const t = today();
  const seg = <div className="seg" role="group" aria-label="Ansicht">
    {([['week', 'Woche'], ['month', 'Monat']] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)}>{l}</button>)}
  </div>;
  if (view === 'week') {
    const mon = addDays(mondayOf(t), wk * 7), sun = addDays(mon, 6);
    const days = Array.from({ length: 7 }, (_, i) => addDays(mon, i)).filter(d => wk !== 0 || d >= t);
    return <>
      {seg}
      <div className="calnav">
        <button type="button" className="nav" aria-label="Vorige Woche" onClick={() => setWk(wk - 1)}>‹</button>
        <div className="ttl">KW {isoWeek(mon)}<small>{fromIso(mon).getDate()}. {MON[fromIso(mon).getMonth()].slice(0, 3)} – {fromIso(sun).getDate()}. {MON[fromIso(sun).getMonth()].slice(0, 3)}</small></div>
        <button type="button" className="nav" aria-label="Nächste Woche" onClick={() => setWk(wk + 1)}>›</button>
      </div>
      {wk !== 0 && <button type="button" className="todaybtn" onClick={() => setWk(0)}>Diese Woche</button>}
      {days.map(d => <div key={d} style={{ display: 'grid', gap: 8 }}>
        <div className="day-h"><span>{dayLabel(d)}</span></div>
        <DayList snap={snap} d={d} filter={filter} now={now} open={open} flash={flash} empty="small" />
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
      <button type="button" className="nav" aria-label="Voriger Monat" onClick={() => setMo(mo - 1)}>‹</button>
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
        return <button key={d} type="button" className={`cell${d === t ? ' today' : ''}${d === sel ? ' sel' : ''}${d < t ? ' past' : ''}`} onClick={() => setSel(d)} aria-label={`${longDate(d)}, ${ev.length} Termine`}>
          {i + 1}<span className="dots">{dots.map((c, j) => <i key={j} style={cvar(c)} />)}{bdOn(snap.birthdays, d).length > 0 && <i className="bdot" />}</span>
        </button>;
      })}
    </div>
    <div className="day-h"><span>{dayLabel(sel)}</span></div>
    <DayList snap={snap} d={sel} filter={filter} now={now} open={open} flash={flash} empty="small" />
  </>;
}
