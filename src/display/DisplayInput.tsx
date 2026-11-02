import { useEffect, useRef, useState } from 'react';
import { store } from '../lib/store';
import { parseSpoken } from '../lib/ai';
import { native } from '../lib/native';
import { avatarOf } from '../lib/supabase';
import { whenText } from '../lib/model';
import type { Draft } from '../lib/parse';
import type { DisplayFeed } from '../lib/types';
import { cvar, Icon } from '../app/ui';

type Rec = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };
const SR = (window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }).SpeechRecognition
  ?? (window as unknown as { webkitSpeechRecognition?: new () => Rec }).webkitSpeechRecognition;

// Eingabe am Touch-Display: wer bin ich (Avatar antippen), dann sprechen oder tippen, bei Terminen erst bestätigen
export function DisplayInput({ token, feed, mode, close, saved }: { token: string; feed: DisplayFeed; mode: 'event' | 'board'; close: () => void; saved: (msg: string) => void }) {
  const people = feed.members.filter(m => m.role !== 'guest');
  const [who, setWho] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [rec, setRec] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const r = useRef<Rec | null>(null);
  const join = (a: string, b: string) => [a.trim(), b.trim()].filter(Boolean).join(' ');

  useEffect(() => {
    const on = (e: Event) => { const t = String((e as CustomEvent).detail ?? '').trim(); setRec(false); if (t) setText(x => join(x, t)); };
    window.addEventListener('famto-speech', on);
    return () => { window.removeEventListener('famto-speech', on); r.current?.stop(); };
  }, []);

  const listen = () => {
    const n = native();
    if (n?.listen) { setRec(true); n.listen(); return; }
    if (!SR) { setErr('Spracheingabe gibt es in diesem Browser nicht. Bitte tippen.'); return; }
    if (rec) { r.current?.stop(); return; }
    const x = new SR(); x.lang = 'de-DE'; x.interimResults = false; x.continuous = false;
    x.onresult = e => { const t = Array.from(e.results).map(res => res[0].transcript).join(' '); setText(v => join(v, t)); };
    x.onend = () => setRec(false); x.onerror = () => setRec(false);
    r.current = x; try { x.start(); setRec(true); } catch { setRec(false); }
  };

  const go = async () => {
    const v = text.trim(); if (!v || !who) return;
    setBusy(true); setErr('');
    try {
      if (mode === 'board') { await store.displayPost(token, who, v); saved('Hängt jetzt am Board.'); return; }
      const p = await parseSpoken(v, who, people.map(m => ({ id: m.id, name: m.name, role: m.role ?? 'member' })), undefined, token);
      setDraft({ ...p, vis: 'family' });
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const save = async () => {
    if (!draft || !who) return;
    setBusy(true); setErr('');
    try {
      const { id: _id, reason: _r, suggested: _s, timeFound: _t, busy: _b, ...ev } = draft as Draft & { id?: string };
      await store.displaySaveEvent(token, who, { ...ev, vis: 'family' } as never);
      saved(`Familientermin gespeichert: ${draft.title}, ${whenText(draft)}`);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const nm = (id: string) => people.find(m => m.id === id)?.name ?? '';
  return (
    <div className="w-ov" onClick={e => { if (e.target === e.currentTarget) close(); }}>
      <div className="w-card w-in" role="dialog" aria-label={mode === 'board' ? 'Nachricht ans Board' : 'Neuer Familientermin'}>
        <h4>{mode === 'board' ? '✎ Nachricht ans Board' : '＋ Neuer Familientermin'}</h4>
        {!draft && <>
          <div className="w-in-lbl">Wer bist du?</div>
          <div className="w-who">{people.map(m => { const a = avatarOf(m); return (
            <button key={m.id} type="button" className={`w-p${who === m.id ? ' on' : ''}`} style={cvar(m.color)} onClick={() => setWho(m.id)}>
              <span className={`b${a ? ' av' : ''}`}>{a ? <img src={a} alt="" /> : m.name[0]}</span><small>{m.name}</small></button>); })}</div>
          <div className="w-in-row">
            <button type="button" className={`w-mic${rec ? ' rec' : ''}`} onClick={listen} aria-label="Sprechen"><Icon name="mic" /></button>
            <textarea value={text} onChange={e => setText(e.target.value)} placeholder={mode === 'board' ? 'Nachricht sprechen oder tippen' : 'z. B. „Freitag 16 Uhr Zahnarzt mit Ben, Anna fährt“'} maxLength={500} />
          </div>
          {err && <div className="w-in-err">{err}</div>}
          <div className="w-in-btns"><button type="button" className="w-btn ghost" onClick={close}>Abbrechen</button>
            <button type="button" className="w-btn" disabled={busy || !text.trim() || !who} onClick={() => void go()}>{busy ? 'Einen Moment …' : !who ? 'Erst oben antippen, wer du bist' : mode === 'board' ? 'Ans Board' : 'Weiter'}</button></div>
        </>}
        {draft && <>
          <div className="r"><span>Was</span><div><b>{draft.title}</b></div></div>
          <div className="r"><span>Wann</span><div>{whenText(draft)}</div></div>
          {draft.persons.length > 0 && <div className="r"><span>Wer</span><div>{draft.persons.map(nm).join(', ')}</div></div>}
          {draft.driver && <div className="r"><span>Fahrdienst</span><div>{nm(draft.driver)} fährt</div></div>}
          {draft.place && <div className="r"><span>Ort</span><div>{draft.place}</div></div>}
          {err && <div className="w-in-err">{err}</div>}
          <div className="w-in-btns"><button type="button" className="w-btn ghost" onClick={() => setDraft(null)}>Ändern</button>
            <button type="button" className="w-btn" disabled={busy} onClick={() => void save()}>{busy ? 'Speichert …' : 'Speichern'}</button></div>
        </>}
      </div>
    </div>
  );
}
