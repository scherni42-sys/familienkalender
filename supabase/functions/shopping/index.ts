// Edge Function „shopping“ (FamTO Pro): liest einen handgeschriebenen Einkaufszettel oder eine Zutatenliste (Kochbuch, Rezept)
// vom Foto, oder stellt zu einem genannten Gericht (Zaubertaste) die Zutaten für den Einkauf zusammen. Artikel, die schon auf dem Zettel stehen, bekommen genau den Namen von dort, damit die App sie zusammenführt.
import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';

const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// Abteilungen wie in der App (src/lib/shop.ts, SHOP_CATS)
const CATS = ['Obst', 'Gemüse', 'Brot & Gebäck', 'Frühstück & Cerealien', 'Fleisch & Wurst', 'Fisch', 'Käse', 'Milchprodukte & Eier', 'Tiefkühl', 'Nudeln, Reis & Konserven', 'Backen & Gewürze', 'Süßes & Snacks', 'Getränke', 'Alkohol', 'Drogerie', 'Haushalt', 'Sonstiges'];

const schema = {
  type: 'object', additionalProperties: false,
  required: ['found', 'kind', 'dish', 'servings', 'items'],
  properties: {
    found: { type: 'boolean', description: 'false, wenn auf dem Foto weder ein Einkaufszettel noch eine Zutatenliste zu sehen ist' },
    kind: { type: 'string', enum: ['zettel', 'rezept'], description: 'zettel: Einkaufszettel oder lose Liste. rezept: Zutatenliste eines Gerichts (Kochbuch, Rezeptkarte, Bildschirmfoto eines Rezepts).' },
    dish: { type: 'string', description: 'Bei rezept: Name des Gerichts, kurz, z. B. „Lasagne“; sonst leer' },
    servings: { type: 'integer', description: 'Bei rezept: für wie viele Personen die Mengen gelten; 0, wenn unbekannt oder kein Rezept' },
    items: { type: 'array', description: 'Alle Artikel in der Reihenfolge auf dem Foto, jeder nur einmal',
      items: { type: 'object', additionalProperties: false, required: ['name', 'qty', 'unit', 'cat'],
        properties: {
          name: { type: 'string', description: 'Artikel ohne Menge, Einzahl oder übliche Form, z. B. „Tomaten“, „Butter“, „Zahnpasta“' },
          qty: { type: 'number', description: 'Menge als Zahl, 1 wenn keine dasteht' },
          unit: { type: 'string', description: 'Einheit: g, kg, ml, l, Pck., Dose, Fl., Glas, Bund, Becher, Beutel; leer bei Stückzahl oder ohne Angabe' },
          cat: { type: 'string', enum: CATS, description: 'Abteilung im Supermarkt bzw. in der Drogerie' }
        } } }
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
    const { data: pro } = await sb.rpc('ai_allowed', {});
    if (pro !== true) return json({ error: 'Die KI-Funktionen gibt es in FamTO Pro.', pro: true }, 402);
    const { image, known, dish, servings } = await req.json();
    const cook = typeof dish === 'string' && dish.trim() ? dish.trim().slice(0, 120) : '';
    const people = Number.isInteger(servings) && servings > 0 && servings < 100 ? servings : 4;
    if (!cook && (!image || typeof image.data !== 'string' || image.data.length > 6_000_000 || !/^image\/(jpeg|png|webp)$/.test(image.type))) throw new Error('Kein Foto');
    const names = (Array.isArray(known) ? known : []).filter((x: unknown) => typeof x === 'string').slice(0, 200).map((x: string) => x.slice(0, 120));
    const r = await client.beta.messages.create({
      model: 'claude-opus-5-5', max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      system: `Du liest Fotos für den gemeinsamen Einkaufszettel einer Familie: handgeschriebene Einkaufszettel oder Zutatenlisten aus Kochbüchern und Rezepten.
Lies Handschrift sorgfältig und schreib die Artikel verständlich und richtig geschrieben aus („Joghurt“ statt „Jogurt“, „Zahnpasta“ statt „Zahnp.“).
Mengen übernimmst du als Zahl mit Einheit; „2 Pck. Butter“ → qty 2, unit „Pck.“, name „Butter“. Ohne Mengenangabe: qty 1, unit leer.
Bei einem Rezept: jede Zutat einmal, mit der Menge aus dem Rezept. Wasser lässt du weg. Steht dieselbe Zutat mehrfach im Rezept (z. B. für Teig und Soße), fasse sie zusammen.
Soll ein Gericht zusammengestellt werden: kind „rezept“, dish ist der kurze Name des Gerichts, servings die Personenzahl. Nimm ein übliches deutsches Hausrezept und gib alle Zutaten mit Einkaufsmengen für diese Personenzahl an, auch Beilagen, die im Namen stehen (Kartoffelstampf: Kartoffeln, Milch, Butter). Grundzutaten wie Salz, Pfeffer, Öl und Mehl nimmst du nur auf, wenn das Gericht viel davon braucht.
Steht ein Artikel schon auf dem Zettel der Familie, auch in anderer Schreibweise oder Mehrzahl, verwende genau diesen Namen. Auf dem Zettel stehen schon: ${names.length ? names.join(', ') : '(noch nichts)'}.`,
      messages: [{ role: 'user', content: cook
        ? `Stell die Zutaten für den Einkauf zusammen: ${cook}, für ${people} Personen.`
        : [{ type: 'image', source: { type: 'base64', media_type: image.type, data: image.data } }, { type: 'text', text: 'Lies die Artikel für den Einkaufszettel aus.' }] }]
    });
    if (r.stop_reason === 'refusal') throw new Error('abgelehnt');
    const block = r.content.find(b => b.type === 'text');
    if (!block || block.type !== 'text') throw new Error('Keine Antwort');
    return json({ list: JSON.parse(block.text) });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 400);
  }
});
