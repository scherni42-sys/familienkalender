import type { ShopIn, ShopItem } from './types';
import { supabase } from './supabase';
import { today } from './dates';
import { isPro, PRO_ONLY } from './store';

// Einkaufszettel: Eingabe zerlegen, doppelte Artikel zusammenführen, Anzeige

const NUM: Record<string, number> = { ein: 1, eine: 1, einen: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, zwölf: 12, halbe: 0.5, halbes: 0.5, halber: 0.5 };
// Einheiten, wie man sie sagt oder schreibt, und wie sie auf dem Zettel stehen
const UNITS: [RegExp, string][] = [
  [/^(kg|kilo|kilogramm)$/i, 'kg'], [/^(g|gr|gramm)$/i, 'g'], [/^(l|liter)$/i, 'l'], [/^(ml|milliliter)$/i, 'ml'],
  [/^(pck|pck\.|pk|packung|packungen|päckchen|pkg)$/i, 'Pck.'], [/^(dose|dosen)$/i, 'Dose'], [/^(flasche|flaschen)$/i, 'Fl.'],
  [/^(glas|gläser)$/i, 'Glas'], [/^(bund|bündel)$/i, 'Bund'], [/^(becher)$/i, 'Becher'], [/^(tüte|tüten|beutel)$/i, 'Beutel'],
  [/^(netz|netze)$/i, 'Netz'], [/^(kiste|kisten|kasten|kästen)$/i, 'Kiste'], [/^(rolle|rollen)$/i, 'Rolle'], [/^(stück|stk|stk\.|st\.)$/i, '']
];
const unitOf = (w: string) => { for (const [re, u] of UNITS) if (re.test(w)) return u; return null; };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// „Milch, 2 Packungen Butter und 500 g Hack“ → drei Artikel
// Namen aus mehreren Wörtern, die zusammenbleiben (sonst trennt die Spracheingabe sie)
const PHRASES = ['rote bete', 'rote beete', 'crème fraîche', 'creme fraiche', 'saure sahne', 'schlagsahne', 'griechischer joghurt', 'frische milch', 'h-milch'];
const isNum = (w: string) => /^\d/.test(w) || NUM[w.toLowerCase()] !== undefined;
// Spracheingabe liefert oft keine Kommas: „Hirse Bananen Äpfel“ oder „Hirse 2 Bananen 3 Äpfel“ → drei Artikel.
// Neuer Artikel beginnt bei jedem großgeschriebenen Wort (Hauptwort) oder einer Zahl; kleingeschriebene Wörter („frische“)
// gehören zum nächsten Hauptwort, Mengen und Einheiten („2 Packungen Butter“) bleiben beim Artikel.
function splitSpoken(part: string): string[] {
  const w = part.split(/\s+/).filter(Boolean);
  if (w.length < 2 || PHRASES.some(p => part.toLowerCase() === p)) return [part];
  const out: string[][] = []; let cur: string[] = [], noun = false;
  for (let i = 0; i < w.length; i++) {
    const x = w[i];
    const pair = (x + ' ' + (w[i + 1] ?? '')).toLowerCase();
    const starts = isNum(x) || (/^[A-ZÄÖÜ]/.test(x) && unitOf(x) === null);
    if (noun && starts) { out.push(cur); cur = []; noun = false; }
    if (PHRASES.includes(pair)) { cur.push(x, w[++i]); noun = true; continue; }
    cur.push(x);
    if (/^[A-ZÄÖÜ]/.test(x) && unitOf(x) === null && !isNum(x)) noun = true;
  }
  if (cur.length) out.push(cur);
  return out.map(c => c.join(' '));
}

export function parseShop(text: string): ShopIn[] {
  return text.split(/[,;\n]+|\s+und\s+|\s+sowie\s+/i).map(x => x.trim().replace(/[.!?]+$/, '')).filter(Boolean).flatMap(splitSpoken).map(part => {
    const w = part.split(/\s+/);
    let qty = 1, unit = '', i = 0;
    const n = w[0].toLowerCase().replace(',', '.');
    const m = n.match(/^(\d+(?:\.\d+)?)(x|×|kg|g|l|ml)?$/);
    if (m) { qty = Number(m[1]); i = 1; if (m[2] && m[2] !== 'x' && m[2] !== '×') unit = unitOf(m[2]) ?? ''; }
    else if (NUM[n] !== undefined && w.length > 1) { qty = NUM[n]; i = 1; }
    if (i && w[i] && /^(x|×|mal)$/i.test(w[i])) i++;
    if (i && w.length > i + 1 && !unit) { const u = unitOf(w[i]); if (u !== null) { unit = u; i++; } }
    const name = cap(w.slice(i).join(' ').trim() || part);
    return { name, qty: qty > 0 ? qty : 1, unit };
  });
}

