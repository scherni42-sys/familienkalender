import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { store, useSnapshot } from '../lib/store';
import type { ChatMsg, Member } from '../lib/types';
import { hm, today } from '../lib/dates';
import { shrinkPhoto } from '../lib/ai';
import { Badge, Icon, useLong } from './ui';
import { ClipMenu } from './ClipMenu';
import { EmojiPanel } from './Emoji';
import { native } from '../lib/native';
import { fail, toast } from './toast';
import { ask } from './ask';

// Chat von Person zu Person, wie bei WhatsApp: links die Liste, ein Tipp öffnet den Verlauf.
// Nur Absender und Empfänger sehen die Nachrichten, nie das Display.

const dayOf = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const timeOf = (iso: string) => { const d = new Date(iso); return hm(d.getHours() * 60 + d.getMinutes()); };
const whenC = (iso: string) => {
  const d = dayOf(iso), t = today();
  if (d === t) return timeOf(iso);
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (d === dayOf(y.toISOString())) return 'gestern';
  return new Date(iso).toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric' });
};
export const chatPreview = (c: ChatMsg) => c.kind === 'text' && c.media ? `📎 ${c.text || 'Dokument'}` : c.kind === 'image' ? `📷 ${c.text || 'Foto'}` : c.kind === 'voice' ? `🎤 Sprachnachricht${c.dur ? ` (${c.dur} s)` : ''}` : c.kind === 'place' ? '📍 Standort' : c.text;

// Gesprächsliste: je Person die letzte Nachricht und wie viele ungelesen sind
export function chatThreads(chats: ChatMsg[], me: string | null) {
  const by = new Map<string, { with: string; last: ChatMsg; unread: number }>();
  for (const c of chats) {
    const w = c.from_member === me ? c.to_member : c.from_member;
    const t = by.get(w) ?? { with: w, last: c, unread: 0 };
    if (c.created_at >= t.last.created_at) t.last = c;
    if (c.to_member === me && !c.read_at) t.unread++;
    by.set(w, t);
  }
  return [...by.values()].sort((a, b) => b.last.created_at.localeCompare(a.last.created_at));
}

function Media({ c }: { c: ChatMsg }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { if (c.media) store.chatUrl(c.media).then(setUrl, () => setUrl(null)); }, [c.media]);
  if (!c.media) return null;
  if (!url) return <div className="ch-load">Lädt …</div>;
  if (c.kind === 'text') return <a className="ch-file" href={url} target="_blank" rel="noreferrer"><Icon name="clip" /><span>{c.text || 'Dokument'}</span></a>;
  return c.kind === 'voice' ? <audio controls preload="none" src={url} /> : <a href={url} target="_blank" rel="noreferrer" className="ch-img"><img src={url} alt={c.text || 'Foto'} loading="lazy" /></a>;
}

function Bubble({ c, mine, del }: { c: ChatMsg; mine: boolean; del: () => void }) {
  const l = useLong(() => { if (mine) del(); });
  const time = <small className="ch-time">
    {/* Sprachnachricht, Foto, Datei: lange drücken trifft oft das Bedienfeld, daher ein eigener Papierkorb */}
    {mine && c.media && <button type="button" className="ch-del" aria-label="Nachricht löschen" onClick={del}><Icon name="trash" /></button>}
    {timeOf(c.created_at)}{mine ? (c.read_at ? ' ✓✓' : ' ✓') : ''}</small>;
  const maps = c.lat != null && c.lon != null ? `https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lon}` : '';
  return (
    <div className={`ch-b${mine ? ' me' : ''}`} {...l.on}>
      {c.kind === 'place' ? <a className="ch-place" href={maps} target="_blank" rel="noreferrer"><Icon name="place" /><span><b>Standort</b><small>In Karte öffnen</small></span></a> : null}
      {c.media ? <Media c={c} /> : null}
      {/* Uhrzeit wie bei WhatsApp: rechts in der letzten Textzeile, wenn dort Platz ist */}
      {c.text && !(c.kind === 'text' && c.media) ? <div className="ch-t">{c.text}{time}</div> : time}
    </div>
  );
}

