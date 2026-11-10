// Kassenbuch: Kassenbons mit Foto und Positionen (privat oder Familie). In der Testversion nur im Speicher.
import { isPro, store } from './store';
import { supabase } from './supabase';
import { today } from './dates';
import { native } from './native';

export const CATS = ['Lebensmittel', 'Drogerie', 'Kraftstoff', 'Essen gehen', 'Haushalt', 'Kleidung', 'Freizeit', 'Gesundheit', 'Kinder/Schule', 'Sonstiges'] as const;
export const CAT_ICON: Record<string, string> = { Lebensmittel: '🛒', Drogerie: '🧴', Kraftstoff: '⛽', 'Essen gehen': '🍽️', Haushalt: '🏠', Kleidung: '👕', Freizeit: '🎟️', Gesundheit: '💊', 'Kinder/Schule': '🎒', Sonstiges: '📦' };

export interface Item { id?: string; name: string; qty: number; price: number; vat: number; category: string; family: boolean }
export type Scope = 'private' | 'family' | 'business';
export interface Prefs { business: boolean; firm: string; cards: { card: string; scope: Scope; firm?: string }[]; addr?: Party; firms: Party[] }
export interface Party { name: string; street: string; zip: string; city: string; country: string; vat_id: string; tax_no: string; email: string; phone: string; contact: string; iban?: string; bic?: string }
export interface EInv { seller?: Party; buyer?: Party; due?: string; service?: string; ref?: string }
export interface Tax { rate: number; net: number; tax: number }
export interface Receipt {
  id?: string; owner?: string; bought_at: string; merchant: string; payment: string; card: string;
  total: number; currency: string; category: string; scope: Scope; photo: string | null; note: string; items: Item[];
  kind: 'bon' | 'rechnung'; invoice_no: string; net: number; taxes: Tax[]; items_net: boolean; grp: string; einv: EInv; firm?: string;
}
export interface ReadResult { found: boolean; seller?: Party; buyer?: Party; due_date?: string; service_date?: string; buyer_ref?: string; kind: 'bon' | 'rechnung'; invoice_no: string; net: number; taxes: Tax[]; items_net: boolean; box: { x0: number; y0: number; x1: number; y1: number }; merchant: string; date: string; time: string; payment: string; card: string; total: number; currency: string; category: string; items: { name: string; qty: number; price: number; vat: number; category: string }[] }

const ctx = () => { const s = store.get(); return { fam: s.family!.id, me: s.me! }; };
const sb = () => { if (!supabase) throw new Error('Keine Verbindung'); return supabase; };
const missing = (m: string) => /receipt|cash_view|cash_prefs|schema cache|does not exist|find the table/i.test(m) ? 'Das Kassenbuch ist noch nicht eingerichtet (Migration 0022).' : m;

let demo: Receipt[] = [];
let demoPrefs: Prefs = { business: false, firm: '', cards: [], firms: [] };

