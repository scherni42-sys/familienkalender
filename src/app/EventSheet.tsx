import { useState } from 'react';
import { store, useSnapshot } from '../lib/store';
import type { Draft } from '../lib/parse';
import type { NewEvent } from '../lib/types';
import { dayLabel, hm, toMin } from '../lib/dates';
import { conflicts, nameOf, whenText } from '../lib/model';
import { Badge, cvar, Icon, Sheet } from './ui';
import { fail, toast } from './toast';

// Entwurf in einen speicherbaren Termin umwandeln (auch für die Direkteingabe ohne Bestätigung)
export const toNewEvent = (d: Draft, bringTxt = d.bring.join(', ')): NewEvent => ({
  title: d.title.trim(), date: d.date, end_date: d.all_day ? (d.end_date < d.date ? d.date : d.end_date) : d.date,
  all_day: d.all_day, start_min: d.all_day ? 0 : d.start_min, end_min: d.all_day ? 1440 : d.end_min,
  persons: d.persons, driver: d.driver, vis: d.vis === 'family' ? 'family' : d.busy ? 'busy' : 'private',
  place: d.place.trim(), addr: d.addr.trim(), travel_min: d.driver && d.travel_min ? d.travel_min : null,
  notes: d.notes.trim(), bring: bringTxt.split(',').map(x => x.trim()).filter(Boolean), discreet: d.vis === 'family' && d.discreet
});

