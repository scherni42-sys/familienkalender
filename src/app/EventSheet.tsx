import { useEffect, useState } from 'react';
import { isPro, store, useSnapshot } from '../lib/store';
import type { Draft } from '../lib/parse';
import type { NewEvent } from '../lib/types';
import { hm, toMin } from '../lib/dates';
import { conflicts, isOnline, nameOf, whenText } from '../lib/model';
import { Badge, cvar, Icon, Sheet } from './ui';
import { fail, toast } from './toast';
import { suggestPlaces, travelTime, type PlaceHit } from '../lib/ai';
import { AttachButton, FileList } from './Files';
import { evAlarm, hasEvAlarm, LEADS, setEvAlarm } from '../lib/bdalarm';
import { native } from '../lib/native';
import { ask } from './ask';

// Adresse in zwei Feldern: „Straße Nr“ und „PLZ Ort“, gespeichert als „Straße Nr, PLZ Ort“ (eindeutig für Route und Fahrzeit)
export const splitAddr = (a: string): [string, string] => { const k = a.lastIndexOf(','); return k < 0 ? [a, ''] : [a.slice(0, k), a.slice(k + 1).trimStart()]; };
export const joinAddr = (street: string, town: string) => street.replace(/,/g, ' ') + (town ? `, ${town}` : '');

// Entwurf in einen speicherbaren Termin umwandeln (auch für die Direkteingabe ohne Bestätigung)
export const toNewEvent = (d: Draft, bringTxt = d.bring.join(', ')): NewEvent => ({
  title: d.title.trim(), date: d.date, end_date: d.all_day ? (d.end_date < d.date ? d.date : d.end_date) : d.date,
  all_day: d.all_day, start_min: d.all_day ? 0 : d.start_min, end_min: d.all_day ? 1440 : d.end_min,
  persons: d.persons, driver: d.driver, vis: d.vis === 'family' ? 'family' : d.busy ? 'busy' : 'private',
  place: d.place.trim(), addr: d.addr.trim().replace(/^,\s*/, ''), travel_min: d.driver && d.travel_min ? d.travel_min : null,
  notes: d.notes.trim(), bring: bringTxt.split(',').map(x => x.trim()).filter(Boolean), discreet: d.vis === 'family' && d.discreet,
  // Hin/Abholen nur mitschicken, wenn gewählt (ältere Datenbank ohne diese Spalten bleibt so verwendbar)
  ...(d.trip ? { trip: d.driver ? d.trip : 'hin', driver2: d.driver && d.trip === 'beides' ? d.driver2 ?? null : null } : {})
});

