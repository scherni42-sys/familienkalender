// Edge Function „mailin“: liest die Postfächer der Mitglieder (Tabelle mailboxes) und legt PDF-Rechnungen als neue Belege in den Eingang des Kassenbuchs.
// Läuft alle 15 Minuten über pg_cron (Kopf x-famto-cron, Schlüssel in cash_mailkey) und auf Knopfdruck aus der App.
// Postfacharten: IMAP mit (App-)Passwort, Outlook/Microsoft 365 über die Microsoft-Anmeldung (Graph, nur Lesen).
// Geheimnisse: MS_CLIENT_ID, MS_CLIENT_SECRET (App-Registrierung bei Microsoft), optional MAILBOX_KEY (verschlüsselt Passwörter und Microsoft-Schlüssel, sonst der Dienstschlüssel).
// Postfächer werden nur gelesen: nichts wird gelöscht oder verschoben, gelesene Mails merkt sich die Tabelle cash_mail.
// Doppelte Rechnungen (gleiche PDF oder gleiche Rechnungsnummer/Betrag/Datum in der Familie) werden übersprungen.
import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';
import PostalMime from 'npm:postal-mime@2.7.6';

const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-famto-cron' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const enc = new TextEncoder(), dec = new TextDecoder();
const PER_BOX = 3;      // höchstens so viele Mails mit PDF je Postfach und Lauf
const MAX_LOOK = 150;   // höchstens so viele neue Mails je Postfach und Lauf ansehen
const BUDGET = 110_000; // Laufzeit je Aufruf in ms

const CATS = ['Lebensmittel', 'Drogerie', 'Kraftstoff', 'Essen gehen', 'Haushalt', 'Kleidung', 'Freizeit', 'Gesundheit', 'Kinder/Schule', 'Sonstiges'];