// Vergleichsschlüssel: Groß-/Kleinschreibung, Leerzeichen und einfache Mehrzahl spielen keine Rolle („Tomate“ = „Tomaten“)
export function shopKey(name: string) {
  let k = name.toLowerCase().replace(/ß/g, 'ss').replace(/[^a-zäöü0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  k = k.split(' ').map(x => x.length > 4 ? x.replace(/(en|er|n|e|s)$/, '') : x).join(' ');
  return k;
}

// Neue Artikel mit dem Zettel abgleichen: gleicher Artikel (im selben Abschnitt) → Menge erhöhen statt doppelt aufführen.
// Abgehakte Artikel kommen mit der neuen Menge zurück auf den Zettel.
export function mergeShop(list: ShopItem[], add: ShopIn[]) {
  const ins: ShopIn[] = [];
  const upd = new Map<string, Partial<ShopItem>>();
  let merged = 0;
  for (const a of add) {
    const name = a.name.trim(); if (!name) continue;
    const dish = (a.dish ?? '').trim(), unit = a.unit ?? '', qty = a.qty && a.qty > 0 ? a.qty : 1;
    const hit = list.find(x => x.dish === dish && shopKey(x.name) === shopKey(name) && (x.done || x.unit === unit || (upd.get(x.id)?.unit ?? x.unit) === unit));
    if (hit) {
      const cur = { ...hit, ...upd.get(hit.id) };
      upd.set(hit.id, cur.done ? { done: false, done_by: null, done_at: null, taker: null, qty, unit } : { qty: cur.qty + qty });
      merged++;
      continue;
    }
    const same = ins.find(x => (x.dish ?? '') === dish && shopKey(x.name) === shopKey(name) && (x.unit ?? '') === unit);
    if (same) { same.qty = (same.qty ?? 1) + qty; merged++; continue; }
    ins.push({ name, qty, unit, dish, cat: a.cat && (SHOP_CATS as readonly string[]).includes(a.cat) ? a.cat : unit === 'Dose' ? 'Nudeln, Reis & Konserven' : shopCat(name), servings: dish ? a.servings ?? null : null });
  }
  return { ins, upd, merged };
}

const fmt = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');
const PLURAL: Record<string, string> = { Dose: 'Dosen', Glas: 'Gläser', Netz: 'Netze', Kiste: 'Kisten', Rolle: 'Rollen' };
// Anzeige gerundet: Gramm und Milliliter auf glatte Werte, kg und l auf eine Stelle, Stück und Packungen aufgerundet
export function roundQty(qty: number, unit: string) {
  if (unit === 'g' || unit === 'ml') return qty >= 100 ? Math.round(qty / 10) * 10 : Math.max(5, Math.round(qty / 5) * 5);
  if (unit === 'kg' || unit === 'l') return Math.max(0.1, Math.round(qty * 10) / 10);
  const r = Math.round(qty * 100) / 100;
  return r < 1 ? (r <= 0.5 ? 0.5 : 1) : Math.ceil(r - 0.05);
}
export function shopQty(x: Pick<ShopItem, 'qty' | 'unit'>) {
  const q = roundQty(x.qty, x.unit);
  if (x.unit) return `${fmt(q)} ${q > 1 ? PLURAL[x.unit] ?? x.unit : x.unit}`;
  return q !== 1 ? `${fmt(q)}×` : '';
}

// Offene Artikel: davon hängt ab, ob das Zettel-Symbol am Board erscheint
export const openShop = (list?: ShopItem[]) => (list ?? []).filter(x => !x.done);

// FamTO Pro: Foto eines handgeschriebenen Zettels oder einer Zutatenliste aus dem Kochbuch auslesen (Edge Function „shopping“)
type ShopRead = { found: boolean; dish: string; servings: number | null; items: ShopIn[] };
async function callShopping(body: Record<string, unknown>, what: string, list: ShopItem[]): Promise<ShopRead> {
  if (!supabase) throw new Error(`${what} geht nur mit einer echten Familie, nicht in der Beispielfamilie.`);
  if (!isPro()) throw new Error(`${what} macht die KI. ${PRO_ONLY}`);
  const { data, error } = await supabase.functions.invoke('shopping', { body: { ...body, today: today(), known: [...new Set(list.map(x => x.name))] } });
  if (error) {
    const res = (error as { context?: Response }).context;
    if (res?.status === 402) throw new Error(`${what} macht die KI. ${PRO_ONLY}`);
    throw new Error('Claude ist gerade nicht erreichbar. Bitte noch einmal versuchen.');
  }
  const r = data?.list as { found: boolean; kind: 'zettel' | 'rezept'; dish: string; servings: number; items: { name: string; qty: number; unit: string; cat?: string }[] } | undefined;
  if (!r) throw new Error('Claude hat nichts geliefert. Bitte noch einmal versuchen.');
  const dish = r.kind === 'rezept' ? (r.dish.trim() || 'Rezept') : '';
  const servings = dish && r.servings > 0 ? Math.round(r.servings) : null;
  return { found: r.found && r.items.length > 0, dish, servings, items: r.items.map(x => ({ name: cap(x.name.trim()), qty: x.qty > 0 ? x.qty : 1, unit: unitOf(x.unit) ?? x.unit.trim(), cat: x.cat, dish, servings })) };
}
export const readShopPhoto = (image: { type: string; data: string }, list: ShopItem[]) => callShopping({ image }, 'Zettel und Rezepte vom Foto lesen', list);
// Zaubertaste: „Einkaufen für Wiener Schnitzel mit Kartoffelstampf“ → Claude stellt die Zutaten zusammen
export const dishShop = (dish: string, servings: number, list: ShopItem[]) => callShopping({ dish, servings }, 'Zutaten für ein Gericht zusammenstellen', list);

// Abteilungen in der Reihenfolge eines typischen Rundgangs durch Supermarkt und Drogerie
export const SHOP_CATS = ['Obst', 'Gemüse', 'Brot & Gebäck', 'Frühstück & Cerealien', 'Fleisch & Wurst', 'Fisch', 'Käse', 'Milchprodukte & Eier',
  'Tiefkühl', 'Nudeln, Reis & Konserven', 'Backen & Gewürze', 'Süßes & Snacks', 'Getränke', 'Alkohol', 'Drogerie', 'Haushalt', 'Sonstiges'] as const;
export type ShopCat = typeof SHOP_CATS[number];

// Einfache Zuordnung über Wortteile (auch ohne KI, in beiden Tarifen). Reihenfolge zählt: „Apfelsaft“ ist Getränk, nicht Obst.
const RULES: [ShopCat, string[]][] = [
  ['Obst', ['wassermelone', 'weintraube']],
  ['Haushalt', ['teelicht']],
  ['Tiefkühl', ['tiefkühl', ' tk-', ' tk ', ' eis ', 'speiseeis', 'eiscreme', 'pizza', 'pommes', 'fischstäbchen', 'kroketten', 'rahmspinat', 'erbsen tk']],
  ['Alkohol', ['bier', ' wein', 'rotwein', 'weißwein', 'rosé', 'glühwein', 'sekt', 'prosecco', 'schnaps', 'wodka', 'whisky', ' rum ', ' gin ', 'likör', 'radler', 'aperol', 'champagner']],
  ['Getränke', ['saft', 'wasser', 'sprudel', 'limo', 'cola', 'fanta', 'sprite', 'schorle', 'eistee', 'smoothie', 'getränk', ' mate ', 'energy']],
  ['Drogerie', ['zahnpasta', 'zahncreme', 'zahnbürste', 'zahnseide', 'shampoo', 'duschgel', 'seife', 'deo', 'handcreme', 'hautcreme', 'gesichtscreme', 'lotion', 'windel', 'feuchttücher', 'rasier', 'tampon', 'binden', 'slipeinlage', 'pflaster', 'kosmetik', 'make-up', 'wattepad', 'wattestäbchen', 'taschentücher', 'sonnencreme', 'haargel', 'spülung', 'mundspül', 'vitamin', 'kondom', 'nagel']],
  ['Haushalt', ['klopapier', 'toilettenpapier', 'küchenrolle', 'küchenpapier', 'spülmittel', 'spültabs', 'tabs', 'waschmittel', 'weichspüler', 'müllbeutel', 'müllsack', 'alufolie', 'frischhaltefolie', 'backpapier', 'schwamm', 'putzmittel', 'reiniger', 'batterie', 'glühbirne', 'kerze', 'servietten', 'gefrierbeutel', 'entkalker', 'lappen', 'tücher']],
  ['Fisch', ['lachs', 'thunfisch', 'forelle', 'hering', 'matjes', 'garnele', 'krabbe', 'shrimp', 'fisch', 'seelachs', 'kabeljau', 'makrele', 'sardine', 'scampi']],
  ['Fleisch & Wurst', ['fleisch', 'hack', 'schnitzel', 'steak', 'wurst', 'würst', 'salami', 'schinken', 'speck', 'bacon', 'hähnchen', 'hühnchen', 'pute', 'rind', 'schwein', 'kotelett', 'gulasch', 'braten', 'filet', 'leberkäs', 'aufschnitt', 'frikadelle', 'bratwurst', 'mett', 'kassler', 'chorizo', 'lamm', 'geflügel']],
  ['Käse', ['käse', 'gouda', 'emmentaler', 'parmesan', 'mozzarella', 'feta', 'camembert', 'brie', 'cheddar', 'gorgonzola', 'raclette', 'halloumi', 'bergkäse', 'edamer', 'grana']],
  ['Milchprodukte & Eier', ['milch', 'joghurt', 'jogurt', 'quark', 'sahne', 'schmand', 'butter', 'margarine', 'eier', ' ei ', 'kefir', 'buttermilch', 'pudding', 'skyr', 'crème fraîche', 'creme fraiche', 'frischkäse', 'mascarpone', 'ricotta', 'hafermilch', 'sojamilch']],
  ['Brot & Gebäck', ['brot', 'brötchen', 'toast', 'baguette', 'croissant', 'laugen', 'brezel', 'kuchen', 'zwieback', 'knäcke', 'wrap', 'tortilla', 'ciabatta', 'semmel', 'gebäck', 'berliner', 'franzbrötchen']],
  ['Frühstück & Cerealien', ['müsli', 'hirse', 'porridge', 'dinkelflocken', 'cornflakes', 'flakes', 'haferflocken', 'cerealien', 'granola', 'marmelade', 'konfitüre', 'honig', 'nutella', 'aufstrich', 'kaffee', 'tee', 'kakao', 'espresso', 'erdnussbutter']],
  ['Süßes & Snacks', ['schokolade', 'schoko', 'chips', 'kekse', 'keks', 'gummi', 'bonbon', 'süßigkeit', 'riegel', 'nüsse', 'erdnüsse', 'salzstangen', 'popcorn', 'cracker', 'lakritz', 'praline', 'waffel']],
  ['Backen & Gewürze', ['mehl', 'zucker', 'backpulver', 'hefe', 'vanille', 'salz', 'pfeffer', 'gewürz', 'paprikapulver', 'zimt', 'öl', 'essig', 'senf', 'ketchup', 'mayo', 'brühe', 'oregano', 'basilikum getr', 'curry', 'stärke', 'speisestärke', 'kakaopulver', 'puderzucker', 'sojasoße', 'sojasauce']],
  ['Nudeln, Reis & Konserven', ['nudel', 'spaghetti', 'penne', 'fusilli', 'lasagne', 'tortellini', 'reis', 'couscous', 'bulgur', 'linsen', 'kichererbsen', 'bohnen dose', 'dose', 'konserve', 'passierte', 'tomatenmark', 'pesto', 'soße', 'sauce', 'suppe', 'mais dose', 'quinoa', 'gnocchi', 'spätzle', 'polenta']],
  ['Obst', ['apfel', 'äpfel', 'banane', 'birne', 'orange', 'mandarine', 'clementine', 'zitrone', 'limette', 'traube', 'erdbeer', 'himbeer', 'heidelbeer', 'blaubeer', 'kiwi', 'mango', 'ananas', 'melone', 'pfirsich', 'nektarine', 'pflaume', 'kirsche', 'obst', 'grapefruit', 'avocado', 'granatapfel', 'beeren']],
  ['Gemüse', ['tomate', 'gurke', 'paprika', 'salat', 'karotte', 'möhre', 'zwiebel', 'knoblauch', 'kartoffel', 'zucchini', 'aubergine', 'brokkoli', 'blumenkohl', 'kohl', 'spinat', 'lauch', 'porree', 'sellerie', 'pilz', 'champignon', 'radieschen', 'rucola', 'spargel', 'kürbis', 'mais', 'erbsen', 'bohnen', 'ingwer', 'petersilie', 'schnittlauch', 'basilikum', 'dill', 'kräuter', 'gemüse', 'rote bete', 'fenchel', 'süßkartoffel', 'frühlingszwiebel', 'chili']]
];
export function shopCat(name: string): ShopCat {
  const n = ` ${name.toLowerCase()} `;
  for (const [cat, words] of RULES) if (words.some(w => n.includes(w))) return cat;
  return 'Sonstiges';
}
export const catOf = (x: { name: string; cat?: string | null }): ShopCat => (SHOP_CATS as readonly string[]).includes(x.cat ?? '') ? x.cat as ShopCat : shopCat(x.name);
export const catRank = (x: { name: string; cat?: string | null }) => SHOP_CATS.indexOf(catOf(x));
