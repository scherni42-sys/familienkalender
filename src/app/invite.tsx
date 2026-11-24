import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { store, useSnapshot } from '../lib/store';
import { askPerson, nameOf, personAnswer, whenText } from '../lib/model';
import type { CalEvent } from '../lib/types';
import { fail, toast } from './toast';
import './invite.css';

// Familientermine anderer bei mir:
//  'ask'  = ich bin eingeladen und habe noch nicht geantwortet: blass + goldenes @ rechts vom Farbbalken
//  'pale' = ich bin nicht eingeladen (oder habe abgesagt): bleibt blass
//  null   = normal (eigene Termine, zugesagt, ältere Termine ohne Anfrage, Kinder-Bereich)
type Ev = Pick<CalEvent, 'owner' | 'persons' | 'vis' | 'persons_by' | 'persons_ok'> & { area?: unknown; color?: string };
export function inviteState(e: Ev, me: string | null | undefined, past = false): 'ask' | 'pale' | null {
  if (!me || e.area || e.color || e.vis !== 'family') return null;
  if (askPerson(e as CalEvent, me)) return past ? 'pale' : 'ask';
  if (e.owner === me) return null;
  if (!e.persons.includes(me)) return 'pale';
  return personAnswer(e as CalEvent, me) === false ? 'pale' : null;
}
export const inviteCls = (st: 'ask' | 'pale' | null) => (st === 'ask' ? ' pale asking' : st === 'pale' ? ' pale' : '');

// Zusagen-Fenster: öffnet sich über das @ (App, Widget-Ansicht, Android-Widget), auch Tage nach der Benachrichtigung
let openId: string | null = null;
const subs = new Set<() => void>();
export function askInvite(id: string | null) { openId = id; subs.forEach(f => f()); }
const useOpen = () => useSyncExternalStore(cb => { subs.add(cb); return () => { subs.delete(cb); }; }, () => openId);

// Das goldene @; Tippen öffnet das Zusagen-Fenster statt der Details
export function AtMark({ id }: { id: string }) {
  return <button type="button" className="inv-at" aria-label="Einladung: zusagen oder absagen"
    onPointerDown={x => x.stopPropagation()} onKeyDown={x => x.stopPropagation()} onClick={x => { x.stopPropagation(); askInvite(id); }}>@</button>;
}

export function InviteAsk() {
  const snap = useSnapshot();
  const id = useOpen();
  const e = id ? snap.events.find(x => x.id === id) : undefined;
  if (!id) return null;
  const close = () => askInvite(null);
  if (!e) return null; // beim Start aus dem Widget: erscheint, sobald die Termine geladen sind
  const by = nameOf(snap.members, e.persons_by ?? e.owner);
  const mine = snap.me ? personAnswer(e, snap.me) : undefined;
  const answer = (ok: boolean) => { close(); store.personAnswer(e.id, ok).then(() => toast(`${ok ? 'Zugesagt' : 'Abgesagt'}. ${by} bekommt Bescheid.`), fail); };
  return createPortal(
    <div className="inv-ov" onClick={x => { if (x.target === x.currentTarget) close(); }}>
      <div className="inv-card" role="dialog" aria-label="Einladung beantworten">
        <span className="inv-at big" aria-hidden="true">@</span>
        <b>{e.title}</b>
        <div>{whenText(e)}{e.place ? ` · ${e.place}` : ''}</div>
        <div className="inv-by">{by} hat dich eingetragen.{mine === true ? ' Du hast zugesagt.' : mine === false ? ' Du hast abgesagt.' : ''}</div>
        <div className="inv-btns">
          <button type="button" className="btn" onClick={() => answer(true)}>Zusagen</button>
          <button type="button" className="btn ghost" onClick={() => answer(false)}>Absagen</button>
        </div>
        <button type="button" className="inv-later" onClick={close}>Später</button>
      </div>
    </div>, document.body);
}
