import { useEffect, useRef, useState } from 'react';
import { useSnapshot } from '../lib/store';
import { askClaude, parseSpoken, type AskResult } from '../lib/ai';
import type { Draft } from '../lib/parse';
import { hm, shortDate } from '../lib/dates';
import { bdLabel, colorOf } from '../lib/model';
import { native } from '../lib/native';
import { eventDraft } from './DetailSheet';
import { cvar, Icon, Sheet } from './ui';
import { toast } from './toast';

type Rec = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };
const SR = (window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }).SpeechRecognition
  ?? (window as unknown as { webkitSpeechRecognition?: new () => Rec }).webkitSpeechRecognition;

const IDEAS = ['Wann treffe ich Tom das nächste Mal?', 'Alle Termine mit Oma', 'Wer fährt diese Woche?', 'Wann hat Opa Geburtstag?'];

// Zaubertaste: in eigenen Worten fragen oder etwas erledigen lassen
export function AskSheet({ close, open, edit, toDraft, bdays }: { close: () => void; open: (id: string) => void; edit: (d: Draft) => void; toDraft: (d: Draft) => void; bdays: () => void }) {
  const snap = useSnapshot();
  const [q, setQ] = useState(''), [busy, setBusy] = useState(false), [rec, setRec] = useState(false);
  const [res, setRes] = useState<AskResult | null>(null), [err, setErr] = useState('');
  const latest = useRef(q); latest.current = q;
  const input = useRef<HTMLTextAreaElement>(null);

  const ask = async (text = latest.current) => {
    const v = text.trim(); if (!v || busy) return;
    setBusy(true); setErr(''); setRes(null);
    try {
      const r = await askClaude(v, snap.me!, snap.members, snap.events, snap.birthdays);
      // Wünsche gleich ausführen: bearbeiten, neuer Termin, Geburtstage
      if (r.action === 'edit' && r.target && r.events.length <= 1) { edit(eventDraft(r.target)); return; }
      if (r.action === 'open' && r.target && r.events.length <= 1) { open(r.target.id); return; }
      if (r.action === 'new' && r.newText) { toDraft(await parseSpoken(r.newText, snap.me!, snap.members.filter(m => m.role !== 'guest'))); return; }
      setRes(r);
    } catch (x) { setErr(x instanceof Error ? x.message : String(x)); }
    finally { setBusy(false); }
  };

  // Android-App: Spracherkennung des Handys, danach gleich fragen
  useEffect(() => {
    const on = (e: Event) => { const t = String((e as CustomEvent).detail ?? '').trim(); setRec(false); if (t) { setQ(t); void ask(t); } };
    window.addEventListener('famto-speech', on);
    return () => window.removeEventListener('famto-speech', on);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Zaubertaste: Mikrofon geht sofort an; nach der Sprechpause fragt die App von selbst
  useEffect(() => {
    const t = setTimeout(() => { if (native()?.listen || SR) listen(); else input.current?.focus(); }, 350);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const listen = () => {
    const n = native();
    if (n?.listen) { setRec(true); n.listen(); return; }
    if (!SR) { toast('Hier geht Sprache nur über das Mikrofon der Tastatur. Oder einfach tippen.'); input.current?.focus(); return; }
    const x = new SR(); x.lang = 'de-DE'; x.interimResults = true; x.continuous = false;
    let t = '';
    x.onresult = e => { t = Array.from(e.results).map(r => r[0].transcript).join(' '); setQ(t); };
    x.onend = () => { setRec(false); if (t.trim()) void ask(t); };
    x.onerror = () => setRec(false);
    try { x.start(); setRec(true); } catch { setRec(false); }
  };

  const nm = (id: string | null) => snap.members.find(m => m.id === id)?.name ?? '';
  return (
    <Sheet onClose={close} label="Claude fragen">
      <h2>✨ Frag Claude</h2>
      <p className="note">Frag nach Terminen, Personen oder Geburtstagen, oder sag, was du ändern oder eintragen möchtest.</p>
      <div className="ask-in">
        <textarea ref={input} rows={2} value={q} placeholder="z. B. Wann treffe ich Tom das nächste Mal?" onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(); } }} aria-label="Deine Frage an Claude" />
        <button type="button" className={`btn ghost sm ask-mic${rec ? ' on' : ''}`} onClick={listen} aria-label="Frage sprechen"><Icon name="mic" /></button>
      </div>
      {!res && !busy && !err && <div className="ask-ideas">{IDEAS.map(i => <button key={i} type="button" onClick={() => { setQ(i); void ask(i); }}>{i}</button>)}</div>}
      {busy && <p className="note ask-busy">Claude sieht im Kalender nach …</p>}
      {err && <p className="note">{err}</p>}
      {res && <div className="ask-res">
        <p>{res.answer}</p>
        {res.events.length > 0 && <div className="ask-list">{res.events.map(e => (
          <button key={e.id} type="button" className="ask-ev" style={cvar(colorOf(snap.members, e.persons[0]))} onClick={() => open(e.id)}>
            <span className="d">{shortDate(e.date)}<small>{e.all_day ? 'ganztägig' : hm(e.start_min)}</small></span>
            <span className="t"><b>{e.title}</b><small>{[e.persons.map(nm).join(', '), e.place].filter(Boolean).join(' · ')}</small></span>
            {res.action === 'edit' && <span className="ask-edit" role="button" tabIndex={0} onClick={x => { x.stopPropagation(); edit(eventDraft(e)); }}>Bearbeiten</span>}
          </button>))}</div>}
        {res.birthdays.length > 0 && <div className="ask-list">{res.birthdays.map(b => (
          <button key={b.id} type="button" className="ask-ev" onClick={bdays}><span className="d">🎂</span><span className="t"><b>{b.name}</b><small>{bdLabel(b)}{b.year ? `, Jahrgang ${b.year}` : ''}</small></span></button>))}</div>}
      </div>}
      <div className="btn-row">
        <button type="button" className="btn ghost" onClick={close}>Schließen</button>
        <button type="button" className="btn" disabled={busy || !q.trim()} onClick={() => void ask()}>Fragen</button>
      </div>
    </Sheet>
  );
}