// Eigene Einstellungen: Firma, Karten mit fester Zuordnung (privat, Familie, Firma)
export async function getPrefs(): Promise<Prefs> {
  if (store.demo) return demoPrefs;
  const r = await sb().from('cash_prefs').select('*').eq('member', ctx().me).maybeSingle();
  if (r.error) throw new Error(missing(r.error.message));
  const d = r.data as (Prefs & { firms?: Party[] }) | null;
  const addr = d?.addr && typeof d.addr === 'object' && Object.values(d.addr).some(Boolean) ? d.addr : undefined;
  // Früher gab es nur eine Firma (Name + Rechnungsanschrift): daraus die erste Firma machen
  const firms = Array.isArray(d?.firms) && d!.firms.length ? d!.firms : d?.firm || addr?.name ? [{ ...(addr ?? {} as Party), name: d?.firm || addr!.name }] : [];
  return { business: !!d?.business, firm: d?.firm ?? '', cards: Array.isArray(d?.cards) ? d!.cards : [], addr, firms };
}
export async function setPrefs(p: Prefs) {
  if (store.demo) { demoPrefs = p; return; }
  const { fam, me } = ctx();
  const firms = p.firms.filter(f => f.name?.trim());
  const row = { member: me, family_id: fam, business: p.business, firm: firms[0]?.name ?? p.firm, cards: p.cards, ...(firms.length ? { firms, addr: firms[0] } : p.addr ? { addr: p.addr } : {}) };
  const r = await sb().from('cash_prefs').upsert(row);
  if (r.error) throw new Error(/firms/.test(r.error.message) ? 'Für mehrere Firmen fehlt noch ein Datenbank-Schritt (Migration 0025).' : missing(r.error.message.includes('cash_prefs') ? 'receipts' : r.error.message));
}
export const cardScope = (p: Prefs, card: string) => card ? p.cards.find(c => c.card === card)?.scope : undefined;
export const cardFirm = (p: Prefs, card: string) => card ? p.cards.find(c => c.card === card && c.scope === 'business')?.firm : undefined;
// Firma zum Rechnungsempfänger finden: gleiche Straße + PLZ oder möglichst viele gleiche Wörter im Namen (Rechtsform zählt nicht)
const LEGAL = new Set(['gmbh', 'mbh', 'kg', 'co', 'ug', 'ag', 'ohg', 'gbr', 'ev', 'se', 'haftungsbeschrankt', 'und', 'der', 'die', 'das']);
const words = (s?: string) => (s ?? '').toLowerCase().replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss').split(/[^a-z0-9]+/).filter(w => w.length > 1 && !LEGAL.has(w));
const flat = (s?: string) => (s ?? '').toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
export function matchFirm(p: Prefs, b?: Partial<Party>): string | undefined {
  if (!b?.name && !b?.street) return undefined;
  let best: string | undefined, score = 0;
  for (const f of p.firms) {
    if (!f.name) continue;
    const fw = words(f.name), bw = words(b.name);
    // Wortanfänge zählen auch („Grundstücksges.“ ↔ „Grundstücksgesellschaft“)
    const hit = fw.filter(w => bw.some(x => x === w || (x.length >= 5 && w.startsWith(x)) || (w.length >= 5 && x.startsWith(w)))).length;
    let s = fw.length ? hit / fw.length : 0;
    if (flat(f.zip) && flat(f.zip) === flat(b.zip) && flat(f.street) && flat(f.street) === flat(b.street)) s += 0.5;
    if (s > score) { score = s; best = f.name; }
  }
  return score >= 0.6 ? best : undefined;
}

export async function canViewFamily(): Promise<boolean> {
  const s = store.get(); const me = s.members.find(m => m.id === s.me);
  if (!me) return false;
  if (me.role === 'admin' || store.demo) return true;
  const r = await sb().from('members').select('cash_view').eq('id', me.id).maybeSingle();
  return !!(r.data as { cash_view?: boolean } | null)?.cash_view;
}

export async function viewers(): Promise<Record<string, boolean>> {
  if (store.demo) return {};
  const r = await sb().from('members').select('id, cash_view').eq('family_id', ctx().fam);
  if (r.error) throw new Error(missing(r.error.message));
  return Object.fromEntries((r.data as { id: string; cash_view: boolean }[]).map(x => [x.id, x.cash_view]));
}
export async function setViewer(id: string, on: boolean) {
  const r = await sb().from('members').update({ cash_view: on }).eq('id', id);
  if (r.error) throw new Error(missing(r.error.message));
}

// Alle sichtbaren Bons in einem Zeitraum (von/bis als YYYY-MM-DD, bis einschließlich)
export async function list(from: string, to: string): Promise<Receipt[]> {
  if (store.demo) return demo.filter(r => r.bought_at.slice(0, 10) >= from && r.bought_at.slice(0, 10) <= to).sort((a, b) => b.bought_at.localeCompare(a.bought_at));
  const end = new Date(to + 'T00:00:00'); end.setDate(end.getDate() + 1);
  const r = await sb().from('receipts').select('*, receipt_items(*)').eq('family_id', ctx().fam).gte('bought_at', new Date(from + 'T00:00:00').toISOString()).lt('bought_at', end.toISOString()).order('bought_at', { ascending: false });
  if (r.error) throw new Error(missing(r.error.message));
  return rows(r.data);
}