// Sprachnachricht: einmal tippen startet, Stopp sendet, ✕ verwirft
function useRecorder(send: (b: Blob, sec: number) => void) {
  const [sec, setSec] = useState<number | null>(null);
  const rec = useRef<{ r: MediaRecorder; parts: Blob[]; start: number; keep: boolean; tick: ReturnType<typeof setInterval> } | null>(null);
  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg'].find(t => MediaRecorder.isTypeSupported?.(t));
      const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const cur = { r, parts: [] as Blob[], start: Date.now(), keep: true, tick: setInterval(() => setSec(Math.round((Date.now() - cur.start) / 1000)), 500) };
      r.ondataavailable = e => { if (e.data.size) cur.parts.push(e.data); };
      r.onstop = () => {
        clearInterval(cur.tick); stream.getTracks().forEach(t => t.stop()); setSec(null); rec.current = null;
        const s = Math.max(1, Math.round((Date.now() - cur.start) / 1000));
        if (cur.keep && cur.parts.length) send(new Blob(cur.parts, { type: (r.mimeType || 'audio/webm').split(';')[0] }), s);
      };
      rec.current = cur; r.start(); setSec(0);
      // Nach 3 Minuten automatisch senden
      setTimeout(() => { if (rec.current === cur && r.state === 'recording') r.stop(); }, 180_000);
    } catch (e) {
      // In der Android-App: Erlaubnis anfragen bzw. gleich zur Freigabe; danach einfach nochmal aufs Mikrofon tippen
      const n = native(), why = e instanceof Error ? e.name : '';
      const st = n?.askMic?.();
      if (st === 'asked') toast('Bitte das Mikrofon erlauben, dann nochmal aufs Mikrofon tippen.');
      else if (st === 'ok') { toast(`Mikrofon ging nicht (${why || 'unbekannt'}). Bitte nochmal tippen.`); }
      else toast('Kein Zugriff aufs Mikrofon. Bitte in den Handy-Einstellungen erlauben.');
    }
  };
  const stop = (keep: boolean) => { const c = rec.current; if (!c) return; c.keep = keep; c.r.stop(); };
  return { sec, start, stop };
}

