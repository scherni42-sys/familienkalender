import { useState, type ReactNode } from 'react';
import { AtMark, inviteCls, inviteState } from './invite';
import type { Birthday, CalEvent, Snapshot } from '../lib/types';
import { hm, today } from '../lib/dates';
import { bdOn, colorOf, evColor, depart, driveDone, isOnline, etaDriver, etaMin, liveMsgs, nameOf, target, TIER, travel, visibleOnDay, whenM } from '../lib/model';
import { flightShort, useFlight } from '../lib/flight';
import { Badge, cvar, Icon, useLong } from './ui';
import { chatPreview, chatThreads } from './Chat';
import { openShop } from '../lib/shop';
import { isSosMsg } from '../lib/sos';

// Startseite der App im Aussehen des Handy-Widgets: nur Heute, dazu das Board auf dunklem Grund
type Filter = 'all' | 'family' | 'home';
type Go = { open: (id: string, day: string) => void; edit: (id: string) => void; bday: (id: string) => void; add: (day: string) => void; msg: (id: string) => void };

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
  const arrived = eta === null && (driveDone(e) || past);
  const tr = travel(e, s), dep = depart(e, s);
  let drive = '', soon = false;
  if (eta !== null) drive = `${nm(etaDriver(e))} fährt · Ankunft ${hm(eta)}`;
  else if (e.driver && !arrived) {
    const go = isToday && !e.all_day && tr > 0 && target(e) > now;
    soon = go && dep > now && dep - now <= 30;
    drive = `${nm(e.driver)} ${e.trip === 'ab' ? 'holt ab' : e.trip === 'beides' ? 'bringt' : 'fährt'}${go ? ` · los ${hm(dep)}` : ''}${e.trip === 'beides' && e.driver2 ? ` · ${nm(e.driver2)} holt ab` : ''}`;
  }
  // Kurz wie im Widget; Antippen klappt die Einzelheiten auf, lange drücken bearbeitet
  const [open, setOpen] = useState(false);
  const where = [e.place, isOnline(e) ? '' : e.addr].filter(Boolean).join(' · ');
  const left = !e.all_day && !past && e.start_min > now ? e.start_min - now : null;
  const l = useLong(() => go.edit(e.id));
  const inv = inviteState(e, snap.me, past);
  const short = e.area ? <div className="wv-sub">{e.area.name}{e.tier === 'care' ? ' · Betreuung' : ''}{e.place ? ` · ${e.place}` : ''}</div>
    : drive ? <div className={`wv-sub${soon ? ' soon' : ''}`}><Icon name="car" /> {drive}</div> : e.place ? <div className="wv-sub">{e.place}</div> : null;
  return (
    <div className={`wv-row${open ? ' big' : ''}${past ? ' past' : ''}${inviteCls(inv)}`} style={cvar(evColor(snap.members, e))} role="button" tabIndex={0} aria-expanded={open}
      {...l.on} onClick={() => { if (l.longed.current) { l.longed.current = false; return; } setOpen(o => !o); }} onKeyDown={k => { if (k.key === 'Enter') setOpen(o => !o); }}>
      <i className="wv-bar" />
      {inv === 'ask' && <AtMark id={e.id} />}
      <time>{e.all_day ? 'ganzt.' : hm(e.start_min)}{open && !e.all_day && <small>{hm(e.end_min)}</small>}</time>
      <div className="wv-txt">
        <div className={`wv-t${open ? ' wrap' : ''}`}>{(e.vis !== 'family' || e.tier === 'parents') && <Icon name="lock" />}<span>{e.title}</span>{!open && e.files?.length ? <Icon name="clip" /> : null}</div>
        {!open ? <><Flight e={e} />{short}</> : <>
          {e.area && <div className="wv-sub">{e.area.name}{e.tier ? ` · ${TIER[e.tier][0]}` : ''}</div>}
          {e.persons.length > 0 && <div className="wv-sub">{e.persons.map(p => nm(p)).join(', ')}</div>}
          {where && <div className="wv-sub wrap"><Icon name="pin" /> {where}</div>}
          {isOnline(e) && <div className="wv-sub">Online-Besprechung</div>}
          <Flight e={e} />
          {drive && <div className={`wv-sub${soon ? ' soon' : ''}`}><Icon name="car" /> {soon ? `In ${dep - now} Min. losfahren · ` : ''}{drive}{tr && !eta ? ` · ${tr} Min. Fahrt` : ''}</div>}
          {e.bring.length > 0 && <div className="wv-sub wrap">Mitbringen: {e.bring.join(', ')}</div>}
          {e.notes && <div className="wv-sub wrap note">{e.notes}</div>}
          {e.files?.length ? <div className="wv-sub"><Icon name="clip" /> {e.files.length === 1 ? e.files[0].name : `${e.files.length} Dokumente`}</div> : null}
          {left !== null && left <= 120 && <div className="wv-sub soon">in {left >= 60 ? `${Math.floor(left / 60)} Std. ${left % 60 ? `${left % 60} Min.` : ''}` : `${left} Min.`}</div>}
          <button type="button" className="wv-more" onClick={x => { x.stopPropagation(); go.open(e.id, d); }}>Details, Navigation, Wecker ›</button>
        </>}
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
    {!list.length && !bds.length && <button type="button" className="wv-note" onClick={() => go.add(d)}><b>＋ Termin</b></button>}
  </>;
}