const schema = {
  type: 'object', additionalProperties: false,
  required: ['found', 'kind', 'box', 'merchant', 'invoice_no', 'seller', 'buyer', 'due_date', 'service_date', 'buyer_ref', 'net', 'taxes', 'items_net', 'date', 'time', 'payment', 'card', 'total', 'currency', 'category', 'items'],
  properties: {
    found: { type: 'boolean', description: 'false, wenn auf dem Foto kein Kassenbon oder keine Rechnung zu sehen ist' },
    kind: { type: 'string', enum: ['bon', 'rechnung'], description: 'rechnung: Rechnung, die Netto, MwSt und Brutto ausdrücklich getrennt ausweist (Handwerker, Firma, Werkstatt, Online-Shop mit Rechnungsnummer, Netto-Positionen). bon: normaler Kassenbon für Endverbraucher mit Bruttopreisen, auch wenn unten eine kleine MwSt-Aufstellung steht.' },
    invoice_no: { type: 'string', description: 'Rechnungsnummer, sonst leer' },
    seller: { type: 'object', additionalProperties: false, required: ['name', 'street', 'zip', 'city', 'country', 'vat_id', 'tax_no', 'email', 'phone', 'contact', 'iban', 'bic'], description: 'Rechnungssteller (Verkäufer), auch bei Kassenbons; Felder leer, wenn nicht angegeben', properties: { name: { type: 'string', description: 'vollständige rechtliche Firmierung mit Rechtsform, wie sie im Impressum oder Kleingedruckten steht, z. B. „ALDI GmbH & Co. KG Nord“ oder „REWE Markt GmbH“, nicht der Filialname' }, street: { type: 'string', description: 'Straße und Hausnummer' }, zip: { type: 'string' }, city: { type: 'string' }, country: { type: 'string', description: 'ISO-Ländercode, meist DE' }, vat_id: { type: 'string', description: 'USt-IdNr. wie DE123456789, sonst leer' }, tax_no: { type: 'string', description: 'Steuernummer, sonst leer' }, email: { type: 'string' }, phone: { type: 'string' }, contact: { type: 'string', description: 'Ansprechpartner/Bearbeiter, sonst leer' }, iban: { type: 'string', description: 'IBAN des Verkäufers ohne Leerzeichen, sonst leer' }, bic: { type: 'string' } } },
    buyer: { type: 'object', additionalProperties: false, required: ['name', 'street', 'zip', 'city', 'country', 'vat_id', 'tax_no', 'email', 'phone', 'contact'], description: 'Rechnungsempfänger (Käufer), alles leer wenn nicht angegeben', properties: { name: { type: 'string' }, street: { type: 'string', description: 'Straße und Hausnummer' }, zip: { type: 'string' }, city: { type: 'string' }, country: { type: 'string', description: 'ISO-Ländercode, meist DE' }, vat_id: { type: 'string', description: 'USt-IdNr. wie DE123456789, sonst leer' }, tax_no: { type: 'string', description: 'Steuernummer, sonst leer' }, email: { type: 'string' }, phone: { type: 'string' }, contact: { type: 'string', description: 'Ansprechpartner/Bearbeiter, sonst leer' } } },
    due_date: { type: 'string', description: 'Fälligkeitsdatum YYYY-MM-DD, sonst leer' },
    service_date: { type: 'string', description: 'Liefer- bzw. Leistungsdatum YYYY-MM-DD, sonst leer' },
    buyer_ref: { type: 'string', description: 'Leitweg-ID, Bestell- oder Kundennummer des Käufers, sonst leer' },
    net: { type: 'number', description: 'Nettosumme (ohne MwSt) wie gedruckt, 0 wenn nicht angegeben' },
    taxes: { type: 'array', description: 'MwSt-Aufstellung je Steuersatz wie gedruckt, leer wenn keine',
      items: { type: 'object', additionalProperties: false, required: ['rate', 'net', 'tax'],
        properties: { rate: { type: 'number', description: 'Steuersatz in Prozent, z. B. 19 oder 7' }, net: { type: 'number', description: 'Nettobetrag zu diesem Satz' }, tax: { type: 'number', description: 'Steuerbetrag zu diesem Satz' } } } },
    items_net: { type: 'boolean', description: 'true, wenn die Positionspreise netto (ohne MwSt) gedruckt sind' },
    box: { type: 'object', additionalProperties: false, required: ['x0', 'y0', 'x1', 'y1'], description: 'Rechteck um den Bon als Anteil von Bildbreite bzw. -höhe (0 bis 1), knapp um das Papier',
      properties: { x0: { type: 'number' }, y0: { type: 'number' }, x1: { type: 'number' }, y1: { type: 'number' } } },
    merchant: { type: 'string', description: 'Händler bzw. Geschäft, kurz, z. B. „REWE“ oder „Aral Tankstelle Kiel“' },
    date: { type: 'string', description: 'Kaufdatum YYYY-MM-DD, leer wenn nicht lesbar' },
    time: { type: 'string', description: 'Uhrzeit HH:MM, leer wenn nicht lesbar' },
    payment: { type: 'string', description: 'Zahlungsart, z. B. „Bar“, „EC-Karte“, „Visa“, „Mastercard“, „PayPal“, „Apple Pay“, „Überweisung“' },
    card: { type: 'string', description: 'Letzte 4 Ziffern der Karte, sonst leer' },
    total: { type: 'number', description: 'Gesamtbetrag brutto (inkl. MwSt), der zu zahlen ist' },
    currency: { type: 'string', description: 'ISO-Code, meist EUR' },
    category: { type: 'string', enum: CATS, description: 'Hauptkategorie des ganzen Bons' },
    items: { type: 'array', description: 'Alle Positionen in der Reihenfolge des Bons; Pfand, Rabatte als eigene Zeilen (Rabatt negativ)',
      items: { type: 'object', additionalProperties: false, required: ['name', 'qty', 'price', 'vat', 'category'],
        properties: { name: { type: 'string' }, qty: { type: 'number', description: 'Menge, sonst 1' }, price: { type: 'number', description: 'Zeilenbetrag gesamt, genau wie gedruckt (netto, wenn die Rechnung netto ausweist)' }, vat: { type: 'number', description: 'Steuersatz der Zeile in Prozent, 0 wenn nicht erkennbar' }, category: { type: 'string', enum: CATS } } } }
  }
};

// Kleiner IMAP-Client (nur lesen): LOGIN, SELECT, UID SEARCH, UID FETCH
class Imap {
  private c!: Deno.TlsConn; private buf = new Uint8Array(0); private n = 0;
  async open(host: string) { this.c = await Deno.connectTls({ hostname: host, port: 993 }); await this.line(); }
  private async more() {
    const b = new Uint8Array(65536), k = await this.c.read(b);
    if (k === null) throw new Error('Verbindung zum Postfach getrennt');
    const x = new Uint8Array(this.buf.length + k); x.set(this.buf); x.set(b.subarray(0, k), this.buf.length); this.buf = x;
  }
  private async line(): Promise<string> {
    for (;;) {
      const i = this.buf.findIndex((v, k) => v === 13 && this.buf[k + 1] === 10);
      if (i >= 0) { const l = dec.decode(this.buf.subarray(0, i)); this.buf = this.buf.subarray(i + 2); return l; }
      await this.more();
    }
  }
  private async bytes(n: number): Promise<Uint8Array> {
    // Große Mails stückweise in einen fertigen Puffer lesen
    const out = new Uint8Array(n); let k = Math.min(n, this.buf.length);
    out.set(this.buf.subarray(0, k)); this.buf = this.buf.subarray(k);
    while (k < n) {
      const b = new Uint8Array(Math.min(262144, n - k)), r = await this.c.read(b);
      if (r === null) throw new Error('Verbindung zum Postfach getrennt');
      out.set(b.subarray(0, r), k); k += r;
    }
    return out;
  }
  async cmd(c: string): Promise<{ lines: string[]; lits: Uint8Array[] }> {
    const t = `F${++this.n}`;
    await this.c.write(enc.encode(`${t} ${c}\r\n`));
    const lines: string[] = [], lits: Uint8Array[] = [];
    for (;;) {
      let l = await this.line(), m: RegExpMatchArray | null;
      while ((m = l.match(/\{(\d+)\}$/))) { lits.push(await this.bytes(+m[1])); l += ' ' + await this.line(); }
      if (l.startsWith(t + ' ')) { if (!/^\S+ OK/i.test(l)) throw new Error('Postfach: ' + l.slice(t.length + 1).slice(0, 200)); return { lines, lits }; }
      lines.push(l);
    }
  }
  close() { try { this.c.close(); } catch { /* egal */ } }
}
const q = (s: string) => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
const HOSTS: Record<string, string> = { 'gmx.de': 'imap.gmx.net', 'gmx.net': 'imap.gmx.net', 'web.de': 'imap.web.de', 'gmail.com': 'imap.gmail.com', 'googlemail.com': 'imap.gmail.com', 't-online.de': 'secureimap.t-online.de', 'posteo.de': 'posteo.de', 'mailbox.org': 'imap.mailbox.org', 'icloud.com': 'imap.mail.me.com' };

