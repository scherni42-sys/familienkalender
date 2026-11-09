export type Role = 'admin' | 'member' | 'child' | 'guest';
export type Vis = 'family' | 'private' | 'busy';

export interface Member {
  id: string;
  name: string;
  role: Role;
  color: string;
  adult: boolean;
  linked: boolean; // hat ein Handy mit der App verbunden
  app_bg: string | null;
  avatar?: string | null;
}

export type Trip = 'hin' | 'ab' | 'beides';

export interface CalEvent {
  id: string;
  owner: string;
  ext_id?: string | null; // aus dem Handy-Kalender übernommen; „w:…“ = beruflicher Kalender
  title: string;
  date: string; // YYYY-MM-DD
  end_date: string;
  all_day: boolean;
  start_min: number;
  end_min: number;
  persons: string[];
  driver: string | null;
  vis: Vis;
  place: string;
  addr: string;
  travel_min: number | null;
  eta?: string | null; // Fahrer ist unterwegs: voraussichtliche Ankunft
  eta_by?: string | null; // wer gerade fährt (Hinfahrt oder Abholung)
  files?: FileRef[]; // angehängte Dokumente
  arrived_at?: string | null; // „Angekommen“ gemeldet
  trip?: Trip; // hin: zum Beginn bringen · ab: zum Ende abholen · beides: driver bringt, driver2 holt ab
  driver2?: string | null;
  driver_by?: string | null; // wer den Fahrer eingetragen hat
  driver_ok?: boolean | null; // Fahrer hat zugesagt
  driver2_ok?: boolean | null;
  declined_by?: string | null; // wer abgesagt hat („Kann nicht“)
  notes: string;
  bring: string[];
  discreet: boolean;
}

// Private Termine mit „belegt“: Die Familie sieht nur Zeit und Person, keine Details
export interface BusySlot {
  id: string;
  owner: string;
  date: string;
  end_date: string;
  all_day: boolean;
  start_min: number;
  end_min: number;
}

export interface Reply { id: string; from_member: string; text: string; created_at: string }

// Angehängtes Dokument: liegt im privaten Speicher „files“ (in der Beispielfamilie als data:-URL)
export type FileRef = { path: string; name: string; type: string; size: number };

export interface Message {
  id: string;
  from_member: string;
  text: string;
  created_at: string;
  pinned: boolean;
  done: boolean;
  taker: string | null;
  via: string | null;
  files?: FileRef[];
  image?: string | null; // Foto am Board: Pfad im Speicher (oder data:-URL in der Demo)
  replies: Reply[];
}

export interface Birthday { id: string; name: string; rel: string; day: number; month: number; year: number | null; owner?: string | null; ext_id?: string | null; files?: FileRef[] }

export interface DisplayDevice { id: string; name: string; token: string; touch?: boolean }

export interface Settings {
  bdLead: number;
  ttlHours: number;
  split: number; // Minuten; 0 = Vorschau immer
  pastMode: 'fade' | 'hide';
  showTravel: boolean;
  home: string;
  buffer: number;
  remind: number;
  ahead: number;
  boardMode: 'dynamic' | 'fixed';
  wbg: string;
  tall?: string[]; // Displays (id), die hochkant hängen
  chatDays: number; // Chat-Nachrichten verschwinden nach 1 bis 30 Tagen
}

export const DEFAULT_SETTINGS: Settings = {
  bdLead: 14, ttlHours: 24, split: 14 * 60, pastMode: 'fade', showTravel: true,
  home: '', buffer: 5, remind: 10, ahead: 6, boardMode: 'dynamic', wbg: '', chatDays: 7
};

export type Plan = 'basis' | 'pro';

export interface Snapshot {
  // plan: FamTO (basis, ohne KI) oder FamTO Pro; tester: Familie darf zum Ausprobieren selbst umschalten
  family: { id: string; name: string; settings: Settings; plan?: Plan; tester?: boolean } | null;
  me: string | null;
  members: Member[];
  events: CalEvent[];
  busy: BusySlot[];
  messages: Message[];
  birthdays: Birthday[];
  displays: DisplayDevice[];
  // Chat von Person zu Person: nur eigene (gesendet oder empfangen), nie auf dem Display
  chats?: ChatMsg[];
}

export type ChatKind = 'text' | 'image' | 'voice' | 'place';
export interface ChatMsg { id: string; from_member: string; to_member: string; kind: ChatKind; text: string; media: string | null; dur: number | null; lat: number | null; lon: number | null; created_at: string; read_at: string | null }
export type ChatOut = { kind: ChatKind; text?: string; blob?: Blob; name?: string; dur?: number; lat?: number; lon?: number };

export type NewEvent = Omit<CalEvent, 'id' | 'owner'>;

// Was die Display-Seite bekommt: nur Familientermine, nie private Details
export interface DisplayFeed {
  touch?: boolean;
  family: { name: string; settings: Settings };
  members: (Pick<Member, 'id' | 'name' | 'color'> & { avatar?: string | null; role?: Member['role'] })[];
  events: CalEvent[];
  messages: Message[];
  birthdays: Birthday[];
}
