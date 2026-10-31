// Edge Function: versteht einen gesprochenen Satz oder ein Foto (Zettel, Brief, Einladung) und macht daraus einen Termin-Vorschlag.
// Secret setzen: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// Nur angemeldete Familienmitglieder dürfen die Funktion nutzen (Prüfung im Code, „Verify JWT“ kann aus bleiben).
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
  required: ['title', 'date', 'end_date', 'all_day', 'start_min', 'end_min', 'persons', 'driver', 'vis', 'reason', 'place', 'addr', 'bring', 'discreet'],
  properties: {
    title: { type: 'string', description: 'Kurzer Titel, z. B. „Fußballtraining“' },
    date: { type: 'string', description: 'Datum YYYY-MM-DD' },
    end_date: { type: 'string', description: 'Letzter Tag YYYY-MM-DD, bei eintägigen Terminen gleich date' },
    all_day: { type: 'boolean', description: 'true, wenn keine Uhrzeit genannt wurde' },
    start_min: { type: 'integer', description: 'Beginn in Minuten nach Mitternacht' },
    end_min: { type: 'integer', description: 'Ende in Minuten nach Mitternacht; ohne Angabe Beginn + 60' },
    persons: { type: 'array', items: { type: 'string' }, description: 'IDs der betroffenen Familienmitglieder' },
    driver: { type: ['string', 'null'], description: 'ID der Person, die fährt oder bringt' },
    vis: { type: 'string', enum: ['family', 'private'] },
    reason: { type: 'string', description: 'Kurze Begründung für vis, z. B. „Mia ist betroffen“' },
    place: { type: 'string' },
    addr: { type: 'string', description: 'Adresse, falls genannt' },
    bring: { type: 'array', items: { type: 'string' }, description: 'Was mitgebracht werden soll' },
    discreet: { type: 'boolean', description: 'true bei Arzt- oder Therapieterminen' }
  }
};

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const auth = req.headers.get('Authorization') ?? '';
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { data: u } = await sb.auth.getUser(auth.replace(/^Bearer /, ''));
    const { data: mine } = u.user ? await sb.from('members').select('id').eq('user_id', u.user.id).eq('active', true).limit(1) : { data: null };
    if (!mine?.length) return new Response(JSON.stringify({ error: 'Nicht angemeldet' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } });
    const { text = '', today, me, members, image } = await req.json();
    // Foto: verkleinertes JPEG als Base64 vom Handy
    const img = image && typeof image.data === 'string' && image.data.length < 4_000_000 && /^image\/(jpeg|png|webp)$/.test(image.type) ? image : null;
    if (typeof text !== 'string' || text.length > 500 || (!text.trim() && !img)) throw new Error('Kein Text');
    const people = (members as { id: string; name: string; role: string }[]).map(m => `- ${m.name} (ID ${m.id}, ${m.role})`).join('\n');
    const speaker = (members as { id: string; name: string }[]).find(m => m.id === me)?.name ?? 'unbekannt';

    const response = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      system: `Du trägst Termine in einen Familienkalender ein. Heute ist ${today}. Es spricht ${speaker} (ID ${me}).
Familienmitglieder:
${people}
Regeln: „ich/mich/mein“ meint die sprechende Person. Mama, Papa, Oma usw. ordnest du dem passenden Mitglied zu, wenn es eindeutig ist.
Wochentage meinen das nächste kommende Datum. Ohne Uhrzeit ist der Termin ganztägig.
vis ist „family“, wenn andere Mitglieder betroffen sind oder jemand anderes fährt, sonst „private“; bei „privat“ im Satz immer „private“.
Wer fährt, bringt oder abholt, ist driver und gehört nicht zu persons, außer er nimmt selbst teil.
Ein Datum ohne Jahr meint das nächste kommende Datum. Bei einem Foto liest du den Termin aus Handschrift, Brief, Einladung oder Screenshot; stehen mehrere Termine darauf, nimm den ersten.`,
      messages: [{
        role: 'user',
        content: img
          ? [{ type: 'image', source: { type: 'base64', media_type: img.type, data: img.data } },
             { type: 'text', text: text.trim() || 'Trage den Termin von diesem Foto ein.' }]
          : text
      }]
    });

    if (response.stop_reason === 'refusal') throw new Error('abgelehnt');
    const block = response.content.find(b => b.type === 'text');
    if (!block || block.type !== 'text') throw new Error('Keine Antwort');
    const event = JSON.parse(block.text);
    return new Response(JSON.stringify({ event }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (e) {
    // Die App fällt dann auf die einfache Erkennung auf dem Handy zurück
    return new Response(JSON.stringify({ error: String(e instanceof Error ? e.message : e) }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});
