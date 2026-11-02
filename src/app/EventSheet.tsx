import { useEffect, useState } from 'react';
import { store, useSnapshot } from '../lib/store';
import type { Draft } from '../lib/parse';
import type { NewEvent } from '../lib/types';
import { dayLabel, hm, toMin } from '../lib/dates';
import { conflicts, nameOf, whenText } from '../lib/model';
import { Badge, cvar, Icon, Sheet } from './ui';
import { fail, toast } from './toast';
import { suggestPlaces, travelTime, type PlaceHit } from '../lib/ai';

// Adresse in zwei Feldern: „Straße Nr“ und „PLZ Ort“, gespeichert als „Straße Nr, PLZ Ort“ (eindeutig für Route und Fahrzeit)
export const splitAddr = (a: string): [string, string] => { const k = a.lastIndexOf(','); return k < 0 ? [a, ''] : [a.slice(0, k), a.slice(k + 1).trimStart()]; };
export const joinAddr = (street: string, town: string) => street.replace(/,/g, ' ') + (town ? `, ${town}` : '');

// Entwurf in einen speicherbaren Termin umwandeln (auch für die Direkteingabe ohne Bestätigung)
export const toNewEvent = (d: Draft, bringTxt = d.bring.join(', ')): NewEvent => ({
  title: d.title.trim(), date: d.date, end_date: d.all_day ? (d.end_date < d.date ? d.date : d.end_date) : d.date,
  all_day: d.all_day, start_min: d.all_day ? 0 : d.start_min, end_min: d.all_day ? 1440 : d.end_min,
  persons: d.persons, driver: d.driver, vis: d.vis === 'family' ? 'family' : d.busy ? 'busy' : 'private',
  place: d.place.trim(), addr: d.addr.trim().replace(/^,\s*/, ''), travel_min: d.driver && d.travel_min ? d.travel_min : null,
  notes: d.notes.trim(), bring: bringTxt.split(',').map(x => x.trim()).filter(Boolean), discreet: d.vis === 'family' && d.discreet
});

