import { useEffect, useRef, useState } from 'react';
import { useSnapshot } from '../lib/store';
import { CAT_ICON, CATS, canViewFamily, crop, eur, familyPart, gross, taxesFromItems, getPrefs, setPrefs, cardScope, type Prefs, type Scope, list, loadPhoto, photoUrl, read, remove, save, toB64, toBlob, type Item, type Receipt, type Tax } from '../lib/cash';
import { Badge, Icon, Sheet } from './ui';
import { ask } from './ask';
import { fail, toast } from './toast';

const MON = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const num = (s: string) => { const n = Number(s.replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const fmt = (n: number) => n.toFixed(2).replace('.', ',');

type View = { kind: 'list' } | { kind: 'new' } | { kind: 'prefs' } | { kind: 'edit'; rc: Receipt; photo?: HTMLCanvasElement | null };

// Kassenbuch: Monatsübersicht, Bons fotografieren, auslesen, privat oder Familie
export function CashSheet({ close }: { close: () => void }) {
  const [view, setView] = useState<View>({ kind: 'list' });
  const [prefs, setP] = useState<Prefs>({ business: false, firm: '', cards: [] });
  useEffect(() => { void getPrefs().then(setP).catch(() => {}); }, []);
  const keep = async (p: Prefs) => { await setPrefs(p); setP(p); };
  const list = () => setView({ kind: 'list' });
  if (view.kind === 'new') return <NewReceipt close={close} back={list} prefs={prefs} next={(rc, photo) => setView({ kind: 'edit', rc, photo })} />;
  if (view.kind === 'edit') return <ReceiptForm close={close} rc={view.rc} photo={view.photo} prefs={prefs} keep={keep} done={list} />;
  if (view.kind === 'prefs') return <CashPrefs close={close} back={list} prefs={prefs} keep={keep} />;
  return <CashList close={close} prefs={prefs} add={() => setView({ kind: 'new' })} open={rc => setView({ kind: 'edit', rc })} settings={() => setView({ kind: 'prefs' })} />;
}

const SCOPE_LABEL: Record<Scope, string> = { private: 'Privat', family: 'Familie', business: 'Firma' };

// Eigene Einstellungen: Firma-Belege und feste Kartenzuordnung
function CashPrefs({ close, back, prefs, keep }: { close: () => void; back: () => void; prefs: Prefs; keep: (p: Prefs) => Promise<void> }) {
  const [p, setP] = useState<Prefs>(prefs), [busy, setBusy] = useState(false);
  const setCard = (i: number, c: Partial<Prefs['cards'][number]>) => setP(x => ({ ...x, cards: x.cards.map((y, k) => k === i ? { ...y, ...c } : y) }));
  const go = async () => {
    setBusy(true);
    try { await keep({ ...p, firm: p.firm.trim(), cards: p.cards.filter(c => c.card.length === 4) }); toast('Gespeichert.'); back(); }
    catch (e) { fail(e); } finally { setBusy(false); }
  };
  return (
    <Sheet onClose={close} label="Kassenbuch einrichten">
      <h2>Kassenbuch einrichten</h2>
      <label className="cash-opt"><input type="checkbox" checked={p.business} onChange={e => setP({ ...p, business: e.target.checked })} /><span><b>Ich bin Unternehmer</b><small>Zeigt die Taste „Firma“. Firmenbelege sieht nur du, mit Netto und Vorsteuer.</small></span></label>
      {p.business && <label className="field"><span>Firmenname</span><input value={p.firm} onChange={e => setP({ ...p, firm: e.target.value })} maxLength={200} placeholder="z. B. Muster GmbH" /></label>}
      <div className="field"><span>Meine Karten</span></div>
      <p className="cash-check">Wird ein Beleg mit einer dieser Karten bezahlt, ordnet FamTO ihn gleich richtig zu.</p>
      <div className="cash-cards">{p.cards.map((c, i) => <div key={i} className="cash-card">
        <span>…</span><input value={c.card} inputMode="numeric" maxLength={4} placeholder="1234" aria-label="Letzte 4 Ziffern" onChange={e => setCard(i, { card: e.target.value.replace(/\D/g, '').slice(0, 4) })} />
        <select value={c.scope} onChange={e => setCard(i, { scope: e.target.value as Scope })} aria-label="Zuordnung">
          {(['private', 'family', ...(p.business || c.scope === 'business' ? ['business'] as const : [])] as Scope[]).map(v => <option key={v} value={v}>{SCOPE_LABEL[v]}</option>)}
        </select>
        <button type="button" className="x" aria-label="Karte löschen" onClick={() => setP(x => ({ ...x, cards: x.cards.filter((_, k) => k !== i) }))}>✕</button>
      </div>)}</div>
      <button type="button" className="btn sm" onClick={() => setP(x => ({ ...x, cards: [...x.cards, { card: '', scope: x.business ? 'business' : 'private' }] }))}>＋ Karte</button>
      <div className="btn-row"><button type="button" className="btn ghost" onClick={back}>Zurück</button><button type="button" className="btn" disabled={busy} onClick={() => void go()}>{busy ? 'Speichert …' : 'Speichern'}</button></div>
    </Sheet>
  );
}

function CashList({ close, add, open, settings, prefs }: { close: () => void; add: () => void; open: (rc: Receipt) => void; settings: () => void; prefs: Prefs }) {
  const snap = useSnapshot();
  const me = snap.me!;
  const [off, setOff] = useState(0), [tab, setTab] = useState<'mine' | 'family' | 'business'>('mine'), [fam, setFam] = useState(false);
  const [rows, setRows] = useState<Receipt[] | null>(null), [err, setErr] = useState('');
  const now = new Date(), first = new Date(now.getFullYear(), now.getMonth() + off, 1), last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  useEffect(() => { void canViewFamily().then(setFam).catch(() => setFam(false)); }, []);
  useEffect(() => { setRows(null); setErr(''); list(ymd(first), ymd(last)).then(setRows, e => setErr(e instanceof Error ? e.message : String(e))); }, [off]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = (rows ?? []).filter(r => tab === 'mine' ? r.owner === me && r.scope !== 'business' : tab === 'business' ? r.owner === me && r.scope === 'business' : familyPart(r) !== 0);
  const amount = (r: Receipt) => tab === 'family' ? familyPart(r) : r.total;
  // Firma: Netto und Vorsteuer aus der MwSt-Aufstellung, sonst aus den Zeilen geschätzt
  const vat = (r: Receipt) => { const t = r.taxes.length ? r.taxes : taxesFromItems(r); return t.reduce((s, x) => s + x.tax, 0); };
  const tax = tab === 'business' ? shown.reduce((s, r) => s + vat(r), 0) : 0;
  const sum = shown.reduce((s, r) => s + amount(r), 0);
  // Summen je Kategorie: aus den Zeilen, sonst aus dem Bon
  const byCat = new Map<string, number>();
  for (const r of shown) {
    const its = tab === 'family' && r.scope !== 'family' ? r.items.filter(i => i.family) : r.items;
    if (its.length && Math.abs(its.reduce((s, i) => s + gross(r, i), 0) - amount(r)) < 0.05) for (const i of its) byCat.set(i.category, (byCat.get(i.category) ?? 0) + gross(r, i));
    else byCat.set(r.category, (byCat.get(r.category) ?? 0) + amount(r));
  }
  const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...cats.map(c => c[1]));
  return (
    <Sheet onClose={close} label="Kassenbuch">
      <h2>Kassenbuch</h2>
      <button type="button" className="cash-gear" aria-label="Kassenbuch einrichten" onClick={settings}><Icon name="gear" /></button>
      {(fam || prefs.business) && <div className="cash-tabs">
        <button type="button" className={`kw-p${tab === 'mine' ? ' on' : ''}`} onClick={() => setTab('mine')}>Meine</button>
        {fam && <button type="button" className={`kw-p${tab === 'family' ? ' on' : ''}`} onClick={() => setTab('family')}>Familie</button>}
        {prefs.business && <button type="button" className={`kw-p${tab === 'business' ? ' on' : ''}`} onClick={() => setTab('business')}>Firma</button>}
      </div>}
      <div className="cash-mon">
        <button type="button" className="arr" aria-label="Monat zurück" onClick={() => setOff(o => o - 1)}>◀</button>
        <b>{MON[first.getMonth()]} {first.getFullYear()}</b>
        <button type="button" className="arr" aria-label="Monat vor" style={{ visibility: off < 0 ? 'visible' : 'hidden' }} onClick={() => setOff(o => o + 1)}>▶</button>
      </div>
      {err ? <p className="cash-err">{err}</p> : rows === null ? <p>Lädt …</p> : <>
        <div className="cash-sum"><span>{tab === 'mine' ? 'Meine Ausgaben' : tab === 'business' ? (prefs.firm || 'Firma') + ' brutto' : 'Familienausgaben'}</span><b>{eur(sum)}</b></div>
        {tab === 'business' && <div className="cash-net"><span>Netto <b>{eur(sum - tax)}</b></span><span>Vorsteuer <b>{eur(tax)}</b></span></div>}
        {cats.length > 0 && <div className="cash-cats">{cats.map(([c, v]) => <div key={c} className="cash-cat">
          <span>{CAT_ICON[c] ?? '📦'} {c}</span><i style={{ width: `${Math.max(3, v / max * 100)}%` }} /><b>{eur(v)}</b></div>)}</div>}
        {!shown.length && <p>{tab === 'mine' ? 'In diesem Monat noch keine Belege. Mit „＋ Beleg“ fotografierst du einen Kassenbon.' : tab === 'business' ? 'In diesem Monat keine Firmenbelege.' : 'In diesem Monat keine Familienausgaben.'}</p>}
        <div className="cash-list">{shown.map(r => {
          const who = snap.members.find(m => m.id === r.owner);
          const d = new Date(r.bought_at);
          return <button key={r.id} type="button" className="cash-row" onClick={() => open(r)}>
            <span className="cash-ic">{CAT_ICON[r.category] ?? '📦'}</span>
            <span className="cash-mid"><b>{r.merchant || 'Beleg'}</b><small>{d.getDate()}.{d.getMonth() + 1}. {pad(d.getHours())}:{pad(d.getMinutes())}{r.payment ? ` · ${r.payment}${r.card ? ` …${r.card}` : ''}` : ''}{r.kind === 'rechnung' ? ' · Rechnung' : ''}{r.scope === 'family' ? ' · Familie' : r.items.some(i => i.family) ? ' · teils Familie' : ''}</small></span>
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
function NewReceipt({ close, back, next, prefs }: { close: () => void; back: () => void; prefs: Prefs; next: (rc: Receipt, photo: HTMLCanvasElement | null) => void }) {
  const cam = useRef<HTMLInputElement>(null), gal = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(''), [img, setImg] = useState<HTMLCanvasElement | null>(null), [rc, setRc] = useState<Receipt | null>(null);
  const [box, setBox] = useState({ x0: 0, y0: 0, x1: 1, y1: 1 });
  const blank = (): Receipt => ({ bought_at: new Date().toISOString(), merchant: '', payment: '', card: '', total: 0, currency: 'EUR', category: 'Sonstiges', scope: 'private', photo: null, note: '', items: [], kind: 'bon', invoice_no: '', net: 0, taxes: [], items_net: false });
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
        const card = r.card.replace(/\D/g, '').slice(-4), by = cardScope(prefs, card);
        if (by) toast(`Karte …${card}: ${SCOPE_LABEL[by]}`);
        setRc({ ...blank(), scope: by ?? 'private', bought_at: (isNaN(at.getTime()) ? new Date() : at).toISOString(), merchant: r.merchant, payment: r.payment, card, total: r.total || r.items.reduce((s, i) => s + i.price, 0), kind: r.kind === 'rechnung' ? 'rechnung' : 'bon', invoice_no: r.invoice_no ?? '', net: r.net || 0, taxes: r.taxes ?? [], items_net: !!r.items_net, currency: r.currency || 'EUR', category: (CATS as readonly string[]).includes(r.category) ? r.category : 'Sonstiges', items: r.items.map(i => ({ ...i, vat: i.vat || 0, family: false })) });
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
        <p>Fotografiere den Kassenbon möglichst gerade und flach. FamTO liest Händler, Datum, Karte, Positionen und Summe aus (bei Rechnungen auch Netto und MwSt) und stellt den Bon frei.</p>
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
function ReceiptForm({ close, rc: start, photo, done, prefs, keep }: { close: () => void; rc: Receipt; photo?: HTMLCanvasElement | null; done: () => void; prefs: Prefs; keep: (p: Prefs) => Promise<void> }) {
  const snap = useSnapshot();
  const mine = !start.owner || start.owner === snap.me;
  const [rc, setRc] = useState<Receipt>(start), [busy, setBusy] = useState(false), [url, setUrl] = useState(''), [big, setBig] = useState(false);
  useEffect(() => { if (photo) setUrl(photo.toDataURL('image/jpeg', 0.8)); else if (rc.photo) void photoUrl(rc.photo).then(setUrl).catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (p: Partial<Receipt>) => setRc(r => ({ ...r, ...p }));
  const setItem = (i: number, p: Partial<Item>) => setRc(r => ({ ...r, items: r.items.map((x, k) => k === i ? { ...x, ...p } : x) }));
  const d = new Date(rc.bought_at), date = ymd(d), time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const setWhen = (dt: string, tm: string) => { const n = new Date(`${dt}T${tm || '12:00'}:00`); if (!isNaN(n.getTime())) set({ bought_at: n.toISOString() }); };
  const inv = rc.kind === 'rechnung';
  const biz = prefs.business || start.scope === 'business';
  const known = cardScope(prefs, rc.card);
  const [remember, setRemember] = useState(false);
  const itemSum = rc.items.reduce((s, i) => s + gross(rc, i), 0), itemNet = rc.items.reduce((s, i) => s + i.price, 0);
  const famSum = familyPart(rc);
  const taxNet = rc.taxes.reduce((s, t) => s + t.net, 0), taxSum = rc.taxes.reduce((s, t) => s + t.tax, 0);
  const setTax = (i: number, p: Partial<Tax>) => setRc(r => ({ ...r, taxes: r.taxes.map((x, k) => k === i ? { ...x, ...p } : x) }));
  // Rechnung einschalten: fehlende MwSt-Aufstellung aus den Zeilen schätzen
  const setKind = (k: Receipt['kind']) => setRc(r => {
    const taxes = k === 'rechnung' && !r.taxes.length ? taxesFromItems(r) : r.taxes;
    return { ...r, kind: k, taxes, net: k === 'rechnung' && !r.net ? Math.round(taxes.reduce((s, t) => s + t.net, 0) * 100) / 100 : r.net };
  });
  const go = async () => {
    if (!rc.merchant.trim() && !rc.total) { toast('Bitte mindestens Händler oder Betrag eintragen.'); return; }
    setBusy(true);
    try {
      await save({ ...rc, merchant: rc.merchant.trim() }, photo ? await toBlob(photo) : null);
      if (remember && rc.card.length === 4) await keep({ ...prefs, cards: [...prefs.cards.filter(c => c.card !== rc.card), { card: rc.card, scope: rc.scope }] }).catch(() => {}); toast('Beleg gespeichert.'); done(); }
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
        {!ro && <div className={`visbig${biz ? ' three' : ''}`} role="group" aria-label="Privat, Familie oder Firma">
          <button type="button" className="private" aria-pressed={rc.scope === 'private'} onClick={() => set({ scope: 'private' })}><Icon name="lock" />Privat<small>nur ich</small></button>
          <button type="button" className="family" aria-pressed={rc.scope === 'family'} onClick={() => set({ scope: 'family' })}><Icon name="home" />Familie<small>Familienkasse</small></button>
          {biz && <button type="button" className="business" aria-pressed={rc.scope === 'business'} onClick={() => setRc(r => ({ ...r, scope: 'business', items: r.items.map(i => ({ ...i, family: false })) }))}><Icon name="work" />Firma<small>{prefs.firm || 'nur ich'}</small></button>}
        </div>}
        {!ro && <div className="cash-kind" role="group" aria-label="Belegart">
          <button type="button" aria-pressed={!inv} onClick={() => setKind('bon')}>🧾 Kassenbon<small>Bruttopreise</small></button>
          <button type="button" aria-pressed={inv} onClick={() => setKind('rechnung')}>📄 Rechnung<small>Netto · MwSt · Brutto</small></button>
        </div>}
        <label className="field"><span>{inv ? 'Rechnungssteller' : 'Händler'}</span><input value={rc.merchant} onChange={e => set({ merchant: e.target.value })} maxLength={200} placeholder="z. B. REWE" /></label>
        <div className="row2">
          <label className="field"><span>Datum</span><input type="date" value={date} onChange={e => e.target.value && setWhen(e.target.value, time)} /></label>
          <label className="field"><span>Uhrzeit</span><input type="time" value={time} onChange={e => e.target.value && setWhen(date, e.target.value)} /></label>
          <label className="field"><span>Bezahlt mit</span><input value={rc.payment} onChange={e => set({ payment: e.target.value })} maxLength={100} placeholder="Bar, EC-Karte …" /></label>
          <label className="field"><span>Karte (letzte 4)</span><input value={rc.card} inputMode="numeric" onChange={e => { const card = e.target.value.replace(/\D/g, '').slice(0, 4); const by = cardScope(prefs, card); set(by && !start.id ? { card, scope: by } : { card }); }} placeholder="1234" /></label>
          {!ro && rc.card.length === 4 && known !== rc.scope && <label className="cash-v wide"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} /> Karte …{rc.card} immer als „{SCOPE_LABEL[rc.scope]}“ zuordnen</label>}
          {inv && <label className="field"><span>Rechnungsnr.</span><input value={rc.invoice_no} onChange={e => set({ invoice_no: e.target.value })} maxLength={60} /></label>}
          {inv && <label className="field"><span>Netto (€)</span><input inputMode="decimal" defaultValue={rc.net ? fmt(rc.net) : ''} onChange={e => set({ net: num(e.target.value) })} placeholder="0,00" /></label>}
          <label className="field"><span>{inv ? 'Brutto (€)' : 'Summe (€)'}</span><input inputMode="decimal" defaultValue={rc.total ? fmt(rc.total) : ''} onChange={e => set({ total: num(e.target.value) })} placeholder="0,00" /></label>
          <label className="field"><span>Kategorie</span><select value={rc.category} onChange={e => set({ category: e.target.value })}>{CATS.map(c => <option key={c} value={c}>{CAT_ICON[c]} {c}</option>)}</select></label>
        </div>
        {inv && <div className="cash-tax">
          <div className="th"><span>MwSt</span><span>Netto</span><span>Steuer</span><span>Brutto</span><span /></div>
          {rc.taxes.map((t, i) => <div key={i} className="tr">
            <span><input inputMode="decimal" defaultValue={String(t.rate).replace('.', ',')} onChange={e => setTax(i, { rate: num(e.target.value) })} aria-label="Steuersatz" />%</span>
            <input inputMode="decimal" defaultValue={fmt(t.net)} onChange={e => setTax(i, { net: num(e.target.value) })} aria-label="Netto" />
            <input inputMode="decimal" defaultValue={fmt(t.tax)} onChange={e => setTax(i, { tax: num(e.target.value) })} aria-label="Steuer" />
            <b>{fmt(t.net + t.tax)}</b>
            {!ro ? <button type="button" className="x" aria-label="Steuersatz löschen" onClick={() => setRc(r => ({ ...r, taxes: r.taxes.filter((_, k) => k !== i) }))}>✕</button> : <span />}
          </div>)}
          <div className="tr sum"><span>Summe</span><b>{fmt(taxNet)}</b><b>{fmt(taxSum)}</b><b>{fmt(taxNet + taxSum)}</b><span /></div>
          {!ro && <button type="button" className="btn sm" onClick={() => setRc(r => ({ ...r, taxes: [...r.taxes, { rate: 19, net: 0, tax: 0 }] }))}>＋ Steuersatz</button>}
          {rc.taxes.length > 0 && (Math.abs(taxNet + taxSum - rc.total) > 0.02 || (rc.net && Math.abs(taxNet - rc.net) > 0.02)) ? <p className="cash-warn">Netto + MwSt ergibt {eur(taxNet + taxSum)}, auf der Rechnung stehen {rc.net ? `netto ${eur(rc.net)} und ` : ''}brutto {eur(rc.total)}. Bitte prüfen.</p> : null}
          <label className="cash-v"><input type="checkbox" checked={rc.items_net} onChange={e => set({ items_net: e.target.checked })} /> Positionspreise sind netto</label>
        </div>}
        <div className="field"><span>Positionen{inv ? (rc.items_net ? ' (netto)' : ' (brutto)') : ''}{rc.scope === 'private' && !ro ? ' · Haken = zählt als Familienausgabe' : ''}</span></div>
        <div className="cash-items">{rc.items.map((it, i) => <div key={i} className="cash-it">
          {rc.scope === 'private' && <input type="checkbox" aria-label="Familienausgabe" title="Familienausgabe" checked={it.family} onChange={e => setItem(i, { family: e.target.checked })} />}
          <input className="nm" value={it.name} onChange={e => setItem(i, { name: e.target.value })} aria-label="Position" />
          <select value={it.category} onChange={e => setItem(i, { category: e.target.value })} aria-label="Kategorie">{CATS.map(c => <option key={c} value={c}>{CAT_ICON[c]}</option>)}</select>
          {inv && <select className="vat" value={it.vat} onChange={e => setItem(i, { vat: Number(e.target.value) })} aria-label="MwSt">{[...new Set([0, 7, 19, it.vat])].sort((a, b) => a - b).map(v => <option key={v} value={v}>{v ? `${v}%` : '–'}</option>)}</select>}
          <input className="pr" inputMode="decimal" defaultValue={fmt(it.price)} onChange={e => setItem(i, { price: num(e.target.value) })} aria-label="Preis" />
          {!ro && <button type="button" className="x" aria-label="Zeile löschen" onClick={() => setRc(r => ({ ...r, items: r.items.filter((_, k) => k !== i) }))}>✕</button>}
        </div>)}</div>
        {!ro && <button type="button" className="btn sm" onClick={() => setRc(r => ({ ...r, items: [...r.items, { name: '', qty: 1, price: 0, vat: r.items.at(-1)?.vat ?? 0, category: r.category, family: false }] }))}>＋ Zeile</button>}
        <p className="cash-check">Positionen: {inv && rc.items_net ? `netto ${eur(itemNet)} · brutto ${eur(itemSum)}` : eur(itemSum)}{rc.items.length && Math.abs(itemSum - rc.total) > 0.05 ? ` · weicht von der Summe ${eur(rc.total)} ab` : ''}{famSum ? ` · Familie: ${eur(famSum)}` : ''}</p>
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
