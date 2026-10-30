import { useEffect, useRef, useState } from 'react';
import { store, useSnapshot } from '../lib/store';
import { parseSpoken } from '../lib/ai';
import type { Draft } from '../lib/parse';
import { Icon, Sheet } from './ui';
import { fail, toast } from './toast';

type Mode = 'private' | 'family' | 'board';
const SAMPLES: Record<Mode, string[]> = {
  family: ['Morgen um 17 Uhr hat Mia Fußball, Papa fährt', 'Übermorgen 15:30 Zahnarzt mit Ben, ich bringe ihn hin', 'Klassenfahrt Mia vom 2.11. bis 6.11.'],
  private: ['Morgen 10 Uhr Termin bei meiner Ärztin', 'Dienstag 19 Uhr Squash'],
  board: ['Milch und Eier fehlen', 'Bin um 18 Uhr zurück', 'Wer kann Ben morgen von der Kita holen?']
};

// Web-Spracherkennung des Browsers (Chrome/Android, Safari/iOS)
type Rec = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };
const SR = (window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }).SpeechRecognition
  ?? (window as unknown as { webkitSpeechRecognition?: new () => Rec }).webkitSpeechRecognition;

export function MicSheet({ close, toDraft, posted }: { close: () => void; toDraft: (d: Draft) => void; posted: () => void }) {
  const snap = useSnapshot();
  const [mode, setMode] = useState<Mode>('family');
  const [text, setText] = useState('');
  const [rec, setRec] = useState(false), [busy, setBusy] = useState(false);
  const r = useRef<Rec | null>(null);
  useEffect(() => () => r.current?.stop(), []);

  const listen = () => {
    if (!SR) { toast('Dieser Browser kann keine Sprache erkennen. Tippe den Satz einfach ein.'); return; }
    if (rec) { r.current?.stop(); return; }
    const x = new SR();
    x.lang = 'de-DE'; x.interimResults = true; x.continuous = false;
    x.onresult = e => setText(Array.from(e.results).map(res => res[0].transcript).join(' '));
    x.onend = () => setRec(false);
    x.onerror = e => { setRec(false); if (e.error === 'not-allowed') toast('Bitte erlaube den Zugriff auf das Mikrofon.'); };
    r.current = x; x.start(); setRec(true);
  };

  const go = async () => {
    const v = text.trim(); if (!v) return;
    setBusy(true);
    try {
      if (mode === 'board') { await store.postMessage(v); toast('Hängt jetzt an der Wand.'); posted(); return; }
      const d = await parseSpoken(v, snap.me!, snap.members.filter(m => m.role !== 'guest'));
      toDraft({ ...d, vis: mode, busy: mode === 'private' && d.busy });
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  return (
    <Sheet onClose={close} label="Sprechen">
      <h2>{mode === 'board' ? 'Nachricht an die Pinnwand' : 'Neuer Termin'}</h2>
      <div className="visbig three" role="group" aria-label="Art">
        <button type="button" className="private" aria-pressed={mode === 'private'} onClick={() => setMode('private')}><Icon name="lock" />Privat<small>nur ich</small></button>
        <button type="button" className="family" aria-pressed={mode === 'family'} onClick={() => setMode('family')}><Icon name="home" />Familie<small>alle + Display</small></button>
        <button type="button" className="board" aria-pressed={mode === 'board'} onClick={() => setMode('board')}><Icon name="board" />Pinnwand<small>Nachricht</small></button>
      </div>
      <div className="listen"><button type="button" className={`mic${rec ? ' rec' : ''}`} onClick={listen} aria-label={rec ? 'Aufnahme beenden' : 'Sprechen'}><Icon name="mic" /></button></div>
      <p style={{ textAlign: 'center' }}>{rec ? 'Ich höre zu …' : 'Tippe aufs Mikrofon und sprich, oder schreib den Satz.'}</p>
      <textarea value={text} onChange={e => setText(e.target.value)} placeholder={mode === 'board' ? 'z. B. Milch fehlt' : 'z. B. Mia hat Donnerstag um 17 Uhr Fußball, Papa fährt'} maxLength={500} />
      <div className="chips">{SAMPLES[mode].map(x => <button key={x} type="button" className="chip" onClick={() => setText(x)}>{x}</button>)}</div>
      <div className="btn-row">
        <button type="button" className="btn ghost" onClick={close}>Abbrechen</button>
        <button type="button" className="btn" disabled={busy || !text.trim()} onClick={() => void go()}>{busy ? <span className="spin" /> : mode === 'board' ? 'An die Wand' : 'Weiter'}</button>
      </div>
    </Sheet>
  );
}
