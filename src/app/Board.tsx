import { useState } from 'react';
import { store, useSnapshot } from '../lib/store';
import { leftTxt, liveMsgs, nameOf, whenM } from '../lib/model';
import { Badge, Icon } from './ui';
import { fail, toast } from './toast';

export function Board() {
  const snap = useSnapshot();
  const s = snap.family!.settings;
  const me = snap.members.find(m => m.id === snap.me)!;
  const canAct = me.role !== 'guest';
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [text, setText] = useState(''), [reply, setReply] = useState('');
  const msgs = liveMsgs(snap.messages, s);
  const member = (id: string) => snap.members.find(m => m.id === id);
  const ttl = s.ttlHours < 48 ? `${s.ttlHours} Std.` : `${s.ttlHours / 24} Tagen`;

  const quick = async (id: string, t: string) => {
    try {
      if (t === 'Mach ich') { await store.setMessage(id, { taker: snap.me }); toast('Alle sehen: du übernimmst das.'); }
      await store.reply(id, t);
    } catch (e) { fail(e); }
  };

  return <>
    <p className="note">Kurze Nachrichten für alle, auch auf dem Display. Sie verschwinden nach {ttl}, sobald jemand sie abhakt, oder bleiben angeheftet stehen.</p>
    {msgs.length === 0 && <div className="empty smile"><Icon name="smile" />Keine Nachrichten</div>}
    {msgs.map(m => (
      <div key={m.id} className={`msg${m.pinned ? ' pinned' : ''}`}>
        <div className="from"><Badge m={member(m.from_member)} /> {nameOf(snap.members, m.from_member)} · {whenM(m)}{m.via ? ` · ${m.via}` : ''}</div>
        <div>{m.text}</div>
        {m.taker && <div className="note"><b>Übernimmt: {nameOf(snap.members, m.taker)}</b></div>}
        {m.replies.length > 0 && <div className="replies">{m.replies.map(r => <div key={r.id} className="rp"><Badge m={member(r.from_member)} /><span>{r.text}</span></div>)}</div>}
        {canAct && <div className="quick">
          {['👍', 'Mach ich', 'Nein'].map(q => <button key={q} type="button" className="chip" onClick={() => void quick(m.id, q)}>{q}</button>)}
          <button type="button" className="chip" onClick={() => { setReplyTo(replyTo === m.id ? null : m.id); setReply(''); }}>Antworten</button>
        </div>}
        <div className="macts">
          {canAct && <>
            <button type="button" className="small-btn" onClick={() => store.setMessage(m.id, { done: true }).then(() => toast('Erledigt und von der Wand genommen.'), fail)}>✓ Erledigt</button>
            <button type="button" className="small-btn" onClick={() => store.setMessage(m.id, { pinned: !m.pinned }).then(() => toast(m.pinned ? `Gelöst: verschwindet in ${ttl}.` : 'Angeheftet: bleibt stehen, bis jemand es löst.'), fail)}>{m.pinned ? 'Lösen' : 'Anheften'}</button>
          </>}
          <span className="left">{m.pinned && <Icon name="pin" />} {leftTxt(m, s)}</span>
        </div>
        {replyTo === m.id && (
          <form className="compose" onSubmit={e => { e.preventDefault(); const v = reply.trim(); if (!v) return; store.reply(m.id, v).then(() => { setReplyTo(null); setReply(''); }, fail); }}>
            <input autoFocus value={reply} onChange={e => setReply(e.target.value)} placeholder={`Kurze Antwort an ${nameOf(snap.members, m.from_member)}`} maxLength={300} />
            <button>Senden</button>
          </form>
        )}
      </div>
    ))}
    {canAct && (
      <form className="compose" onSubmit={e => { e.preventDefault(); const v = text.trim(); if (!v) return; store.postMessage(v).then(() => { setText(''); toast('Hängt jetzt an der Wand.'); }, fail); }}>
        <input value={text} onChange={e => setText(e.target.value)} placeholder="Nachricht an die Familie" maxLength={500} />
        <button>An die Wand</button>
      </form>
    )}
  </>;
}
