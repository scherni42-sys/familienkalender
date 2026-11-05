// Edge Function „receipt“: liest einen fotografierten Kassenbon oder eine PDF-Rechnung aus (Händler, Datum, Karte, Positionen, Summe, Kategorien)
// und meldet, wo der Bon im Foto liegt, damit die App ihn freistellen kann. Nur für angemeldete Familienmitglieder.
import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';

const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const CATS = ['Lebensmittel', 'Drogerie', 'Kraftstoff', 'Essen gehen', 'Haushalt', 'Kleidung', 'Freizeit', 'Gesundheit', 'Kinder/Schule', 'Sonstiges'];

const schema = {
  type: 'object', additionalProperties: false,
  required: ['found', 'kind', 'box', 'merchant', 'invoice_no', 'net', 'taxes', 'items_net', 'date', 'time', 'payment', 'card', 'total', 'currency', 'category', 'items'],
  properties: {
    found: { type: 'boolean', description: 'false, wenn auf dem Foto kein Kassenbon oder keine Rechnung zu sehen ist' },
    kind: { type: 'string', enum: ['bon', 'rechnung'], description: 'rechnung: Rechnung, die Netto, MwSt und Brutto ausdrücklich getrennt ausweist (Handwerker, Firma, Werkstatt, Online-Shop mit Rechnungsnummer, Netto-Positionen). bon: normaler Kassenbon für Endverbraucher mit Bruttopreisen, auch wenn unten eine kleine MwSt-Aufstellung steht.' },
    invoice_no: { type: 'string', description: 'Rechnungsnummer, sonst leer' },
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

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const auth = req.headers.get('Authorization') ?? '';
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { data: u } = await sb.auth.getUser(auth.replace(/^Bearer /, ''));
    const { data: mine } = u.user ? await sb.from('members').select('id, role').eq('user_id', u.user.id).eq('active', true).limit(1) : { data: null };
    if (!mine?.length || mine[0].role === 'guest') return json({ error: 'Nicht angemeldet' }, 401);
    const { image, today } = await req.json();
    if (!image || typeof image.data !== 'string' || image.data.length > 6_000_000 || !/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(image.type)) throw new Error('Kein Foto');
    const doc = image.type === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: image.data } } as const
      : { type: 'image', source: { type: 'base64', media_type: image.type, data: image.data } } as const;
    const r = await client.beta.messages.create({
      model: 'claude-opus-5-5', max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
      system: `Du liest deutsche Kassenbons und Rechnungen für ein Familien-Kassenbuch. Heute ist ${today}.
Übernimm Beträge genau wie gedruckt. Abkürzungen auf dem Bon schreibst du verständlich aus, wenn es eindeutig ist (z. B. „BIO VOLLM.“ → „Bio Vollmilch“).
Kategorien: Lebensmittel (Supermarkt, Bäcker, Getränke), Drogerie (dm, Rossmann, Hygiene), Kraftstoff (Tanken, Laden), Essen gehen (Restaurant, Imbiss, Lieferdienst),
Haushalt (Baumarkt, Möbel, Putzmittel, Elektro), Kleidung, Freizeit (Kino, Sport, Ausflug, Bücher, Spiele), Gesundheit (Apotheke, Arzt), Kinder/Schule, sonst Sonstiges.
Ohne lesbares Datum leer lassen, nicht raten.
Unterscheide genau zwischen Netto und Brutto: total ist immer der Bruttobetrag. Bei Rechnungen mit Netto-Positionen übernimm die Nettopreise in die Zeilen, setze items_net und gib die MwSt-Aufstellung vollständig an.
Auf Kassenbons stehen Steuersätze oft als Buchstaben (A = 19 %, B = 7 %); ordne sie den Zeilen zu, wenn die Legende auf dem Bon steht.`,
      messages: [{ role: 'user', content: [doc, { type: 'text', text: image.type === 'application/pdf' ? 'Lies diese Rechnung (PDF) aus. box: 0, 0, 1, 1.' : 'Lies diesen Beleg aus.' }] }]
    });
    if (r.stop_reason === 'refusal') throw new Error('abgelehnt');
    const block = r.content.find(b => b.type === 'text');
    if (!block || block.type !== 'text') throw new Error('Keine Antwort');
    return json({ receipt: JSON.parse(block.text) });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 400);
  }
});