// Alle sichtbaren Bons einer Buchungsgruppe, egal wann
export async function listGroup(g: string): Promise<Receipt[]> {
  if (store.demo) return demo.filter(r => r.grp === g).sort((a, b) => b.bought_at.localeCompare(a.bought_at));
  const r = await sb().from('receipts').select('*, receipt_items(*)').eq('family_id', ctx().fam).eq('grp', g).order('bought_at', { ascending: false });
  if (r.error) throw new Error(missing(r.error.message));
  return rows(r.data);
}

// Namen aller Buchungsgruppen, die ich sehe (neueste zuerst)
export async function groups(): Promise<string[]> {
  if (store.demo) return [...new Set(demo.map(r => r.grp).filter(Boolean))];
  const r = await sb().from('receipts').select('grp, bought_at').eq('family_id', ctx().fam).neq('grp', '').order('bought_at', { ascending: false }).limit(1000);
  if (r.error) return [];
  return [...new Set((r.data as { grp: string }[]).map(x => x.grp))];
}

function rows(data: unknown): Receipt[] {
  return (data as (Receipt & { receipt_items: (Item & { pos: number })[] })[]).map(x => ({ ...x, total: Number(x.total), net: Number(x.net ?? 0), kind: x.kind === 'rechnung' ? 'rechnung' : 'bon', invoice_no: x.invoice_no ?? '', items_net: !!x.items_net, grp: x.grp ?? '', firm: (x as { firm?: string }).firm ?? '', einv: (x.einv && typeof x.einv === 'object' ? x.einv : {}) as EInv, taxes: Array.isArray(x.taxes) ? x.taxes.map(t => ({ rate: Number(t.rate), net: Number(t.net), tax: Number(t.tax) })) : [], items: [...x.receipt_items].sort((a, b) => a.pos - b.pos).map(i => ({ ...i, qty: Number(i.qty), price: Number(i.price), vat: Number(i.vat ?? 0) })) }));
}

export async function save(rc: Receipt, photo?: Blob | null): Promise<string> {
  if (store.demo) {
    const id = rc.id ?? crypto.randomUUID();
    const url = photo ? URL.createObjectURL(photo) + (photo.type === 'application/pdf' ? '#.pdf' : '') : rc.photo;
    demo = [...demo.filter(x => x.id !== id), { ...rc, id, owner: ctx().me, photo: url }];
    return id;
  }
  const { fam, me } = ctx();
  let path = rc.photo;
  if (photo) {
    const pdf = photo.type === 'application/pdf';
    path = `${fam}/${me}/${crypto.randomUUID()}.${pdf ? 'pdf' : 'jpg'}`;
    const up = await sb().storage.from('receipts').upload(path, photo, { contentType: pdf ? 'application/pdf' : 'image/jpeg' });
    if (up.error) throw new Error(missing(up.error.message.includes('not found') ? 'receipts' : up.error.message));
  }
  const row = { family_id: fam, owner: me, bought_at: rc.bought_at, merchant: rc.merchant, payment: rc.payment, card: rc.card, total: rc.total, currency: rc.currency, category: rc.category, scope: rc.scope, photo: path, note: rc.note, kind: rc.kind, invoice_no: rc.invoice_no, net: rc.net, taxes: rc.taxes, items_net: rc.items_net, ...(rc.grp ? { grp: rc.grp } : rc.id ? { grp: '' } : {}), ...(Object.keys(rc.einv ?? {}).length ? { einv: rc.einv } : {}), ...(rc.scope === 'business' && rc.firm ? { firm: rc.firm } : {}) };
  const res = rc.id ? await sb().from('receipts').update(row).eq('id', rc.id).select('id').single() : await sb().from('receipts').insert(row).select('id').single();
  if (res.error) { if (photo && path) await sb().storage.from('receipts').remove([path]); throw new Error(/'firm'|\bfirm\b/.test(res.error.message) ? 'Für die Firmen-Zuordnung fehlt noch ein Datenbank-Schritt (Migration 0025).' : missing(res.error.message)); }
  const id = (res.data as { id: string }).id;
  if (rc.id) await sb().from('receipt_items').delete().eq('receipt_id', id);
  if (rc.items.length) {
    const ir = await sb().from('receipt_items').insert(rc.items.map((i, pos) => ({ receipt_id: id, family_id: fam, owner: me, pos, name: i.name, qty: i.qty, price: i.price, vat: i.vat, category: i.category, family: rc.scope === 'family' ? true : rc.scope === 'business' ? false : i.family })));
    if (ir.error) throw new Error(missing(ir.error.message));
  }
  // altes Foto aufräumen, wenn ersetzt
  if (photo && rc.id && rc.photo && rc.photo !== path) await sb().storage.from('receipts').remove([rc.photo]);
  return id;
}