export function EventSheet({ draft, fresh, close, back, saved }: { draft: Draft; fresh: boolean; close: () => void; back: () => void; saved: (id: string) => void }) {
  const snap = useSnapshot();
  const s = snap.family!.settings;
  const [d, setD] = useState<Draft>(draft);
  const [busy, setBusy] = useState(false);
  const [bringTxt, setBringTxt] = useState(draft.bring.join(', '));
  const set = (p: Partial<Draft>) => setD(x => ({ ...x, ...p }));
  const people = snap.members.filter(m => m.role !== 'guest');
  const drivers = snap.members.filter(m => m.adult && m.role !== 'guest');
  const cf = conflicts(snap.events, snap.busy, d, snap.members, d.id);
  const others = d.persons.filter(id => id !== snap.me);
  const visText = d.vis === 'family'
    ? 'Alle in der Familie sehen den Termin, und er erscheint auf dem Display im Flur.'
    : d.busy ? 'Nur du siehst die Details. Die Familie sieht „belegt“, das Display zeigt nichts.' : 'Nur du siehst diesen Termin. Er erscheint nicht auf dem Display.';

  const save = async () => {
    if (!d.title.trim()) { toast('Bitte einen Titel eingeben.'); return; }
    if (!d.all_day && d.end_min <= d.start_min) { toast('Das Ende muss nach dem Beginn liegen.'); return; }
    setBusy(true);
    try {
      const id = await store.saveEvent(toNewEvent(d, bringTxt), d.id);
      toast(d.vis === 'family' ? 'Gespeichert. Steht jetzt auch auf dem Display.' : 'Gespeichert, nur für dich.');
      saved(id);
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!d.id || !confirm('Termin wirklich löschen?')) return;
    try { await store.deleteEvent(d.id); toast('Termin gelöscht.'); close(); } catch (e) { fail(e); }
  };

  return (
    <Sheet onClose={close} label="Termin bestätigen">
      <h2>{fresh ? 'Stimmt das so?' : 'Termin bearbeiten'}</h2>
      {fresh && <div className="ai"><Icon name="spark" /><div>
        {d.suggested === d.vis ? <><b>Passt: {d.vis === 'family' ? 'Familie' : 'Privat'}</b>, weil {d.reason}.</>
          : <><b>Hinweis:</b> Du hast {d.vis === 'family' ? 'Familie' : 'Privat'} gewählt. Ich hätte {d.suggested === 'family' ? 'Familie' : 'Privat'} vorgeschlagen, weil {d.reason}.</>}
        {d.timeFound ? '' : ' Keine Uhrzeit genannt, daher ganztägig.'}
        {d.source && <span className="note" style={{ display: 'block' }}>{d.source === 'ai' ? 'Erkannt von Claude' : `Einfache Erkennung (ohne KI${d.why ? ': ' + d.why : ''})`}</span>}
      </div></div>}
      <div className="visbig" role="group" aria-label="Sichtbarkeit">
        <button type="button" className="private" aria-pressed={d.vis === 'private'} onClick={() => set({ vis: 'private' })}><Icon name="lock" />Privat<small>nur ich</small></button>
        <button type="button" className="family" aria-pressed={d.vis === 'family'} onClick={() => set({ vis: 'family' })}><Icon name="home" />Familie<small>alle + Display</small></button>
      </div>
      {d.vis === 'private' && <label className="busyopt"><input type="checkbox" checked={d.busy} onChange={e => set({ busy: e.target.checked })} /> Familie sieht „belegt“ (ohne Details)</label>}
      <p>{visText}</p>
      {d.vis === 'private' && others.length > 0 && <div className="warnbox">Achtung: {others.map(id => nameOf(snap.members, id)).join(', ')} sieht diesen privaten Termin nicht.</div>}

      <label className="field"><span>Titel</span><input value={d.title} onChange={e => set({ title: e.target.value })} maxLength={80} /></label>
      <div className="row2">
        <label className="busyopt wide"><input type="checkbox" checked={d.all_day} onChange={e => set(e.target.checked ? { all_day: true } : { all_day: false, start_min: 18 * 60, end_min: 19 * 60 })} /> Ganztägig</label>
        {d.all_day ? <>
          <label className="field"><span>Von</span><input type="date" value={d.date} onChange={e => e.target.value && set({ date: e.target.value, end_date: d.end_date < e.target.value ? e.target.value : d.end_date })} /></label>
          <label className="field"><span>Bis</span><input type="date" value={d.end_date < d.date ? d.date : d.end_date} min={d.date} onChange={e => e.target.value && set({ end_date: e.target.value })} /></label>
          <span className="note wide">{whenText({ ...d, end_date: d.end_date < d.date ? d.date : d.end_date })}</span>
        </> : <>
          <label className="field wide"><span>Datum · {dayLabel(d.date)}</span><input type="date" value={d.date} onChange={e => e.target.value && set({ date: e.target.value, end_date: e.target.value })} /></label>
          <label className="field"><span>Beginn</span><input type="time" value={hm(d.start_min)} onChange={e => { if (!e.target.value) return; const n = toMin(e.target.value), len = d.end_min - d.start_min; set({ start_min: n, end_min: Math.min(n + Math.max(len, 15), 1439) }); }} /></label>
          <label className="field"><span>Ende</span><input type="time" value={hm(d.end_min)} onChange={e => e.target.value && set({ end_min: toMin(e.target.value) })} /></label>
        </>}
      </div>
      <div className="field"><span>Wer ist dabei?</span>
        <div className="ptoggle">{people.map(m => <button key={m.id} type="button" style={cvar(m.color)} aria-pressed={d.persons.includes(m.id)}
          onClick={() => set({ persons: d.persons.includes(m.id) ? d.persons.filter(x => x !== m.id) : [...d.persons, m.id] })}><Badge m={m} />{m.name}</button>)}</div>
        {d.persons.length === 0 && <span className="note">Niemand ausgewählt: Der Termin steht ohne Namen im Kalender, z. B. für Handwerker oder Müllabfuhr.</span>}
      </div>
      <label className="field"><span>Wer fährt?</span>
        <select value={d.driver ?? ''} onChange={e => set({ driver: e.target.value || null })}>
          <option value="">Niemand nötig</option>
          {drivers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </label>
      <label className="field"><span>Ort</span><input value={d.place} onChange={e => set({ place: e.target.value })} placeholder="z. B. Sportplatz Nord" /></label>
      <label className="field"><span>Adresse</span><input value={d.addr} onChange={e => set({ addr: e.target.value })} placeholder="Straße, Ort" /></label>
      {d.driver && s.showTravel && !d.all_day && (
        <div className="row2">
          <label className="field"><span>Fahrzeit (Min.)</span><input type="number" inputMode="numeric" min={0} max={240} value={d.travel_min ?? ''} onChange={e => set({ travel_min: e.target.value ? Math.max(0, Math.min(240, Number(e.target.value))) : null })} placeholder="z. B. 15" /></label>
          <div className="note" style={{ alignSelf: 'end' }}>{d.travel_min ? <>Los um <b>{hm(d.start_min - d.travel_min - s.buffer)}</b>{s.buffer ? ` (mit ${s.buffer} Min. Puffer)` : ''}</> : 'Mit Fahrzeit zeigt die App, wann es losgeht.'}</div>
        </div>
      )}
      <label className="field"><span>Mitbringen (mit Komma trennen)</span><input value={bringTxt} onChange={e => setBringTxt(e.target.value)} placeholder="z. B. Trinkflasche, Schienbeinschoner" /></label>
      <label className="field"><span>Notiz</span><textarea value={d.notes} onChange={e => set({ notes: e.target.value })} placeholder="z. B. Abholen am Vereinsheim" /></label>
      {d.vis === 'family' && <label className="busyopt"><input type="checkbox" checked={d.discreet} onChange={e => set({ discreet: e.target.checked })} /> Diskret: im Gäste-Modus nur „Termin“ zeigen</label>}
      {cf.length > 0 && <div className="warnbox"><b>Achtung, Überschneidung</b>{cf.map(c => <span key={c}>{c}</span>)}</div>}
      <div className="btn-row">
        {fresh ? <button type="button" className="btn ghost" onClick={back}>Neu sprechen</button>
          : d.id ? <button type="button" className="btn ghost" onClick={() => void remove()}>Löschen</button>
          : <button type="button" className="btn ghost" onClick={close}>Abbrechen</button>}
        <button type="button" className="btn" disabled={busy} onClick={() => void save()}>Speichern</button>
      </div>
    </Sheet>
  );
}
