// Edge Function „mailin“: liest das Belege-Postfach (IMAP) und legt PDF-Rechnungen als neue Belege in den Eingang des Kassenbuchs.
// Läuft alle 15 Minuten über pg_cron (Kopf x-famto-cron) oder auf Knopfdruck aus der App (angemeldetes Mitglied).
// Geheimnisse: MAIL_USER, MAIL_PASS, optional MAIL_HOST. Die Belege gehören dem Mitglied mit cash_prefs.mailin; der Zeitplan-Schlüssel steht in cash_mailkey.
// Das Postfach wird nur gelesen: nichts wird gelöscht oder verschoben, gelesene Mails merkt sich die Tabelle cash_mail.
import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';
import PostalMime from 'npm:postal-mime@2.7.6';

const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-famto-cron' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const enc = new TextEncoder(), dec = new TextDecoder();
const PER_RUN = 2;

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

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  try {
    const { data: om } = await admin.from('cash_prefs').select('member').eq('mailin', true).limit(1);
    const owner = (om?.[0]?.member as string | undefined) ?? '';
    // Zugang: Zeitplan mit Schlüssel oder das angemeldete Mitglied, dem das Postfach gehört
    const { data: key } = await admin.from('cash_mailkey').select('key').eq('id', 1).maybeSingle();
    const cron = !!key?.key && req.headers.get('x-famto-cron') === key.key;
    if (cron && !owner) return json({ ok: true, idle: true });
    if (!cron) {
      const auth = req.headers.get('Authorization') ?? '';
      const { data: u } = await admin.auth.getUser(auth.replace(/^Bearer /, ''));
      const { data: m } = u.user ? await admin.from('members').select('id').eq('user_id', u.user.id).eq('active', true) : { data: null };
      if (!m?.some(x => x.id === owner)) return json({ error: owner ? 'Nur für den Besitzer des Belege-Postfachs.' : 'Bitte zuerst im Kassenbuch „Rechnungen aus E-Mails“ einschalten.' }, 401);
    }
    const user = Deno.env.get('MAIL_USER') ?? '', pass = Deno.env.get('MAIL_PASS') ?? '';
    if (!user || !pass) return json({ error: 'Das Belege-Postfach ist noch nicht eingerichtet (MAIL_USER, MAIL_PASS).', setup: true }, 400);
    const host = Deno.env.get('MAIL_HOST') || HOSTS[user.split('@')[1]?.toLowerCase() ?? ''] || '';
    if (!host) return json({ error: 'Bitte MAIL_HOST eintragen (IMAP-Server des Postfachs).', setup: true }, 400);
    const { data: mem } = await admin.from('members').select('family_id').eq('id', owner).single();
    if (!mem) throw new Error('Besitzer des Postfachs unbekannt');
    const fam = mem.family_id as string;
    // Rechnungen aus E-Mails liest die KI, also nur in FamTO Pro
    const { data: plan } = await admin.rpc('plan_of', { fam });
    if (plan !== 'pro') return cron ? json({ ok: true, idle: true, basis: true }) : json({ error: 'Die KI-Funktionen gibt es in FamTO Pro.', pro: true }, 402);
    const { data: prefs } = await admin.from('cash_prefs').select('*').eq('member', owner).maybeSingle();
    const firms: Party[] = Array.isArray(prefs?.firms) ? prefs.firms : prefs?.firm ? [{ name: prefs.firm }] : [];
    const business = !!prefs?.business;

    const im = new Imap();
    await im.open(host);
    const out: { subject: string; status: string }[] = [];
    let left = 0;
    try {
      await im.cmd(`LOGIN ${q(user)} ${q(pass)}`);
      const sel = await im.cmd('SELECT INBOX');
      const uv = sel.lines.join(' ').match(/UIDVALIDITY (\d+)/i)?.[1] ?? '0';
      const since = new Date(Date.now() - 30 * 86400000);
      const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const s = await im.cmd(`UID SEARCH SINCE ${since.getUTCDate()}-${M[since.getUTCMonth()]}-${since.getUTCFullYear()}`);
      const uids = (s.lines.find(l => /^\* SEARCH/i.test(l)) ?? '').replace(/^\* SEARCH/i, '').trim().split(/\s+/).filter(Boolean).map(Number).sort((a, b) => a - b);
      const ids = uids.map(u => `${user.toLowerCase()}:${uv}:${u}`);
      const { data: seen } = ids.length ? await admin.from('cash_mail').select('id').in('id', ids) : { data: [] };
      const todo = uids.filter((_, k) => !seen?.some(x => x.id === ids[k]));
      left = Math.max(0, todo.length - PER_RUN);
      for (const uid of todo.slice(0, PER_RUN)) {
        const id = `${user.toLowerCase()}:${uv}:${uid}`;
        // Merken zuerst: zwei gleichzeitige Läufe lesen dieselbe Mail nicht doppelt
        const lock = await admin.from('cash_mail').insert({ id, family_id: fam, status: 'liest' });
        if (lock.error) continue;
        let subject = '', sender = '', status = '', count = 0;
        try {
          const f = await im.cmd(`UID FETCH ${uid} (BODY.PEEK[])`);
          const raw = f.lits.sort((a, b) => b.length - a.length)[0];
          if (!raw) throw new Error('Mail leer');
          const mail = await PostalMime.parse(raw);
          subject = (mail.subject ?? '').slice(0, 300); sender = (mail.from?.address ?? '').slice(0, 200);
          // Als Anlage weitergeleitete Mails (.eml) mit auspacken
          const atts = [...(mail.attachments ?? [])];
          for (const a of mail.attachments ?? []) if (/message\/rfc822/i.test(a.mimeType) || /\.eml$/i.test(a.filename ?? '')) {
            try { const inner = await PostalMime.parse(new Uint8Array(a.content as ArrayBuffer)); atts.push(...(inner.attachments ?? [])); if (!subject || /^(wg|fw|fwd)\b/i.test(subject)) subject = (inner.subject ?? subject).slice(0, 300); } catch { /* egal */ }
          }
          const pdfs = atts.filter(a => /pdf/i.test(a.mimeType) || /\.pdf$/i.test(a.filename ?? '')).slice(0, 3);
          if (!pdfs.length) status = 'kein PDF-Anhang';
          for (const a of pdfs) {
            const bytes = new Uint8Array(a.content as ArrayBuffer);
            if (bytes.length > 4_500_000) { status = 'PDF zu groß'; continue; }
            const r = await readPdf(b64(bytes));
            if (!r.found) { status = 'keine Rechnung erkannt'; continue; }
            const path = `${fam}/${owner}/${crypto.randomUUID()}.pdf`;
            const up = await admin.storage.from('receipts').upload(path, bytes, { contentType: 'application/pdf' });
            if (up.error) throw new Error(up.error.message);
            const at = r.date ? new Date(`${r.date}T${/^\d\d:\d\d$/.test(r.time) ? r.time : '12:00'}:00`) : new Date();
            const byFirm = business ? matchFirm(firms, r.buyer) ?? (/\b(gmbh|mbh|ag|kg|ug|ohg|gbr|se)\b/i.test(r.buyer?.name ?? '') ? String(r.buyer.name).trim() : undefined) : undefined;
            const row = {
              family_id: fam, owner, inbox: true, bought_at: (isNaN(at.getTime()) ? new Date() : at).toISOString(),
              merchant: String(r.merchant ?? '').slice(0, 200), payment: String(r.payment ?? '').slice(0, 100), card: String(r.card ?? '').replace(/\D/g, '').slice(-4),
              total: r.total || 0, currency: r.currency || 'EUR', category: CATS.includes(r.category) ? r.category : 'Sonstiges',
              scope: byFirm ? 'business' : 'private', firm: byFirm ?? '', photo: path,
              note: `Aus E-Mail: ${subject}${sender ? ` (${sender})` : ''}`.slice(0, 500),
              kind: r.kind === 'rechnung' ? 'rechnung' : 'bon', invoice_no: r.invoice_no ?? '', net: r.net || 0, taxes: r.taxes ?? [], items_net: !!r.items_net,
              einv: r.kind === 'rechnung' ? { seller: r.seller, buyer: r.buyer, due: r.due_date || undefined, service: r.service_date || undefined, ref: r.buyer_ref || undefined } : r.seller?.name || r.seller?.street ? { seller: r.seller } : {}
            };
            const ins = await admin.from('receipts').insert(row).select('id').single();
            if (ins.error) { await admin.storage.from('receipts').remove([path]); throw new Error(ins.error.message); }
            const items = (r.items ?? []) as { name: string; qty: number; price: number; vat: number; category: string }[];
            if (items.length) await admin.from('receipt_items').insert(items.map((i, pos) => ({ receipt_id: ins.data.id, family_id: fam, owner, pos, name: String(i.name).slice(0, 300), qty: i.qty || 1, price: i.price || 0, vat: i.vat || 0, category: CATS.includes(i.category) ? i.category : 'Sonstiges', family: false })));
            count++;
          }
          if (count) status = `${count} Beleg${count > 1 ? 'e' : ''}`;
        } catch (e) { status = 'Fehler: ' + String(e instanceof Error ? e.message : e).slice(0, 200); }
        await admin.from('cash_mail').update({ subject, sender, status, receipts: count }).eq('id', id);
        out.push({ subject, status });
      }
      await im.cmd('LOGOUT').catch(() => {});
    } finally { im.close(); }
    return json({ ok: true, mailbox: user, done: out, left });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 400);
  }
});
