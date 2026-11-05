import { useEffect, useRef, useState } from 'react';
import { useSnapshot } from '../lib/store';
import { CAT_ICON, CATS, canViewFamily, crop, eur, familyPart, list, loadPhoto, photoUrl, read, remove, save, toB64, toBlob, type Item, type Receipt } from '../lib/cash';
import { Badge, Icon, Sheet } from './ui';
import { ask } from './ask';
import { fail, toast } from './toast';

const MON = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const num = (s: string) => { const n = Number(s.replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const fmt = (n: number) => n.toFixed(2).replace('.', ',');

type View = { kind: 'list' } | { kind: 'new' } | { kind: 'edit'; rc: Receipt; photo?: HTMLCanvasElement | null };

// Kassenbuch: Monatsübersicht, Bons fotografieren, auslesen, privat oder Familie
export function CashSheet({ close }: { close: () => void }) {
  const [view, setView] = useState<View>({ kind: 'list' });
  if (view.kind === 'new') return <NewReceipt close={close} back={() => setView({ kind: 'list' })} next={(rc, photo) => setView({ kind: 'edit', rc, photo })} />;
  if (view.kind === 'edit') return <ReceiptForm close={close} rc={view.rc} photo={view.photo} done={() => setView({ kind: 'list' })} />;
  return <CashList close={close} add={() => setView({ kind: 'new' })} open={rc => setView({ kind: 'edit', rc })} />;
}

function CashList({ close, add, open }: { close: () => void; add: () => void; open: (rc: Receipt) => void }) {
  const snap = useSnapshot();
  const me = snap.me!;
  const [off, setOff] = useState(0), [tab, setTab] = useState<'mine' | 'family'>('mine'), [fam, setFam] = useState(false);
  const [rows, setRows] = useState<Receipt[] | null>(null), [err, setErr] = useState('');
  const now = new Date(), first = new Date(now.getFullYear(), now.getMonth() + off, 1), last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  useEffect(() => { void canViewFamily().then(setFam).catch(() => setFam(false)); }, []);
  useEffect(() => { setRows(null); setErr(''); list(ymd(first), ymd(last)).then(setRows, e => setErr(e instanceof Error ? e.message : String(e))); }, [off]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = (rows ?? []).filter(r => tab === 'mine' ? r.owner === me : familyPart(r) !== 0);
  const amount = (r: Receipt) => tab === 'mine' ? r.total : familyPart(r);
  const sum = shown.reduce((s, r) => s + amount(r), 0);
  // Summen je Kategorie: aus den Zeilen, sonst aus dem Bon
  const byCat = new Map<string, number>();
  for (const r of shown) {
    const its = tab === 'family' && r.scope !== 'family' ? r.items.filter(i => i.family) : r.items;
    if (its.length && Math.abs(its.reduce((s, i) => s + i.price, 0) - amount(r)) < 0.05) for (const i of its) byCat.set(i.category, (byCat.get(i.category) ?? 0) + i.price);
    else byCat.set(r.category, (byCat.get(r.category) ?? 0) + amount(r));
  }
  const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...cats.map(c => c[1]));
  return (
    <Sheet onClose={close} label="Kassenbuch">
      <h2>Kassenbuch</h2>
      {fam && <div className="cash-tabs">
        <button type="button" className={`kw-p${tab === 'mine' ? ' on' : ''}`} onClick={() => setTab('mine')}>Meine</button>
        <button type="button" className={`kw-p${tab === 'family' ? ' on' : ''}`} onClick={() => setTab('family')}>Familie</button>
      </div>}
      <div className="cash-mon">
        <button type="button" className="arr" aria-label="Monat zurück" onClick={() => setOff(o => o - 1)}>◀</button>
        <b>{MON[first.getMonth()]} {first.getFullYear()}</b>
        <button type="button" className="arr" aria-label="Monat vor" style={{ visibility: off < 0 ? 'visible' : 'hidden' }} onClick={() => setOff(o => o + 1)}>▶</button>
      </div>
      {err ? <p className="cash-err">{err}</p> : rows === null ? <p>Lädt …</p> : <>
        <div className="cash-sum"><span>{tab === 'mine' ? 'Meine Ausgaben' : 'Familienausgaben'}</span><b>{eur(sum)}</b></div>
        {cats.length > 0 && <div className="cash-cats">{cats.map(([c, v]) => <div key={c} className="cash-cat">
          <span>{CAT_ICON[c] ?? '📦'} {c}</span><i style={{ width: `${Math.max(3, v / max * 100)}%` }} /><b>{eur(v)}</b></div>)}</div>}
        {!shown.length && <p>{tab === 'mine' ? 'In diesem Monat noch keine Belege. Mit „＋ Beleg“ fotografierst du einen Kassenbon.' : 'In diesem Monat keine Familienausgaben.'}</p>}
        <div className="cash-list">{shown.map(r => {
          const who = snap.members.find(m => m.id === r.owner);
          const d = new Date(r.bought_at);
          return <button key={r.id} type="button" className="cash-row" onClick={() => open(r)}>
            <span className="cash-ic">{CAT_ICON[r.category] ?? '📦'}</span>
            <span className="cash-mid"><b>{r.merchant || 'Beleg'}</b><small>{d.getDate()}.{d.getMonth() + 1}. {pad(d.getHours())}:{pad(d.getMinutes())}{r.payment ? ` · ${r.payment}${r.card ? ` …${r.card}` : ''}` : ''}{r.scope === 'family' ? ' · Familie' : r.items.some(i => i.family) ? ' · teils Familie' : ''}</small></span>
            {tab === 'family' && who && who.id !== me && <Badge m={who} size={24} plain />}
            <b className="cash-amt">{eur(amount(r))}</b>
          </button>;
        })}</div>
      </>}
      <div className="btn-row"><button type="button" className="btn ghost" onClick={close}>Schließen</button>{snap.members.find(m => m.id === me)?.role !== 'guest' && <button type="button" className="btn" onClick={add}>＋ Beleg</button>}</div>
    </Sheet>
  );
}

// Neuer Bon: Foto aufnehmen oder wählen, auslesen lassen, zuschneiden
function NewReceipt({ close, back, next }: { close: () => void; back: () => void; next: (rc: Receipt, photo: HTMLCanvasElement | null) => void }) {
  const cam = useRef<HTMLInputElement>(null), gal = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(''), [img, setImg] = useState<HTMLCanvasElement | null>(null), [rc, setRc] = useState<Receipt | null>(null);
  const [box, setBox] = useState({ x0: 0, y0: 0, x1: 1, y1: 1 });
  const blank = (): Receipt => ({ bought_at: new Date().toISOString(), merchant: '', payment: '', card: '', total: 0, currency: 'EUR', category: 'Sonstiges', scope: 'private', photo: null, note: '', items: [] });
  const pick = async (f?: File) => {
    if (!f) return;
    try {
      setBusy('Foto wird geladen …');
      const c = await loadPhoto(f); setImg(c);
      setBusy('Der Bon wird gelesen …');
      try {
        const r = await read(toB64(c));
        if (!r.found) toast('Auf dem Foto ist kein Bon zu erkennen. Du kannst trotzdem alles eintragen.');
        const at = r.date ? new Date(`${r.date}T${/^\d\d:\d\d$/.test(r.time) ? r.time : '12:00'}:00`) : new Date();
        setRc({ ...blank(), bought_at: (isNaN(at.getTime()) ? new Date() : at).toISOString(), merchant: r.merchant, payment: r.payment, card: r.card.replace(/\D/g, '').slice(-4), total: r.total || r.items.reduce((s, i) => s + i.price, 0), currency: r.currency || 'EUR', category: (CATS as readonly string[]).includes(r.category) ? r.category : 'Sonstiges', items: r.items.map(i => ({ ...i, family: false })) });
        if (r.found && r.box && r.box.x1 - r.box.x0 > 0.1 && r.box.y1 - r.box.y0 > 0.1) setBox({ x0: Math.max(0, r.box.x0 - 0.01), y0: Math.max(0, r.box.y0 - 0.01), x1: Math.min(1, r.box.x1 + 0.01), y1: Math.min(1, r.box.y1 + 0.01) });
      } catch (e) { fail(e); setRc(blank()); }
    } catch { toast('Das Foto ließ sich nicht öffnen.'); }
    finally { setBusy(''); }
  };
  return (
    <Sheet onClose={close} label="Neuer Beleg">
      <h2>Neuer Beleg</h2>
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={e => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
      <input ref={gal} type="file" accept="image/*" hidden onChange={e => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
      {busy ? <div className="cash-busy"><span className="spin" /> {busy}</div> : img && rc ? <>
        <p>Zieh die Ecken so, dass nur der Bon im Rahmen ist.</p>
        <CropBox img={img} box={box} set={setBox} />
      </> : <>
        <p>Fotografiere den Kassenbon möglichst gerade und flach. FamTO liest Händler, Datum, Karte, Positionen und Summe aus und stellt den Bon frei.</p>
        <div className="cash-pick">
          <button type="button" className="btn" onClick={() => cam.current?.click()}><Icon name="camera" /> Fotografieren</button>
          <button type="button" className="btn ghost" onClick={() => gal.current?.click()}><Icon name="image" /> Aus der Galerie</button>
          <button type="button" className="btn ghost" onClick={() => next(blank(), null)}>Ohne Foto eintragen</button>
        </div>
      </>}
      <div className="btn-row"><button type="button" className="btn ghost" onClick={back}>Zurück</button>
        {img && rc && !busy && <button type="button" className="btn" onClick={() => next(rc, crop(img, box))}>Weiter</button>}</div>
    </Sheet>
  );
}

// Zuschneiden: Rahmen mit vier Ecken zum Ziehen
function CropBox({ img, box, set }: { img: HTMLCanvasElement; box: { x0: number; y0: number; x1: number; y1: number }; set: (b: { x0: number; y0: number; x1: number; y1: number }) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [src] = useState(() => img.toDataURL('image/jpeg', 0.7));
  const drag = (corner: 'tl' | 'tr' | 'bl' | 'br') => (e: React.PointerEvent) => {
    e.preventDefault(); (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const r = wrap.current!.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), y = Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
      const b = { ...box };
      if (corner[1] === 'l') b.x0 = Math.min(x, b.x1 - 0.05); else b.x1 = Math.max(x, b.x0 + 0.05);
      if (corner[0] === 't') b.y0 = Math.min(y, b.y1 - 0.05); else b.y1 = Math.max(y, b.y0 + 0.05);
      Object.assign(box, b); set({ ...b });
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };
  const pc = (v: number) => `${v * 100}%`;
  return (
    <div className="crop" ref={wrap} style={{ aspectRatio: `${img.width} / ${img.height}` }}>
      <img src={src} alt="Beleg" draggable={false} />
      <div className="crop-r" style={{ left: pc(box.x0), top: pc(box.y0), width: pc(box.x1 - box.x0), height: pc(box.y1 - box.y0) }} />
      {(['tl', 'tr', 'bl', 'br'] as const).map(c => <span key={c} className="crop-h" onPointerDown={drag(c)} style={{ left: pc(c[1] === 'l' ? box.x0 : box.x1), top: pc(c[0] === 't' ? box.y0 : box.y1) }} />)}
    </div>
  );
}

// Bon prüfen und speichern (neu oder bearbeiten)
function ReceiptForm({ close, rc: start, photo, done }: { close: () => void; rc: Receipt; photo?: HTMLCanvasElement | null; done: () => void }) {
  const snap = useSnapshot();
  const mine = !start.owner || start.owner === snap.me;
  const [rc, setRc] = useState<Receipt>(start), [busy, setBusy] = useState(false), [url, setUrl] = useState(''), [big, setBig] = useState(false);
  useEffect(() => { if (photo) setUrl(photo.toDataURL('image/jpeg', 0.8)); else if (rc.photo) void photoUrl(rc.photo).then(setUrl).catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (p: Partial<Receipt>) => setRc(r => ({ ...r, ...p }));
  const setItem = (i: number, p: Partial<Item>) => setRc(r => ({ ...r, items: r.items.map((x, k) => k === i ? { ...x, ...p } : x) }));
  const d = new Date(rc.bought_at), date = ymd(d), time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const setWhen = (dt: string, tm: string) => { const n = new Date(`${dt}T${tm || '12:00'}:00`); if (!isNaN(n.getTime())) set({ bought_at: n.toISOString() }); };
  const itemSum = rc.items.reduce((s, i) => s + i.price, 0);
  const famSum = rc.scope === 'family' ? rc.total : rc.items.filter(i => i.family).reduce((s, i) => s + i.price, 0);
  const go = async () => {
    if (!rc.merchant.trim() && !rc.total) { toast('Bitte mindestens Händler oder Betrag eintragen.'); return; }
    setBusy(true);
    try { await save({ ...rc, merchant: rc.merchant.trim() }, photo ? await toBlob(photo) : null); toast('Beleg gespeichert.'); done(); }
    catch (e) { fail(e); } finally { setBusy(false); }
  };
  const del = async () => { if (!(await ask('Diesen Beleg mit Foto löschen?', 'Löschen'))) return; try { await remove(rc); toast('Beleg gelöscht.'); done(); } catch (e) { fail(e); } };
  const ro = !mine;
  return (
    <Sheet onClose={close} label="Beleg">
      <h2>{start.id ? (ro ? 'Beleg' : 'Beleg bearbeiten') : 'Beleg prüfen'}</h2>
      {url && <button type="button" className={`cash-photo${big ? ' big' : ''}`} onClick={() => setBig(!big)} aria-label="Foto vergrößern"><img src={url} alt="Kassenbon" /></button>}
      {ro && <p>Von {snap.members.find(m => m.id === rc.owner)?.name ?? 'jemandem'}. Nur der Besitzer kann den Beleg ändern.</p>}
      <fieldset disabled={ro} className="cash-form">
        {!ro && <div className="visbig" role="group" aria-label="Privat oder Familie">
          <button type="button" className="private" aria-pressed={rc.scope === 'private'} onClick={() => set({ scope: 'private' })}><Icon name="lock" />Privat<small>nur ich</small></button>
          <button type="button" className="family" aria-pressed={rc.scope === 'family'} onClick={() => set({ scope: 'family' })}><Icon name="home" />Familie<small>Familienkasse</small></button>
        </div>}
        <label className="field"><span>Händler</span><input value={rc.merchant} onChange={e => set({ merchant: e.target.value })} maxLength={200} placeholder="z. B. REWE" /></label>
        <div className="row2">
          <label className="field"><span>Datum</span><input type="date" value={date} onChange={e => e.target.value && setWhen(e.target.value, time)} /></label>
          <label className="field"><span>Uhrzeit</span><input type="time" value={time} onChange={e => e.target.value && setWhen(date, e.target.value)} /></label>
          <label className="field"><span>Bezahlt mit</span><input value={rc.payment} onChange={e => set({ payment: e.target.value })} maxLength={100} placeholder="Bar, EC-Karte …" /></label>
          <label className="field"><span>Karte (letzte 4)</span><input value={rc.card} inputMode="numeric" onChange={e => set({ card: e.target.value.replace(/\D/g, '').slice(0, 4) })} placeholder="1234" /></label>
          <label className="field"><span>Summe (€)</span><input inputMode="decimal" defaultValue={rc.total ? fmt(rc.total) : ''} onChange={e => set({ total: num(e.target.value) })} placeholder="0,00" /></label>
          <label className="field"><span>Kategorie</span><select value={rc.category} onChange={e => set({ category: e.target.value })}>{CATS.map(c => <option key={c} value={c}>{CAT_ICON[c]} {c}</option>)}</select></label>
        </div>
        <div className="field"><span>Positionen{rc.scope === 'private' && !ro ? ' · Haken = zählt als Familienausgabe' : ''}</span></div>
        <div className="cash-items">{rc.items.map((it, i) => <div key={i} className="cash-it">
          {rc.scope === 'private' && <input type="checkbox" aria-label="Familienausgabe" title="Familienausgabe" checked={it.family} onChange={e => setItem(i, { family: e.target.checked })} />}
          <input className="nm" value={it.name} onChange={e => setItem(i, { name: e.target.value })} aria-label="Position" />
          <select value={it.category} onChange={e => setItem(i, { category: e.target.value })} aria-label="Kategorie">{CATS.map(c => <option key={c} value={c}>{CAT_ICON[c]}</option>)}</select>
          <input className="pr" inputMode="decimal" defaultValue={fmt(it.price)} onChange={e => setItem(i, { price: num(e.target.value) })} aria-label="Preis" />
          {!ro && <button type="button" className="x" aria-label="Zeile löschen" onClick={() => setRc(r => ({ ...r, items: r.items.filter((_, k) => k !== i) }))}>✕</button>}
        </div>)}</div>
        {!ro && <button type="button" className="btn sm" onClick={() => setRc(r => ({ ...r, items: [...r.items, { name: '', qty: 1, price: 0, category: r.category, family: false }] }))}>＋ Zeile</button>}
        <p className="cash-check">Positionen: {eur(itemSum)}{rc.items.length && Math.abs(itemSum - rc.total) > 0.05 ? ` · weicht von der Summe ${eur(rc.total)} ab` : ''}{famSum ? ` · Familie: ${eur(famSum)}` : ''}</p>
        <label className="field"><span>Notiz</span><textarea value={rc.note} onChange={e => set({ note: e.target.value })} maxLength={2000} rows={2} /></label>
      </fieldset>
      <div className="btn-row">
        <button type="button" className="btn ghost" onClick={done}>{ro ? 'Zurück' : 'Abbrechen'}</button>
        {!ro && start.id && <button type="button" className="btn ghost del-btn" aria-label="Löschen" onClick={() => void del()}><Icon name="trash" /></button>}
        {!ro && <button type="button" className="btn" disabled={busy} onClick={() => void go()}>{busy ? 'Speichert …' : 'Speichern'}</button>}
      </div>
    </Sheet>
  );
}