// Firma zum Rechnungsempfänger (wie in der App)
type Party = { name?: string; street?: string; zip?: string };
const LEGAL = new Set(['gmbh', 'mbh', 'kg', 'co', 'ug', 'ag', 'ohg', 'gbr', 'ev', 'se', 'haftungsbeschrankt', 'und', 'der', 'die', 'das']);
const words = (s?: string) => (s ?? '').toLowerCase().replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss').split(/[^a-z0-9]+/).filter(w => w.length > 1 && !LEGAL.has(w));
const flat = (s?: string) => (s ?? '').toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
function matchFirm(firms: Party[], b?: Party): string | undefined {
  if (!b?.name) return undefined;
  let best: string | undefined, score = 0;
  for (const f of firms) {
    if (!f.name) continue;
    const fw = words(f.name), bw = words(b.name);
    const hit = fw.filter(w => bw.some(x => x === w || (x.length >= 5 && w.startsWith(x)) || (w.length >= 5 && x.startsWith(w)))).length;
    let s = fw.length ? hit / fw.length : 0;
    if (flat(f.zip) && flat(f.zip) === flat(b.zip) && flat(f.street) && flat(f.street) === flat(b.street)) s += 0.5;
    if (s > score) { score = s; best = f.name; }
  }
  return score >= 0.6 ? best : undefined;
}

async function readPdf(data: string) {
  const r = await client.beta.messages.create({
    model: 'claude-opus-5-5', max_tokens: 8000,
    betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
    system: `Du liest deutsche Kassenbons und Rechnungen für ein Familien-Kassenbuch. Heute ist ${new Date().toISOString().slice(0, 10)}.
Übernimm Beträge genau wie gedruckt. Abkürzungen auf dem Bon schreibst du verständlich aus, wenn es eindeutig ist (z. B. „BIO VOLLM.“ → „Bio Vollmilch“).
Kategorien: Lebensmittel (Supermarkt, Bäcker, Getränke), Drogerie (dm, Rossmann, Hygiene), Kraftstoff (Tanken, Laden), Essen gehen (Restaurant, Imbiss, Lieferdienst),
Haushalt (Baumarkt, Möbel, Putzmittel, Elektro), Kleidung, Freizeit (Kino, Sport, Ausflug, Bücher, Spiele), Gesundheit (Apotheke, Arzt), Kinder/Schule, sonst Sonstiges.
Ohne lesbares Datum leer lassen, nicht raten.
Unterscheide genau zwischen Netto und Brutto: total ist immer der Bruttobetrag. Bei Rechnungen mit Netto-Positionen übernimm die Nettopreise in die Zeilen, setze items_net und gib die MwSt-Aufstellung vollständig an.
Lies den Verkäufer immer vollständig aus, auch bei Kassenbons: seller.name ist die rechtliche Firmierung mit Rechtsform (GmbH, GmbH & Co. KG, AG, e. K. …), die meist klein oben, unten oder neben der USt-IdNr. steht; dazu Anschrift, USt-IdNr., Steuernummer, Kontakt und IBAN, soweit angegeben. merchant ist dagegen der kurze Alltagsname des Geschäfts mit Ort, z. B. „Aldi Altenholz“. Ist keine Firmierung zu sehen, nimm den Geschäftsnamen. Bei Rechnungen lies auch den Käufer vollständig aus.
Auf Kassenbons stehen Steuersätze oft als Buchstaben (A = 19 %, B = 7 %); ordne sie den Zeilen zu, wenn die Legende auf dem Bon steht.`,
    messages: [{ role: 'user', content: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }, { type: 'text', text: 'Lies diese Rechnung (PDF) aus. box: 0, 0, 1, 1.' }] }]
  });
  if (r.stop_reason === 'refusal') throw new Error('abgelehnt');
  const block = r.content.find(b => b.type === 'text');
  if (!block || block.type !== 'text') throw new Error('Keine Antwort');
  return JSON.parse(block.text);
}