function Thread({ w, back }: { w: Member; back: () => void }) {
  const snap = useSnapshot();
  const me = snap.me!;
  const list = (snap.chats ?? []).filter(c => (c.from_member === me && c.to_member === w.id) || (c.from_member === w.id && c.to_member === me));
  const [text, setText] = useState(''), [busy, setBusy] = useState(false), [emo, setEmo] = useState(false);
  const inp = useRef<HTMLInputElement>(null);
  // Emoji an der Schreibmarke einfügen
  const addEmoji = (e: string) => {
    const el = inp.current, a = el?.selectionStart ?? text.length, b = el?.selectionEnd ?? text.length;
    setText(text.slice(0, a) + e + text.slice(b));
    requestAnimationFrame(() => { if (el) { el.setSelectionRange(a + e.length, a + e.length); } });
  };
  const end = useRef<HTMLDivElement>(null);
  // Name und Bild stehen oben in der Zeile neben „Chat“ (Platz dafür legt WidgetView an)
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => { setSlot(document.getElementById('wv-chat-slot')); }, []);
  const unread = list.some(c => c.to_member === me && !c.read_at);
  useEffect(() => { if (unread) void store.chatSeen(w.id).catch(() => {}); }, [unread, w.id]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [list.length]);
  const go = (p: Promise<void>) => { setBusy(true); return p.catch(fail).finally(() => setBusy(false)); };
  const voice = useRecorder((b, sec) => void go(store.sendChat(w.id, { kind: 'voice', blob: b, dur: sec })));
  const photo = async (f?: File) => {
    if (!f) return;
    try { const p = await shrinkPhoto(f); const blob = await (await fetch(`data:${p.type};base64,${p.data}`)).blob(); await go(store.sendChat(w.id, { kind: 'image', blob, text: text.trim() })); setText(''); }
    catch { toast('Das Foto ließ sich nicht öffnen.'); }
  };
  const doc = (f: File) => {
    if (f.size > 10 * 1024 * 1024) { toast('Die Datei ist zu groß (höchstens 10 MB).'); return; }
    void go(store.sendChat(w.id, { kind: 'text', blob: f, name: f.name, text: f.name }));
  };
  const place = () => {
    if (!navigator.geolocation) { toast('Standort geht auf diesem Gerät nicht.'); return; }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      p => void go(store.sendChat(w.id, { kind: 'place', lat: +p.coords.latitude.toFixed(5), lon: +p.coords.longitude.toFixed(5) })).then(() => toast('Standort gesendet.')),
      () => { setBusy(false); toast('Standort nicht verfügbar. Bitte Standort am Handy einschalten.'); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  };
  const days = snap.family!.settings.chatDays ?? 7;
  let lastDay = '';
  return (
    <div className="ch-thread">
      {(() => { const head = <div className="ch-head">
        <button type="button" className="ch-back" aria-label="Zurück zur Chatliste" onClick={back}><Icon name="back" /></button>
        <Badge m={w} size={40} plain /><b>{w.name}</b>
      </div>; return slot ? createPortal(head, slot) : head; })()}
      <div className="ch-list">
        {!list.length && <div className="ch-empty">Noch keine Nachrichten. Nur du und {w.name} sehen diesen Chat.</div>}
        {list.map(c => {
          const d = dayOf(c.created_at), sep = d !== lastDay; lastDay = d;
          return <div key={c.id} className="ch-row">
            {sep && <div className="ch-day">{d === today() ? 'Heute' : whenC(c.created_at)}</div>}
            <Bubble c={c} mine={c.from_member === me} del={() => { void ask('Diese Nachricht löschen?', 'Löschen').then(y => { if (y) void store.deleteChat(c.id).catch(fail); }); }} />
          </div>;
        })}
        <div ref={end} />
      </div>
      <div className="ch-note">Verschwindet nach {days === 1 ? '1 Tag' : `${days} Tagen`}.</div>
      {voice.sec !== null ? (
        <div className="ch-compose rec">
          <button type="button" className="ch-i" aria-label="Aufnahme verwerfen" onClick={() => voice.stop(false)}>✕</button>
          <span className="ch-rec"><i />Aufnahme {Math.floor(voice.sec / 60)}:{String(voice.sec % 60).padStart(2, '0')}</span>
          <button type="button" className="ch-send" aria-label="Sprachnachricht senden" onClick={() => voice.stop(true)}><Icon name="send" /></button>
        </div>
      ) : (
        <form className="ch-compose" onSubmit={e => { e.preventDefault(); const v = text.trim(); if (!v || busy) return; void go(store.sendChat(w.id, { kind: 'text', text: v })).then(() => setText('')); }}>
          <ClipMenu image={f => void photo(f)} doc={doc} place={place} disabled={busy} />
          <span className="ch-field">
            <button type="button" className={`ch-emo${emo ? ' on' : ''}`} aria-label={emo ? 'Tastatur' : 'Emoji'} aria-pressed={emo} onClick={() => { setEmo(!emo); if (emo) inp.current?.focus(); else inp.current?.blur(); }}>
              {emo ? <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><rect x="2.5" y="6" width="19" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M6 9.5h1M9.5 9.5h1M13 9.5h1M16.5 9.5h1M6 12.5h1M9.5 12.5h1M13 12.5h1M16.5 12.5h1M8 15.2h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
                : <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" strokeWidth="1.8" /><circle cx="9" cy="10" r="1.2" fill="currentColor" /><circle cx="15" cy="10" r="1.2" fill="currentColor" /><path d="M8 14.2q4 3.6 8 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>}
            </button>
            <input ref={inp} value={text} onChange={e => setText(e.target.value)} onFocus={() => setEmo(false)} placeholder={`Nachricht an ${w.name}`} maxLength={2000} aria-label="Nachricht" />
          </span>
          {text.trim() ? <button className="ch-send" aria-label="Senden" disabled={busy}>{busy ? <span className="spin" /> : <Icon name="send" />}</button>
            : <button type="button" className="ch-send" aria-label="Sprachnachricht aufnehmen" disabled={busy} onClick={() => void voice.start()}>{busy ? <span className="spin" /> : <Icon name="mic" />}</button>}
        </form>
      )}
      {emo && voice.sec === null && <EmojiPanel pick={addEmoji} />}
    </div>
  );
}