// big: Board oder Chat groß statt der Termine (Knopf grün); nochmal antippen schaltet zurück
export function WidgetView({ snap, filter, now, go, big, bigEl, toggle, chat, shop }: { snap: Snapshot; filter: Filter; now: number; go: Go; big: 'board' | 'chat' | null; bigEl?: ReactNode; toggle: (w: 'board' | 'chat') => void; chat: (id: string) => void; shop?: () => void }) {
  const t = today();
  const s = snap.family!.settings;
  const msgs = liveMsgs(snap.messages, s);
  const m = (id: string) => snap.members.find(x => x.id === id);
  const me = m(snap.me ?? '');
  const threads = chatThreads(snap.chats ?? [], snap.me);
  const unread = threads.reduce((n, x) => n + x.unread, 0);
  // Einkaufszettel: grünes Zettel-Symbol rechts neben „Board“, nur solange etwas zu kaufen ist
  const shopN = openShop(snap.shopping).length;
  const pill = (w: 'board' | 'chat', label: string, n = 0) => <div className={`wv-sec${big ? ' top' : ''}${w === 'chat' && big === 'chat' ? ' slotted' : ''}${w === 'board' && shopN > 0 && shop ? ' shopped' : ''}`}><button type="button" className={`kw-p bd-p${big === w ? ' on' : ''}`} aria-pressed={big === w} onClick={() => toggle(w)}>{label}{n > 0 && <i className="bd-n">{n}</i>}</button>{w === 'chat' && big === 'chat' && <span id="wv-chat-slot" className="wv-slot" />}{w === 'board' && shopN > 0 && shop && <button type="button" className="shop-p" onClick={shop} aria-label={`Einkaufszettel, ${shopN} offen`} title="Einkaufszettel"><Icon name="note" /><i className="bd-n">{shopN}</i></button>}</div>;
  // Kinder-Bereich: nur Termine, kein Board und kein Chat (bleiben in den Familien)
  if (snap.family?.kind === 'kids') return <div className="wv"><Day d={t} snap={snap} filter={filter} now={now} go={go} />
    <div className="wv-note">Kinder-Bereich {snap.family.name}: Termine, Betreuung und Absprachen. Alle Tage unter „KW“.</div></div>;
  return (
    <div className="wv">
      {!big && <Day d={t} snap={snap} filter={filter} now={now} go={go} />}
      {big !== 'chat' && pill('board', 'Board')}
      {big === 'board' && <div className="wv-board">{bigEl}</div>}
      {!big && <>
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
      </>}
      {me && me.role !== 'guest' && big !== 'board' && <>
        {pill('chat', 'Chat', big ? 0 : unread)}
        {big === 'chat' && <div className="wv-board">{bigEl}</div>}
        {!big && threads.slice(0, 3).map(x => <div key={x.with} className={`wv-msg${x.unread ? ' unread' : ''}`} role="button" tabIndex={0} onClick={() => chat(x.with)}>
          <Badge m={m(x.with)} size={32} plain />
          <div className="wv-txt"><div className="wv-t"><span>{x.last.from_member === snap.me ? 'Du: ' : ''}{chatPreview(x.last)}</span></div></div>
          <small>{nameOf(snap.members, x.with)}<br />{x.unread ? <b className="bd-n">{x.unread}</b> : ''}</small>
        </div>)}
      </>}
    </div>
  );
}