const b64 = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const b64url = (u: Uint8Array) => b64(u).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');

// Zugangsdaten verschlüsseln (AES-GCM mit MAILBOX_KEY)
// Ohne eigenes MAILBOX_KEY dient der Dienstschlüssel des Servers als Grundlage
const mailKey = () => Deno.env.get('MAILBOX_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
let keyP: Promise<CryptoKey> | null = null;
const aes = () => keyP ??= (async () => {
  const raw = mailKey();
  if (!raw) throw new Error('Schlüssel fehlt auf dem Server.');
  const k = await crypto.subtle.digest('SHA-256', enc.encode(raw));
  return crypto.subtle.importKey('raw', k, 'AES-GCM', false, ['encrypt', 'decrypt']);
})();
async function seal(s: string) { const iv = crypto.getRandomValues(new Uint8Array(12)); const c = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aes(), enc.encode(s))); const o = new Uint8Array(12 + c.length); o.set(iv); o.set(c, 12); return b64(o); }
async function unseal(s: string) { const u = unb64(s); return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.subarray(0, 12) }, await aes(), u.subarray(12))); }
async function sign(s: string) { const k = await crypto.subtle.importKey('raw', enc.encode('state:' + mailKey()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(s)))); }

// Microsoft (Outlook, Microsoft 365)
const MS_AUTH = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const MS_SCOPE = 'offline_access Mail.Read User.Read';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const redirect = () => `${Deno.env.get('SUPABASE_URL')}/functions/v1/mailin`;
const APP = 'https://app.famto.net/';
async function msToken(body: Record<string, string>) {
  const r = await fetch(`${MS_AUTH}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: Deno.env.get('MS_CLIENT_ID') ?? '', client_secret: Deno.env.get('MS_CLIENT_SECRET') ?? '', scope: MS_SCOPE, ...body }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('Microsoft-Anmeldung: ' + String(j.error_description ?? j.error ?? r.status).split('\n')[0].slice(0, 160));
  return j as { access_token: string; refresh_token?: string };
}
async function graph(token: string, path: string) {
  const r = await fetch(path.startsWith('http') ? path : GRAPH + path, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Outlook: ${r.status} ${(await r.text()).slice(0, 160)}`);
  return r;
}

type Att = { filename: string; mime: string; bytes: Uint8Array };
type Mail = { subject: string; sender: string; atts: Att[] };
type Box = { id: string; family_id: string; owner: string; kind: 'imap' | 'outlook'; address: string; host: string; secret: string; only_invoices: boolean };
// deno-lint-ignore no-explicit-any
type Ctx = { admin: any; firms: Party[]; business: boolean };

// MIME einer Mail lesen, als Anlage weitergeleitete Mails (.eml) mit auspacken
async function parseMime(raw: Uint8Array | ArrayBuffer): Promise<Mail> {
  const mail = await PostalMime.parse(raw);
  let subject = (mail.subject ?? '').slice(0, 300);
  const atts: Att[] = [];
  const add = (a: { filename?: string | null; mimeType: string; content: unknown }) => { if (a.content instanceof ArrayBuffer) atts.push({ filename: a.filename ?? '', mime: a.mimeType, bytes: new Uint8Array(a.content) }); else if (a.content instanceof Uint8Array) atts.push({ filename: a.filename ?? '', mime: a.mimeType, bytes: a.content }); };
  for (const a of mail.attachments ?? []) {
    if (/message\/rfc822/i.test(a.mimeType) || /\.eml$/i.test(a.filename ?? '')) {
      try { const inner = await parseMime(new Uint8Array(a.content as ArrayBuffer)); atts.push(...inner.atts); if (!subject || /^(wg|aw|fw|fwd)\b/i.test(subject)) subject = inner.subject || subject; } catch { /* egal */ }
    } else add(a);
  }
  return { subject, sender: (mail.from?.address ?? '').slice(0, 200), atts };
}

// Sieht die Mail nach Rechnung aus? Spart KI-Kosten für Newsletter, Tickets usw.
const INVOICE = /rechnung|invoice|beleg|quittung|receipt|gutschrift|abrechnung|zahlungs|bestell|order|kaufbest|faktura|lieferschein|vertrag|beitrag|bill/i;
const looksInvoice = (m: Mail, a: Att) => INVOICE.test(m.subject) || INVOICE.test(a.filename);
const isPdf = (a: Att) => /pdf/i.test(a.mime) || /\.pdf$/i.test(a.filename);
const norm = (s?: string) => (s ?? '').toLowerCase().replace(/[^a-z0-9äöüß]/g, '');

