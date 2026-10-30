import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// Ohne Supabase-Zugangsdaten läuft die App im Demo-Modus (Daten nur in diesem Browser)
export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;
export const DEMO = !supabase;
// Für den Widget-Code der Android-App (der Schlüssel ist öffentlich, die Rechte regelt die Datenbank)
export const SUPA = { url: url ?? '', key: key ?? '' };
