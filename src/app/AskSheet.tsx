import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isPro, useSnapshot } from '../lib/store';
import { askClaude, parseSpoken, type AskResult } from '../lib/ai';
import type { Draft } from '../lib/parse';
import { hm, shortDate } from '../lib/dates';
import { bdLabel, colorOf } from '../lib/model';
import { native } from '../lib/native';
import { eventDraft } from './DetailSheet';
import { cvar, Icon, Sheet } from './ui';
import { toast } from './toast';
import { eur, type Receipt } from '../lib/cash';
import { CatIcon } from './CashIcons';
import { store } from '../lib/store';
import { dishShop } from '../lib/shop';
import { shopToast } from './ShopSheet';

type Rec = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };
const SR = (window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }).SpeechRecognition
  ?? (window as unknown as { webkitSpeechRecognition?: new () => Rec }).webkitSpeechRecognition;

const IDEAS = ['Wann treffe ich Tom das nächste Mal?', 'Alle Termine mit Oma', 'Wer fährt diese Woche?', 'Einkaufen für Wiener Schnitzel mit Kartoffelstampf', 'Wann hat Opa Geburtstag?', 'Was habe ich diesen Monat getankt?'];

// Zaubertaste: in eigenen Worten fragen oder etwas erledigen lassen
export function AskSheet({ close, open, edit, toDraft, bdays, receipt, shop }: { close: () => void; open: (id: string) => void; edit: (d: Draft) => void; toDraft: (d: Draft) => void; bdays: () => void; receipt: (r: Receipt) => void; shop?: () => void }) {
  const snap = useSnapshot();
  const [q, setQ] = useState(''), [busy, setBusy] = useState(false), [rec, setRec] = useState(false);
  const [res, setRes] = useState<AskResult | null>(null), [err, setErr] = useState(''), [phase, setPhase] = useState<'ask' | 'shop'>('ask');
  const latest = useRef(q); latest.current = q;
  const input = useRef<HTMLTextAreaElement>(null);

  // Diktat: Sprechpausen beenden nichts. Erst „Fragen“ schickt ab, das Mikrofon beendet nur das Zuhören.
  const want = useRef(false);        // Nutzer will weiter sprechen (nach einer Pause neu starten)
  const base = useRef('');           // Text vor dem laufenden Erkennungs-Durchgang
  const sendAfter = useRef(false);   // „Fragen“ während des Sprechens: erst das letzte Stück abwarten
  const web = useRef<Rec | null>(null);
  const join = (a: string, b: string) => [a.trim(), b.trim()].filter(Boolean).join(' ');

  const ask = async (text = latest.current) => {
    const v = text.trim(); if (!v || busy) return;
    setBusy(true); setErr(''); setRes(null); setPhase('ask');
    try {
      const r = await askClaude(v, snap.me!, snap.members, snap.events, snap.birthdays);
      // Wünsche gleich ausführen: bearbeiten, neuer Termin, Geburtstage
      if (r.action === 'edit' && r.target && r.events.length <= 1) { edit(eventDraft(r.target)); return; }
      if (r.action === 'open' && r.target && r.events.length <= 1) { open(r.target.id); return; }
      if (r.action === 'new' && r.newText) { toDraft(await parseSpoken(r.newText, snap.me!, snap.members.filter(m => m.role !== 'guest'))); return; }
      // Gericht genannt: Claude stellt die Zutaten zusammen, sie kommen unten auf den Einkaufszettel (ohne Angabe für die ganze Familie)
      if (r.action === 'shop' && r.dish) {
        setPhase('shop');
        const n = r.servings && r.servings > 0 ? r.servings : Math.max(1, snap.members.filter(m => m.role !== 'guest').length);
        const d = await dishShop(r.dish, n, snap.shopping ?? []);
        if (!d.found) { setRes({ ...r, answer: `Zu „${r.dish}“ habe ich keine Zutaten gefunden. Versuch es mit einem anderen Namen.` }); return; }
        shopToast(await store.addShop(d.items), d.dish);
        if (shop) shop(); else setRes(r);
        return;
      }
      setRes(r);
    } catch (x) { setErr(x instanceof Error ? x.message : String(x)); }
    finally { setBusy(false); }
  };
  const askRef = useRef(ask); askRef.current = ask;

  // Ein Durchgang der Erkennung ist fertig (Pause, Stopp oder Fehler)
  const done = (t: string) => {
    if (t.trim()) { base.current = join(base.current, t); setQ(base.current); }
    if (sendAfter.current) { sendAfter.current = false; want.current = false; setRec(false); void askRef.current(base.current || latest.current); return; }
    // Nur Pause: weiter zuhören, bis der Nutzer selbst aufhört
    if (want.current && t.trim()) { const n = native(); if (n?.listen) { window.setTimeout(() => { if (want.current) n.listen!(); }, 250); return; } }
    want.current = false; setRec(false);
  };
  const doneRef = useRef(done); doneRef.current = done;

  // Android-App: Spracherkennung des Handys
  useEffect(() => {
    const on = (e: Event) => doneRef.current(String((e as CustomEvent).detail ?? ''));
    // Zwischenstand live ins Feld, hinter das schon Gesagte
    const part = (e: Event) => setQ(join(base.current, String((e as CustomEvent).detail ?? '')));
    // Fehler nur zeigen, wenn noch nichts im Feld steht (lange Pause nach dem Sprechen ist kein Fehler)
    const bad = (e: Event) => { if (!latest.current.trim()) setErr(String((e as CustomEvent).detail ?? '')); };
    const st = (e: Event) => { if (want.current) setRec(true); if ((e as CustomEvent).detail === 'listening') setErr(''); };
    window.addEventListener('famto-speech', on);
    window.addEventListener('famto-speech-partial', part);
    window.addEventListener('famto-speech-error', bad);
    window.addEventListener('famto-speech-state', st);
    return () => {
      window.removeEventListener('famto-speech', on); window.removeEventListener('famto-speech-partial', part); window.removeEventListener('famto-speech-error', bad); window.removeEventListener('famto-speech-state', st);
      // Fenster zu: Mikrofon aus
      if (want.current) { want.current = false; native()?.stopListen?.(); }
      web.current?.stop();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Feld wächst mit dem Text
  useLayoutEffect(() => {
    const el = input.current; if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 2, Math.round(window.innerHeight * 0.45))}px`;
  }, [q]);

  const stop = () => {
    want.current = false;
    native()?.stopListen?.();
    web.current?.stop();
  };

  const listen = () => {
    if (want.current) { stop(); setRec(false); return; }
    const n = native();
    base.current = latest.current; setErr('');
    if (n?.listen) { want.current = true; setRec(true); n.listen(); return; }
    if (!SR) { toast('Hier geht Sprache nur über das Mikrofon der Tastatur. Oder einfach tippen.'); input.current?.focus(); return; }
    const x = new SR(); x.lang = 'de-DE'; x.interimResults = true; x.continuous = true;
    let t = '';
    x.onresult = e => { t = Array.from(e.results).map(r => r[0].transcript).join(' '); setQ(join(base.current, t)); };
    x.onend = () => { web.current = null; want.current = false; doneRef.current(t); };
    x.onerror = () => { want.current = false; };
    try { x.start(); web.current = x; want.current = true; setRec(true); } catch { setRec(false); }
  };

  // „Fragen“: beim Sprechen erst das letzte Stück abwarten, dann abschicken
  const send = () => {
    if (!want.current) { void ask(); return; }
    sendAfter.current = true; stop();
    window.setTimeout(() => { if (sendAfter.current) { sendAfter.current = false; setRec(false); void askRef.current(); } }, 2500);
  };

  const nm = (id: string | null) => snap.members.find(m => m.id === id)?.name ?? '';
  return (
    <Sheet onClose={close} label="Claude fragen">
      {isPro() ? <>
        <h2>✨ Frag Claude</h2>
        <p className="note">Frag nach Terminen, Personen, Geburtstagen oder Belegen im Kassenbuch, sag, was du ändern oder eintragen möchtest, oder nenn ein Gericht, für das du einkaufen willst.</p>
      </> : <>
        <h2>🔎 Suchen <span className="pro-tag">Claude: Pro</span></h2>
        <p className="note">Such nach Namen, Terminen oder Orten. Mit FamTO Pro beantwortet Claude jede Frage und trägt auch Termine für dich ein.</p>
      </>}
      {/* Mikrofon wie bei „Neuer Eintrag“: grün, erst antippen, beim Zuhören orange */}
      <div className="listen"><button type="button" className={`mic${rec ? ' rec' : ''}`} onClick={listen} aria-label={rec ? 'Zuhören beenden' : 'Frage sprechen'}><Icon name="mic" /></button></div>
      <p style={{ textAlign: 'center' }}>{rec ? 'Ich höre zu … Kurze Pausen sind kein Problem. Mikrofon antippen zum Beenden.' : q.trim() ? 'Fertig? Dann „Fragen“ tippen.' : 'Tippe aufs Mikrofon und sprich, oder schreib deine Frage.'}</p>
      <div className="ask-in">
        <textarea ref={input} rows={3} value={q} placeholder="z. B. Wann treffe ich Tom das nächste Mal?" onChange={e => { setQ(e.target.value); if (!want.current) base.current = e.target.value; }}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} aria-label="Deine Frage an Claude" />
      </div>
      {!res && !busy && !err && !rec && !q.trim() && <div className="ask-ideas">{IDEAS.map(i => <button key={i} type="button" onClick={() => { setQ(i); void ask(i); }}>{i}</button>)}</div>}
      {busy && <p className="note ask-busy">{phase === 'shop' ? 'Claude stellt die Zutaten zusammen …' : isPro() ? 'Claude sieht im Kalender nach …' : 'Suche …'}</p>}
      {err && <p className="note">{err}</p>}
      {res && <div className="ask-res">
        <p>{res.answer}</p>
        {res.events.length > 0 && <div className="ask-list">{res.events.map(e => (
          <button key={e.id} type="button" className="ask-ev" style={cvar(colorOf(snap.members, e.persons[0]))} onClick={() => open(e.id)}>
            <span className="d">{shortDate(e.date)}<small>{e.all_day ? 'ganztägig' : hm(e.start_min)}</small></span>
            <span className="t"><b>{e.title}</b><small>{[e.persons.map(nm).join(', '), e.place].filter(Boolean).join(' · ')}</small></span>
            {res.action === 'edit' && <span className="ask-edit" role="button" tabIndex={0} onClick={x => { x.stopPropagation(); edit(eventDraft(e)); }}>Bearbeiten</span>}
          </button>))}</div>}
        {res.receipts.length > 0 && <div className="ask-list">{res.receipts.map(r => (
          <button key={r.id} type="button" className="ask-ev" onClick={() => receipt(r)}>
            <span className="d"><CatIcon c={r.category} size={22} /></span>
            <span className="t"><b>{r.merchant || 'Beleg'}</b><small>{new Date(r.bought_at).toLocaleDateString('de-DE')}{r.grp ? ` · ${r.grp}` : ''}{r.scope === 'family' ? ' · Familie' : ''}</small></span>
            <b className="ask-amt">{eur(r.total)}</b>
          </button>))}</div>}
        {res.birthdays.length > 0 && <div className="ask-list">{res.birthdays.map(b => (
          <button key={b.id} type="button" className="ask-ev" onClick={bdays}><span className="d">🎂</span><span className="t"><b>{b.name}</b><small>{bdLabel(b)}{b.year ? `, Jahrgang ${b.year}` : ''}</small></span></button>))}</div>}
      </div>}
      <div className="btn-row">
        <button type="button" className="btn ghost" onClick={close}>Schließen</button>
        <button type="button" className="btn" disabled={busy || !q.trim()} onClick={send}>Fragen</button>
      </div>
    </Sheet>
  );
}