// Auswahl für die Dauer eines Termins
const DURS = [15, 30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 480, 600];
const durText = (m: number) => { const h = Math.floor(m / 60), r = m % 60; return h ? `${h} Std.${r ? ` ${r} Min.` : ''}` : `${r} Min.`; };

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
  // Straße tippen: passende Adressen mit PLZ und Ort vorschlagen (z. B. „Weg beim Jäger 193“)
  const [aHits, setAHits] = useState<PlaceHit[] | null>(null);
  const [aTyped, setATyped] = useState(false);
  useEffect(() => {
    const [st, town] = splitAddr(d.addr);
    const q = [st.trim(), town.trim()].filter(Boolean).join(' ');
    if (!aTyped || st.trim().length < 4) { setAHits(null); return; }
    const t = setTimeout(() => { suggestPlaces(q, s.home).then(h => setAHits(h.filter(x => x.addr !== d.addr.trim())), () => setAHits(null)); }, 450);
    return () => clearTimeout(t);
  }, [d.addr, aTyped]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickAddr = (h: PlaceHit) => { set({ addr: h.addr, ...(!d.place.trim() && h.name ? { place: h.name } : {}) }); setATyped(false); setAHits(null); };
  const pick = (h: PlaceHit) => { set({ addr: h.addr, ...(h.name && h.name.length > d.place.trim().length ? { place: h.name } : {}) }); setTyped(false); setHits(null); };
  const webSearch = () => { setLooking('web'); suggestPlaces(d.place.trim(), s.home, true).then(h => { setHits(h); if (!h.length) toast('Auch im Internet nichts Eindeutiges gefunden. Bitte von Hand eintragen.'); }, fail).finally(() => setLooking('')); };
  const people = snap.members.filter(m => m.role !== 'guest');
  const drivers = snap.members.filter(m => m.adult && m.role !== 'guest');
  const cf = conflicts(snap.events, snap.busy, d, snap.members, d.id);
  const others = d.persons.filter(id => id !== snap.me);
  const visText = d.vis === 'family'
    ? 'Alle in der Familie sehen den Termin, und er erscheint auf dem Display im Flur.'
    : d.busy ? 'Nur du siehst den Termin. Trägt jemand etwas zur selben Zeit ein, warnt die App: „belegt“.' : 'Nur du siehst diesen Termin. Er erscheint nicht auf dem Display.';

  const [wake, setWake] = useState(() => evAlarm(d.id));
  const [pending, setPending] = useState<{ name: string; type: string; data: string }[]>([]);
  // Navigation aus dem Formular: erst speichern (sonst geht die eingetippte Adresse verloren), dann „unterwegs“ mit Ankunftszeit
  const navGo = (dest: string) => {
    window.open(`https://www.google.com/maps/dir/?api=1&travelmode=driving&dir_action=navigate&destination=${encodeURIComponent(dest)}`, '_blank');
    void save(id => {
      const meM = snap.members.find(m => m.id === snap.me);
      const mine = d.driver === snap.me || d.driver2 === snap.me;
      const takeOver = !d.driver && !!meM && meM.role !== 'child' && meM.role !== 'guest';
      if (!mine && !takeOver) return;
      const set = (min: number) => store.setEta(id, new Date(Date.now() + min * 60000).toISOString(), takeOver ? snap.me : undefined).catch(() => {});
      if (d.travel_min) void set(d.travel_min);
      navigator.geolocation?.getCurrentPosition(
        p => travelTime(`${p.coords.latitude.toFixed(5)},${p.coords.longitude.toFixed(5)}`, dest).then(r => set(r.minutes), () => { if (!d.travel_min) void set(15); }),
        () => { if (!d.travel_min) void set(15); }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 120000 });
    });
  };
  const save = async (after?: (id: string) => void) => {
    if (!d.title.trim()) { toast('Bitte einen Titel eingeben.'); return; }
    if (!d.all_day && d.end_min <= d.start_min) { toast('Das Ende muss nach dem Beginn liegen.'); return; }
    setBusy(true);
    try {
      // Fahrer und Adresse: Fahrzeit von zu Hause neu berechnen, wenn sie fehlt, der Fahrer wechselt oder die Adresse neu ist (für die Abfahrts-Erinnerung)
      let dd = d;
      const to = d.addr.replace(/^,\s*/, '').trim();
      if (d.driver && to && (!d.travel_min || d.driver !== draft.driver || (d.driver2 ?? null) !== (draft.driver2 ?? null) || to !== draft.addr.replace(/^,\s*/, '').trim()) && !d.all_day && s.home) {
        const r = await Promise.race([travelTime(s.home, to), new Promise<null>(res => setTimeout(() => res(null), 8000))]).catch(() => null);
        if (r) dd = { ...d, travel_min: r.minutes };
      }
      const id = await store.saveEvent(toNewEvent(dd, bringTxt), d.id);
      for (const f of pending) await store.attachFile(f, { event: id }).catch(fail);
      if (hasEvAlarm() && (wake || evAlarm(id))) setEvAlarm({ id, lead: dd.all_day ? 0 : wake, date: dd.date, start: dd.start_min, title: dd.title.trim() });
      toast(d.vis === 'family' ? 'Gespeichert. Steht jetzt auch auf dem Display.' : 'Gespeichert, nur für dich.');
      after?.(id);
      saved(id);
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!d.id || !(await ask('Termin wirklich löschen?', 'Löschen'))) return;
    try { await store.deleteEvent(d.id); toast('Termin gelöscht.'); close(); } catch (e) { fail(e); }
  };

  // Aus dem Handy-Kalender (Outlook, Google, …) übernommen: Änderungen an Titel/Zeit/Ort gehören ins Original
  const ext = d.id ? snap.events.find(e => e.id === d.id)?.ext_id ?? null : null;
  return (
    <Sheet onClose={close} label="Termin bestätigen">
      <h2>{fresh ? (d.reason ? 'Stimmt das so?' : 'Neuer Termin') : 'Termin bearbeiten'}</h2>
      {ext && <div className="ai ext-src"><Icon name="today" /><div>
        <b>Aus deinem Handy-Kalender übernommen{ext.startsWith('w:') ? ' (beruflich, z. B. Outlook)' : ''}.</b> Titel, Zeit, Ort und Notiz kommen von dort und werden beim nächsten Abgleich wieder überschrieben. Ändere sie deshalb im Original. Fahrer, Personen, Adresse und Mitbringen kannst du hier ändern, die bleiben.
        {native()?.openCal && <button type="button" className="btn sm" style={{ marginTop: 8 }} onClick={() => { if (!native()?.openCal?.(ext)) toast('Der Termin ließ sich im Kalender nicht öffnen.'); }}>Im Handy-Kalender öffnen</button>}
      </div></div>}
      {fresh && d.reason && <div className="ai"><Icon name="spark" /><div>
        {d.suggested === d.vis ? <><b>Passt: {d.vis === 'family' ? 'Familie' : 'Privat'}</b>, weil {d.reason}.</>
          : <><b>Hinweis:</b> Du hast {d.vis === 'family' ? 'Familie' : 'Privat'} gewählt. Ich hätte {d.suggested === 'family' ? 'Familie' : 'Privat'} vorgeschlagen, weil {d.reason}.</>}
        {d.timeFound ? '' : ' Keine Uhrzeit genannt, daher ganztägig.'}
        {d.source && <span className="note" style={{ display: 'block' }}>{d.source === 'ai' ? 'Erkannt von Claude' : d.why === 'pro' ? 'Einfache Erkennung. Mit FamTO Pro erkennt Claude Termine genauer.' : `Einfache Erkennung (ohne KI${d.why ? ': ' + d.why : ''})`}</span>}
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
        {d.all_day ? <>
          <label className="field"><span>Von</span><input type="date" value={d.date} onChange={e => e.target.value && set({ date: e.target.value, end_date: d.end_date < e.target.value ? e.target.value : d.end_date })} /></label>
          <label className="field"><span>Bis</span><input type="date" value={d.end_date < d.date ? d.date : d.end_date} min={d.date} onChange={e => e.target.value && set({ end_date: e.target.value })} /></label>
          <span className="note wide">{whenText({ ...d, end_date: d.end_date < d.date ? d.date : d.end_date })}</span>
        </> : <>
          <label className="field wide"><span>Datum</span><input type="date" value={d.date} onChange={e => e.target.value && set({ date: e.target.value, end_date: e.target.value })} /></label>
          <label className="field"><span>Beginn</span><input type="time" value={hm(d.start_min)} onChange={e => { if (!e.target.value) return; const n = toMin(e.target.value), len = d.end_min - d.start_min; set({ start_min: n, end_min: Math.min(n + Math.max(len, 15), 1439) }); }} /></label>
          {/* Dauer statt Ende: das Ende ergibt sich daraus (höchstens bis 23:59) */}
          <label className="field"><span>Dauer</span><select value={d.end_min - d.start_min} onChange={e => set({ end_min: Math.min(d.start_min + Number(e.target.value), 1439) })}>
            {[...new Set([...DURS, d.end_min - d.start_min])].filter(m => m > 0).sort((a, b) => a - b).map(m => <option key={m} value={m}>{durText(m)}</option>)}
          </select></label>
        </>}
        <label className="busyopt wide"><input type="checkbox" checked={d.all_day} onChange={e => set(e.target.checked ? { all_day: true } : { all_day: false, start_min: 18 * 60, end_min: 19 * 60 })} /> Ganztägig</label>
      </div>
      <div className="field"><span>Wer ist dabei?</span>
        <div className="ptoggle">{people.map(m => <button key={m.id} type="button" style={cvar(m.color)} aria-pressed={d.persons.includes(m.id)}
          onClick={() => set({ persons: d.persons.includes(m.id) ? d.persons.filter(x => x !== m.id) : [...d.persons, m.id] })}><Badge m={m} />{m.name}</button>)}</div>
        {d.persons.length === 0 && <span className="note">Niemand ausgewählt: Der Termin steht ohne Namen im Kalender, z. B. für Handwerker oder Müllabfuhr.</span>}
      </div>
      <label className="field"><span>{d.trip === 'beides' ? 'Wer bringt hin?' : d.trip === 'ab' ? 'Wer holt ab?' : 'Wer fährt?'}</span>
        <select value={d.driver ?? ''} onChange={e => set({ driver: e.target.value || null })}>
          <option value="">Niemand nötig</option>
          {drivers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </label>
      {d.driver && <div className="field"><span>Fahrt</span>
        <div className="seg trip">{([['hin', 'Hinbringen'], ['ab', 'Abholen'], ['beides', 'Beides']] as const).map(([k, l]) =>
          <button key={k} type="button" aria-pressed={(d.trip ?? 'hin') === k} onClick={() => set({ trip: k, driver2: k === 'beides' ? d.driver2 ?? d.driver : null })}>{l}</button>)}</div>
      </div>}
      {d.driver && d.trip === 'beides' && <label className="field"><span>Wer holt ab?</span>
        <select value={d.driver2 ?? ''} onChange={e => set({ driver2: e.target.value || null })}>
          <option value="">Niemand nötig</option>
          {drivers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </label>}
      <label className="field"><span>Name des Ortes</span><input value={d.place} onChange={e => { set({ place: e.target.value }); setTyped(true); }} placeholder="z. B. Mediamarkt Kiel Citti-Park" autoComplete="off" /></label>
      {(hits || looking) && <div className="place-hits">
        {looking === 'osm' && !hits && <div className="note">Suche …</div>}
        {hits?.map((h, i) => <button key={i} type="button" onClick={() => pick(h)}><Icon name="place" /><span>{h.name && <b>{h.name}</b>}<small>{h.addr}</small></span></button>)}
        {hits && looking !== 'web' && <button type="button" className="web" onClick={webSearch}><Icon name="search" /><span>{hits.length ? 'Nicht dabei? Im Internet suchen' : 'Nichts gefunden. Im Internet suchen'}</span>{!isPro() && <span className="pro-tag">Pro</span>}</button>}
        {looking === 'web' && <div className="note">Suche im Internet, das dauert ein paar Sekunden …</div>}
      </div>}
      <div className="row2">
        <label className="field"><span>Straße und Hausnummer</span><input value={splitAddr(d.addr)[0]} onChange={e => { set({ addr: joinAddr(e.target.value, splitAddr(d.addr)[1]) }); setATyped(true); }} placeholder="z. B. Projensdorfer Str. 300" autoComplete="street-address" /></label>
        <label className="field"><span>PLZ und Ort</span><input value={splitAddr(d.addr)[1]} onChange={e => { set({ addr: joinAddr(splitAddr(d.addr)[0], e.target.value) }); setATyped(true); }} placeholder="z. B. 24106 Kiel" /></label>
      </div>
      {aHits && aHits.length > 0 && <div className="place-hits">
        {aHits.map((h, i) => <button key={i} type="button" onClick={() => pickAddr(h)}><Icon name="place" /><span>{h.name && <b>{h.name}</b>}<small>{h.addr}</small></span></button>)}
      </div>}
      {(d.addr.replace(/^,\s*/, '').trim() || d.place.trim()) && !isOnline(d) && <button type="button" className="btn sm nav-btn" style={{ justifySelf: 'start', alignSelf: 'flex-start' }} disabled={busy} onClick={() => navGo(d.addr.replace(/^,\s*/, '').trim() || d.place.trim())}><Icon name="car" /> Speichern und Navigation starten</button>}
      {d.driver && s.showTravel && !d.all_day && (
        <div className="row2">
          <label className="field"><span>Fahrzeit (Min.)</span><input type="number" inputMode="numeric" min={0} max={240} value={d.travel_min ?? ''} onChange={e => set({ travel_min: e.target.value ? Math.max(0, Math.min(240, Number(e.target.value))) : null })} placeholder="z. B. 15" /></label>
          <div className="note" style={{ alignSelf: 'end' }}>
            {d.addr.replace(/^,\s*/, '').trim() && <button type="button" className="small-btn" style={{ marginBottom: 6 }} disabled={calc}
              onClick={() => { if (!s.home) { toast('Bitte zuerst unter Einstellungen → Allgemein die Zuhause-Adresse eintragen.'); return; } setCalc(true);
                travelTime(s.home, d.addr.replace(/^,\s*/, '')).then(r => { set({ travel_min: r.minutes }); toast(`${r.minutes} Min. Fahrt (${String(r.km).replace('.', ',')} km) von zu Hause.`); }, fail).finally(() => setCalc(false)); }}>
              {calc ? 'Rechne …' : 'Fahrzeit berechnen'}</button>}<br />
            {d.travel_min ? <>{d.trip === 'ab' ? 'Zum Abholen los um' : 'Los um'} <b>{hm((d.trip === 'ab' ? d.end_min : d.start_min) - d.travel_min - s.buffer)}</b>{d.trip === 'beides' && d.driver2 ? <>, zum Abholen um <b>{hm(d.end_min - d.travel_min - s.buffer)}</b></> : null}{s.buffer ? ` (mit ${s.buffer} Min. Puffer)` : ''}</> : 'Mit Fahrzeit zeigt die App, wann es losgeht.'}</div>
        </div>
      )}
      <label className="field"><span>Mitbringen (mit Komma trennen)</span><input value={bringTxt} onChange={e => setBringTxt(e.target.value)} placeholder="z. B. Trinkflasche, Schienbeinschoner" /></label>
      <label className="field"><span>Notiz</span><textarea value={d.notes} onChange={e => set({ notes: e.target.value })} placeholder="z. B. Abholen am Vereinsheim" /></label>
      {hasEvAlarm() && !d.all_day && <div className="field"><span>Wecker auf diesem Handy</span>
        <div className="alarm-pick">
          <label className="busyopt"><input type="checkbox" checked={wake > 0} onChange={e => setWake(e.target.checked ? 30 : 0)} /> <Icon name="alarm" /> Wecker stellen</label>
          {wake > 0 && <select value={wake} onChange={e => setWake(Number(e.target.value))}>{LEADS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>}
        </div></div>}
      <div className="field"><span>Dokumente</span>
        {d.id && <FileList files={snap.events.find(x => x.id === d.id)?.files} from={{ event: d.id }} canEdit />}
        {pending.length > 0 && <div className="files">{pending.map((f, i) => <div key={i} className="file"><span className="file-open"><Icon name="clip" /><span><b>{f.name}</b><small>wird beim Speichern angehängt</small></span></span><button type="button" className="file-x" aria-label={`${f.name} entfernen`} onClick={() => setPending(p => p.filter((_, j) => j !== i))}>×</button></div>)}</div>}
        <div style={{ marginTop: 6 }}>{d.id ? <AttachButton to={{ event: d.id }} /> : <AttachButton to={{}} pick={f => setPending(p => [...p, f])} />}</div>
      </div>
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
