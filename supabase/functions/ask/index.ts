// Edge Function „ask“: die Zaubertaste. Beantwortet Fragen zu den Familienterminen
// („Wann treffe ich Tom das nächste Mal?“, „Alle Termine mit Tom“) und zum Kassenbuch („Was habe ich im Oktober getankt?“) und erkennt Wünsche wie „Termin bearbeiten“ oder „neuer Termin“.
// Die App schickt nur die Termine, Geburtstage und Belege mit, die die fragende Person ohnehin sehen darf.
import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';

const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'events', 'birthdays', 'receipts', 'action', 'target', 'new_text', 'dish', 'servings', 'dest', 'board_text', 'board_private', 'web_query'],
  properties: {
    answer: { type: 'string', description: 'Kurze, freundliche Antwort auf Deutsch (1 bis 3 Sätze), duzen. Bei Listen nur zusammenfassen, die Termine zeigt die App darunter.' },
    events: { type: 'array', items: { type: 'integer' }, description: 'Nummern (#) der passenden Termine, chronologisch, höchstens 30' },
    birthdays: { type: 'array', items: { type: 'integer' }, description: 'Nummern (G#) passender Geburtstage' },
    receipts: { type: 'array', items: { type: 'integer' }, description: 'Nummern (B#) passender Belege aus dem Kassenbuch, neueste zuerst, höchstens 30' },
    action: { type: 'string', enum: ['none', 'open', 'edit', 'new', 'bdays', 'shop', 'nav', 'board', 'web'], description: 'open: einen Termin anzeigen · edit: einen Termin bearbeiten · new: neuen Termin anlegen · bdays: Geburtstage öffnen · shop: Zutaten für ein Gericht auf den Einkaufszettel · nav: Navigation mit Google Maps starten · board: Nachricht ans Familien-Board heften · web: im Internet bzw. auf der Flugtafel nachsehen · none: nur antworten' },
    target: { type: ['integer', 'null'], description: 'Nummer des Termins für open/edit' },
    new_text: { type: ['string', 'null'], description: 'Bei new: der Terminwunsch als Satz, z. B. „Freitag 15 Uhr Zahnarzt Mia“' },
    dish: { type: ['string', 'null'], description: 'Bei shop: das Gericht, so wie genannt, z. B. „Wiener Schnitzel mit Kartoffelstampf“' },
    servings: { type: ['integer', 'null'], description: 'Bei shop: für wie viele Personen, wenn genannt, sonst null' },
    dest: { type: ['string', 'null'], description: 'Bei nav: das Ziel als Suchbegriff für Google Maps, z. B. „Supermarkt“, „Sparkasse Winsen (Luhe)“, „Hamburg Hauptbahnhof“; „nächste“ weglassen. Bei einem Termin als Ziel dessen Adresse bzw. Ort.' },
    board_text: { type: ['string', 'null'], description: 'Bei board: der Text der Nachricht, als vollständiger Satz in der Form, wie er am Board stehen soll, ohne „schreib ans Board“' },
    board_private: { type: ['boolean', 'null'], description: 'Bei board: true, wenn die Nachricht nur für die fragende Person sein soll (privat, Erinnerung für mich), sonst false' },
    web_query: { type: ['string', 'null'], description: 'Bei web: die Frage für die Internetsuche, vollständig und mit echtem Datum, z. B. „Ankunft der Flüge aus Stuttgart in Berlin BER am Mittwoch, 25.11.2026, zwischen 6 und 12 Uhr“' }
  }
};

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { q = '', today, now, me, members = [], events = [], birthdays = [], receipts = [] } = await req.json();
    // Nur angemeldete Familienmitglieder
    const auth = req.headers.get('Authorization') ?? '';
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { data: u } = await sb.auth.getUser(auth.replace(/^Bearer /, ''));
    const { data: mine } = u.user ? await sb.from('members').select('id').eq('user_id', u.user.id).eq('active', true).limit(1) : { data: null };
    if (!mine?.length) return json({ error: 'Nicht angemeldet' }, 401);
    const { data: pro } = await sb.rpc('ai_allowed', {});
    if (pro !== true) return json({ error: 'Die KI-Funktionen gibt es in FamTO Pro.', pro: true }, 402);
    if (typeof q !== 'string' || !q.trim() || q.length > 500) throw new Error('Keine Frage');
    if (!Array.isArray(events) || events.length > 2500) throw new Error('Zu viele Termine');
    if (!Array.isArray(receipts) || receipts.length > 600) throw new Error('Zu viele Belege');

    const people = (members as { name: string; role: string }[]).map(m => `- ${m.name} (${m.role})`).join('\n');
    const speaker = (members as { id: string; name: string }[]).find(m => m.id === me)?.name ?? 'unbekannt';
    const evText = (events as string[]).map((l, i) => `#${i} ${String(l).slice(0, 300)}`).join('\n');
    const bdText = (birthdays as string[]).map((l, i) => `G${i} ${String(l).slice(0, 120)}`).join('\n');
    const rcText = (receipts as string[]).map((l, i) => `B${i} ${String(l).slice(0, 700)}`).join('\n');

    const response = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: receipts.length ? 'medium' : 'low', format: { type: 'json_schema', schema } },
      system: [{
        type: 'text',
        text: `Du bist der Assistent im Familienkalender FamTO. Heute ist ${today}, jetzt ${now} Uhr. Es fragt ${speaker}.
Familienmitglieder:
${people}

Termine (Nummer, Datum, Zeit, Titel, Personen, Fahrer, Ort, Notiz):
${evText || '(keine)'}

Geburtstage:
${bdText || '(keine)'}

Belege im Kassenbuch (Nummer, Datum, Händler, Betrag brutto, wer, Zuordnung bzw. „Firma …“, Kategorie, Rechnung, Rechnungssteller „von …“, Rechnungsempfänger „an …“, Zahlart, Gruppe, Positionen, Notiz):
${rcText || '(keine)'}

Regeln:
- „ich/mich/mein“ meint ${speaker}. Personen außerhalb der Familie (z. B. Tom) findest du über Titel, Ort und Notiz.
- „nächste Mal“ heißt: der früheste Termin ab jetzt. „Übersicht/alle“: alle passenden, vergangene nur, wenn danach gefragt wird.
- Wer etwas ändern, verschieben oder bearbeiten will, bekommt action „edit“ mit dem passenden Termin. Bei Geburtstagen (nicht Geburtstagsfeiern im Kalender) action „bdays“.
- Wer einen neuen Termin eintragen will, bekommt action „new“ und new_text.
- Wer für ein Gericht einkaufen, es kochen oder die Zutaten auf den Einkaufszettel haben will („Einkaufen für Wiener Schnitzel mit Kartoffelstampf“, „Lasagne für 6 Personen“), bekommt action „shop“ mit dish und servings; answer dann kurz, z. B. „Ich schreibe dir die Zutaten auf den Einkaufszettel.“ Fragen nach vergangenen Einkäufen gehören dagegen zum Kassenbuch.
- Fragen zu Ausgaben, Einkäufen, Rechnungen oder Belegen beantwortest du aus dem Kassenbuch: rechne Summen genau aus und nenne sie in Euro (z. B. „123,45 €“), die passenden Belege kommen in receipts. Fremde Belege zählen nur mit ihrem Familienanteil.
- Fragen nach Rechnungen an eine Firma oder Person beantwortest du über „an …“ (Rechnungsempfänger) und „Firma …“ (zugeordnete Firma); Schreibweisen dürfen leicht abweichen.
- Wer irgendwohin geführt, navigiert, geschickt oder gebracht werden will oder den Weg wissen möchte („Führe mich zum nächsten Supermarkt“, „Kannst du mich zur Sparkasse in Winsen schicken“, „Wie komme ich zu Omas Geburtstag“), bekommt action „nav“ mit dest; answer kurz, z. B. „Ich starte die Route zur Sparkasse in Winsen.“ Sag nie, dass du nicht navigieren kannst: die App öffnet Google Maps.
- Wer etwas ans Board, an die Pinnwand oder als Nachricht an die Familie schreiben will oder eine private Erinnerung/Notiz für sich möchte, bekommt action „board“ mit board_text und board_private.
- Wissensfragen, die nicht aus Terminen, Geburtstagen oder Kassenbuch zu beantworten sind (Flüge, Züge, Öffnungszeiten, Wetter, Veranstaltungen, Ergebnisse, Fakten), bekommen action „web“ mit web_query; answer leer lassen. Steht der passende Flug schon im Kalender, nimm die Flugnummer daraus in web_query auf.
- Erfinde nichts. Findest du nichts Passendes, sag das freundlich und schlage eine andere Formulierung vor.
- Datumsangaben in der Antwort deutsch, z. B. „Freitag, 6. November, 17 Uhr“.`,
        cache_control: { type: 'ephemeral' }
      }],
      messages: [{ role: 'user', content: q.trim() }]
    });

    if (response.stop_reason === 'refusal') throw new Error('abgelehnt');
    const block = response.content.find(b => b.type === 'text');
    if (!block || block.type !== 'text') throw new Error('Keine Antwort');
    const result = JSON.parse(block.text);
    // Wissensfrage: die Funktion „websuche“ sieht im Internet bzw. auf der Flugtafel nach (sparsam, Claude Haiku 5.5).
    // Die App zeigt die Antwort wie jede andere; action wird „none“, damit auch ältere App-Versionen sie anzeigen.
    if (result.action === 'web' && result.web_query) {
      const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/websuche`, {
        method: 'POST',
        headers: { Authorization: auth, apikey: Deno.env.get('SUPABASE_ANON_KEY')!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: result.web_query, today, now })
      });
      const w = await r.json().catch(() => null) as { result?: { text: string; quellen: { titel: string; url: string }[]; termin: string | null }; error?: string } | null;
      const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
      if (w?.result) {
        const src = w.result.quellen.map(q => host(q.url)).filter(Boolean);
        result.answer = w.result.text + (src.length ? ` (Quelle: ${[...new Set(src)].join(', ')})` : '');
        result.web = w.result;
      } else result.answer = w?.error ?? 'Die Internetsuche hat gerade nicht geklappt. Bitte gleich noch einmal.';
      result.action = 'none';
    }
    return json({ result });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 400);
  }
});
