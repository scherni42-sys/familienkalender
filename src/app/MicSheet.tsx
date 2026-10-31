import { useEffect, useRef, useState } from 'react';
import { store, useSnapshot } from '../lib/store';
import { parseSpoken } from '../lib/ai';
import type { Draft } from '../lib/parse';
import { Icon, Sheet } from './ui';
import { toNewEvent } from './EventSheet';
import { whenText } from '../lib/model';
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

// Stichwort am Satzanfang: „Privat …“, „Familie …“ oder „Pinnwand …“ speichert ohne Rückfrage
const PREFIX = /^\s*(privat|familie|pinnwand)\b[\s,.:;!-]*/i;
const PAUSE = 3000;     // so lange darf man schweigen, bevor die Aufnahme endet
const FIRST = 7000;     // Zeit bis zum ersten Wort

export function MicSheet({ auto, quick, close, toDraft, posted, saved }: { auto?: boolean; quick?: boolean; close: () => void; toDraft: (d: Draft) => void; posted: () => void; saved: (id: string) => void }) {
  const snap = useSnapshot();
  // Seitentaste: ohne Stichwort „Privat“/„Familie“ landet das Gesprochene auf der Pinnwand
  const [mode, setMode] = useState<Mode>(quick ? 'board' : 'family');
  const [text, setText] = useState('');
  const [rec, setRec] = useState(false), [busy, setBusy] = useState(false);
  const r = useRef<Rec | null>(null);
  // Aufnahme-Zustand: Android beendet die Erkennung nach kurzer Stille, wir starten sie bis zur echten Pause neu
  const sess = useRef({ base: '', cur: '', last: 0, first: true, stop: false });
  const latest = useRef({ text, mode });
  latest.current = { text, mode };
  useEffect(() => () => { sess.current.stop = true; r.current?.stop(); }, []);
  // Schnellstart: Aufnahme gleich beginnen; lehnt der Browser ohne Antippen ab, bleibt der Knopf
  useEffect(() => { if (auto && SR) { const t = setTimeout(() => listen(true), 300); return () => clearTimeout(t); } }, []);

  const join = (a: string, b: string) => [a.trim(), b.trim()].filter(Boolean).join(' ');

  const startRec = (quiet: boolean) => {
    const x = new SR!();
    x.lang = 'de-DE'; x.interimResults = true; x.continuous = false;
    x.onresult = e => {
      const st = sess.current;
      st.cur = Array.from(e.results).map(res => res[0].transcript).join(' ');
      st.last = Date.now(); st.first = false;
      setText(join(st.base, st.cur));
    };
    x.onend = () => {
      const st = sess.current;
      st.base = join(st.base, st.cur); st.cur = '';
      const quietFor = Date.now() - st.last;
      if (!st.stop && quietFor < (st.first ? FIRST : PAUSE)) { startRec(true); return; }
      setRec(false);
      // Nach der Pause geht es ohne weiteres Antippen weiter: mit Stichwort direkt speichern, sonst zur Bestätigung
      if (!st.stop && st.base) void go(st.base);
    };
    x.onerror = e => {
      if (e.error === 'no-speech' || e.error === 'aborted') return; // onend entscheidet
      sess.current.stop = true; setRec(false);
      if (e.error === 'not-allowed' && !quiet) toast('Bitte erlaube den Zugriff auf das Mikrofon.');
    };
    r.current = x;
    try { x.start(); setRec(true); } catch { sess.current.stop = true; setRec(false); }
  };

  const listen = (quiet = false) => {
    if (!SR) { toast('Dieser Browser kann keine Sprache erkennen. Tippe den Satz einfach ein.'); return; }
    if (rec) { sess.current.stop = true; r.current?.stop(); return; }
    sess.current = { base: latest.current.text.trim(), cur: '', last: Date.now(), first: true, stop: false };
    startRec(quiet);
  };

  const go = async (spoken?: string) => {
    let v = (spoken ?? latest.current.text).trim(); if (!v) return;
    let m = latest.current.mode;
    const pre = v.match(PREFIX);
    const direct = !!pre;
    if (pre) {
      const k = pre[1].toLowerCase();
      m = k === 'privat' ? 'private' : k === 'familie' ? 'family' : 'board';
      v = v.slice(pre[0].length).trim();
      setMode(m);
      if (!v) return;
      v = v.charAt(0).toUpperCase() + v.slice(1);
    }
    setBusy(true);
    try {
      if (m === 'board') { await store.postMessage(v); toast('Hängt jetzt an der Wand.'); posted(); return; }
      const parsed = await parseSpoken(v, snap.me!, snap.members.filter(x => x.role !== 'guest'));
      const d: Draft = { ...parsed, vis: m, busy: m === 'private' && parsed.busy };
      if (direct && d.title.trim()) {
        const id = await store.saveEvent(toNewEvent(d));
        toast(`${m === 'family' ? 'Familientermin' : 'Privater Termin'} gespeichert: ${d.title}, ${whenText(d)}`);
        saved(id);
        return;
      }
      toDraft(d);
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
      <div className="listen"><button type="button" className={`mic${rec ? ' rec' : ''}`} onClick={() => listen()} aria-label={rec ? 'Aufnahme beenden' : 'Sprechen'}><Icon name="mic" /></button></div>
      <p style={{ textAlign: 'center' }}>{rec ? 'Ich höre zu … Kurze Pausen sind kein Problem.' : 'Tippe aufs Mikrofon und sprich, oder schreib den Satz.'}</p>
      <textarea value={text} onChange={e => setText(e.target.value)} placeholder={mode === 'board' ? 'z. B. Milch fehlt' : 'z. B. Mia hat Donnerstag um 17 Uhr Fußball, Papa fährt'} maxLength={500} />
      <p className="note">Tipp: Beginnst du mit „Privat“, „Familie“ oder „Pinnwand“, wird ohne Rückfrage gespeichert.</p>
      <div className="chips">{SAMPLES[mode].map(x => <button key={x} type="button" className="chip" onClick={() => setText(x)}>{x}</button>)}</div>
      <div className="btn-row">
        <button type="button" className="btn ghost" onClick={close}>Abbrechen</button>
        <button type="button" className="btn" disabled={busy || !text.trim()} onClick={() => void go()}>{busy ? <span className="spin" /> : mode === 'board' ? 'An die Wand' : 'Weiter'}</button>
      </div>
    </Sheet>
  );
}
