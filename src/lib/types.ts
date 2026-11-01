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
}

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

export interface Message {
  id: string;
  from_member: string;
  text: string;
  created_at: string;
  pinned: boolean;
  done: boolean;
  taker: string | null;
  via: string | null;
  image?: string | null; // Foto am Board: Pfad im Speicher (oder data:-URL in der Demo)
  replies: Reply[];
}

export interface Birthday { id: string; name: string; rel: string; day: number; month: number; year: number | null; owner?: string | null; ext_id?: string | null }

export interface DisplayDevice { id: string; name: string; token: string }

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
}

export const DEFAULT_SETTINGS: Settings = {
  bdLead: 14, ttlHours: 24, split: 14 * 60, pastMode: 'fade', showTravel: true,
  home: '', buffer: 5, remind: 10, ahead: 6, boardMode: 'dynamic', wbg: ''
};

export interface Snapshot {
  family: { id: string; name: string; settings: Settings } | null;
  me: string | null;
  members: Member[];
  events: CalEvent[];
  busy: BusySlot[];
  messages: Message[];
  birthdays: Birthday[];
  displays: DisplayDevice[];
}

export type NewEvent = Omit<CalEvent, 'id' | 'owner'>;

// Was die Display-Seite bekommt: nur Familientermine, nie private Details
export interface DisplayFeed {
  family: { name: string; settings: Settings };
  members: Pick<Member, 'id' | 'name' | 'color'>[];
  events: CalEvent[];
  messages: Message[];
  birthdays: Birthday[];
}
