import { useEffect, useState } from 'react';
import { native } from '../lib/native';
import { store } from '../lib/store';
import { SWATCHES } from '../lib/model';
import { cvar } from './ui';

export function Onboarding() {
  // Link mit ?neu öffnet gleich „Neue Familie anlegen“
  const [mode, setMode] = useState<'start' | 'create' | 'join' | 'back'>(() => new URLSearchParams(location.search).has('neu') ? 'create' : 'start');
  const [fam, setFam] = useState(''), [name, setName] = useState(''), [code, setCode] = useState('');
  const [color, setColor] = useState(SWATCHES[6][0]);
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const run = async (f: () => Promise<void>) => {
    setBusy(true); setErr('');
    try { await f(); } catch (e) { setErr(e instanceof Error ? e.message : 'Das hat nicht geklappt.'); } finally { setBusy(false); }
  };
  // In der Android-App: mit dem gespeicherten Widget-Code automatisch ins eigene Konto
  useEffect(() => {
    const c = native()?.code();
    if (c && c.startsWith('FK1:') && !store.demo) void run(() => store.reclaim(c));
  }, []);
  return (
    <main className="onb">
      <img className="logo" src="icon.svg" alt="" />
      <h1>FamTO</h1>
      <p>Termine per Sprache eintragen, privat oder für die Familie. Familientermine erscheinen auf dem Display im Flur.</p>
      {store.demo && <p><span className="badge-demo">Demo-Modus</span> Ohne Datenbank: Alles bleibt in diesem Browser.</p>}

      {mode === 'start' && <>
        <button className="btn" onClick={() => setMode('create')}>Neue Familie anlegen</button>
        <button className="btn ghost" onClick={() => setMode('join')}>Ich habe einen Einladungscode</button>
        {!store.demo && <button className="btn ghost" onClick={() => { setCode(''); setMode('back'); }}>Ich war schon dabei</button>}
        {store.demo && <button className="btn ghost" disabled={busy} onClick={() => run(() => store.loadExample())}>Beispielfamilie ansehen</button>}
      </>}

      {mode === 'create' && (
        <form className="card" onSubmit={e => { e.preventDefault(); void run(() => store.createFamily(fam.trim(), name.trim(), color)); }}>
          <h2>Neue Familie</h2>
          <p className="note">Du wirst Admin und kannst danach die anderen einladen.</p>
          <label className="field"><span>Name der Familie</span><input required value={fam} onChange={e => setFam(e.target.value)} placeholder="z. B. Familie Schmidt" /></label>
          <label className="field"><span>Dein Vorname</span><input required value={name} onChange={e => setName(e.target.value)} placeholder="z. B. Jan" /></label>
          <div className="field"><span>Deine Farbe</span><div className="sw" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {SWATCHES.map(([h, l]) => <button type="button" key={h} className={`swb${color === h ? ' on' : ''}`} style={cvar(h)} aria-label={l} title={l} onClick={() => setColor(h)} />)}
          </div></div>
          {err && <div className="err">{err}</div>}
          <div className="btn-row"><button type="button" className="btn ghost" onClick={() => setMode('start')}>Zurück</button><button className="btn" disabled={busy}>Anlegen</button></div>
        </form>
      )}

      {mode === 'back' && (
        <form className="card" onSubmit={e => { e.preventDefault(); void run(() => store.reclaim(code)); }}>
          <h2>Zurück in mein Konto</h2>
          <p className="note">Füge deinen persönlichen Widget-Code ein (beginnt mit FK1:). Du findest ihn in der FamTO-Widget-App unter „Widget einrichten“: ins Code-Feld tippen, alles markieren, kopieren. Oder ein anderes Familienmitglied lässt dich neu einladen.</p>
          <label className="field"><span>Widget-Code</span><textarea required value={code} onChange={e => setCode(e.target.value)} placeholder="FK1:…" rows={3} /></label>
          {err && <div className="err">{err}</div>}
          <div className="btn-row"><button type="button" className="btn ghost" onClick={() => setMode('start')}>Zurück</button><button className="btn" disabled={busy}>Verbinden</button></div>
        </form>
      )}

      {mode === 'join' && (
        <form className="card" onSubmit={e => { e.preventDefault(); void run(() => store.joinWithCode(code)); }}>
          <h2>Mit Code beitreten</h2>
          <p className="note">Den Code bekommst du vom Admin deiner Familie (Einstellungen → Familie &amp; Mitglieder).</p>
          <label className="field"><span>Einladungscode</span><input required value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="z. B. K7P2QX" autoCapitalize="characters" maxLength={8} /></label>
          {err && <div className="err">{err}</div>}
          <div className="btn-row"><button type="button" className="btn ghost" onClick={() => setMode('start')}>Zurück</button><button className="btn" disabled={busy}>Beitreten</button></div>
        </form>
      )}
    </main>
  );
}