// Gibt es diese Rechnung in der Familie schon (auch von Hand erfasst)?
// deno-lint-ignore no-explicit-any
async function duplicate(ctx: Ctx, fam: string, r: Record<string, any>, at: Date): Promise<boolean> {
  const total = Number(r.total) || 0;
  const no = norm(r.invoice_no);
  if (no) {
    const { data } = await ctx.admin.from('receipts').select('invoice_no,total').eq('family_id', fam).neq('invoice_no', '').gte('total', total - 0.011).lte('total', total + 0.011).limit(50);
    if (data?.some((x: { invoice_no: string }) => norm(x.invoice_no as string) === no)) return true;
  }
  if (!total || isNaN(at.getTime())) return false;
  const d0 = new Date(at); d0.setUTCHours(0, 0, 0, 0); const d1 = new Date(d0.getTime() + 86400000);
  const { data } = await ctx.admin.from('receipts').select('merchant,invoice_no').eq('family_id', fam).gte('total', total - 0.011).lte('total', total + 0.011).gte('bought_at', new Date(d0.getTime() - 43200000).toISOString()).lt('bought_at', new Date(d1.getTime() + 43200000).toISOString()).limit(20);
  const m = norm(String(r.merchant ?? '').split(/\s+/)[0]);
  return !!data?.some((x: { merchant: string; invoice_no: string }) => (!no || !x.invoice_no) && (!m || m.length < 3 || norm(x.merchant as string).includes(m) || m.includes(norm(String(x.merchant ?? '').split(/\s+/)[0]))));
}

// Eine Mail verarbeiten: PDFs auslesen, Doppelte überspringen, Belege anlegen
async function handle(ctx: Ctx, box: Box, mail: Mail): Promise<{ status: string; count: number }> {
  const fam = box.family_id, owner = box.owner, { admin } = ctx;
  const pdfs = mail.atts.filter(isPdf);
  if (!pdfs.length) return { status: 'kein PDF-Anhang', count: 0 };
  const use = (box.only_invoices ? pdfs.filter(a => looksInvoice(mail, a)) : pdfs).slice(0, 3);
  if (!use.length) return { status: 'keine Rechnung (Betreff/Dateiname)', count: 0 };
  let count = 0, dup = 0; const notes: string[] = [];
  for (const a of use) {
    if (a.bytes.length > 4_500_000) { notes.push('PDF zu groß'); continue; }
    const hash = hex(await crypto.subtle.digest('SHA-256', a.bytes as BufferSource));
    const { data: same } = await admin.from('receipts').select('id').eq('family_id', fam).eq('file_hash', hash).limit(1);
    if (same?.length) { dup++; continue; }
    const r = await readPdf(b64(a.bytes));
    if (!r.found) { notes.push('keine Rechnung erkannt'); continue; }
    const at0 = r.date ? new Date(`${r.date}T${/^\d\d:\d\d$/.test(r.time) ? r.time : '12:00'}:00`) : new Date();
    const at = isNaN(at0.getTime()) ? new Date() : at0;
    if (await duplicate(ctx, fam, r, at)) { dup++; continue; }
    const path = `${fam}/${owner}/${crypto.randomUUID()}.pdf`;
    const up = await admin.storage.from('receipts').upload(path, a.bytes, { contentType: 'application/pdf' });
    if (up.error) throw new Error(up.error.message);
    const byFirm = ctx.business ? matchFirm(ctx.firms, r.buyer) ?? (/\b(gmbh|mbh|ag|kg|ug|ohg|gbr|se)\b/i.test(r.buyer?.name ?? '') ? String(r.buyer.name).trim() : undefined) : undefined;
    const row = {
      family_id: fam, owner, inbox: true, bought_at: at.toISOString(), file_hash: hash,
      merchant: String(r.merchant ?? '').slice(0, 200), payment: String(r.payment ?? '').slice(0, 100), card: String(r.card ?? '').replace(/\D/g, '').slice(-4),
      total: r.total || 0, currency: r.currency || 'EUR', category: CATS.includes(r.category) ? r.category : 'Sonstiges',
      scope: byFirm ? 'business' : 'private', firm: byFirm ?? '', photo: path,
      note: `Aus E-Mail: ${mail.subject}${mail.sender ? ` (${mail.sender})` : ''}`.slice(0, 500),
      kind: r.kind === 'rechnung' ? 'rechnung' : 'bon', invoice_no: r.invoice_no ?? '', net: r.net || 0, taxes: r.taxes ?? [], items_net: !!r.items_net,
      einv: r.kind === 'rechnung' ? { seller: r.seller, buyer: r.buyer, due: r.due_date || undefined, service: r.service_date || undefined, ref: r.buyer_ref || undefined } : r.seller?.name || r.seller?.street ? { seller: r.seller } : {}
    };
    const ins = await admin.from('receipts').insert(row).select('id').single();
    if (ins.error) { await admin.storage.from('receipts').remove([path]); throw new Error(ins.error.message); }
    const items = (r.items ?? []) as { name: string; qty: number; price: number; vat: number; category: string }[];
    if (items.length) await admin.from('receipt_items').insert(items.map((i, pos) => ({ receipt_id: ins.data.id, family_id: fam, owner, pos, name: String(i.name).slice(0, 300), qty: i.qty || 1, price: i.price || 0, vat: i.vat || 0, category: CATS.includes(i.category) ? i.category : 'Sonstiges', family: false })));
    count++;
  }
  const parts = [count ? `${count} Beleg${count > 1 ? 'e' : ''}` : '', dup ? `${dup} doppelt, übersprungen` : '', ...notes].filter(Boolean);
  return { status: parts.join(', ') || 'nichts gefunden', count };
}

