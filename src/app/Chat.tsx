import { useEffect, useRef, useState } from 'react';
import { store, useSnapshot } from '../lib/store';
import type { ChatMsg, Member } from '../lib/types';
import { hm, today } from '../lib/dates';
import { shrinkPhoto } from '../lib/ai';
import { Badge, Icon, useLong } from './ui';
import { fail, toast } from './toast';

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
export const chatPreview = (c: ChatMsg) => c.kind === 'image' ? `📷 ${c.text || 'Foto'}` : c.kind === 'voice' ? `🎤 Sprachnachricht${c.dur ? ` (${c.dur} s)` : ''}` : c.kind === 'place' ? '📍 Standort' : c.text;

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
  return c.kind === 'voice' ? <audio controls preload="none" src={url} /> : <a href={url} target="_blank" rel="noreferrer" className="ch-img"><img src={url} alt={c.text || 'Foto'} loading="lazy" /></a>;
}

function Bubble({ c, mine, del }: { c: ChatMsg; mine: boolean; del: () => void }) {
  const l = useLong(() => { if (mine) del(); });
  const maps = c.lat != null && c.lon != null ? `https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lon}` : '';
  return (
    <div className={`ch-b${mine ? ' me' : ''}`} {...l.on}>
      {c.kind === 'place' ? <a className="ch-place" href={maps} target="_blank" rel="noreferrer"><Icon name="place" /><span><b>Standort</b><small>In Karte öffnen</small></span></a> : null}
      {c.kind === 'image' || c.kind === 'voice' ? <Media c={c} /> : null}
      {c.text && <div className="ch-t">{c.text}</div>}
      <small className="ch-time">{timeOf(c.created_at)}{mine ? (c.read_at ? ' ✓✓' : ' ✓') : ''}</small>
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
    } catch { toast('Kein Zugriff aufs Mikrofon. Bitte in den Handy-Einstellungen erlauben.'); }
  };
  const stop = (keep: boolean) => { const c = rec.current; if (!c) return; c.keep = keep; c.r.stop(); };
  return { sec, start, stop };
}

function Thread({ w, back }: { w: Member; back: () => void }) {
  const snap = useSnapshot();
  const me = snap.me!;
  const list = (snap.chats ?? []).filter(c => (c.from_member === me && c.to_member === w.id) || (c.from_member === w.id && c.to_member === me));
  const [text, setText] = useState(''), [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
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
      <div className="ch-head">
        <button type="button" className="ch-back" aria-label="Zurück zur Chatliste" onClick={back}><Icon name="back" /></button>
        <Badge m={w} size={34} /><b>{w.name}</b>
      </div>
      <div className="ch-list">
        {!list.length && <div className="ch-empty">Noch keine Nachrichten. Nur du und {w.name} sehen diesen Chat.</div>}
        {list.map(c => {
          const d = dayOf(c.created_at), sep = d !== lastDay; lastDay = d;
          return <div key={c.id} className="ch-row">
            {sep && <div className="ch-day">{d === today() ? 'Heute' : whenC(c.created_at)}</div>}
            <Bubble c={c} mine={c.from_member === me} del={() => { if (confirm('Diese Nachricht löschen?')) void store.deleteChat(c.id).catch(fail); }} />
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
          <label className="ch-i" aria-label="Foto senden"><Icon name="camera" /><input type="file" accept="image/*" hidden onChange={e => { void photo(e.target.files?.[0]); e.target.value = ''; }} /></label>
          <button type="button" className="ch-i" aria-label="Standort senden" disabled={busy} onClick={place}><Icon name="place" /></button>
          <input value={text} onChange={e => setText(e.target.value)} placeholder={`Nachricht an ${w.name}`} maxLength={2000} aria-label="Nachricht" />
          {text.trim() ? <button className="ch-send" aria-label="Senden" disabled={busy}>{busy ? <span className="spin" /> : <Icon name="send" />}</button>
            : <button type="button" className="ch-send" aria-label="Sprachnachricht aufnehmen" disabled={busy} onClick={() => void voice.start()}>{busy ? <span className="spin" /> : <Icon name="mic" />}</button>}
        </form>
      )}
    </div>
  );
}

export function Chat({ open, opened }: { open?: string | null; opened?: () => void }) {
  const snap = useSnapshot();
  const me = snap.members.find(m => m.id === snap.me);
  const [w, setW] = useState<string | null>(open ?? null), [pick, setPick] = useState(false);
  useEffect(() => { if (open) { setW(open); opened?.(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!me || me.role === 'guest') return <div className="ch-empty">Gäste können nicht chatten.</div>;
  const people = snap.members.filter(m => m.id !== me.id && m.role !== 'guest');
  const who = people.find(m => m.id === w);
  if (who) return <Thread w={who} back={() => setW(null)} />;
  const threads = chatThreads(snap.chats ?? [], snap.me);
  const fresh = people.filter(p => !threads.some(t => t.with === p.id));
  return (
    <div className="ch-start">
      {threads.map(t => {
        const m = snap.members.find(x => x.id === t.with);
        return <button key={t.with} type="button" className={`ch-item${t.unread ? ' unread' : ''}`} onClick={() => setW(t.with)}>
          <Badge m={m} size={40} />
          <span className="ch-mid"><b>{m?.name ?? 'Unbekannt'}</b><small>{t.last.from_member === snap.me ? 'Du: ' : ''}{chatPreview(t.last)}</small></span>
          <span className="ch-side"><small>{whenC(t.last.created_at)}</small>{t.unread > 0 && <i>{t.unread}</i>}</span>
        </button>;
      })}
      {!threads.length && !pick && <div className="ch-empty">Noch keine Chats. Mit ＋ schreibst du jemandem aus der Familie.</div>}
      {pick ? <div className="ch-pick">
        <div className="ch-pick-h">Neuer Chat mit …</div>
        {[...fresh, ...people.filter(p => !fresh.includes(p))].map(p => <button key={p.id} type="button" className="ch-item" onClick={() => { setPick(false); setW(p.id); }}><Badge m={p} size={40} /><span className="ch-mid"><b>{p.name}</b></span></button>)}
        {!people.length && <div className="ch-empty">In der Familie ist sonst noch niemand.</div>}
      </div> : <button type="button" className="ch-new" onClick={() => setPick(true)}>＋ Neuer Chat</button>}
    </div>
  );
}