// plus: zählt hoch, wenn unten das ＋ gedrückt wird; dann die Auswahl „Neuer Chat mit …“
// inThread: meldet nach oben, ob gerade ein Gespräch offen ist (dann ohne ＋ unten, Eingabe fest unten)
export function Chat({ open, opened, plus = 0, inThread }: { open?: string | null; opened?: () => void; plus?: number; inThread?: (on: boolean) => void }) {
  const snap = useSnapshot();
  const me = snap.members.find(m => m.id === snap.me);
  const [w, setW] = useState<string | null>(open ?? null), [pick, setPick] = useState(false);
  useEffect(() => { if (open) { setW(open); opened?.(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (plus) { setW(null); setPick(true); } }, [plus]);
  if (!me || me.role === 'guest') return <div className="ch-empty">Gäste können nicht chatten.</div>;
  const people = snap.members.filter(m => m.id !== me.id && m.role !== 'guest');
  const who = people.find(m => m.id === w);
  return <ChatInner who={who} people={people} pick={pick} setPick={setPick} setW={setW} inThread={inThread} />;
}

function ChatInner({ who, people, pick, setPick, setW, inThread }: { who?: Member; people: Member[]; pick: boolean; setPick: (b: boolean) => void; setW: (id: string | null) => void; inThread?: (on: boolean) => void }) {
  const snap = useSnapshot();
  const on = !!who;
  useEffect(() => { inThread?.(on); }, [on]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => inThread?.(false), []); // eslint-disable-line react-hooks/exhaustive-deps
  if (who) return <Thread w={who} back={() => setW(null)} />;
  const threads = chatThreads(snap.chats ?? [], snap.me);
  const fresh = people.filter(p => !threads.some(t => t.with === p.id));
  return (
    <div className="ch-start">
      {threads.map(t => {
        const m = snap.members.find(x => x.id === t.with);
        return <button key={t.with} type="button" className={`ch-item${t.unread ? ' unread' : ''}`} onClick={() => setW(t.with)}>
          <Badge m={m} size={50} plain />
          <span className="ch-mid"><b>{m?.name ?? 'Unbekannt'}</b><small>{t.last.from_member === snap.me ? 'Du: ' : ''}{chatPreview(t.last)}</small></span>
          <span className="ch-side"><small>{whenC(t.last.created_at)}</small>{t.unread > 0 && <i>{t.unread}</i>}</span>
        </button>;
      })}
      {!threads.length && !pick && <div className="ch-empty">Noch keine Chats. Mit ＋ unten rechts schreibst du jemandem aus der Familie.</div>}
      {pick ? <div className="ch-pick">
        <div className="ch-pick-h">Neuer Chat mit …</div>
        {[...fresh, ...people.filter(p => !fresh.includes(p))].map(p => <button key={p.id} type="button" className="ch-item" onClick={() => { setPick(false); setW(p.id); }}><Badge m={p} size={50} plain /><span className="ch-mid"><b>{p.name}</b></span></button>)}
        {!people.length && <div className="ch-empty">In der Familie ist sonst noch niemand.</div>}
        <button type="button" className="ch-new" onClick={() => setPick(false)}>Abbrechen</button>
      </div> : null}
    </div>
  );
}
