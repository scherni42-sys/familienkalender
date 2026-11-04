import { useEffect, useState } from 'react';
import { store, useSnapshot } from '../lib/store';
import { leftTxt, liveMsgs, nameOf, whenM } from '../lib/model';
import { Badge, Icon } from './ui';
import { fail, toast } from './toast';
import { shrinkPhoto } from '../lib/ai';
import { boardImg } from '../lib/supabase';
import { AttachButton, FileList } from './Files';

// big: Board füllt die Startseite; neue Nachrichten dann über das ＋ unten (kein Eingabefeld, mehr Platz)
export function Board({ focus, reply: replyOpen, big }: { focus?: string | null; reply?: string | null; big?: boolean }) {
  const snap = useSnapshot();
  const s = snap.family!.settings;
  const me = snap.members.find(m => m.id === snap.me)!;
  const canAct = me.role !== 'guest';
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null), [editTxt, setEditTxt] = useState('');
  const [text, setText] = useState(''), [reply, setReply] = useState('');
  const [photo, setPhoto] = useState<{ type: string; data: string } | null>(null), [sending, setSending] = useState(false);
  const pick = async (f?: File) => { if (!f) return; try { setPhoto(await shrinkPhoto(f)); } catch { toast('Das Foto ließ sich nicht öffnen.'); } };
  const msgs = liveMsgs(snap.messages, s);
  const member = (id: string) => snap.members.find(m => m.id === id);
  // Aus dem Widget angetippte Nachricht ins Bild holen
  // „Antworten“ im Widget: Antwortfeld dieser Nachricht gleich öffnen
  useEffect(() => { if (replyOpen) { setReplyTo(replyOpen); setReply(''); } }, [replyOpen]);
  useEffect(() => { if (focus) document.getElementById(`msg-${focus}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, [focus]);
  const ttl = s.ttlHours < 48 ? `${s.ttlHours} Std.` : `${s.ttlHours / 24} Tagen`;

  const quick = async (id: string, t: string) => {
    try {
      if (t === 'Mach ich') { await store.setMessage(id, { taker: snap.me }); toast('Alle sehen: du übernimmst das.'); }
      await store.reply(id, t);
    } catch (e) { fail(e); }
  };

  return <>
    {!big && <p className="note">Kurze Nachrichten für alle, auch auf dem Display. Sie verschwinden nach {ttl}, sobald jemand sie abhakt, oder bleiben angeheftet stehen.</p>}
    {msgs.length === 0 && <div className="empty smile"><Icon name="smile" />{big ? 'Keine Nachrichten. Mit ＋ unten rechts schreibst du eine.' : 'Keine Nachrichten'}</div>}
    {msgs.map(m => (
      <div key={m.id} id={`msg-${m.id}`} className={`msg${m.pinned ? ' pinned' : ''}${focus === m.id ? ' isnew' : ''}`}>
        <div className="from"><Badge m={member(m.from_member)} /> {nameOf(snap.members, m.from_member)} · {whenM(m)}{m.via ? ` · ${m.via}` : ''}</div>
        {editId === m.id ? (
          <form className="compose" onSubmit={e => { e.preventDefault(); const v = editTxt.trim(); if (!v) return; store.setMessage(m.id, { text: v }).then(() => { setEditId(null); toast('Nachricht geändert.'); }, fail); }}>
            <input autoFocus value={editTxt} onChange={e => setEditTxt(e.target.value)} maxLength={500} aria-label="Nachricht bearbeiten" />
            <button>Speichern</button>
          </form>
        ) : <div>{m.image && m.text === '📷 Foto' ? null : m.text}</div>}
        {m.image && <a href={boardImg(m.image)} target="_blank" rel="noreferrer" className="msg-img"><img src={boardImg(m.image)} alt={m.text} loading="lazy" /></a>}
        <FileList files={m.files} from={{ message: m.id }} canEdit={m.from_member === snap.me || me.role === 'admin'} />
        {m.taker && <div className="note"><b>Übernimmt: {nameOf(snap.members, m.taker)}</b></div>}
        {m.replies.length > 0 && <div className="replies">{m.replies.map(r => <div key={r.id} className="rp"><Badge m={member(r.from_member)} /><span>{r.text}</span></div>)}</div>}
        {canAct && <div className="quick">
          {(m.image ? ['👍'] : ['👍', 'Mach ich', 'Nein']).map(q => <button key={q} type="button" className="chip" onClick={() => void quick(m.id, q)}>{q}</button>)}
          <button type="button" className="chip" onClick={() => { setReplyTo(replyTo === m.id ? null : m.id); setReply(''); }}>Antworten</button>
        </div>}
        <div className="macts">
          {canAct && <>
            <button type="button" className="small-btn" onClick={() => store.setMessage(m.id, { done: true }).then(() => toast('Erledigt und von der Wand genommen.'), fail)}>✓ Erledigt</button>
            {(m.from_member === snap.me || me.role === 'admin') && <button type="button" className="small-btn" onClick={() => { if (editId === m.id) { setEditId(null); return; } setEditId(m.id); setEditTxt(m.text); }}>{editId === m.id ? 'Abbrechen' : 'Bearbeiten'}</button>}
            <button type="button" className="small-btn" onClick={() => store.setMessage(m.id, { pinned: !m.pinned }).then(() => toast(m.pinned ? `Gelöst: verschwindet in ${ttl}.` : 'Angeheftet: bleibt stehen, bis jemand es löst.'), fail)}>{m.pinned ? 'Lösen' : 'Anheften'}</button>
            {(m.from_member === snap.me || me.role === 'admin') && <button type="button" className="small-btn" aria-label="Nachricht löschen" title="Löschen" onClick={() => store.deleteMessage(m.id).then(() => toast('Nachricht gelöscht.'), fail)}><Icon name="trash" /></button>}
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
    {canAct && !big && (
      <>
        {photo && <div className="photo-prev"><img src={`data:${photo.type};base64,${photo.data}`} alt="Foto für das Board" /><button type="button" className="small-btn" onClick={() => setPhoto(null)}>Foto entfernen</button></div>}
        <form className="compose" onSubmit={e => {
          e.preventDefault(); const v = text.trim() || (photo ? '📷 Foto' : ''); if (!v || sending) return;
          setSending(true);
          store.postMessage(v, photo ?? undefined).then(() => { setText(''); setPhoto(null); toast('Hängt jetzt am Board.'); }, fail).finally(() => setSending(false));
        }}>
          <input value={text} onChange={e => setText(e.target.value)} placeholder={photo ? 'Text zum Foto (freiwillig)' : 'Nachricht an die Familie'} maxLength={500} />
          <button disabled={sending}>{sending ? '…' : 'Boarding'}</button>
        </form>
        <div className="cam-row">
          <label className="cam-big"><Icon name="camera" /><span>Foto aufnehmen</span><input type="file" accept="image/*" capture="environment" hidden onChange={e => { void pick(e.target.files?.[0]); e.target.value = ''; }} /></label>
          <label className="cam-big"><Icon name="image" /><span>Aus Galerie</span><input type="file" accept="image/*" hidden onChange={e => { void pick(e.target.files?.[0]); e.target.value = ''; }} /></label>
          <AttachButton to={{ text: text.trim() || undefined }} label="Dokument" className="cam-big" done={() => setText('')} />
        </div>
      </>
    )}
  </>;
}
