import { useState } from 'react';
import { store } from '../lib/store';
import { avatarOf } from '../lib/supabase';
import { hm, toMin } from '../lib/dates';
import type { CalEvent, DisplayFeed } from '../lib/types';
import { cvar } from '../app/ui';
import { joinAddr, splitAddr } from '../app/EventSheet';

// Termin am Touch-Display bearbeiten oder löschen: erst antippen, wer man ist, dann ändern
export function DisplayEdit({ token, feed, ev, close, saved }: { token: string; feed: DisplayFeed; ev: CalEvent; close: () => void; saved: (msg: string) => void }) {
  const people = feed.members.filter(m => m.role !== 'guest');
  const [who, setWho] = useState<string | null>(null);
  const [d, setD] = useState({ title: ev.title, date: ev.date, all_day: ev.all_day, start: hm(ev.start_min), end: hm(ev.end_min), persons: [...ev.persons], driver: ev.driver ?? '', place: ev.place, addr: ev.addr, notes: ev.notes });
  const [busy, setBusy] = useState(false), [err, setErr] = useState(''), [del, setDel] = useState(false);
  const set = (p: Partial<typeof d>) => setD(x => ({ ...x, ...p }));
  const [street, town] = splitAddr(d.addr);

  const run = async (f: () => Promise<void>, msg: string) => {
    if (!who) { setErr('Bitte oben antippen, wer du bist.'); return; }
    setBusy(true); setErr('');
    try { await f(); saved(msg); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const save = () => {
    const s = toMin(d.start), e = toMin(d.end);
    if (!d.title.trim()) { setErr('Bitte einen Titel eingeben.'); return; }
    if (!d.all_day && e <= s) { setErr('Das Ende muss nach dem Beginn liegen.'); return; }
    const addr = d.addr.replace(/^,\s*/, '').trim();
    void run(() => store.displayUpdateEvent(token, who!, ev.id, {
      title: d.title.trim(), date: d.date, end_date: ev.end_date > d.date && ev.date === d.date ? ev.end_date : d.date, all_day: d.all_day,
      start_min: d.all_day ? 0 : s, end_min: d.all_day ? 1440 : e, persons: d.persons, driver: d.driver || null,
      place: d.place.trim(), addr, travel_min: addr === ev.addr ? ev.travel_min : null, notes: d.notes.trim()
    }), `Gespeichert: ${d.title.trim()}`);
  };

  return (
    <div className="w-ov" onClick={e => { if (e.target === e.currentTarget) close(); }}>
      <div className="w-card w-in w-edit" role="dialog" aria-label="Termin bearbeiten">
        <h4>Termin bearbeiten</h4>
        <div className="w-in-lbl">Wer bist du?</div>
        <div className="w-who">{people.map(m => { const a = avatarOf(m); return (
          <button key={m.id} type="button" className={`w-p${who === m.id ? ' on' : ''}`} style={cvar(m.color)} onClick={() => setWho(m.id)}>
            <span className={`b${a ? ' av' : ''}`}>{a ? <img src={a} alt="" /> : m.name[0]}</span><small>{m.name}</small></button>); })}</div>
        <label className="w-f"><span>Titel</span><input value={d.title} onChange={e => set({ title: e.target.value })} /></label>
        <div className="w-f2">
          <label className="w-f"><span>Datum</span><input type="date" value={d.date} onChange={e => set({ date: e.target.value })} /></label>
          <label className="w-f chk"><input type="checkbox" checked={d.all_day} onChange={e => set({ all_day: e.target.checked })} /><span>Ganztägig</span></label>
        </div>
        {!d.all_day && <div className="w-f2">
          <label className="w-f"><span>Beginn</span><input type="time" value={d.start} onChange={e => set({ start: e.target.value })} /></label>
          <label className="w-f"><span>Ende</span><input type="time" value={d.end} onChange={e => set({ end: e.target.value })} /></label>
        </div>}
        <div className="w-in-lbl">Wer ist dabei?</div>
        <div className="w-tog">{people.map(m => <button key={m.id} type="button" style={cvar(m.color)} aria-pressed={d.persons.includes(m.id)}
          onClick={() => set({ persons: d.persons.includes(m.id) ? d.persons.filter(x => x !== m.id) : [...d.persons, m.id] })}>{m.name}</button>)}</div>
        <label className="w-f"><span>Wer fährt?</span><select value={d.driver} onChange={e => set({ driver: e.target.value })}>
          <option value="">Niemand nötig</option>{people.filter(m => m.role !== 'child').map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        <label className="w-f"><span>Name des Ortes</span><input value={d.place} onChange={e => set({ place: e.target.value })} /></label>
        <div className="w-f2">
          <label className="w-f"><span>Straße und Hausnummer</span><input value={street} onChange={e => set({ addr: joinAddr(e.target.value, town) })} /></label>
          <label className="w-f"><span>PLZ und Ort</span><input value={town} onChange={e => set({ addr: joinAddr(street, e.target.value) })} /></label>
        </div>
        <label className="w-f"><span>Notiz</span><textarea value={d.notes} onChange={e => set({ notes: e.target.value })} /></label>
        {err && <div className="w-in-err">{err}</div>}
        <div className="w-in-btns">
          {del ? <>
            <span className="w-in-lbl" style={{ marginRight: 'auto' }}>Wirklich löschen?</span>
            <button type="button" className="w-btn ghost" onClick={() => setDel(false)}>Nein</button>
            <button type="button" className="w-btn danger" disabled={busy} onClick={() => void run(() => store.displayDeleteEvent(token, who!, ev.id), `Gelöscht: ${ev.title}`)}>Ja, löschen</button>
          </> : <>
            <button type="button" className="w-btn ghost danger-t" style={{ marginRight: 'auto' }} onClick={() => setDel(true)}>Löschen</button>
            <button type="button" className="w-btn ghost" onClick={close}>Abbrechen</button>
            <button type="button" className="w-btn" disabled={busy} onClick={save}>{busy ? 'Einen Moment …' : 'Speichern'}</button>
          </>}
        </div>
      </div>
    </div>
  );
}
