import { avatarOf, boardImg } from '../lib/supabase';
import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import './display.css';
import { store } from '../lib/store';
import type { CalEvent, DisplayFeed, Member } from '../lib/types';
import { addDays, fromIso, hm, inDays, isoWeek, longDate, mondayOf, MON, nowMin, today, WD, WDS } from '../lib/dates';
import { bdOn, byTime, driveDone, dayOfN, depart, etaDriver, etaMin, leg2, liveMsgs, onDay, target, travel, upcoming, whenM, whenText } from '../lib/model';
import { cvar, Icon } from '../app/ui';
import { DisplayInput } from './DisplayInput';
import { DisplayEdit } from './DisplayEdit';

type Variant = 'bigme' | 'qm' | 'color' | 'eink' | 'mini' | 'hoch';
const variant = (): Variant => {
  const v = new URLSearchParams(location.search).get('v');
  if (v === 'bigme' || v === 'color' || v === 'eink' || v === 'mini' || v === 'hoch' || v === 'qm') return v;
  // Ohne Angabe: hochkant aufgehängter Bildschirm bekommt die Widget-Ansicht
  return innerHeight > innerWidth * 1.15 ? 'hoch' : 'qm';
};
// ?r=Sekunden in der Adresse setzt den Abruf-Takt (mindestens 5 Sekunden)
const refreshMs = (v: Variant) => {
  const r = Number(new URLSearchParams(location.search).get('r'));
  return r > 0 ? Math.max(5, r) * 1000 : v === 'eink' || v === 'bigme' ? 300000 : 60000;
};

