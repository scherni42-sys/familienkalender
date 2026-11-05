import { useEffect, useRef, useState } from 'react';
import { useSnapshot } from '../lib/store';
import { CATS, canViewFamily, groups, listGroup, crop, eur, familyPart, gross, taxesFromItems, getPrefs, setPrefs, cardScope, type Prefs, type Scope, type Party, type EInv, type ReadResult, takeShared, openPdf, list, loadPhoto, photoUrl, read, reread, remove, save, toB64, toBlob, type Item, type Receipt, type Tax } from '../lib/cash';
import { Badge, Icon, Sheet } from './ui';
import { ask } from './ask';
import { CatIcon, CatPick } from './CashIcons';
import { ZoomView } from './ZoomView';
import { fail, toast } from './toast';
import { native } from '../lib/native';
import type { Cell, SheetData } from '../lib/xlsx';
import { xCheck, xrechnung } from '../lib/xrechnung';

const MON = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const num = (s: string) => { const n = Number(s.replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const fmt = (n: number) => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true });

type Photo = HTMLCanvasElement | Blob | null;
type View = { kind: 'list' } | { kind: 'new'; file?: File } | { kind: 'prefs' } | { kind: 'edit'; rc: Receipt; photo?: Photo };

// Kassenbuch: Monatsübersicht, Bons fotografieren, auslesen, privat oder Familie
export function CashSheet({ close, share, rc: openRc }: { close: () => void; share?: boolean; rc?: Receipt }) {
  // Mit FamTO geteilte Datei (PDF-Rechnung, Foto): gleich einen neuen Beleg damit anlegen
  const [view, setView] = useState<View>(() => { const f = share ? takeShared() : null; return f ? { kind: 'new', file: f } : openRc ? { kind: 'edit', rc: openRc } : { kind: 'list' }; });
  const [prefs, setP] = useState<Prefs>({ business: false, firm: '', cards: [] });
  useEffect(() => { void getPrefs().then(setP).catch(() => {}); }, []);
  const keep = async (p: Prefs) => { await setPrefs(p); setP(p); };
  const list = () => setView({ kind: 'list' });
  // Monat und Reiter bleiben erhalten; nach dem Speichern springt die Liste in den Monat des Belegs
  const [per, setPer] = useState<Period>({ mode: 'month', off: 0, yoff: 0, from: '', to: '', grp: '' }), [tab, setTab] = useState<Tab>('mine');
  const saved = (rc: Receipt) => {
    const d = new Date(rc.bought_at), n = new Date();
    if (!isNaN(d.getTime()) && per.mode === 'month') setPer(p => ({ ...p, off: Math.min(0, (d.getFullYear() - n.getFullYear()) * 12 + d.getMonth() - n.getMonth()) }));
    if (!isNaN(d.getTime()) && per.mode === 'year') setPer(p => ({ ...p, yoff: Math.min(0, d.getFullYear() - n.getFullYear()) }));
    if (rc.scope === 'business' && prefs.business) setTab('business'); else if (tab === 'business') setTab('mine');
    list();
  };
  if (view.kind === 'new') return <NewReceipt close={close} back={list} prefs={prefs} file={view.file} next={(rc, photo) => setView({ kind: 'edit', rc, photo })} />;
  if (view.kind === 'edit') return <ReceiptForm close={close} rc={view.rc} photo={view.photo} prefs={prefs} keep={keep} done={list} saved={saved} />;
  if (view.kind === 'prefs') return <CashPrefs close={close} back={list} prefs={prefs} keep={keep} />;
  return <CashList close={close} prefs={prefs} per={per} setPer={setPer} tab={tab} setTab={setTab} add={() => setView({ kind: 'new' })} open={rc => setView({ kind: 'edit', rc })} settings={() => setView({ kind: 'prefs' })} />;
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
      <details className="cash-einv"><summary>Meine Rechnungsanschrift (für E-Rechnungen)</summary>
        <p className="cash-check">Wird als Käufer eingesetzt, wenn auf der Rechnung keiner zu erkennen ist.</p>
        <PartyFields p={p.addr ?? {}} set={a => setP(x => ({ ...x, addr: { ...x.addr, ...a } as Party }))} buyer />
      </details>
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

type Tab = 'mine' | 'family' | 'business';
type Mode = 'month' | 'year' | 'range' | 'group';
export interface Period { mode: Mode; off: number; yoff: number; from: string; to: string; grp: string }
const MS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const dmy = (s: string) => s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : '';

function CashList({ close, add, open, settings, prefs, per, setPer, tab, setTab }: { per: Period; setPer: (f: (p: Period) => Period) => void; tab: Tab; setTab: (t: Tab) => void; close: () => void; add: () => void; open: (rc: Receipt) => void; settings: () => void; prefs: Prefs }) {
  const snap = useSnapshot();
  const me = snap.me!;
  const [fam, setFam] = useState(false), [grps, setGrps] = useState<string[]>([]), [umlSel, setUmlSel] = useState<string[]>([]);
  const [q, setQ] = useState(''), [all, setAll] = useState<Receipt[] | null>(null);
  const find = q.trim().length >= 2;
  useEffect(() => { if (find && !all) list('2000-01-01', ymd(new Date(Date.now() + 86400000))).then(setAll, () => setAll([])); }, [find]); // eslint-disable-line react-hooks/exhaustive-deps
  const [rows, setRows] = useState<Receipt[] | null>(null), [err, setErr] = useState('');
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + per.off, 1), last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const year = now.getFullYear() + per.yoff;
  const range: [string, string] | null = per.mode === 'month' ? [ymd(first), ymd(last)] : per.mode === 'year' ? [`${year}-01-01`, `${year}-12-31`] : per.mode === 'range' ? (per.from && per.to && per.from <= per.to ? [per.from, per.to] : null) : null;
  const key = per.mode === 'group' ? `g:${per.grp}` : range ? range.join('|') : '';
  useEffect(() => { void canViewFamily().then(setFam).catch(() => setFam(false)); void groups().then(setGrps); }, []);
  useEffect(() => {
    let live = true; setRows(null); setErr('');
    const q = per.mode === 'group' ? (per.grp ? listGroup(per.grp) : Promise.resolve([])) : range ? list(range[0], range[1]) : Promise.resolve([]);
    q.then(r => { if (live) setRows(r); }, e => { if (live) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const grpMode = per.mode === 'group' && !find;
  // Suche: alle Belege, die ich sehen darf, nach Händler, Position, Notiz, Gruppe, Rechnungsnr., Betrag
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = (r: Receipt) => [r.merchant, r.note, r.grp, r.invoice_no, r.category, r.payment, r.card, fmt(r.total), ...r.items.map(i => i.name)].join(' ').toLowerCase();
  const base = find ? (all ?? []).filter(r => words.every(w => hay(r).includes(w))) : rows ?? [];
  // In der Gruppe zählen alle sichtbaren Belege (für die Kostenumlage), sonst je Reiter
  const shown = base.filter(r => find ? (r.owner === me || familyPart(r) !== 0) : grpMode ? (r.owner === me || familyPart(r) !== 0) : tab === 'mine' ? r.owner === me && r.scope !== 'business' : tab === 'business' ? r.owner === me && r.scope === 'business' : familyPart(r) !== 0);
  const amount = (r: Receipt) => grpMode || find ? (r.owner === me || r.scope === 'family' ? r.total : familyPart(r)) : tab === 'family' ? familyPart(r) : r.total;
  // Firma: Netto und Vorsteuer aus der MwSt-Aufstellung, sonst aus den Zeilen geschätzt
  const vat = (r: Receipt) => { const t = r.taxes.length ? r.taxes : taxesFromItems(r); return t.reduce((s, x) => s + x.tax, 0); };
  const biz = !grpMode && tab === 'business';
  const tax = biz ? shown.reduce((s, r) => s + vat(r), 0) : 0;
  const sum = shown.reduce((s, r) => s + amount(r), 0);
  // Summen je Kategorie: aus den Zeilen, sonst aus dem Bon
  const byCat = new Map<string, number>();
  for (const r of shown) {
    const part = amount(r) !== r.total;
    const its = part ? r.items.filter(i => i.family) : r.items;
    if (its.length && Math.abs(its.reduce((s, i) => s + gross(r, i), 0) - amount(r)) < 0.05) for (const i of its) byCat.set(i.category, (byCat.get(i.category) ?? 0) + gross(r, i));
    else byCat.set(r.category, (byCat.get(r.category) ?? 0) + amount(r));
  }
  const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...cats.map(c => c[1]));
  const byMon = per.mode === 'year' ? MS.map((_, m) => shown.filter(r => new Date(r.bought_at).getMonth() === m).reduce((s, r) => s + amount(r), 0)) : [];
  const maxMon = Math.max(1, ...byMon);
  const label = find ? `Suche ${q.trim()}` : per.mode === 'month' ? `${MON[first.getMonth()]} ${first.getFullYear()}` : per.mode === 'year' ? String(year) : per.mode === 'range' ? `${dmy(per.from)} – ${dmy(per.to)}` : per.grp;
  const who = (id?: string) => snap.members.find(m => m.id === id)?.name ?? '';
  const exp = async () => {
    try {
      await exportXlsx(`Kassenbuch ${label}${grpMode ? '' : ` ${tab === 'mine' ? 'Meine' : tab === 'family' ? 'Familie' : 'Firma'}`}`, shown, amount, who, grpMode ? umlage(shown, amount, umlSel, who) : null);
    } catch (e) { fail(e); }
  };
  const setMode = (mode: Mode) => setPer(p => ({ ...p, mode, from: p.from || ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: p.to || ymd(now), grp: p.grp || grps[0] || '' }));
  return (
    <Sheet onClose={close} label="Kassenbuch">
      <div className="cash-top">
        <h2>Kassenbuch</h2>
        <button type="button" className="head-i" aria-label="Kassenbuch einrichten" onClick={settings}><Icon name="gear" /></button>
      </div>
      {per.mode !== 'group' && !find && (fam || prefs.business) && <div className="cash-tabs">
        <button type="button" className={`kw-p${tab === 'mine' ? ' on' : ''}`} onClick={() => setTab('mine')}>Meine</button>
        {fam && <button type="button" className={`kw-p${tab === 'family' ? ' on' : ''}`} onClick={() => setTab('family')}>Familie</button>}
        {prefs.business && <button type="button" className={`kw-p${tab === 'business' ? ' on' : ''}`} onClick={() => setTab('business')}>Firma</button>}
      </div>}
      <div className="cash-modes" role="group" aria-label="Zeitraum">
        {([['month', 'Monat'], ['year', 'Jahr'], ['range', 'Von – bis'], ['group', 'Gruppe']] as [Mode, string][]).map(([m, t]) =>
          <button key={m} type="button" aria-pressed={per.mode === m} onClick={() => setMode(m)}>{t}</button>)}
      </div>
      <label className="cash-find"><Icon name="search" /><input type="text" enterKeyHint="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Belege durchsuchen, z. B. Zahnpasta, Berchim" aria-label="Belege durchsuchen" />{q && <button type="button" aria-label="Suche löschen" onClick={() => setQ('')}>✕</button>}</label>
      {!find && per.mode === 'month' && <div className="cash-mon">
        <button type="button" className="arr" aria-label="Monat zurück" onClick={() => setPer(p => ({ ...p, off: p.off - 1 }))}>◀</button>
        <b>{label}</b>
        <button type="button" className="arr" aria-label="Monat vor" style={{ visibility: per.off < 0 ? 'visible' : 'hidden' }} onClick={() => setPer(p => ({ ...p, off: p.off + 1 }))}>▶</button>
      </div>}
      {!find && per.mode === 'year' && <div className="cash-mon">
        <button type="button" className="arr" aria-label="Jahr zurück" onClick={() => setPer(p => ({ ...p, yoff: p.yoff - 1 }))}>◀</button>
        <b>{label}</b>
        <button type="button" className="arr" aria-label="Jahr vor" style={{ visibility: per.yoff < 0 ? 'visible' : 'hidden' }} onClick={() => setPer(p => ({ ...p, yoff: p.yoff + 1 }))}>▶</button>
      </div>}
      {!find && per.mode === 'range' && <div className="row2">
        <label className="field"><span>Von</span><input type="date" value={per.from} onChange={e => setPer(p => ({ ...p, from: e.target.value }))} /></label>
        <label className="field"><span>Bis</span><input type="date" value={per.to} onChange={e => setPer(p => ({ ...p, to: e.target.value }))} /></label>
      </div>}
      {grpMode && !find && (grps.length ? <label className="field"><span>Buchungsgruppe</span><select value={per.grp} onChange={e => setPer(p => ({ ...p, grp: e.target.value }))}>{grps.map(g => <option key={g} value={g}>{g}</option>)}</select></label>
        : <p>Noch keine Buchungsgruppen. Trag beim Beleg unter „Buchungsgruppe“ z. B. „Urlaub Dänemark 2026“ ein, dann siehst du hier alle Ausgaben dazu und wer wem wie viel schuldet.</p>)}
      {err && !find ? <p className="cash-err">{err}</p> : (find ? all === null : rows === null) ? <p>Lädt …</p> : <>
        <div className="cash-sum"><span>{find ? `${shown.length} Treffer` : grpMode ? 'Gesamt' : tab === 'mine' ? 'Meine Ausgaben' : biz ? (prefs.firm || 'Firma') + ' brutto' : 'Familienausgaben'}</span><b>{eur(sum)}</b></div>
        {biz && <div className="cash-net"><span>Netto <b>{eur(sum - tax)}</b></span><span>Vorsteuer <b>{eur(tax)}</b></span></div>}
        {grpMode && shown.length > 0 && <Umlage key={per.grp} shown={shown} amount={amount} onSel={setUmlSel} />}
        {!find && per.mode === 'year' && sum > 0 && <div className="cash-cats">{byMon.map((v, m) => <div key={m} className="cash-cat mon">
          <span>{MS[m]}</span><i style={{ width: `${v ? Math.max(2, v / maxMon * 100) : 0}%` }} /><b>{v ? eur(v) : '–'}</b></div>)}</div>}
        {cats.length > 0 && <div className="cash-cats">{cats.map(([c, v]) => <div key={c} className="cash-cat">
          <span><CatIcon c={c} size={18} /> {c}</span><i style={{ width: `${Math.max(3, v / max * 100)}%` }} /><b>{eur(v)}</b></div>)}</div>}
        {!shown.length && !(grpMode && !grps.length) && <p>{find ? 'Nichts gefunden.' : per.mode !== 'month' ? 'Keine Belege in dieser Auswahl.' : tab === 'mine' ? 'In diesem Monat noch keine Belege. Mit „＋ Beleg“ fotografierst du einen Kassenbon.' : biz ? 'In diesem Monat keine Firmenbelege.' : 'In diesem Monat keine Familienausgaben.'}</p>}
        {shown.length > 0 && <button type="button" className="btn sm ghost cash-xl" onClick={() => void exp()}><Icon name="share" /> Excel-Export</button>}
        <div className="cash-list">{shown.map(r => {
          const m = snap.members.find(x => x.id === r.owner);
          const d = new Date(r.bought_at);
          return <button key={r.id} type="button" className="cash-row" onClick={() => open(r)}>
            <span className="cash-ic"><CatIcon c={r.category} size={24} /></span>
            <span className="cash-mid"><b>{r.merchant || 'Beleg'}</b><small>{d.getDate()}.{d.getMonth() + 1}.{per.mode === 'month' && !find ? '' : String(d.getFullYear()).slice(2)}{r.kind === 'rechnung' ? '' : ` ${pad(d.getHours())}:${pad(d.getMinutes())}`}{r.payment ? ` · ${r.payment}${r.card ? ` …${r.card}` : ''}` : ''}{r.kind === 'rechnung' ? ' · Rechnung' : ''}{r.grp && !grpMode ? ` · ${r.grp}` : ''}{r.scope === 'family' ? ' · Familie' : r.items.some(i => i.family) ? ' · teils Familie' : ''}</small></span>
            {(tab === 'family' || grpMode || find) && m && m.id !== me && <Badge m={m} size={24} plain />}
            <b className="cash-amt">{eur(amount(r))}</b>
          </button>;
        })}</div>
      </>}
      <div className="btn-row"><button type="button" className="btn ghost" onClick={close}>Schließen</button>{snap.members.find(m => m.id === me)?.role !== 'guest' && <button type="button" className="btn" onClick={add}>＋ Beleg</button>}</div>
    </Sheet>
  );
}

// Kostenumlage: wer hat wie viel bezahlt, gleich aufgeteilt auf die gewählten Personen, wer zahlt wem
function umlage(shown: Receipt[], amount: (r: Receipt) => number, people: string[], who: (id?: string) => string) {
  const paid = new Map<string, number>();
  for (const r of shown) if (r.owner) paid.set(r.owner, (paid.get(r.owner) ?? 0) + amount(r));
  const ids = [...new Set([...paid.keys(), ...people])].filter(id => people.includes(id) || paid.has(id));
  const total = [...paid.values()].reduce((s, v) => s + v, 0), share = ids.length ? total / ids.length : 0;
  const bal = ids.map(id => ({ id, name: who(id), paid: paid.get(id) ?? 0, diff: (paid.get(id) ?? 0) - share }));
  const pay: { from: string; to: string; eur: number }[] = [];
  const deb = bal.filter(b => b.diff < -0.005).map(b => ({ ...b, v: -b.diff })), cre = bal.filter(b => b.diff > 0.005).map(b => ({ ...b, v: b.diff }));
  for (const d of deb) for (const c of cre) { const x = Math.min(d.v, c.v); if (x > 0.005) { pay.push({ from: d.name, to: c.name, eur: Math.round(x * 100) / 100 }); d.v -= x; c.v -= x; } }
  return { total, share, bal, pay };
}

function Umlage({ shown, amount, onSel }: { shown: Receipt[]; amount: (r: Receipt) => number; onSel: (s: string[]) => void }) {
  const snap = useSnapshot();
  const all = snap.members.filter(m => m.role !== 'guest');
  const payers = [...new Set(shown.map(r => r.owner!))];
  const [sel, setSel] = useState<string[]>(() => all.map(m => m.id).filter(id => payers.includes(id) || id === snap.me));
  useEffect(() => { onSel(sel); }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps
  const who = (id?: string) => snap.members.find(m => m.id === id)?.name ?? '?';
  const u = umlage(shown, amount, sel, who);
  return <div className="cash-uml">
    <b>Kostenumlage</b>
    <div className="cash-uml-who">{all.map(m => <label key={m.id} className={sel.includes(m.id) ? 'on' : ''}>
      <input type="checkbox" checked={sel.includes(m.id)} disabled={payers.includes(m.id)} onChange={e => setSel(s => e.target.checked ? [...s, m.id] : s.filter(x => x !== m.id))} />{m.name}</label>)}</div>
    <div className="cash-uml-t">{u.bal.map(b => <div key={b.id}><span>{b.name}</span><span>bezahlt {eur(b.paid)}</span><b className={b.diff >= 0 ? 'plus' : 'minus'}>{b.diff >= 0 ? '+' : '−'}{eur(Math.abs(b.diff))}</b></div>)}</div>
    <small>Anteil je Person: {eur(u.share)} ({u.bal.length} {u.bal.length === 1 ? 'Person' : 'Personen'})</small>
    {u.pay.length ? u.pay.map((p, i) => <p key={i} className="cash-pay">{p.from} zahlt an {p.to}: <b>{eur(p.eur)}</b></p>) : <p className="cash-pay">Alles ausgeglichen.</p>}
    <small>Es zählen alle Belege der Gruppe, die du sehen darfst. Belege der anderen bitte als „Familie“ speichern.</small>
  </div>;
}

// Excel-Datei bauen und teilen (App) bzw. herunterladen (Browser)
async function exportXlsx(title: string, shown: Receipt[], amount: (r: Receipt) => number, who: (id?: string) => string, uml: ReturnType<typeof umlage> | null) {
  const { xlsx } = await import('../lib/xlsx');
  const SC: Record<string, string> = { private: 'Privat', family: 'Familie', business: 'Firma' };
  const sorted = [...shown].sort((a, b) => a.bought_at.localeCompare(b.bought_at));
  const vatOf = (r: Receipt) => (r.taxes.length ? r.taxes : taxesFromItems(r)).reduce((s, t) => s + t.tax, 0);
  const sheets: SheetData[] = [{
    name: 'Belege', widths: [11, 26, 14, 14, 18, 18, 9, 9, 14, 7, 12, 12, 12, 12, 30],
    rows: [['Datum', 'Händler', 'Person', 'Kategorie', 'Buchungsgruppe', 'Rechnungsnr.', 'Art', 'Zuordnung', 'Bezahlt mit', 'Karte', 'Netto', 'MwSt', 'Brutto', 'Betrag', 'Notiz'],
      ...sorted.map(r => { const v = vatOf(r); return [{ date: new Date(r.bought_at) }, r.merchant, who(r.owner), r.category, r.grp, r.invoice_no, r.kind === 'rechnung' ? 'Rechnung' : 'Bon', SC[r.scope], r.payment, r.card, { eur: r.net || r.total - v }, { eur: v }, { eur: r.total }, { eur: amount(r) }, r.note]; }),
      ['Summe', '', '', '', '', '', '', '', '', '', { eur: sorted.reduce((s, r) => s + (r.net || r.total - vatOf(r)), 0) }, { eur: sorted.reduce((s, r) => s + vatOf(r), 0) }, { eur: sorted.reduce((s, r) => s + r.total, 0) }, { eur: sorted.reduce((s, r) => s + amount(r), 0) }, '']]
  }, {
    name: 'Positionen', widths: [11, 26, 32, 8, 14, 7, 12, 9],
    rows: [['Datum', 'Händler', 'Position', 'Menge', 'Kategorie', 'MwSt %', 'Betrag', 'Familie'],
      ...sorted.flatMap(r => r.items.map(i => [{ date: new Date(r.bought_at) }, r.merchant, i.name, i.qty, i.category, i.vat || null, { eur: i.price }, r.scope === 'family' || i.family ? 'ja' : ''] as Cell[]))]
  }];
  if (uml) sheets.push({ name: 'Kostenumlage', widths: [18, 14, 14, 14], rows: [['Person', 'Bezahlt', 'Anteil', 'Saldo'], ...uml.bal.map(b => [b.name, { eur: b.paid }, { eur: uml.share }, { eur: b.diff }] as Cell[]), [], ['Ausgleich'], ...uml.pay.map(p => [`${p.from} → ${p.to}`, { eur: p.eur }] as Cell[])] });
  shareBytes(`${title.replace(/[^\wÄÖÜäöüß .-]+/g, ' ').trim()}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xlsx(sheets));
}

// Datei teilen (App: Teilen-Menü) bzw. herunterladen (Browser)
function shareBytes(name: string, mime: string, data: Uint8Array) {
  const n = native();
  if (n?.shareFile) { let bin = ''; for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode(...data.subarray(i, i + 0x8000)); n.shareFile(name, mime, btoa(bin)); return; }
  if (n) { toast('Für den Export bitte die App aktualisieren (Einstellungen → App-Update).'); return; }
  const url = URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>], { type: mime }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Neuer Bon: Foto aufnehmen oder wählen, auslesen lassen, zuschneiden
function NewReceipt({ close, back, next, prefs, file }: { close: () => void; back: () => void; prefs: Prefs; file?: File; next: (rc: Receipt, photo: Photo) => void }) {
  const cam = useRef<HTMLInputElement>(null), gal = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(''), [img, setImg] = useState<HTMLCanvasElement | null>(null), [rc, setRc] = useState<Receipt | null>(null);
  const [box, setBox] = useState({ x0: 0, y0: 0, x1: 1, y1: 1 });
  const blank = (): Receipt => ({ bought_at: new Date().toISOString(), merchant: '', payment: '', card: '', total: 0, currency: 'EUR', category: 'Sonstiges', scope: 'private', photo: null, note: '', items: [], kind: 'bon', invoice_no: '', net: 0, taxes: [], items_net: false, grp: '', einv: {} });
  const fill = (r: ReadResult): Receipt => {
    const at = r.date ? new Date(`${r.date}T${/^\d\d:\d\d$/.test(r.time) ? r.time : '12:00'}:00`) : new Date();
    const card = r.card.replace(/\D/g, '').slice(-4), by = cardScope(prefs, card);
    if (by) toast(`Karte …${card}: ${SCOPE_LABEL[by]}`);
    return { ...blank(), scope: by ?? 'private', bought_at: (isNaN(at.getTime()) ? new Date() : at).toISOString(), merchant: r.merchant, payment: r.payment, card, total: r.total || r.items.reduce((s, i) => s + i.price, 0), kind: r.kind === 'rechnung' ? 'rechnung' : 'bon', invoice_no: r.invoice_no ?? '', net: r.net || 0, taxes: r.taxes ?? [], items_net: !!r.items_net, currency: r.currency || 'EUR', category: (CATS as readonly string[]).includes(r.category) ? r.category : 'Sonstiges', items: r.items.map(i => ({ ...i, vat: i.vat || 0, family: false })), einv: r.kind === 'rechnung' ? { seller: r.seller, buyer: r.buyer, due: r.due_date || undefined, service: r.service_date || undefined, ref: r.buyer_ref || undefined } : {} };
  };
  // PDF (z. B. Rechnung aus der Mail): direkt lesen lassen, kein Zuschneiden
  const pdf = async (f: File) => {
    if (f.size > 4_500_000) { toast('Die PDF ist zu groß (höchstens 4,5 MB).'); return; }
    setBusy('Die Rechnung wird gelesen …');
    let rc = blank();
    try {
      const b = new Uint8Array(await f.arrayBuffer()); let bin = '';
      for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
      const r = await read({ type: 'application/pdf', data: btoa(bin) });
      if (!r.found) toast('In der PDF ist keine Rechnung zu erkennen. Du kannst trotzdem alles eintragen.');
      rc = fill(r);
    } catch (e) { fail(e); }
    finally { setBusy(''); }
    next(rc, f);
  };
  useEffect(() => { if (file) void pick(file); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = async (f?: File) => {
    if (!f) return;
    if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) { await pdf(f); return; }
    try {
      setBusy('Foto wird geladen …');
      const c = await loadPhoto(f); setImg(c);
      setBusy('Der Bon wird gelesen …');
      try {
        const r = await read(toB64(c));
        if (!r.found) toast('Auf dem Foto ist kein Bon zu erkennen. Du kannst trotzdem alles eintragen.');
        setRc(fill(r));
        if (r.found && r.box && r.box.x1 - r.box.x0 > 0.1 && r.box.y1 - r.box.y0 > 0.1) setBox({ x0: Math.max(0, r.box.x0 - 0.01), y0: Math.max(0, r.box.y0 - 0.01), x1: Math.min(1, r.box.x1 + 0.01), y1: Math.min(1, r.box.y1 + 0.01) });
      } catch (e) { fail(e); setRc(blank()); }
    } catch { toast('Das Foto ließ sich nicht öffnen.'); }
    finally { setBusy(''); }
  };
  return (
    <Sheet onClose={close} label="Neuer Beleg">
      <h2>Neuer Beleg</h2>
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={e => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
      <input ref={gal} type="file" accept="image/*,application/pdf" hidden onChange={e => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
      {busy ? <div className="cash-busy"><span className="spin" /> {busy}</div> : img && rc ? <>
        <p>Zieh die Ecken so, dass nur der Bon im Rahmen ist.</p>
        <CropBox img={img} box={box} set={setBox} />
      </> : <>
        <p>Fotografiere den Kassenbon möglichst gerade und flach. FamTO liest Händler, Datum, Karte, Positionen und Summe aus (bei Rechnungen auch Netto und MwSt) und stellt den Bon frei.</p>
        <div className="cash-pick">
          <button type="button" className="btn" onClick={() => cam.current?.click()}><Icon name="camera" /> Fotografieren</button>
          <button type="button" className="btn ghost" onClick={() => gal.current?.click()}><Icon name="image" /> Foto oder PDF wählen</button>
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
function ReceiptForm({ close, rc: start, photo, done, saved, prefs, keep }: { saved: (rc: Receipt) => void; close: () => void; rc: Receipt; photo?: Photo; done: () => void; prefs: Prefs; keep: (p: Prefs) => Promise<void> }) {
  const snap = useSnapshot();
  const mine = !start.owner || start.owner === snap.me;
  const [rc, setRc] = useState<Receipt>(start), [busy, setBusy] = useState(false), [url, setUrl] = useState(''), [big, setBig] = useState(false);
  const isPdf = photo instanceof Blob || !!rc.photo?.endsWith('.pdf');
  useEffect(() => { if (photo instanceof HTMLCanvasElement) setUrl(photo.toDataURL('image/jpeg', 0.8)); else if (rc.photo && !isPdf) void photoUrl(rc.photo).then(setUrl).catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (p: Partial<Receipt>) => setRc(r => ({ ...r, ...p }));
  const setItem = (i: number, p: Partial<Item>) => setRc(r => ({ ...r, items: r.items.map((x, k) => k === i ? { ...x, ...p } : x) }));
  const d = new Date(rc.bought_at), date = ymd(d), time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const setWhen = (dt: string, tm: string) => { const n = new Date(`${dt}T${tm || '12:00'}:00`); if (!isNaN(n.getTime())) set({ bought_at: n.toISOString() }); };
  const inv = rc.kind === 'rechnung';
  const biz = prefs.business || start.scope === 'business';
  const known = cardScope(prefs, rc.card);
  const [remember, setRemember] = useState(false), [grpList, setGrpList] = useState<string[]>([]);
  useEffect(() => { void groups().then(setGrpList); }, []);
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
      await save({ ...rc, merchant: rc.merchant.trim(), grp: rc.grp.trim() }, photo instanceof HTMLCanvasElement ? await toBlob(photo) : photo ?? null);
      if (remember && rc.card.length === 4) await keep({ ...prefs, cards: [...prefs.cards.filter(c => c.card !== rc.card), { card: rc.card, scope: rc.scope }] }).catch(() => {}); toast('Beleg gespeichert.'); saved(rc); }
    catch (e) { fail(e); } finally { setBusy(false); }
  };
  const del = async () => { if (!(await ask('Diesen Beleg mit Foto löschen?', 'Löschen'))) return; try { await remove(rc); toast('Beleg gelöscht.'); done(); } catch (e) { fail(e); } };
  const ro = !mine;
  return (
    <Sheet onClose={close} label="Beleg">
      <h2>{start.id ? (ro ? 'Beleg' : 'Beleg bearbeiten') : 'Beleg prüfen'}</h2>
      {isPdf && <button type="button" className="cash-pdf" disabled={!rc.photo || photo instanceof Blob} onClick={() => void openPdf(rc.photo!)}><CatIcon c="rechnung" size={28} /><span><b>PDF-Rechnung</b><small>{photo instanceof Blob ? 'wird mit dem Beleg gespeichert' : 'antippen zum Öffnen'}</small></span></button>}
      {url && <button type="button" className="cash-photo" onClick={() => setBig(true)} aria-label="Foto vergrößern"><img src={url} alt="Kassenbon" /><span className="cash-photo-tip">Antippen zum Vergrößern</span></button>}
      {big && url && <ZoomView src={url} close={() => setBig(false)} />}
      {ro && <p>Von {snap.members.find(m => m.id === rc.owner)?.name ?? 'jemandem'}. Nur der Besitzer kann den Beleg ändern.</p>}
      <fieldset disabled={ro} className="cash-form">
        {!ro && <div className={`visbig${biz ? ' three' : ''}`} role="group" aria-label="Privat, Familie oder Firma">
          <button type="button" className="private" aria-pressed={rc.scope === 'private'} onClick={() => setRc(r => ({ ...r, scope: 'private', items: r.scope === 'family' ? r.items.map(i => ({ ...i, family: false })) : r.items }))}><Icon name="lock" />Privat<small>nur ich</small></button>
          <button type="button" className="family" aria-pressed={rc.scope === 'family'} onClick={() => set({ scope: 'family' })}><Icon name="home" />Familie<small>Familienkasse</small></button>
          {biz && <button type="button" className="business" aria-pressed={rc.scope === 'business'} onClick={() => setRc(r => ({ ...r, scope: 'business', items: r.items.map(i => ({ ...i, family: false })) }))}><Icon name="work" />Firma<small>{prefs.firm || 'nur ich'}</small></button>}
        </div>}
        {!ro && <div className="cash-kind" role="group" aria-label="Belegart">
          <button type="button" aria-pressed={!inv} onClick={() => setKind('bon')}><span className="k"><CatIcon c="bon" size={20} /> Kassenbon</span><small>Bruttopreise</small></button>
          <button type="button" aria-pressed={inv} onClick={() => setKind('rechnung')}><span className="k"><CatIcon c="rechnung" size={20} /> Rechnung</span><small>Netto · MwSt · Brutto</small></button>
        </div>}
        <label className="field"><span>{inv ? 'Rechnungssteller' : 'Händler'}</span><input value={rc.merchant} onChange={e => set({ merchant: e.target.value })} maxLength={200} placeholder="z. B. REWE" /></label>
        <div className="row2">
          <label className="field"><span>Datum</span><input type="date" value={date} onChange={e => e.target.value && setWhen(e.target.value, time)} /></label>
          {inv && <label className="field"><span>Rechnungsnr.</span><input value={rc.invoice_no} onChange={e => set({ invoice_no: e.target.value })} maxLength={60} /></label>}
          {!inv && <label className="field"><span>Uhrzeit</span><input type="time" value={time} onChange={e => e.target.value && setWhen(date, e.target.value)} /></label>}
          <label className="field"><span>Bezahlt mit</span><input value={rc.payment} onChange={e => set({ payment: e.target.value })} maxLength={100} placeholder="Bar, EC-Karte …" /></label>
          <label className="field"><span>Karte (letzte 4)</span><input value={rc.card} inputMode="numeric" onChange={e => { const card = e.target.value.replace(/\D/g, '').slice(0, 4); const by = cardScope(prefs, card); set(by && !start.id ? { card, scope: by } : { card }); }} placeholder="1234" /></label>
          {!ro && rc.card.length === 4 && known !== rc.scope && <label className="cash-v wide"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} /> Karte …{rc.card} immer als „{SCOPE_LABEL[rc.scope]}“ zuordnen</label>}
          {inv && <label className="field"><span>Netto (€)</span><input inputMode="decimal" defaultValue={rc.net ? fmt(rc.net) : ''} onChange={e => set({ net: num(e.target.value) })} placeholder="0,00" /></label>}
          <label className="field"><span>{inv ? 'Brutto (€)' : 'Summe (€)'}</span><input inputMode="decimal" defaultValue={rc.total ? fmt(rc.total) : ''} onChange={e => set({ total: num(e.target.value) })} placeholder="0,00" /></label>
          <div className="field"><span>Kategorie</span><CatPick value={rc.category} disabled={ro} set={c => set({ category: c })} /></div>
        </div>
        {inv && <div className="cash-tax">
          <p className="cash-check">Steuerübersicht wie unten auf der Rechnung: je MwSt-Satz eine Zeile.</p>
          <div className="th"><span>MwSt</span><span>Netto</span><span>Steuer</span><span>Brutto</span><span /></div>
          {rc.taxes.map((t, i) => <div key={i} className="tr">
            <span><input inputMode="decimal" defaultValue={String(t.rate).replace('.', ',')} onChange={e => setTax(i, { rate: num(e.target.value) })} aria-label="Steuersatz" />%</span>
            <input inputMode="decimal" defaultValue={fmt(t.net)} onChange={e => setTax(i, { net: num(e.target.value) })} aria-label="Netto" />
            <input inputMode="decimal" defaultValue={fmt(t.tax)} onChange={e => setTax(i, { tax: num(e.target.value) })} aria-label="Steuer" />
            <b>{fmt(t.net + t.tax)}</b>
            {!ro ? <button type="button" className="x" aria-label="Steuersatz löschen" onClick={() => setRc(r => ({ ...r, taxes: r.taxes.filter((_, k) => k !== i) }))}>✕</button> : <span />}
          </div>)}
          <div className="tr sum"><span>Summe</span><b>{fmt(taxNet)}</b><b>{fmt(taxSum)}</b><b>{fmt(taxNet + taxSum)}</b><span /></div>
          {!ro && <button type="button" className="btn sm" onClick={() => setRc(r => ({ ...r, taxes: [...r.taxes, { rate: 19, net: 0, tax: 0 }] }))}>＋ weiterer MwSt-Satz</button>}
          {!ro && rc.items.some(i => i.vat) && <button type="button" className="btn sm ghost" onClick={() => setRc(r => ({ ...r, taxes: taxesFromItems(r) }))}>Aus Positionen berechnen</button>}
          {rc.taxes.length > 0 && (Math.abs(taxNet + taxSum - rc.total) > 0.02 || (rc.net && Math.abs(taxNet - rc.net) > 0.02)) ? <p className="cash-warn">Netto + MwSt ergibt {eur(taxNet + taxSum)}, auf der Rechnung stehen {rc.net ? `netto ${eur(rc.net)} und ` : ''}brutto {eur(rc.total)}. Bitte prüfen.</p> : null}
          <label className="cash-v"><input type="checkbox" checked={rc.items_net} onChange={e => set({ items_net: e.target.checked })} /> Positionspreise sind netto</label>
        </div>}
        <div className="field"><span>Positionen{inv ? (rc.items_net ? ' (netto)' : ' (brutto)') : ''}{rc.scope === 'private' && !ro ? ' · Haken = zählt als Familienausgabe' : ''}</span></div>
        <div className="cash-items">{rc.items.map((it, i) => <div key={i} className="cash-it">
          {rc.scope === 'private' && <input type="checkbox" aria-label="Familienausgabe" title="Familienausgabe" checked={it.family} onChange={e => setItem(i, { family: e.target.checked })} />}
          <input className="nm" value={it.name} onChange={e => setItem(i, { name: e.target.value })} aria-label="Position" />
          <CatPick compact value={it.category} disabled={ro} set={c => setItem(i, { category: c })} />
          {inv && <select className="vat" value={it.vat} onChange={e => setItem(i, { vat: Number(e.target.value) })} aria-label="MwSt">{[...new Set([0, 7, 19, it.vat])].sort((a, b) => a - b).map(v => <option key={v} value={v}>{v ? `${v}%` : '–'}</option>)}</select>}
          <input className="pr" inputMode="decimal" defaultValue={fmt(it.price)} onChange={e => setItem(i, { price: num(e.target.value) })} aria-label="Preis" />
          {!ro && <button type="button" className="x" aria-label="Zeile löschen" onClick={() => setRc(r => ({ ...r, items: r.items.filter((_, k) => k !== i) }))}>✕</button>}
        </div>)}</div>
        {!ro && <button type="button" className="btn sm" onClick={() => setRc(r => ({ ...r, items: [...r.items, { name: '', qty: 1, price: 0, vat: r.items.at(-1)?.vat ?? 0, category: r.category, family: false }] }))}>＋ Zeile</button>}
        <p className="cash-check">Positionen: {inv && rc.items_net ? `netto ${eur(itemNet)} · brutto ${eur(itemSum)}` : eur(itemSum)}{rc.items.length && Math.abs(itemSum - rc.total) > 0.05 ? ` · weicht von der Summe ${eur(rc.total)} ab` : ''}{famSum ? ` · Familie: ${eur(famSum)}` : ''}</p>
        {inv && <EInvBox rc={rc} set={set} prefs={prefs} ro={ro} />}
        <label className="field"><span>Buchungsgruppe (optional)</span><input value={rc.grp} list="cash-grps" maxLength={100} placeholder="z. B. Urlaub Dänemark 2026" onChange={e => set({ grp: e.target.value })} onBlur={e => set({ grp: e.target.value.trim() })} />
          <datalist id="cash-grps">{grpList.map(g => <option key={g} value={g} />)}</datalist></label>
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

// Felder für Verkäufer bzw. Käufer
function PartyFields({ p, set, buyer, miss = [] }: { p: Partial<Party>; set: (p: Partial<Party>) => void; buyer?: boolean; miss?: string[] }) {
  const f = (k: keyof Party, label: string, wide = false, ph = '') => <label className={`field${wide ? ' wide' : ''}${miss.includes(k) ? ' need' : ''}`}><span>{label}</span><input value={p[k] ?? ''} placeholder={ph} onChange={e => set({ [k]: e.target.value })} /></label>;
  return <div className="row2">
    {f('name', 'Name / Firma', true)}{f('street', 'Straße', true)}{f('zip', 'PLZ')}{f('city', 'Ort')}
    {f('vat_id', 'USt-IdNr.', false, 'DE…')}{!buyer && f('tax_no', 'Steuernummer')}{f('email', 'E-Mail')}
    {!buyer && f('phone', 'Telefon')}{!buyer && f('contact', 'Ansprechpartner')}{!buyer && f('iban', 'IBAN', true)}
  </div>;
}

// E-Rechnung: Angaben prüfen und als XRechnung (XML) exportieren
function EInvBox({ rc, set, prefs, ro }: { rc: Receipt; set: (p: Partial<Receipt>) => void; prefs: Prefs; ro: boolean }) {
  const e = rc.einv ?? {};
  const upd = (p: Partial<EInv>) => set({ einv: { ...e, ...p } });
  // Käufer leer: eigene Rechnungsanschrift aus den Einstellungen
  // Steht auf der Rechnung die eigene Anschrift (gleiche PLZ und Straße oder gleicher Name), fehlende Käuferfelder daraus ergänzen
  const n = (v?: string) => (v ?? '').toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
  const me = prefs.addr, eb = e.buyer;
  const same = !!me && !!eb?.name && ((!!n(me.name) && n(me.name) === n(eb.name)) || (!!n(me.zip) && n(me.zip) === n(eb.zip) && !!n(me.street) && n(me.street) === n(eb.street)));
  const fillB = (have: Party, add?: Party) => { const o = { ...have } as Record<string, string>; for (const [k, v] of Object.entries(add ?? {})) if (v && !o[k]) o[k] = v; return o as unknown as Party; };
  const buyer: Party = !eb?.name ? { ...(me ?? {} as Party), ...(eb ?? {}), name: eb?.name || me?.name || prefs.firm } : same ? fillB(eb, me) : eb;
  const full: Receipt = { ...rc, einv: { ...e, seller: { ...(e.seller ?? {} as Party), name: e.seller?.name || rc.merchant }, buyer } };
  const chk = xCheck(full);
  const [busy, setBusy] = useState(false);
  // Leere Felder aus dem gespeicherten Beleg nachtragen, Eingetragenes bleibt
  const merge = <T extends object>(have: T | undefined, got: T | undefined): T => { const o = { ...(got ?? {}) } as Record<string, unknown>; for (const [k, v] of Object.entries(have ?? {})) if (v) o[k] = v; return o as T; };
  const again = async () => {
    if (!rc.photo) return;
    setBusy(true);
    try {
      const r = await reread(rc.photo);
      set({ invoice_no: rc.invoice_no || r.invoice_no || '', einv: { ...e, seller: merge(e.seller, r.seller), buyer: merge(e.buyer, r.buyer), due: e.due || r.due_date || undefined, service: e.service || r.service_date || undefined, ref: e.ref || r.buyer_ref || undefined } });
      toast('Angaben aus der Rechnung übernommen. Bitte prüfen und speichern.');
    } catch (x) { fail(x); } finally { setBusy(false); }
  };
  const go = () => {
    const xml = xrechnung(full);
    shareBytes(`XRechnung ${(rc.invoice_no || rc.merchant || 'Beleg').replace(/[^\wÄÖÜäöüß .-]+/g, ' ').trim()}.xml`, 'application/xml', new TextEncoder().encode(xml));
  };
  return <details className="cash-einv">
    <summary>E-Rechnung (XRechnung){chk.missing.length ? <small> · {chk.missing.length} Angaben fehlen</small> : <small className="ok"> · vollständig</small>}</summary>
    {!ro && rc.photo && !rc.photo.startsWith('blob:') && <button type="button" className="btn sm ghost" disabled={busy} onClick={() => void again()}>{busy ? 'Wird gelesen …' : 'Angaben aus der Rechnung neu auslesen'}</button>}
    <b>Verkäufer</b>
    <PartyFields p={full.einv.seller ?? {}} miss={chk.keys.filter(k => k.startsWith('seller.')).map(k => k.slice(7))} set={p => upd({ seller: { ...(e.seller ?? {} as Party), name: e.seller?.name || rc.merchant, ...p } })} />
    <b>Käufer</b>
    <PartyFields p={full.einv.buyer ?? {}} buyer miss={chk.keys.filter(k => k.startsWith('buyer.')).map(k => k.slice(6))} set={p => upd({ buyer: { ...(full.einv.buyer ?? {} as Party), ...p } })} />
    <div className="row2">
      <label className="field"><span>Fällig am</span><input type="date" value={e.due ?? ''} onChange={x => upd({ due: x.target.value || undefined })} /></label>
      <label className="field"><span>Leistungsdatum</span><input type="date" value={e.service ?? ''} onChange={x => upd({ service: x.target.value || undefined })} /></label>
      <label className="field wide"><span>Käuferreferenz (Leitweg-ID, Bestellnr.)</span><input value={e.ref ?? ''} onChange={x => upd({ ref: x.target.value || undefined })} /></label>
    </div>
    {chk.note && <p className="cash-warn">{chk.note}</p>}
    {chk.missing.some(m => !/^(Verkäufer|Käufer):/.test(m)) && <p className="cash-warn">Außerdem fehlt: {chk.missing.filter(m => !/^(Verkäufer|Käufer):/.test(m)).join(', ')}.</p>}
    {!ro && <button type="button" className="btn sm" disabled={chk.missing.length > 0} onClick={go}><Icon name="share" /> Als XRechnung exportieren</button>}
    <p className="cash-check">Hinweis: Eine E-Rechnung im rechtlichen Sinn stellt der Verkäufer aus. Diese Umwandlung ist für Buchhaltung und Steuerberater (z. B. DATEV, lexoffice) gedacht.</p>
  </details>;
}