// Eine Mail nur einmal anfassen: erst merken, dann lesen (zwei gleichzeitige Läufe lesen nichts doppelt)
async function once(ctx: Ctx, box: Box, id: string, work: () => Promise<Mail | null>): Promise<{ status: string; count: number } | null> {
  const lock = await ctx.admin.from('cash_mail').insert({ id, family_id: box.family_id, mailbox: box.id, status: 'liest' });
  if (lock.error) return null;
  let subject = '', sender = '', status = '', count = 0;
  try {
    const mail = await work();
    if (!mail) status = 'kein PDF-Anhang';
    else { subject = mail.subject; sender = mail.sender; ({ status, count } = await handle(ctx, box, mail)); }
  } catch (e) { status = 'Fehler: ' + String(e instanceof Error ? e.message : e).slice(0, 200); }
  await ctx.admin.from('cash_mail').update({ subject, sender, status, receipts: count }).eq('id', id);
  return { status, count };
}

const since = () => new Date(Date.now() - 30 * 86400000);

async function checkImap(ctx: Ctx, box: Box, until: number) {
  const host = box.host || HOSTS[box.address.split('@')[1]?.toLowerCase() ?? ''] || '';
  if (!host) throw new Error('IMAP-Server fehlt');
  const im = new Imap(); await im.open(host);
  let found = 0, pdfMails = 0;
  try {
    await im.cmd(`LOGIN ${q(box.address)} ${q(await unseal(box.secret))}`);
    const sel = await im.cmd('EXAMINE INBOX');
    const uv = sel.lines.join(' ').match(/UIDVALIDITY (\d+)/i)?.[1] ?? '0';
    const s0 = since(), M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const s = await im.cmd(`UID SEARCH SINCE ${s0.getUTCDate()}-${M[s0.getUTCMonth()]}-${s0.getUTCFullYear()}`);
    const uids = (s.lines.find(l => /^\* SEARCH/i.test(l)) ?? '').replace(/^\* SEARCH/i, '').trim().split(/\s+/).filter(Boolean).map(Number).sort((a, b) => b - a);
    const ids = uids.map(u => `${box.id}:${uv}:${u}`);
    const seen = new Set<string>();
    for (let i = 0; i < ids.length; i += 300) { const { data } = await ctx.admin.from('cash_mail').select('id').in('id', ids.slice(i, i + 300)); data?.forEach((x: { id: string }) => seen.add(x.id)); }
    const todo = uids.filter((_, k) => !seen.has(ids[k])).slice(0, MAX_LOOK);
    for (const uid of todo) {
      if (Date.now() > until || pdfMails >= PER_BOX) break;
      // Erst nur den Aufbau der Mail ansehen: ohne PDF oder weitergeleitete Mail gar nicht herunterladen
      const st = await im.cmd(`UID FETCH ${uid} (BODYSTRUCTURE)`);
      const shape = st.lines.join(' ') + ' ' + st.lits.map(l => dec.decode(l)).join(' ');
      const maybe = /"application"\s+"(pdf|octet-stream|x-pdf)"|\.pdf"|"message"\s+"rfc822"|\.eml"/i.test(shape);
      if (maybe) pdfMails++;
      const r = await once(ctx, box, `${box.id}:${uv}:${uid}`, async () => {
        if (!maybe) return null;
        const f = await im.cmd(`UID FETCH ${uid} (BODY.PEEK[])`);
        const raw = f.lits.sort((a, b) => b.length - a.length)[0];
        if (!raw) throw new Error('Mail leer');
        return parseMime(raw);
      });
      found += r?.count ?? 0;
    }
    await im.cmd('LOGOUT').catch(() => {});
  } finally { im.close(); }
  return found;
}