// Das Flur-Display: lädt die Familiendaten über das geheime Token und aktualisiert sich jede Minute (oder nach ?r=)
export function Display({ token }: { token: string }) {
  const [feed, setFeed] = useState<DisplayFeed | null | undefined>(undefined);
  const [now, setNow] = useState(nowMin());
  const [day, setDay] = useState(today());
  const [detail, setDetail] = useState<CalEvent | null>(null);
  const [bdOpen, setBdOpen] = useState(false);
  const [input, setInput] = useState<'event' | 'board' | null>(null);
  const [editing, setEditing] = useState<CalEvent | null>(null);
  const [note, setNote] = useState('');
  // Pinnwand zeigt so viele Nachrichten, wie in die Spalte passen; der Rest wird als „+N weitere“ gezählt
  const [fitN, setFitN] = useState(99);
  const [wk, setWk] = useState(0);
  const [, setTick] = useState(0);
  // Nach dem Blättern kehrt die Ansicht nach einer Minute zu heute zurück
  useEffect(() => { if (!wk) return; const t = setTimeout(() => setWk(0), 60000); return () => clearTimeout(t); }, [wk]);
  useLayoutEffect(() => { setFitN(99); }, [feed]);
  useLayoutEffect(() => {
    const list = document.querySelector('.wys .w-msgs');
    const boxes = [list?.closest('.w-sec'), list?.closest('.w-col, .w-board, .t-board')].filter(Boolean) as HTMLElement[];
    const count = document.querySelectorAll('.wys .w-msgs .w-msg').length;
    if (count > 1 && boxes.some(b => b.scrollHeight > b.clientHeight + 2)) setFitN(count - 1);
  });
  useEffect(() => { const r = () => { setFitN(99); setTick(t => t + 1); }; addEventListener('resize', r); return () => removeEventListener('resize', r); }, []);
  const v = variant();

  useEffect(() => {
    document.title = 'FamTO · Display';
    const load = () => store.displayFeed(token).then(f => setFeed(f));
    void load();
    const t1 = setInterval(() => { setNow(nowMin()); setDay(today()); }, 20000);
    const t2 = setInterval(load, refreshMs(v));
    const off = store.demo ? store.subscribe(() => void load()) : () => {};
    return () => { clearInterval(t1); clearInterval(t2); off(); };
  }, [token, v]);

  if (feed === undefined) return <div className="wys full"><div className="w-empty" style={{ padding: '4cqw' }}>Lädt …</div></div>;
  if (feed === null) return <div className="wys full"><div className="w-empty" style={{ padding: '4cqw' }}>Dieses Display ist nicht (mehr) verbunden. Bitte die Adresse in der App unter Einstellungen → Displays prüfen.</div></div>;

  if (v === 'mini') return <Mini feed={feed} day={day} now={now} />;

  const s = feed.family.settings;
  const qm = v === 'qm' || v === 'bigme', big = v === 'bigme', eink = v === 'eink';
  const members = feed.members as Member[];
  const color = (id?: string | null) => members.find(m => m.id === id)?.color ?? '#7a8590';
  const ini = (id: string) => (members.find(m => m.id === id)?.name.replace(/^(Oma|Opa)\s+/, '')[0] ?? '?').toUpperCase();
  const nm = (id?: string | null) => members.find(m => m.id === id)?.name ?? '';
  const dayOf = (n: number) => addDays(day, n);
  const list = (d: string) => feed.events.filter(e => onDay(e, d)).sort(byTime);
  const morning = s.split > 0 && now < s.split;
  const fixed = s.boardMode === 'fixed';
  const hidePast = (e: CalEvent) => s.pastMode === 'hide' && !e.all_day && e.end_min <= now;
  const msgs = liveMsgs(feed.messages, s);

  const av = (id: string) => avatarOf(members.find(m => m.id === id));
  const sb = (id: string) => { const a = av(id); return <span key={id} className={`b${a ? ' av' : ''}`} style={cvar(color(id))}>{a ? <img src={a} alt="" /> : ini(id)}</span>; };
  const ad = (e: CalEvent, d: string) => <div key={e.id} className="w-ad" style={cvar(e.persons.length ? color(e.persons[0]) : '#7a8590')} onClick={() => setDetail(e)} role="button" tabIndex={0}><b>{e.title}</b><span className="lbl">ganztägig{e.end_date > e.date ? ` · ${dayOfN(e, d)}` : ''}</span></div>;
  const row = (e: CalEvent, past: boolean, noGo = false) => (
    <div key={e.id} className={`w-ev${past ? ' past' : ''}`} style={cvar(e.persons.length ? color(e.persons[0]) : '#7a8590')} onClick={() => setDetail(e)} role="button" tabIndex={0}>
      <time>{hm(e.start_min)}</time>
      <div><div className="tt">{e.title}</div>{e.driver && !(etaMin(e) === null && driveDone(e)) && <div className="dr"><Icon name="car" /> {nm(e.driver)} {etaMin(e) !== null ? <>fährt · <b>Ankunft {hm(etaMin(e)!)}</b></> : <>fährt{travel(e, s) && !noGo ? <> · <b>los {hm(depart(e, s))}</b></> : null}</>}{e.place ? ` · ${e.place}` : ''}</div>}</div>
      <span className="wb">{e.persons.map(sb)}</span>
    </div>
  );
  const bdRow = (d: string) => bdOn(feed.birthdays, d).map(b => <div key={b.id} className="w-bd" onClick={() => setBdOpen(true)} role="button" tabIndex={0}><Icon name="cake" /><span><b>{b.name}</b> hat Geburtstag{b.age ? ` und wird ${b.age}` : ''}</span></div>);

  // Heute mit Jetzt-Linie und Abfahrtszeilen
  const todayList = (() => {
    const l = list(day), out: ReactNode[] = [...bdRow(day), ...l.filter(e => e.all_day).map(e => ad(e, day))];
    let placed = false;
    for (const e of l.filter(x => !x.all_day && !hidePast(x))) {
      const past = e.end_min <= now;
      if (!past && !placed) { out.push(<div key="now" className="nowline">Jetzt {eink ? '' : hm(now)}</div>); placed = true; }
      const eta = etaMin(e);
      const l2 = leg2(e, s);
      if (eta !== null && e.end_min + 30 > now) {
        out.push(<div key={`go${e.id}`} className="w-go soon" style={cvar(color(etaDriver(e)))}><time>{hm(eta)}</time>
          <div className="w-go-bar" style={{ ['--p' as string]: '100%' }}><Icon name="car" /><span>{nm(etaDriver(e))} fährt · Ankunft</span></div></div>);
      } else if (l2 && e.start_min <= now && l2.at > now) {
        const gone = l2.leave <= now;
        out.push(<div key={`go2${e.id}`} className={`w-go${gone ? ' gone' : l2.leave - now <= 30 ? ' soon' : ''}`} style={cvar(color(l2.who))}><time>{hm(l2.leave)}</time>
          <div className="w-go-bar" style={{ ['--p' as string]: '100%' }}><Icon name="car" /><span>{nm(l2.who)} holt ab · {travel(e, s)} Min.</span></div></div>);
      } else if (travel(e, s) && target(e) > now) {
        const dep = depart(e, s), gone = dep <= now;
        out.push(<div key={`go${e.id}`} className={`w-go${gone ? ' gone' : dep - now <= 30 ? ' soon' : ''}`} style={cvar(color(e.driver))}><time>{hm(dep)}</time>
          <div className="w-go-bar" style={{ ['--p' as string]: `${Math.round(100 * travel(e, s) / (travel(e, s) + s.buffer))}%` }}><Icon name="car" /><span>{nm(e.driver)} {gone ? 'ist unterwegs' : e.trip === 'ab' ? 'holt ab' : 'fährt los'} · {travel(e, s)} Min.</span></div></div>);
      }
      out.push(row(e, past, true));
    }
    const hidden = l.filter(hidePast).length;
    if (!l.length && !bdOn(feed.birthdays, day).length) return [<div key="e" className="w-empty">Heute keine Familientermine</div>];
    if (hidden && hidden === l.length && !bdOn(feed.birthdays, day).length) return [<div key="e" className="w-empty">Heute keine weiteren Familientermine</div>];
    return out;
  })();
  const dayList = (d: string) => { const l = list(d); return [...bdRow(d), ...(l.length ? l.map(e => e.all_day ? ad(e, d) : row(e, false)) : [<div key="f" className="w-empty">Frei</div>])]; };
  const compact = (from: number, to: number) => {
    const out: ReactNode[] = [];
    for (let n = from; n <= to; n++) {
      const d = dayOf(n), l = list(d).filter(e => !(e.all_day && e.date < d)), x = fromIso(d);
      out.push(<div key={d}><b>{WDS[x.getDay()]} {x.getDate()}.</b><span>{l.length ? l.map(e => `${e.all_day ? '' : hm(e.start_min) + ' '}${e.title}${e.all_day || !e.persons.length ? '' : ` (${e.persons.map(ini).join('')})`}`).join(' · ') : '–'}</span></div>);
    }
    return out;
  };
  const board = (_max: number) => {
    const n = fitN;
    const shown = msgs.slice(0, n);
    const head = <h3>Board{msgs.length > n && <span className="w-more">+{msgs.length - n} weitere</span>}</h3>;
    const body = shown.length ? shown.map(m => <div key={m.id} className="w-msg">{sb(m.from_member)}<span>{m.text}{m.image && <img className="w-img" src={boardImg(m.image)} alt="" />}{m.taker ? <b> · übernimmt {nm(m.taker)}</b> : m.replies.length ? <b> · {nm(m.replies.at(-1)!.from_member)}: {m.replies.at(-1)!.text}</b> : null}</span>
      {m.pinned ? <small className="pinned" title="angeheftet"><Icon name="pin" /></small> : <small>{whenM(m)}</small>}</div>) : <div className="w-empty">Keine Nachrichten</div>;
    return <div className="w-sec">{head}<div className="w-msgs">{body}</div></div>;
  };

  // Hinweis oben: nächste Abfahrt oder nächster Termin
  let next: ReactNode = <div />;
  const today0 = list(day);
  const onWay = today0.find(e => etaMin(e) !== null && e.end_min + 30 > now);
  const goNext = today0.find(e => etaMin(e) === null && travel(e, s) && depart(e, s) > now && depart(e, s) - now <= 45);
  const nx = today0.find(e => !e.all_day && e.start_min > now);
  if (onWay) next = <div className="w-next go"><Icon name="car" /><div><strong>{nm(etaDriver(onWay))} fährt:</strong> {onWay.title} · Ankunft ca. {hm(etaMin(onWay)!)}</div></div>;
  else if (goNext) next = <div className="w-next go"><Icon name="car" /><div><strong>{eink ? `Um ${hm(depart(goNext, s))}` : `In ${depart(goNext, s) - now} Min.`} losfahren:</strong> {nm(goNext.driver)} fährt{goNext.persons.length ? ` ${goNext.persons.map(nm).join(', ')}` : ''} · {goNext.title} · {travel(goNext, s)} Min. Fahrt</div></div>;
  else if (nx && nx.start_min - now <= 90) next = <div className="w-next"><Icon name="clock" /><div><strong>{eink ? `Um ${hm(nx.start_min)}` : `In ${nx.start_min - now} Min.`}:</strong> {nx.persons.length ? `${nx.persons.map(nm).join(', ')} · ` : ''}{nx.title}{nx.driver ? <> · <strong>{nm(nx.driver)} fährt</strong></> : null}</div></div>;

  const cakes = s.bdLead > 0 ? upcoming(feed.birthdays).filter(b => b.days <= s.bdLead) : [];
  const H = (n: number) => `${n === 0 ? 'Heute' : n === 1 ? 'Morgen' : 'Übermorgen'} · ${WD[fromIso(dayOf(n)).getDay()]}`;

  let main: ReactNode;
  if (morning) {
    main = <div className={`w-main morning${qm ? ' qm' : ''}`}>
      <div className="w-col"><div className="w-sec"><h3>{H(0)}</h3><div className="w-list">{todayList}</div></div></div>
      <div className="w-col">{board(qm ? 5 : 3)}<div className="w-later"><Icon name="clock" /><span>Ab {hm(s.split)} Uhr: {s.ahead === 1 ? 'Vorschau auf morgen' : `Vorschau auf ${s.ahead} Tage`}</span></div></div>
    </div>;
  } else if (fixed) {
    const n = qm && s.ahead > 1 ? 3 : 2;
    main = <div className={`w-main fixboard${qm ? ' qm' : ''}`}>
      <div className="w-days"><div className={`w-dcols c${n}`}>
        <div className="w-col"><div className="w-sec"><h3>{H(0)}</h3><div className="w-list">{todayList}</div></div></div>
        {Array.from({ length: n - 1 }, (_, i) => <div key={i} className="w-col"><div className="w-sec"><h3>{H(i + 1)}</h3><div className="w-list">{dayList(dayOf(i + 1))}</div></div></div>)}
      </div>{s.ahead >= n && <div className="w-strip">{compact(n, Math.min(s.ahead, n + 3)).map((x, i) => <div key={i}>{x}</div>)}</div>}</div>
      <div className="w-board">{board(6)}</div>
    </div>;
  } else if (qm) {
    const three = s.ahead > 1;
    main = <div className={`w-main qm ${three ? 'days3' : 'days2'}`}>
      <div className="w-col"><div className="w-sec"><h3>{H(0)}</h3><div className="w-list">{todayList}</div></div></div>
      <div className="w-col"><div className="w-sec"><h3>{H(1)}</h3><div className="w-list">{dayList(dayOf(1))}</div></div></div>
      {three && <div className="w-col"><div className="w-sec"><h3>{H(2)}</h3><div className="w-list">{dayList(dayOf(2))}</div></div></div>}
      <div className="w-col side">
        {s.ahead >= 3 && <div className="w-sec"><h3>Weitere Tage</h3><div className="w-week">{compact(3, s.ahead)}</div></div>}
        {board(big ? 2 : s.ahead > 6 ? 2 : 3)}
      </div>
    </div>;
  } else {
    main = <div className="w-main days2">
      <div className="w-col"><div className="w-sec"><h3>{H(0)}</h3><div className="w-list">{todayList}</div></div></div>
      <div className="w-col"><div className="w-sec"><h3>{H(1)}</h3><div className="w-list">{dayList(dayOf(1))}</div></div></div>
      <div className="w-col side">
        {s.ahead >= 2 && <div className="w-sec"><h3>Nächste Tage</h3><div className="w-week">{compact(2, Math.min(s.ahead, 4))}</div></div>}
        {board(s.ahead > 3 ? 1 : 2)}
      </div>
    </div>;
  }

  const overlays = <>
      {input && <DisplayInput token={token} feed={feed} mode={input} close={() => setInput(null)}
        saved={m => { setInput(null); setNote(m); setTimeout(() => setNote(''), 4000); void store.displayFeed(token).then(f => setFeed(f)); }} />}
      {note && <div className="w-toast">{note}</div>}
      {detail && <div className="w-ov" onClick={e => { if (e.target === e.currentTarget) setDetail(null); }}><div className="w-card" style={cvar(color(detail.persons[0]))} role="dialog" aria-label="Termindetails">
        <h4>{detail.title}</h4>
        <div className="r"><span>Wann</span><div>{whenText(detail)}</div></div>
        {detail.persons.length > 0 && <div className="r"><span>Wer</span><div><span className="wb">{detail.persons.map(sb)}</span> {detail.persons.map(nm).join(', ')}</div></div>}
        {detail.driver && <div className="r"><span>Fahrdienst</span><div>{nm(detail.driver)} {etaMin(detail) !== null ? `fährt · Ankunft ca. ${hm(etaMin(detail)!)}` : `fährt${travel(detail, s) ? ` · los um ${hm(depart(detail, s))}` : ''}`}</div></div>}
        {(detail.place || detail.addr) && <div className="r"><span>Ort</span><div>{detail.place}{detail.place && detail.addr ? <br /> : null}{detail.addr && <small style={{ color: 'var(--screen-muted)' }}>{detail.addr}</small>}</div></div>}
        {detail.bring.length > 0 && <div className="r"><span>Mitbringen</span><div>{detail.bring.join(', ')}</div></div>}
        {detail.notes && <div className="r"><span>Notiz</span><div>{detail.notes}</div></div>}
        <div className="w-card-btns">{feed.touch && <button type="button" className="w-edit-btn" onClick={() => { setEditing(detail); setDetail(null); }}>Bearbeiten</button>}
          <button type="button" onClick={() => setDetail(null)}>Schließen</button></div>
      </div></div>}
      {editing && <DisplayEdit token={token} feed={feed} ev={editing} close={() => setEditing(null)}
        saved={m => { setEditing(null); setNote(m); setTimeout(() => setNote(''), 4000); void store.displayFeed(token).then(f => setFeed(f)); }} />}
      {bdOpen && <div className="w-ov" onClick={e => { if (e.target === e.currentTarget) setBdOpen(false); }}><div className="w-card" style={cvar('#c9640f')} role="dialog" aria-label="Nächste Geburtstage">
        <h4>Nächste Geburtstage</h4>
        <div className="bdl">{upcoming(feed.birthdays).slice(0, 5).map(b => <div key={b.id} className={`bdr${b.days <= s.bdLead ? ' soon' : ''}`}><div><b>{b.name}</b><small>{b.day}. {MON[b.month - 1]}{b.age ? ` · wird ${b.age}` : ''}</small></div><span className="dd">{inDays(b.days)}</span></div>)}</div>
        <button type="button" onClick={() => setBdOpen(false)}>Schließen</button>
      </div></div>}
  </>;
  const tall = v === 'hoch';
  if (tall) {
    // Hochkant wie das Handy-Widget: Tage untereinander, Board, unten Geburtstage, Kalenderwoche und Eingabe
    const start = wk === 0 ? day : addDays(mondayOf(day), 7 * wk);
    const n = wk === 0 ? Math.max(3, Math.min(s.ahead + 1, 7)) : 7;
    const lbl = (d: string) => { const k = d === day ? 'Heute' : d === addDays(day, 1) ? 'Morgen' : d === addDays(day, 2) ? 'Übermorgen' : ''; const x = fromIso(d); return k ? `${k} · ${WD[x.getDay()]}` : `${WD[x.getDay()]} ${x.getDate()}. ${MON[x.getMonth()]}`; };
    const tev = (e: CalEvent, d: string) => {
      const past = d === day && !e.all_day && e.end_min <= now;
      if (d === day && hidePast(e)) return null;
      return <div key={e.id + d} className={`t-ev${past ? ' past' : ''}`} style={cvar(e.persons.length ? color(e.persons[0]) : '#7a8590')} onClick={() => setDetail(e)} role="button" tabIndex={0}>
        <time>{e.all_day ? 'ganzt.' : hm(e.start_min)}</time>
        <div className="tt"><b>{e.title}</b>{e.driver && !(etaMin(e) === null && driveDone(e)) ? <small> · {nm(e.driver)} {etaMin(e) !== null ? `fährt · Ankunft ${hm(etaMin(e)!)}` : `fährt${travel(e, s) && d === day && !past ? ` · los ${hm(depart(e, s))}` : ''}`}</small> : e.place ? <small> · {e.place}</small> : null}</div>
        <span className="wb">{e.persons.map(sb)}</span></div>;
    };
    const days = Array.from({ length: n }, (_, i) => addDays(start, i)).map(d => {
      const l = list(d), bds = bdOn(feed.birthdays, d), rows = l.map(e => tev(e, d)).filter(Boolean);
      if (!rows.length && !bds.length && d !== day && wk === 0 && d !== addDays(day, 1)) return null;
      if (!rows.length && !bds.length && wk !== 0) return <div key={d} className="t-day free"><h3>{lbl(d)} <span>frei</span></h3></div>;
      return <div key={d} className="t-day"><h3>{lbl(d)}</h3>
        {bds.map(b => <div key={b.id} className="t-ev bd" style={cvar('#c2477a')} onClick={() => setBdOpen(true)} role="button" tabIndex={0}><time><Icon name="cake" /></time><div className="tt"><b>{b.name}</b><small> hat Geburtstag{b.age ? ` · wird ${b.age}` : ''}</small></div></div>)}
        {rows.length ? rows : !bds.length && <div className="w-empty">{d === day && l.length ? 'Keine weiteren Familientermine' : 'Keine Familientermine'}</div>}</div>;
    });
    const shown = msgs.slice(0, fitN);
    const touch = feed.touch;
    return (
      <div className={`wys full tall${!s.wbg ? ' dark' : ''}`} style={s.wbg ? { background: s.wbg } : undefined}>
        <div className="t-head"><h2>{longDate(day)}</h2><div className="clock">{hm(now)}</div></div>
        <div className="t-days">{days}</div>
        <div className="t-board"><div className="w-sec"><h3>Board{msgs.length > fitN && <span className="w-more">+{msgs.length - fitN} weitere</span>}</h3><div className="w-msgs">
          {shown.length ? shown.map(m => <div key={m.id} className="w-msg">{sb(m.from_member)}<span>{m.pinned && <Icon name="pin" />} {m.text}{m.taker ? <b> · übernimmt {nm(m.taker)}</b> : m.replies.length ? <b> · {nm(m.replies.at(-1)!.from_member)}: {m.replies.at(-1)!.text}</b> : null}</span><small>{nm(m.from_member)} · {whenM(m)}</small></div>) : <div className="w-empty">Keine Nachrichten</div>}
        </div></div></div>
        <div className="t-bar">
          <button type="button" className="t-ring b" onClick={() => setBdOpen(true)} aria-label="Geburtstage">B</button>
          <div className="t-kw"><button type="button" onClick={() => setWk(w => w - 1)} aria-label="Woche zurück">◀</button>
            <button type="button" className="t-ring kw" onClick={() => setWk(0)} aria-label="Zurück zu heute">KW {isoWeek(wk === 0 ? day : start)}</button>
            <button type="button" onClick={() => setWk(w => w + 1)} aria-label="Woche vor">▶</button></div>
          {touch ? <div className="t-kw"><button type="button" className="t-ring" onClick={() => setInput('board')} aria-label="Board-Nachricht">✎</button><button type="button" className="t-ring" onClick={() => setInput('event')} aria-label="Neuer Termin">＋</button></div> : <span className="t-ring ghost" />}
        </div>
        {overlays}
      </div>
    );
  }

  return (
    <div className={`wys full${!eink && !big && !s.wbg ? ' dark' : ''}${eink ? ' eink' : ''}${qm ? ' qm' : ''}${big ? ' kal' : ''}`} style={s.wbg ? { background: s.wbg } : undefined}>
      <div className="w-head"><h2>{longDate(day)}</h2>
        {cakes.length > 0 && <div className="w-cakes">{cakes.map(b => <button key={b.id} type="button" className="w-cake" onClick={() => setBdOpen(true)}>{b.days === 0 ? 'Heute' : b.days}<Icon name="cake" /><small>{b.name}</small></button>)}</div>}
        <div><div className="clock">{eink ? '' : hm(now)}</div><div className="sub">{feed.family.name}</div></div></div>
      {next}
      {main}
      <div className="w-foot">{feed.touch && !eink ? <span className="w-add"><button type="button" className="w-addbtn" onClick={() => setInput('event')}>＋ Termin</button><button type="button" className="w-addbtn board" onClick={() => setInput('board')}>✎ Board</button></span> : <span>Termin antippen für Details</span>}<span>Nur Familientermine{morning ? ' · Tagesansicht' : ''}</span></div>
      {overlays}
    </div>
  );
}