export async function remove(rc: Receipt) {
  if (store.demo) { demo = demo.filter(x => x.id !== rc.id); return; }
  const r = await sb().from('receipts').delete().eq('id', rc.id!);
  if (r.error) throw new Error(missing(r.error.message));
  if (rc.photo) await sb().storage.from('receipts').remove([rc.photo]);
}

const urls = new Map<string, { url: string; until: number }>();
export async function photoUrl(path: string): Promise<string> {
  if (store.demo || path.startsWith('blob:') || path.startsWith('data:')) return path;
  const hit = urls.get(path); if (hit && hit.until > Date.now()) return hit.url;
  const r = await sb().storage.from('receipts').createSignedUrl(path, 3600);
  if (r.error || !r.data) throw new Error('Foto nicht gefunden.');
  urls.set(path, { url: r.data.signedUrl, until: Date.now() + 3_000_000 });
  return r.data.signedUrl;
}

// PDF eines Belegs öffnen (App: passendes Programm, Browser: neuer Tab)
export async function openPdf(path: string) {
  const app = !!native();
  const w = app ? null : window.open('', '_blank');
  try { const url = await photoUrl(path); if (w) w.location.href = url; else location.href = url; }
  catch (e) { w?.close(); throw e; }
}

// Mit FamTO geteilte Datei aus der Android-App abholen (einmalig)
export function takeShared(): File | null {
  try {
    const raw = native()?.takeShared?.(); if (!raw) return null;
    const j = JSON.parse(raw) as { name: string; mime: string; b64: string };
    const bin = atob(j.b64), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new File([u], j.name || 'beleg', { type: j.mime });
  } catch { return null; }
}

// Bon vorlesen lassen (Claude über die Edge Function „receipt“)
class ProError extends Error {}
export async function read(image: { type: string; data: string }, pages?: string[]): Promise<ReadResult> {
  if (store.demo || !supabase) return { found: true, kind: 'bon', invoice_no: '', net: 6.65, taxes: [{ rate: 7, net: 3.64, tax: 0.25 }, { rate: 19, net: 3.01, tax: 0.57 }], items_net: false, box: { x0: 0.08, y0: 0.04, x1: 0.92, y1: 0.96 }, merchant: 'Testmarkt', date: today(), time: '10:15', payment: 'EC-Karte', card: '1234', total: 7.47, currency: 'EUR', category: 'Lebensmittel',
    items: [{ name: 'Bio Vollmilch', qty: 1, price: 1.49, vat: 7, category: 'Lebensmittel' }, { name: 'Brötchen', qty: 6, price: 2.4, vat: 7, category: 'Lebensmittel' }, { name: 'Zahnpasta', qty: 1, price: 3.58, vat: 19, category: 'Drogerie' }] };
  if (!isPro()) throw new ProError('Belege automatisch auslesen gibt es in FamTO Pro. Trag den Beleg einfach von Hand ein.');
  const { data, error } = await supabase.functions.invoke('receipt', { body: { image, ...(pages?.length ? { pages } : {}), today: today() } });
  if ((error as { context?: Response } | null)?.context?.status === 402) throw new ProError('Belege automatisch auslesen gibt es in FamTO Pro. Trag den Beleg einfach von Hand ein.');
  if (error || !data?.receipt) throw new Error('Der Bon ließ sich nicht lesen. Du kannst ihn von Hand eintragen.');
  return data.receipt as ReadResult;
}