export function EventSheet({ draft, fresh, close, back, saved }: { draft: Draft; fresh: boolean; close: () => void; back: () => void; saved: (id: string) => void }) {
  const snap = useSnapshot();
  const s = snap.family!.settings;
  const [calc, setCalc] = useState(false);
  const [d, setD] = useState<Draft>(draft);
  const [busy, setBusy] = useState(false);
  const [bringTxt, setBringTxt] = useState(draft.bring.join(', '));
  const set = (p: Partial<Draft>) => setD(x => ({ ...x, ...p }));
  const [hits, setHits] = useState<PlaceHit[] | null>(null);
  const [looking, setLooking] = useState<'' | 'osm' | 'web'>('');
  const [typed, setTyped] = useState(false);
  const hasAddr = !!d.addr.replace(/^,\s*/, '').trim();
  // Beim Tippen des Ortsnamens Vorschläge mit Adresse zeigen (wie bei Google Maps)
  useEffect(() => {
    const q = d.place.trim();
    if (!typed || q.length < 3) { setHits(null); return; }
    const t = setTimeout(() => { setLooking('osm'); suggestPlaces(q, s.home).then(setHits, () => setHits([])).finally(() => setLooking('')); }, 500);
    return () => clearTimeout(t);
  }, [d.place, typed]); // eslint-disable-line react-hooks/exhaustive-deps
  // Ort von der KI erkannt, aber keine Adresse: ersten Treffer vorbelegen
  useEffect(() => {
    if (!d.place.trim() || hasAddr) return;
    suggestPlaces(d.place.trim(), s.home).then(h => { if (h[0]) { setD(x => x.addr.trim() ? x : { ...x, addr: h[0].addr }); toast(`Adresse gefunden: ${h[0].addr}. Bitte kurz prüfen.`); } }, () => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (h: PlaceHit) => { set({ addr: h.addr, ...(h.name && h.name.length > d.place.trim().length ? { place: h.name } : {}) }); setTyped(false); setHits(null); };
  const webSearch = () => { setLooking('web'); suggestPlaces(d.place.trim(), s.home, true).then(h => { setHits(h); if (!h.length) toast('Auch im Internet nichts Eindeutiges gefunden. Bitte von Hand eintragen.'); }, fail).finally(() => setLooking('')); };
  const people = snap.members.filter(m => m.role !== 'guest');
  const drivers = snap.members.filter(m => m.adult && m.role !== 'guest');
  const cf = conflicts(snap.events, snap.busy, d, snap.members, d.id);
  const others = d.persons.filter(id => id !== snap.me);
  const visText = d.vis === 'family'
    ? 'Alle in der Familie sehen den Termin, und er erscheint auf dem Display im Flur.'
    : d.busy ? 'Nur du siehst den Termin. Trägt jemand etwas zur selben Zeit ein, warnt die App: „belegt“.' : 'Nur du siehst diesen Termin. Er erscheint nicht auf dem Display.';

  const save = async () => {
    if (!d.title.trim()) { toast('Bitte einen Titel eingeben.'); return; }
    if (!d.all_day && d.end_min <= d.start_min) { toast('Das Ende muss nach dem Beginn liegen.'); return; }
    setBusy(true);
    try {
      // Fahrer, Adresse, aber keine Fahrzeit: von zu Hause aus berechnen (für die Abfahrts-Erinnerung)
      let dd = d;
      const to = d.addr.replace(/^,\s*/, '').trim();
      if (d.driver && to && !d.travel_min && !d.all_day && s.home) {
        const r = await Promise.race([travelTime(s.home, to), new Promise<null>(res => setTimeout(() => res(null), 8000))]).catch(() => null);
        if (r) dd = { ...d, travel_min: r.minutes };
      }
      const id = await store.saveEvent(toNewEvent(dd, bringTxt), d.id);
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
      <h2>{fresh ? (d.reason ? 'Stimmt das so?' : 'Neuer Termin') : 'Termin bearbeiten'}</h2>
      {fresh && d.reason && <div className="ai"><Icon name="spark" /><div>
        {d.suggested === d.vis ? <><b>Passt: {d.vis === 'family' ? 'Familie' : 'Privat'}</b>, weil {d.reason}.</>
          : <><b>Hinweis:</b> Du hast {d.vis === 'family' ? 'Familie' : 'Privat'} gewählt. Ich hätte {d.suggested === 'family' ? 'Familie' : 'Privat'} vorgeschlagen, weil {d.reason}.</>}
        {d.timeFound ? '' : ' Keine Uhrzeit genannt, daher ganztägig.'}
        {d.source && <span className="note" style={{ display: 'block' }}>{d.source === 'ai' ? 'Erkannt von Claude' : `Einfache Erkennung (ohne KI${d.why ? ': ' + d.why : ''})`}</span>}
      </div></div>}
      <div className="visbig" role="group" aria-label="Sichtbarkeit">
        <button type="button" className="private" aria-pressed={d.vis === 'private'} onClick={() => set({ vis: 'private' })}><Icon name="lock" />Privat<small>nur ich</small></button>
        <button type="button" className="family" aria-pressed={d.vis === 'family'} onClick={() => set({ vis: 'family' })}><Icon name="home" />Familie<small>alle + Display</small></button>
      </div>
      {d.vis === 'private' && <label className="busyopt"><input type="checkbox" checked={d.busy} onChange={e => set({ busy: e.target.checked })} /> Familie bei Überschneidung warnen („belegt“)</label>}
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
      <label className="field"><span>Name des Ortes</span><input value={d.place} onChange={e => { set({ place: e.target.value }); setTyped(true); }} placeholder="z. B. Mediamarkt Kiel Citti-Park" autoComplete="off" /></label>
      {(hits || looking) && <div className="place-hits">
        {looking === 'osm' && !hits && <div className="note">Suche …</div>}
        {hits?.map((h, i) => <button key={i} type="button" onClick={() => pick(h)}><Icon name="place" /><span>{h.name && <b>{h.name}</b>}<small>{h.addr}</small></span></button>)}
        {hits && looking !== 'web' && <button type="button" className="web" onClick={webSearch}><Icon name="search" /><span>{hits.length ? 'Nicht dabei? Im Internet suchen' : 'Nichts gefunden. Im Internet suchen'}</span></button>}
        {looking === 'web' && <div className="note">Suche im Internet, das dauert ein paar Sekunden …</div>}
      </div>}
      <div className="row2">
        <label className="field"><span>Straße und Hausnummer</span><input value={splitAddr(d.addr)[0]} onChange={e => set({ addr: joinAddr(e.target.value, splitAddr(d.addr)[1]) })} placeholder="z. B. Projensdorfer Str. 300" autoComplete="street-address" /></label>
        <label className="field"><span>PLZ und Ort</span><input value={splitAddr(d.addr)[1]} onChange={e => set({ addr: joinAddr(splitAddr(d.addr)[0], e.target.value) })} placeholder="z. B. 24106 Kiel" /></label>
      </div>
      {d.driver && s.showTravel && !d.all_day && (
        <div className="row2">
          <label className="field"><span>Fahrzeit (Min.)</span><input type="number" inputMode="numeric" min={0} max={240} value={d.travel_min ?? ''} onChange={e => set({ travel_min: e.target.value ? Math.max(0, Math.min(240, Number(e.target.value))) : null })} placeholder="z. B. 15" /></label>
          <div className="note" style={{ alignSelf: 'end' }}>
            {d.addr.replace(/^,\s*/, '').trim() && <button type="button" className="small-btn" style={{ marginBottom: 6 }} disabled={calc}
              onClick={() => { if (!s.home) { toast('Bitte zuerst unter Einstellungen → Allgemein die Zuhause-Adresse eintragen.'); return; } setCalc(true);
                travelTime(s.home, d.addr.replace(/^,\s*/, '')).then(r => { set({ travel_min: r.minutes }); toast(`${r.minutes} Min. Fahrt (${String(r.km).replace('.', ',')} km) von zu Hause.`); }, fail).finally(() => setCalc(false)); }}>
              {calc ? 'Rechne …' : 'Fahrzeit berechnen'}</button>}<br />
            {d.travel_min ? <>Los um <b>{hm(d.start_min - d.travel_min - s.buffer)}</b>{s.buffer ? ` (mit ${s.buffer} Min. Puffer)` : ''}</> : 'Mit Fahrzeit zeigt die App, wann es losgeht.'}</div>
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
