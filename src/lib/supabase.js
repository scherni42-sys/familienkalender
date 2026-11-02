import { createClient } from '@supabase/supabase-js';
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
// Ohne Supabase-Zugangsdaten läuft die App im Demo-Modus (Daten nur in diesem Browser)
export const supabase = url && key ? createClient(url, key) : null;
export const DEMO = !supabase;
// Für den Widget-Code der Android-App (der Schlüssel ist öffentlich, die Rechte regelt die Datenbank)
export const SUPA = { url: url ?? '', key: key ?? '' };
// Adresse eines Board-Fotos
// Avatar nur zeigen, wenn eingeschaltet („off:“ = ausgeschaltet)
export const avatarOf = (m) => (m?.avatar && !m.avatar.startsWith('off:') ? boardImg(m.avatar) : null);
export const boardImg = (p) => (/^(data:|https?:)/.test(p) ? p : `${url}/storage/v1/object/public/board/${p}`);