async function checkOutlook(ctx: Ctx, box: Box, until: number) {
  const t = await msToken({ grant_type: 'refresh_token', refresh_token: await unseal(box.secret) });
  if (t.refresh_token) await ctx.admin.from('mailboxes').update({ secret: await seal(t.refresh_token) }).eq('id', box.id);
  const tok = t.access_token;
  const list: { id: string; subject?: string; from?: { emailAddress?: { address?: string } } }[] = [];
  let next: string | null = `/me/mailFolders/inbox/messages?$filter=${encodeURIComponent(`receivedDateTime ge ${since().toISOString()} and hasAttachments eq true`)}&$select=id,subject,from&$top=50`;
  while (next && list.length < 500) { const j = await (await graph(tok, next)).json(); list.push(...(j.value ?? [])); next = j['@odata.nextLink'] ?? null; }
  const ids = list.map(m => `${box.id}:${m.id}`);
  const seen = new Set<string>();
  for (let i = 0; i < ids.length; i += 100) { const { data } = await ctx.admin.from('cash_mail').select('id').in('id', ids.slice(i, i + 100)); data?.forEach((x: { id: string }) => seen.add(x.id)); }
  let found = 0, done = 0;
  for (const m of list.filter((_, k) => !seen.has(ids[k]))) {
    if (Date.now() > until || done >= PER_BOX) break;
    done++;
    const r = await once(ctx, box, `${box.id}:${m.id}`, async () => {
      const mid = encodeURIComponent(m.id);
      const aj = await (await graph(tok, `/me/messages/${mid}/attachments`)).json();
      const mail: Mail = { subject: (m.subject ?? '').slice(0, 300), sender: (m.from?.emailAddress?.address ?? '').slice(0, 200), atts: [] };
      for (const a of aj.value ?? []) {
        if (a['@odata.type'] === '#microsoft.graph.fileAttachment' && a.contentBytes) mail.atts.push({ filename: a.name ?? '', mime: a.contentType ?? '', bytes: unb64(a.contentBytes) });
        else if (a['@odata.type'] === '#microsoft.graph.itemAttachment') {
          // Als Anlage weitergeleitete Mail: als MIME holen und auspacken
          try { const inner = await parseMime(new Uint8Array(await (await graph(tok, `/me/messages/${mid}/attachments/${encodeURIComponent(a.id)}/$value`)).arrayBuffer())); mail.atts.push(...inner.atts); if (!mail.subject || /^(wg|aw|fw|fwd)\b/i.test(mail.subject)) mail.subject = inner.subject || mail.subject; } catch { /* egal */ }
        }
      }
      return mail;
    });
    found += r?.count ?? 0;
  }
  return found;
}

async function check(ctx: Ctx, box: Box, until: number) {
  let status = '', found = 0;
  try {
    found = box.kind === 'outlook' ? await checkOutlook(ctx, box, until) : await checkImap(ctx, box, until);
    status = found ? `${found} neue Rechnung${found > 1 ? 'en' : ''}` : 'ok';
  } catch (e) { status = 'Fehler: ' + String(e instanceof Error ? e.message : e).slice(0, 200); }
  const { data: cur } = await ctx.admin.from('mailboxes').select('found').eq('id', box.id).maybeSingle();
  await ctx.admin.from('mailboxes').update({ last_check: new Date().toISOString(), last_status: status, found: ((cur?.found as number) ?? 0) + found }).eq('id', box.id);
  return { status, found };
}

async function prefsCtx(admin: Ctx['admin'], member: string): Promise<Ctx> {
  const { data: prefs } = await admin.from('cash_prefs').select('*').eq('member', member).maybeSingle();
  const firms: Party[] = Array.isArray(prefs?.firms) ? prefs.firms : prefs?.firm ? [{ name: prefs.firm }] : [];
  return { admin, firms, business: !!prefs?.business };
}

