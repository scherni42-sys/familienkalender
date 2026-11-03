import type { Birthday, CalEvent, Snapshot } from '../lib/types';
import { addDays, dayLabel, hm, longDate, today } from '../lib/dates';
import { bdOn, colorOf, depart, etaDriver, etaMin, liveMsgs, nameOf, target, travel, visibleOnDay, whenM } from '../lib/model';
import { flightShort, useFlight } from '../lib/flight';
import { Badge, cvar, Icon } from './ui';

// Startseite der App im Aussehen des Handy-Widgets: Heute, Morgen, Board auf dunklem Grund
type Filter = 'all' | 'family' | 'home';
type Go = { open: (id: string, day: string) => void; bday: (id: string) => void; add: (day: string) => void; msg: (id: string) => void };

// Geburtstagsfarbe wie im Widget: private in der Farbe des Besitzers, gemeinsame in Torten-Gold
const bdColor = (snap: Snapshot, b: Birthday) => b.owner ? colorOf(snap.members, b.owner) : '#D9A441';

function Flight({ e }: { e: CalEvent }) {
  const { flight } = useFlight(e);
  const txt = flight ? flightShort(flight) : '';
  return txt ? <div className={`wv-sub${flight!.canceled || (flight!.dep?.delay ?? 0) >= 15 ? ' bad' : ''}`}>✈ {txt}</div> : null;
}

function Row({ e, d, snap, now, go }: { e: CalEvent; d: string; snap: Snapshot; now: number; go: Go }) {
  const s = snap.family!.settings;
  const isToday = d === today();
  const past = isToday && !e.all_day && e.end_min <= now;
  const nm = (id?: string | null) => nameOf(snap.members, id ?? '');
  const eta = e.driver || e.driver2 ? etaMin(e) : null;
  const arrived = eta === null && !!e.arrived_at && e.trip !== 'beides';
  const tr = travel(e, s), dep = depart(e, s);
  let drive = '', soon = false;
  if (eta !== null) drive = `${nm(etaDriver(e))} fährt · Ankunft ${hm(eta)}`;
  else if (e.driver && !arrived) {
    const go = isToday && !e.all_day && tr > 0 && target(e) > now;
    soon = go && dep > now && dep - now <= 30;
    drive = `${nm(e.driver)} ${e.trip === 'ab' ? 'holt ab' : e.trip === 'beides' ? 'bringt' : 'fährt'}${go ? ` · los ${hm(dep)}` : ''}${e.trip === 'beides' && e.driver2 ? ` · ${nm(e.driver2)} holt ab` : ''}`;
  }
  return (
    <div className={`wv-row${past ? ' past' : ''}`} style={cvar(colorOf(snap.members, e.persons[0] ?? e.owner))} role="button" tabIndex={0}
      onClick={() => go.open(e.id, d)} onKeyDown={k => { if (k.key === 'Enter') go.open(e.id, d); }}>
      <i className="wv-bar" />
      <time>{e.all_day ? 'ganzt.' : hm(e.start_min)}</time>
      <div className="wv-txt">
        <div className="wv-t">{e.vis !== 'family' && <Icon name="lock" />}<span>{e.title}</span>{e.files?.length ? <Icon name="clip" /> : null}</div>
        <Flight e={e} />
        {drive ? <div className={`wv-sub${soon ? ' soon' : ''}`}><Icon name="car" /> {drive}</div>
          : e.place ? <div className="wv-sub">{e.place}</div> : null}
      </div>
    </div>
  );
}

function Day({ d, snap, filter, now, go }: { d: string; snap: Snapshot; filter: Filter; now: number; go: Go }) {
  const s = snap.family!.settings;
  const isToday = d === today();
  const { ev } = visibleOnDay(snap.events, snap.busy, d, snap.me, filter);
  const list = ev.filter(e => !(s.pastMode === 'hide' && isToday && !e.all_day && e.end_min <= now))
    .sort((a, b) => a.all_day === b.all_day ? a.start_min - b.start_min : a.all_day ? -1 : 1);
  const bds = bdOn(snap.birthdays, d);
  return <>
    {bds.map(b => <div key={b.id} className="wv-row" style={cvar(bdColor(snap, b))} role="button" tabIndex={0} onClick={() => go.bday(b.id)}>
      <i className="wv-bar" /><time>Geb.</time>
      <div className="wv-txt"><div className="wv-t"><Icon name="cake" />{b.owner && <Icon name="lock" />}<span>{b.name}{b.age ? ` wird ${b.age}` : ''}</span></div></div>
    </div>)}
    {list.map(e => <Row key={e.id} e={e} d={d} snap={snap} now={now} go={go} />)}
    {!list.length && !bds.length && <button type="button" className="wv-note" onClick={() => go.add(d)}>{isToday ? 'Keine Termine mehr' : 'Keine Termine'} · <b>＋ Termin</b></button>}
  </>;
}

export function WidgetView({ snap, filter, now, go }: { snap: Snapshot; filter: Filter; now: number; go: Go }) {
  const t = today(), tm = addDays(t, 1);
  const s = snap.family!.settings;
  const msgs = liveMsgs(snap.messages, s);
  const m = (id: string) => snap.members.find(x => x.id === id);
  return (
    <div className="wv">
      <div className="wv-head"><b>{longDate(t)}</b><span>{hm(now)}</span></div>
      <button type="button" className="wv-sec" onClick={() => go.add(t)}>Heute</button>
      <Day d={t} snap={snap} filter={filter} now={now} go={go} />
      <button type="button" className="wv-sec" onClick={() => go.add(tm)}>{dayLabel(tm)}</button>
      <Day d={tm} snap={snap} filter={filter} now={now} go={go} />
      <div className="wv-sec">Board</div>
      {!msgs.length && <div className="wv-note">Keine Nachrichten</div>}
      {msgs.map(x => {
        const last = x.replies.at(-1);
        return <div key={x.id} className="wv-msg" role="button" tabIndex={0} onClick={() => go.msg(x.id)}>
          <Badge m={m(x.from_member)} size={26} />
          <div className="wv-txt">
            <div className="wv-t">{x.pinned && <Icon name="pin" />}<span>{x.image && !x.text.startsWith('📷') ? '📷 ' : ''}{x.text}</span></div>
            {x.taker ? <div className="wv-sub ok">✓ {nameOf(snap.members, x.taker)} übernimmt das</div>
              : last ? <div className="wv-sub">{nameOf(snap.members, last.from_member)}: {last.text}</div> : null}
          </div>
          <small>{nameOf(snap.members, x.from_member)}<br />{x.pinned ? '' : whenM(x)}</small>
        </div>;
      })}
    </div>
  );
}