// Kleine Ansicht für Handy-Widgets (z. B. über eine Web-Widget-App): heutige Familientermine und Pinnwand
function Mini({ feed, day, now }: { feed: DisplayFeed; day: string; now: number }) {
  const s = feed.family.settings;
  const members = feed.members as Member[];
  const color = (id?: string | null) => members.find(m => m.id === id)?.color ?? '#7a8590';
  const nm = (id?: string | null) => members.find(m => m.id === id)?.name ?? '';
  const evs = feed.events.filter(e => onDay(e, day)).sort(byTime).filter(e => !(s.pastMode === 'hide' && !e.all_day && e.end_min <= now));
  const msgs = liveMsgs(feed.messages, s);
  const d = fromIso(day);
  return (
    <div className="mini">
      <div className="mini-h"><b>Heute</b><span>{WDS[d.getDay()]} {d.getDate()}. {MON[d.getMonth()]}</span></div>
      {evs.length === 0 && <div className="mini-empty">Keine Familientermine</div>}
      {evs.map(e => (
        <div key={e.id} className={`mini-ev${!e.all_day && e.end_min <= now ? ' past' : ''}`} style={cvar(e.persons.length ? color(e.persons[0]) : '#7a8590')}>
          <time>{e.all_day ? 'ganzt.' : hm(e.start_min)}</time>
          <span className="t">{e.title}{e.driver && !(etaMin(e) === null && driveDone(e)) ? <small> · {nm(e.driver)} fährt</small> : null}</span>
        </div>
      ))}
      <div className="mini-h board"><b>Board</b>{msgs.length > 0 && <span>{msgs.length}</span>}</div>
      {msgs.length === 0 && <div className="mini-empty">Keine Nachrichten</div>}
      {msgs.map(m => (
        <div key={m.id} className="mini-msg" style={cvar(color(m.from_member))}>
          {m.pinned && <Icon name="pin" />}<span>{m.text}{m.image && <img className="w-img" src={boardImg(m.image)} alt="" />}</span><small>{nm(m.from_member)}</small>
        </div>
      ))}
    </div>
  );
}