const back = (msg: string) => new Response(null, { status: 302, headers: { Location: `${APP}?open=${encodeURIComponent('cash:postfach:' + msg)}` } });

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const t0 = Date.now(), until = t0 + BUDGET;

  // Rückkehr von der Microsoft-Anmeldung
  if (req.method === 'GET') {
    const u = new URL(req.url), code = u.searchParams.get('code') ?? '', state = u.searchParams.get('state') ?? '';
    if (u.searchParams.get('error')) return back('abgebrochen');
    try {
      const [body, sig] = state.split('.');
      if (!body || sig !== await sign(body)) return back('fehler');
      const st = JSON.parse(dec.decode(unb64(body))) as { m: string; f: string; t: number };
      if (Date.now() - st.t > 20 * 60000) return back('abgelaufen');
      const t = await msToken({ grant_type: 'authorization_code', code, redirect_uri: redirect() });
      if (!t.refresh_token) return back('fehler');
      const me = await (await graph(t.access_token, '/me?$select=mail,userPrincipalName')).json();
      const address = String(me.mail || me.userPrincipalName || 'Outlook').toLowerCase();
      const secret = await seal(t.refresh_token);
      const { data: old } = await admin.from('mailboxes').select('id').eq('owner', st.m).eq('address', address).maybeSingle();
      const r = old ? await admin.from('mailboxes').update({ secret, kind: 'outlook', active: true, last_status: 'verbunden' }).eq('id', old.id)
        : await admin.from('mailboxes').insert({ family_id: st.f, owner: st.m, kind: 'outlook', address, secret, last_status: 'verbunden' });
      if (r.error) throw new Error(r.error.message);
      return back('ok');
    } catch (e) { console.error('outlook', e); return back('fehler'); }
  }

  try {
    const body = await req.json().catch(() => ({})) as { action?: string; id?: string; address?: string; password?: string; host?: string };
    const { data: key } = await admin.from('cash_mailkey').select('key').eq('id', 1).maybeSingle();
    const cron = !!key?.key && req.headers.get('x-famto-cron') === key.key;

    // Zeitplan: alle aktiven Postfächer, die am längsten nicht dran waren, zuerst
    if (cron) {
      const { data: boxes } = await admin.from('mailboxes').select('*').eq('active', true).order('last_check', { ascending: true, nullsFirst: true }).limit(100);
      const plan = new Map<string, boolean>(), out: { address: string; status: string }[] = [];
      for (const b of (boxes ?? []) as Box[]) {
        if (Date.now() > until - 30000) break;
        if (!plan.has(b.family_id)) { const { data } = await admin.rpc('plan_of', { fam: b.family_id }); plan.set(b.family_id, data === 'pro'); }
        if (!plan.get(b.family_id)) continue;
        const r = await check(await prefsCtx(admin, b.owner), b, until);
        out.push({ address: b.address, status: r.status });
      }
      return json({ ok: true, done: out });
    }

    // Aus der App: angemeldetes Mitglied mit FamTO Pro
    const { data: u } = await admin.auth.getUser((req.headers.get('Authorization') ?? '').replace(/^Bearer /, ''));
    const { data: m } = u.user ? await admin.from('members').select('id,family_id').eq('user_id', u.user.id).eq('active', true).limit(1).maybeSingle() : { data: null };
    if (!m) return json({ error: 'Bitte anmelden.' }, 401);
    const { data: plan } = await admin.rpc('plan_of', { fam: m.family_id });
    if (plan !== 'pro') return json({ error: 'Rechnungen aus E-Mails gibt es in FamTO Pro.', pro: true }, 402);

    if (body.action === 'outlook') {
      if (!Deno.env.get('MS_CLIENT_ID')) return json({ error: 'Outlook ist auf dem Server noch nicht eingerichtet.' }, 400);
      const st = b64url(enc.encode(JSON.stringify({ m: m.id, f: m.family_id, t: Date.now() })));
      const p = new URLSearchParams({ client_id: Deno.env.get('MS_CLIENT_ID')!, response_type: 'code', redirect_uri: redirect(), response_mode: 'query', scope: MS_SCOPE, state: `${st}.${await sign(st)}`, prompt: 'select_account' });
      return json({ url: `${MS_AUTH}/authorize?${p}` });
    }

    if (body.action === 'add') {
      const address = String(body.address ?? '').trim().toLowerCase(), password = String(body.password ?? '');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address) || !password) return json({ error: 'Bitte E-Mail-Adresse und Passwort eintragen.' }, 400);
      const domain = address.split('@')[1];
      if (/^(outlook|hotmail|live|msn)\./.test(domain)) return json({ error: 'Für Outlook bitte „Mit Microsoft anmelden“ nehmen.' }, 400);
      const host = String(body.host ?? '').trim().toLowerCase() || HOSTS[domain] || `imap.${domain}`;
      // Zugang gleich ausprobieren
      const im = new Imap();
      try { await im.open(host); await im.cmd(`LOGIN ${q(address)} ${q(password)}`); await im.cmd('EXAMINE INBOX'); await im.cmd('LOGOUT').catch(() => {}); }
      catch (e) { const t = String(e instanceof Error ? e.message : e); return json({ error: /Postfach:/.test(t) ? `Anmeldung abgelehnt. Bitte Adresse und App-Passwort prüfen und ob der Abruf per IMAP im Postfach erlaubt ist. (${t.slice(0, 120)})` : `Der Server ${host} antwortet nicht. Bitte den IMAP-Server prüfen.`, host }, 400); }
      finally { im.close(); }
      const secret = await seal(password);
      const { data: old } = await admin.from('mailboxes').select('id').eq('owner', m.id).eq('address', address).maybeSingle();
      const r = old ? await admin.from('mailboxes').update({ secret, host, kind: 'imap', active: true, last_status: 'verbunden' }).eq('id', old.id)
        : await admin.from('mailboxes').insert({ family_id: m.family_id, owner: m.id, kind: 'imap', address, host, secret, last_status: 'verbunden' });
      if (r.error) throw new Error(r.error.message);
      return json({ ok: true });
    }

    if (body.action === 'check') {
      const { data: b } = await admin.from('mailboxes').select('*').eq('id', body.id ?? '').eq('owner', m.id).maybeSingle();
      if (!b) return json({ error: 'Postfach nicht gefunden.' }, 404);
      const r = await check(await prefsCtx(admin, m.id), b as Box, Math.min(until, t0 + 90000));
      return json({ ok: true, ...r });
    }
    return json({ error: 'Unbekannte Aktion' }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: String(e instanceof Error ? e.message : e) }, 400);
  }
});
