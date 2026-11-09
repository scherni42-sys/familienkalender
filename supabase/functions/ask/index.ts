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
  required: ['answer', 'events', 'birthdays', 'receipts', 'action', 'target', 'new_text'],
  properties: {
    answer: { type: 'string', description: 'Kurze, freundliche Antwort auf Deutsch (1 bis 3 Sätze), duzen. Bei Listen nur zusammenfassen, die Termine zeigt die App darunter.' },
    events: { type: 'array', items: { type: 'integer' }, description: 'Nummern (#) der passenden Termine, chronologisch, höchstens 30' },
    birthdays: { type: 'array', items: { type: 'integer' }, description: 'Nummern (G#) passender Geburtstage' },
    receipts: { type: 'array', items: { type: 'integer' }, description: 'Nummern (B#) passender Belege aus dem Kassenbuch, neueste zuerst, höchstens 30' },
    action: { type: 'string', enum: ['none', 'open', 'edit', 'new', 'bdays'], description: 'open: einen Termin anzeigen · edit: einen Termin bearbeiten · new: neuen Termin anlegen · bdays: Geburtstage öffnen · none: nur antworten' },
    target: { type: ['integer', 'null'], description: 'Nummer des Termins für open/edit' },
    new_text: { type: ['string', 'null'], description: 'Bei new: der Terminwunsch als Satz, z. B. „Freitag 15 Uhr Zahnarzt Mia“' }
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
- Fragen zu Ausgaben, Einkäufen, Rechnungen oder Belegen beantwortest du aus dem Kassenbuch: rechne Summen genau aus und nenne sie in Euro (z. B. „123,45 €“), die passenden Belege kommen in receipts. Fremde Belege zählen nur mit ihrem Familienanteil.
- Fragen nach Rechnungen an eine Firma oder Person beantwortest du über „an …“ (Rechnungsempfänger) und „Firma …“ (zugeordnete Firma); Schreibweisen dürfen leicht abweichen.
- Erfinde nichts. Findest du nichts Passendes, sag das freundlich und schlage eine andere Formulierung vor.
- Datumsangaben in der Antwort deutsch, z. B. „Freitag, 6. November, 17 Uhr“.`,
        cache_control: { type: 'ephemeral' }
      }],
      messages: [{ role: 'user', content: q.trim() }]
    });

    if (response.stop_reason === 'refusal') throw new Error('abgelehnt');
    const block = response.content.find(b => b.type === 'text');
    if (!block || block.type !== 'text') throw new Error('Keine Antwort');
    return json({ result: JSON.parse(block.text) });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 400);
  }
});