// PDF-Rechnung lesen lassen. Manche PDFs (z. B. bestimmte Würth-Rechnungen) lehnt die KI als Datei ab;
// dann werden die Seiten hier im Handy zu Bildern gezeichnet und als Fotos gelesen.
export async function readPdf(bytes: Uint8Array): Promise<ReadResult> {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  try { return await read({ type: 'application/pdf', data: btoa(bin) }); }
  catch (e) {
    if (e instanceof ProError || store.demo || !supabase) throw e;
    const { pdfPages } = await import('./pdfprev');
    const pages = await pdfPages(bytes).catch(() => { throw e; });
    return read({ type: 'image/jpeg', data: pages[0] }, pages.slice(1));
  }
}

// Gespeicherten Beleg (Foto oder PDF) noch einmal auslesen, z. B. für die E-Rechnung
export async function reread(path: string): Promise<ReadResult> {
  const blob = await (await fetch(await photoUrl(path))).blob();
  const b = new Uint8Array(await blob.arrayBuffer());
  if (path.endsWith('.pdf')) return readPdf(b);
  let bin = '';
  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return read({ type: 'image/jpeg', data: btoa(bin) });
}

// Foto für den Bon: längste Seite 1800 px, damit kleine Schrift lesbar bleibt
export async function loadPhoto(file: File): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}
export const toB64 = (c: HTMLCanvasElement, q = 0.85) => ({ type: 'image/jpeg', data: c.toDataURL('image/jpeg', q).split(',')[1] });
export function crop(c: HTMLCanvasElement, b: { x0: number; y0: number; x1: number; y1: number }): HTMLCanvasElement {
  const x = Math.max(0, Math.min(b.x0, b.x1)) * c.width, y = Math.max(0, Math.min(b.y0, b.y1)) * c.height;
  const w = Math.max(20, (Math.min(1, Math.max(b.x0, b.x1)) * c.width) - x), h = Math.max(20, (Math.min(1, Math.max(b.y0, b.y1)) * c.height) - y);
  const o = document.createElement('canvas'); o.width = Math.round(w); o.height = Math.round(h);
  o.getContext('2d')!.drawImage(c, x, y, w, h, 0, 0, o.width, o.height);
  return o;
}
export const toBlob = (c: HTMLCanvasElement) => new Promise<Blob>((ok, no) => c.toBlob(b => b ? ok(b) : no(new Error('Foto')), 'image/jpeg', 0.82));

export const eur = (n: number) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', useGrouping: true });
// Betrag, der als Familienausgabe zählt: ganzer Familienbon, sonst die Familienzeilen
// Bruttobetrag einer Zeile: bei Netto-Rechnungen mit MwSt aufgeschlagen
export const gross = (r: Receipt, i: Item) => r.items_net ? Math.round(i.price * (100 + (i.vat || 0))) / 100 : i.price;
export const familyPart = (r: Receipt) => r.scope === 'family' ? r.total : r.scope === 'business' ? 0 : r.items.filter(i => i.family).reduce((s, i) => s + gross(r, i), 0);
// MwSt-Aufstellung aus den Zeilen berechnen (wenn auf dem Beleg keine steht)
export function taxesFromItems(r: Receipt): Tax[] {
  const m = new Map<number, number>();
  for (const i of r.items) if (i.vat) m.set(i.vat, (m.get(i.vat) ?? 0) + (r.items_net ? i.price : i.price / (1 + i.vat / 100)));
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([rate, n]) => ({ rate, net: Math.round(n * 100) / 100, tax: Math.round(n * rate) / 100 }));
}
