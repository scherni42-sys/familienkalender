import { useEffect, useRef, useState } from 'react';
import { store, useSnapshot } from '../lib/store';
import { parseSpoken, shrinkPhoto } from '../lib/ai';
import type { Draft } from '../lib/parse';
import { Icon, Sheet } from './ui';
import { fail, toast } from './toast';
import { native } from '../lib/native';

type Mode = 'private' | 'family' | 'board';
// Web-Spracherkennung des Browsers (Chrome/Android, Safari/iOS)
type Rec = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };
const SR = (window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }).SpeechRecognition
  ?? (window as unknown as { webkitSpeechRecognition?: new () => Rec }).webkitSpeechRecognition;

// Stichwort am Satzanfang: „Privat …“, „Familie …“ oder „Board …“ speichert ohne Rückfrage
const PREFIX = /^\s*(privat|familie|pinnwand|board|bord)\b[\s,.:;!-]*/i;
const PAUSE = 3000;     // so lange darf man schweigen, bevor die Aufnahme endet
const FIRST = 7000;     // Zeit bis zum ersten Wort

export function MicSheet({ auto, quick, preset, photoFirst, close, toDraft, posted }: { auto?: boolean; quick?: boolean; preset?: Mode; photoFirst?: boolean; close: () => void; toDraft: (d: Draft) => void; posted: () => void; saved: (id: string) => void }) {
  const snap = useSnapshot();
  // Seitentaste: ohne Stichwort „Privat“/„Familie“ landet das Gesprochene auf der Pinnwand
  const [mode, setMode] = useState<Mode>(preset ?? (quick ? 'board' : 'family'));
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
    };
    x.onerror = e => {
      if (e.error === 'no-speech' || e.error === 'aborted') return; // onend entscheidet
      sess.current.stop = true; setRec(false);
      if (e.error === 'not-allowed' && !quiet) toast('Bitte erlaube den Zugriff auf das Mikrofon.');
    };
    r.current = x;
    try { x.start(); setRec(true); } catch { sess.current.stop = true; setRec(false); }
  };

  // In der Android-App: Spracherkennung des Handys, der Text landet im Feld (gespeichert wird erst mit Weiter)
  useEffect(() => {
    const on = (e: Event) => { const t = String((e as CustomEvent).detail ?? '').trim(); setRec(false); if (t) setText(x => join(x, t)); };
    window.addEventListener('famto-speech', on);
    return () => window.removeEventListener('famto-speech', on);
  }, []);

  const listen = (quiet = false) => {
    const n = native();
    if (n?.listen) { setRec(true); n.listen(); return; }
    if (!SR) { toast('Dieser Browser kann keine Sprache erkennen. Tippe den Satz einfach ein.'); return; }
    if (rec) { sess.current.stop = true; r.current?.stop(); return; }
    sess.current = { base: latest.current.text.trim(), cur: '', last: Date.now(), first: true, stop: false };
    startRec(quiet);
  };

  const go = async (spoken?: string) => {
    let v = (spoken ?? latest.current.text).trim(); if (!v) return;
    let m = latest.current.mode;
    const pre = v.match(PREFIX);
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
      if (m === 'board') { await store.postMessage(v); toast('Hängt jetzt am Board.'); posted(); return; }
      const parsed = await parseSpoken(v, snap.me!, snap.members.filter(x => x.role !== 'guest'));
      // Nie automatisch speichern: immer erst zur Bestätigung
      toDraft({ ...parsed, vis: m, busy: m === 'private' && parsed.busy });
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  // Foto von Zettel, Brief oder Einladung: Claude liest den Termin, danach wie gewohnt bestätigen
  const photo = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const img = await shrinkPhoto(file);
      const m = latest.current.mode;
      const typed = latest.current.text.trim();
      // Board gewählt: Foto direkt ans Board hängen
      if (m === 'board') { await store.postMessage(typed || '📷 Foto', img); toast('Foto hängt jetzt am Board.'); posted(); return; }
      const parsed = await parseSpoken(typed, snap.me!, snap.members.filter(x => x.role !== 'guest'), img);
      // Kein Termin auf dem Foto: anbieten, es ans Board zu hängen
      if (parsed.source !== 'ai' || parsed.found === false) {
        const why = parsed.source !== 'ai' ? `Das Foto konnte nicht gelesen werden${parsed.why ? ` (${parsed.why})` : ''}.` : 'Auf dem Foto steht kein Termin.';
        if (window.confirm(`${why}\n\nSoll das Foto stattdessen ans Board?`)) { await store.postMessage(typed || '📷 Foto', img); toast('Foto hängt jetzt am Board.'); posted(); }
        return;
      }
      toDraft({ ...parsed, vis: m, busy: m === 'private' && parsed.busy });
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  return (
    <Sheet onClose={close} label="Sprechen">
      <h2>Neuer Eintrag</h2>
      {/* Aus dem Widget-Kamera-Knopf: großer Foto-Knopf zuerst (Android verlangt einen Tipp, bevor die Kamera aufgeht) */}
      {photoFirst && !store.demo && <label className={`photobig${busy ? ' busy' : ''}`}><Icon name="camera" />{busy ? 'Claude liest das Foto …' : 'Foto aufnehmen'}
        <input type="file" accept="image/*" capture="environment" hidden disabled={busy} onChange={e => { void photo(e.target.files?.[0]); e.target.value = ''; }} /></label>}
      <div className="visbig three" role="group" aria-label="Art">
        <button type="button" className="private" aria-pressed={mode === 'private'} onClick={() => setMode('private')}><Icon name="lock" />Privat<small>nur ich</small></button>
        <button type="button" className="family" aria-pressed={mode === 'family'} onClick={() => setMode('family')}><Icon name="home" />Familie<small>alle + Display</small></button>
        <button type="button" className="board" aria-pressed={mode === 'board'} onClick={() => setMode('board')}><Icon name="board" />Board<small>Nachricht</small></button>
      </div>
      <div className="listen"><button type="button" className={`mic${rec ? ' rec' : ''}`} onClick={() => listen()} aria-label={rec ? 'Aufnahme beenden' : 'Sprechen'}><Icon name="mic" /></button>
        {/* Links: Bild aus der Galerie (Screenshot, Einladung als Bild), rechts: Kamera */}
        {!store.demo && !photoFirst && <label className={`photo left${busy ? ' busy' : ''}`} aria-label="Termin aus einem Bild der Galerie"><span className="rnd"><Icon name="gallery" /></span><span>Galerie</span>
          <input type="file" accept="image/*" hidden disabled={busy} onChange={e => { void photo(e.target.files?.[0]); e.target.value = ''; }} /></label>}
        {!store.demo && !photoFirst && <label className={`photo${busy ? ' busy' : ''}`} aria-label="Termin vom Foto"><span className="rnd"><Icon name="camera" /></span><span>Foto</span>
          <input type="file" accept="image/*" capture="environment" hidden disabled={busy} onChange={e => { void photo(e.target.files?.[0]); e.target.value = ''; }} /></label>}</div>
      <p style={{ textAlign: 'center' }}>{rec ? 'Ich höre zu … Kurze Pausen sind kein Problem.' : busy ? 'Einen Moment, Claude liest …' : 'Tippe aufs Mikrofon und sprich, schreib den Satz, fotografiere einen Zettel oder nimm ein Bild aus der Galerie.'}</p>
      <textarea value={text} onChange={e => setText(e.target.value)} placeholder={mode === 'board' ? 'Nachricht sprechen oder tippen' : 'Termin sprechen oder tippen'} maxLength={500} />
      <p className="note">Tipp: Beginnst du mit „Privat“, „Familie“ oder „Board“, wird die Art gleich umgestellt.</p>
      <div className="btn-row">
        <button type="button" className="btn ghost" onClick={close}>Abbrechen</button>
        <button type="button" className="btn" disabled={busy || !text.trim()} onClick={() => void go()}>{busy ? <span className="spin" /> : mode === 'board' ? 'Boarding' : 'Weiter'}</button>
      </div>
    </Sheet>
  );
}
