import { useSyncExternalStore } from 'react';
import type { Birthday, CalEvent, DisplayFeed, Member, Message, NewEvent, Role, Settings, Snapshot } from './types';
import { DEFAULT_SETTINGS } from './types';
import { supabase } from './supabase';
import { seed } from './seed';
import { addDays, today } from './dates';

const EMPTY: Snapshot = { family: null, me: null, members: [], events: [], busy: [], messages: [], birthdays: [], displays: [] };

export interface MemberInput { name: string; role: Role; color: string; adult: boolean }

// Eine Schnittstelle, zwei Umsetzungen: Supabase (echt, für alle Handys) und Demo (nur dieser Browser)
export interface Store {
  readonly demo: boolean;
  get(): Snapshot;
  ready(): boolean;
  subscribe(cb: () => void): () => void;
  init(): Promise<void>;
  createFamily(familyName: string, myName: string, color: string): Promise<void>;
  joinWithCode(code: string): Promise<void>;
  reclaim(code: string): Promise<void>;
  loadExample(): Promise<void>;
  saveEvent(e: NewEvent, editId?: string): Promise<string>;
  setEta(id: string, eta: string | null, driver?: string | null): Promise<void>;
  driverAnswer(id: string, ok: boolean): Promise<void>;
  deleteEvent(id: string): Promise<void>;
  deleteMessage(id: string): Promise<void>;
  postMessage(text: string, image?: { type: string; data: string }): Promise<void>;
  setAvatar(id: string, image: { type: string; data: string } | null): Promise<void>;
  useAvatar(id: string, on: boolean): Promise<void>;
  reply(id: string, text: string): Promise<void>;
  setMessage(id: string, patch: Partial<Pick<Message, 'pinned' | 'done' | 'taker' | 'text'>>): Promise<void>;
  addMember(m: MemberInput): Promise<string>;
  updateMember(id: string, patch: Partial<Pick<Member, 'name' | 'role' | 'color' | 'adult' | 'app_bg'>>): Promise<void>;
  removeMember(id: string): Promise<void>;
  createInvite(memberId: string): Promise<string>;
  addBirthday(b: Omit<Birthday, 'id'>): Promise<void>;
  removeBirthday(id: string): Promise<void>;
  updateBirthday(old: Birthday, b: Omit<Birthday, 'id'>): Promise<void>;
  updateSettings(patch: Partial<Settings>): Promise<void>;
  addDisplay(name: string): Promise<void>;
  widgetToken(): Promise<string>;
  removeDisplay(id: string): Promise<void>;
  setDisplayTouch(id: string, touch: boolean): Promise<void>;
  displayFeed(token: string): Promise<DisplayFeed | null>;
  // Eingabe am Display: Person tippt ihren Avatar an, Display-Code erlaubt das Speichern
  displayPost(token: string, member: string, text: string): Promise<void>;
  displaySaveEvent(token: string, member: string, ev: NewEvent): Promise<void>;
  displayUpdateEvent(token: string, member: string, id: string, ev: Partial<NewEvent>): Promise<void>;
  displayDeleteEvent(token: string, member: string, id: string): Promise<void>;
  // nur Demo: zwischen den Familienmitgliedern umschalten
  switchUser?(id: string): void;
  reset(): Promise<void>;
}

abstract class Base {
  protected snap: Snapshot = EMPTY;
  protected isReady = false;
  private subs = new Set<() => void>();
  get = () => this.snap;
  ready = () => this.isReady;
  subscribe = (cb: () => void) => { this.subs.add(cb); return () => { this.subs.delete(cb); }; };
  protected emit(next: Snapshot) { this.snap = next; this.isReady = true; this.subs.forEach(f => f()); }
}

const uid = () => crypto.randomUUID();
const code6 = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');

/* ---------- Demo: alles im localStorage ---------- */
const KEY = 'familienkalender-demo-v1';
class LocalStore extends Base implements Store {
  readonly demo = true;
  private invites: Record<string, string> = {};
  private save(next: Snapshot) {
    try { localStorage.setItem(KEY, JSON.stringify({ snap: next, invites: this.invites })); } catch { /* privates Fenster */ }
    this.emit(next);
  }
  private patch(f: (s: Snapshot) => Partial<Snapshot>) { this.save({ ...this.snap, ...f(this.snap) }); }
  async init() {
    let stored: { snap: Snapshot; invites: Record<string, string> } | null = null;
    try { stored = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { stored = null; }
    if (stored?.snap) { this.invites = stored.invites || {}; this.emit({ ...EMPTY, ...stored.snap }); }
    else this.emit(EMPTY);
    // Andere Tabs (z. B. das Display) aktuell halten
    addEventListener('storage', e => { if (e.key === KEY) void this.init(); });
  }
  async createFamily(familyName: string, myName: string, color: string) {
    const me = uid();
    this.save({ ...EMPTY, family: { id: uid(), name: familyName, settings: { ...DEFAULT_SETTINGS } }, me,
      members: [{ id: me, name: myName, role: 'admin', color, adult: true, linked: true, app_bg: null }],
      displays: [{ id: uid(), name: 'Flur', token: 'demo' }] });
  }
  async joinWithCode(code: string) {
    const id = this.invites[code.trim().toUpperCase()];
    if (!id) throw new Error('Code unbekannt oder abgelaufen.');
    delete this.invites[code.trim().toUpperCase()];
    this.patch(s => ({ me: id, members: s.members.map(m => m.id === id ? { ...m, linked: true } : m) }));
  }
  async loadExample() { this.save(seed()); }
  async saveEvent(e: NewEvent, editId?: string) {
    // Anderer Fahrer: laufende Fahrt (Ankunftszeit) des bisherigen Fahrers endet
    if (editId) { this.patch(s => ({ events: s.events.map(x => x.id === editId ? { ...x, ...e, ...((x.driver ?? null) !== (e.driver ?? null) ? { eta: null } : {}) } : x) })); return editId; }
    const id = uid();
    this.patch(s => ({ events: [...s.events, { ...e, id, owner: s.me! } as CalEvent] }));
    return id;
  }
  async deleteEvent(id: string) { this.patch(s => ({ events: s.events.filter(x => x.id !== id) })); }
  async setEta(id: string, eta: string | null, driver?: string | null) {
    this.patch(s => ({ events: s.events.map(x => x.id === id ? { ...x, eta, eta_by: eta ? (driver ?? s.me) : null, arrived_at: eta ? null : x.eta ? new Date().toISOString() : x.arrived_at ?? null, ...(driver ? { driver } : {}) } : x) }));
  }
  async driverAnswer(id: string, ok: boolean) {
    this.patch(s => ({ events: s.events.map(x => x.id !== id ? x : x.driver === s.me
      ? (ok ? { ...x, driver_ok: true } : { ...x, driver: null, driver_ok: null, declined_by: s.me, eta: null })
      : (ok ? { ...x, driver2_ok: true } : { ...x, driver2: null, driver2_ok: null, declined_by: s.me })) }));
  }
  async deleteMessage(id: string) { this.patch(s => ({ messages: s.messages.filter(x => x.id !== id) })); }
  async postMessage(text: string, image?: { type: string; data: string }) {
    const img = image ? `data:${image.type};base64,${image.data}` : null;
    this.patch(s => ({ messages: [...s.messages, { id: uid(), from_member: s.me!, text, created_at: new Date().toISOString(), pinned: false, done: false, taker: null, via: null, image: img, replies: [] }] }));
  }
  async setAvatar(id: string, image: { type: string; data: string } | null) {
    this.patch(s => ({ members: s.members.map(m => m.id === id ? { ...m, avatar: image ? `data:${image.type};base64,${image.data}` : null } : m) }));
  }
  async useAvatar(id: string, on: boolean) {
    this.patch(s => ({ members: s.members.map(m => m.id === id && m.avatar ? { ...m, avatar: on ? m.avatar.replace(/^off:/, '') : 'off:' + m.avatar.replace(/^off:/, '') } : m) }));
  }
  async reply(id: string, text: string) {
    this.patch(s => ({ messages: s.messages.map(m => m.id === id ? { ...m, replies: [...m.replies, { id: uid(), from_member: s.me!, text, created_at: new Date().toISOString() }] } : m) }));
  }
  async setMessage(id: string, patch: Partial<Message>) {
    this.patch(s => ({ messages: s.messages.map(m => m.id === id ? { ...m, ...patch, ...(patch.pinned === false ? { created_at: new Date().toISOString() } : {}) } : m) }));
  }
  async addMember(m: MemberInput) { const id = uid(); this.patch(s => ({ members: [...s.members, { ...m, id, linked: false, app_bg: null }] })); return id; }
  async updateMember(id: string, patch: Partial<Member>) { this.patch(s => ({ members: s.members.map(m => m.id === id ? { ...m, ...patch } : m) })); }
  async removeMember(id: string) { this.patch(s => ({ members: s.members.filter(m => m.id !== id) })); }
  async createInvite(memberId: string) { const c = code6(); this.invites[c] = memberId; this.save(this.snap); return c; }
  async addBirthday(b: Omit<Birthday, 'id'>) { this.patch(s => ({ birthdays: [...s.birthdays, { ...b, id: uid() }] })); }
  async removeBirthday(id: string) { this.patch(s => ({ birthdays: s.birthdays.filter(b => b.id !== id) })); }
  async updateBirthday(old: Birthday, b: Omit<Birthday, 'id'>) { this.patch(s => ({ birthdays: s.birthdays.map(x => x.id === old.id ? { ...b, id: old.id } : x) })); }
  async updateSettings(patch: Partial<Settings>) { this.patch(s => ({ family: s.family && { ...s.family, settings: { ...s.family.settings, ...patch } } })); }
  async widgetToken() { return 'demo'; }
  async addDisplay(name: string) { this.patch(s => ({ displays: [...s.displays, { id: uid(), name, token: 'demo' }] })); }
  async removeDisplay(id: string) { this.patch(s => ({ displays: s.displays.filter(d => d.id !== id) })); }
  async setDisplayTouch(id: string, touch: boolean) { this.patch(s => ({ displays: s.displays.map(d => d.id === id ? { ...d, touch } : d) })); }
  async displayFeed(): Promise<DisplayFeed | null> {
    const s = this.snap;
    if (!s.family) return null;
    const until = addDays(today(), 8);
    return { touch: s.displays.some(d => d.touch), family: { name: s.family.name, settings: s.family.settings }, members: s.members.map(({ id, name, color, avatar, role }) => ({ id, name, color, avatar, role })),
      events: s.events.filter(e => e.vis === 'family' && e.end_date >= today() && e.date <= until), messages: s.messages, birthdays: s.birthdays };
  }
  async displayPost(_t: string, member: string, text: string) {
    this.patch(s => ({ messages: [...s.messages, { id: uid(), from_member: member, text, created_at: new Date().toISOString(), pinned: false, done: false, taker: null, via: 'Display', image: null, replies: [] }] }));
  }
  async displaySaveEvent(_t: string, member: string, ev: NewEvent) { this.patch(s => ({ events: [...s.events, { ...ev, id: uid(), owner: member, vis: 'family' } as CalEvent] })); }
  async displayUpdateEvent(_t: string, _m: string, id: string, ev: Partial<NewEvent>) { this.patch(s => ({ events: s.events.map(e => e.id === id ? { ...e, ...ev } : e) })); }
  async displayDeleteEvent(_t: string, _m: string, id: string) { this.patch(s => ({ events: s.events.filter(e => e.id !== id) })); }
  switchUser(id: string) { this.patch(() => ({ me: id })); }
  async reclaim(_code: string) { throw new Error('Im Demo-Modus nicht möglich.'); }
  async reset() { try { localStorage.removeItem(KEY); } catch { /* egal */ } this.invites = {}; this.emit(EMPTY); }
}

/* ---------- Supabase ---------- */
// Datenbank ohne die neuen Fahrdienst-Spalten: ohne sie speichern
const old = <T extends object>(x: T) => { const { trip: _t, driver2: _d, ...rest } = x as T & { trip?: unknown; driver2?: unknown }; return rest; };

class SupabaseStore extends Base implements Store {
  readonly demo = false;
  private sb = supabase!;
  private familyId: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private channel: ReturnType<typeof this.sb.channel> | null = null;

  private async user() {
    const { data } = await this.sb.auth.getSession();
    if (data.session) return data.session.user.id;
    const { data: d2, error } = await this.sb.auth.signInAnonymously();
    if (error || !d2.user) throw new Error('Anmeldung fehlgeschlagen. Sind anonyme Anmeldungen in Supabase aktiviert?');
    return d2.user.id;
  }
  // Konto mit dem persönlichen Widget-Code (FK1:…) zurückholen
  async reclaim(code: string) {
    let t = '';
    try { t = JSON.parse(atob(code.trim().replace(/^FK1:/, '').trim())).t; } catch { /* unten */ }
    if (!t) throw new Error('Das ist kein gültiger Widget-Code. Er beginnt mit FK1:');
    await this.user();
    this.ok(await this.sb.rpc('reclaim_member', { p_token: t }));
    await this.load();
  }
  private ok<T>(r: { data: T; error: { message: string } | null }) { if (r.error) throw new Error(r.error.message); return r.data; }

  async init() {
    const { data } = await this.sb.auth.getSession();
    if (!data.session) { this.emit(EMPTY); return; }
    await this.load();
  }
  private async load() {
    const userId = (await this.sb.auth.getSession()).data.session?.user.id;
    if (!userId) { this.emit(EMPTY); return; }
    const mine = this.ok(await this.sb.from('members').select('id, family_id').eq('user_id', userId).eq('active', true).limit(1));
    if (!mine?.length) { this.emit(EMPTY); return; }
    const fam = mine[0].family_id as string, me = mine[0].id as string;
    this.familyId = fam;
    const [f, mem, ev, busy, msg, rep, bd, disp] = await Promise.all([
      this.sb.from('families').select('id, name, settings').eq('id', fam).single(),
      this.sb.from('members').select('id, name, role, color, adult, user_id, app_bg, avatar').eq('family_id', fam).eq('active', true).order('created_at'),
      this.sb.from('events').select('*').eq('family_id', fam).gte('end_date', addDays(today(), -62)),
      this.sb.rpc('busy_slots', { fam }),
      this.sb.from('messages').select('*').eq('family_id', fam).order('created_at'),
      this.sb.from('replies').select('*').eq('family_id', fam).order('created_at'),
      this.sb.from('birthdays').select('*').eq('family_id', fam),
      this.sb.from('displays').select('*').eq('family_id', fam)
    ]);
    const family = this.ok(f) as { id: string; name: string; settings: Partial<Settings> };
    const replies = (this.ok(rep) ?? []) as { id: string; message_id: string; from_member: string; text: string; created_at: string }[];
    this.emit({
      family: { id: family.id, name: family.name, settings: { ...DEFAULT_SETTINGS, ...family.settings } },
      me,
      members: ((this.ok(mem) ?? []) as (Member & { user_id: string | null })[]).map(({ user_id, ...m }) => ({ ...m, linked: !!user_id, app_bg: m.id === me ? m.app_bg : null })),
      events: (this.ok(ev) ?? []) as CalEvent[],
      busy: (this.ok(busy) ?? []) as Snapshot['busy'],
      messages: ((this.ok(msg) ?? []) as Omit<Message, 'replies'>[]).map(m => ({ ...m, replies: replies.filter(r => r.message_id === m.id) })),
      birthdays: (this.ok(bd) ?? []) as Birthday[],
      displays: (this.ok(disp) ?? []) as Snapshot['displays']
    });
    this.listen(fam);
  }
  // Änderungen anderer Familienmitglieder kommen per Realtime; dann wird neu geladen
  private listen(fam: string) {
    if (this.channel) return;
    const again = () => { if (this.timer) clearTimeout(this.timer); this.timer = setTimeout(() => void this.load(), 400); };
    let ch = this.sb.channel(`family-${fam}`);
    for (const table of ['events', 'messages', 'replies', 'members', 'birthdays', 'families', 'displays']) {
      ch = ch.on('postgres_changes', { event: '*', schema: 'public', table, filter: table === 'families' ? `id=eq.${fam}` : `family_id=eq.${fam}` }, again);
    }
    this.channel = ch.subscribe();
    addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') again(); });
  }
  private refresh = () => this.load();

  async createFamily(familyName: string, myName: string, color: string) {
    await this.user();
    this.ok(await this.sb.rpc('create_family', { fam_name: familyName, my_name: myName, my_color: color }));
    await this.load();
  }
  async joinWithCode(code: string) {
    await this.user();
    this.ok(await this.sb.rpc('redeem_invite', { p_code: code.trim().toUpperCase() }));
    await this.load();
  }
  async loadExample() { throw new Error('Die Beispielfamilie gibt es nur im Demo-Modus.'); }
  async saveEvent(e: NewEvent, editId?: string) {
    if (editId) {
      // Anderer Fahrer: laufende Fahrt (Ankunftszeit) des bisherigen Fahrers endet
      const was = this.snap.events.find(x => x.id === editId);
      const patch = was && (was.driver ?? null) !== (e.driver ?? null) ? { ...e, eta: null } : e;
      let r = await this.sb.from('events').update(patch).eq('id', editId);
      if (r.error?.code === 'PGRST204') r = await this.sb.from('events').update(old(patch)).eq('id', editId);
      this.ok(r); await this.refresh(); return editId;
    }
    const ins = (x: object) => this.sb.from('events').insert({ ...x, family_id: this.familyId, owner: this.snap.me }).select('id').single();
    let r = await ins(e);
    if (r.error?.code === 'PGRST204') r = await ins(old(e));
    const row = this.ok(r) as { id: string };
    await this.refresh();
    return row.id;
  }
  async deleteEvent(id: string) { this.ok(await this.sb.from('events').delete().eq('id', id)); await this.refresh(); }
  async setEta(id: string, eta: string | null, driver?: string | null) {
    const base = driver ? { eta, driver } : { eta };
    const was = this.snap.events.find(x => x.id === id);
    // Mit Fahrer und „angekommen“-Zeit; ohne die neuen Spalten (ältere Datenbank) nur die Ankunftszeit
    const r = await this.sb.from('events').update({ ...base, eta_by: eta ? (driver ?? this.snap.me) : null, ...(eta ? { arrived_at: null } : was?.eta ? { arrived_at: new Date().toISOString() } : {}) }).eq('id', id);
    if (r.error) this.ok(await this.sb.from('events').update(base).eq('id', id));
    await this.refresh();
  }
  async driverAnswer(id: string, ok: boolean) { this.ok(await this.sb.rpc('driver_answer', { p_event: id, p_ok: ok })); await this.refresh(); }
  async deleteMessage(id: string) {
    const img = this.snap.messages.find(m => m.id === id)?.image;
    this.ok(await this.sb.from('messages').delete().eq('id', id));
    if (img && !/^(data:|https?:)/.test(img)) await this.sb.storage.from('board').remove([img]);
    await this.refresh();
  }
  async postMessage(text: string, image?: { type: string; data: string }) {
    let path: string | null = null;
    if (image) {
      const bytes = Uint8Array.from(atob(image.data), c => c.charCodeAt(0));
      path = `${this.familyId}/${crypto.randomUUID()}.jpg`;
      const up = await this.sb.storage.from('board').upload(path, new Blob([bytes], { type: image.type }), { contentType: image.type });
      if (up.error) throw new Error('Foto ließ sich nicht hochladen: ' + up.error.message);
    }
    this.ok(await this.sb.from('messages').insert({ family_id: this.familyId, from_member: this.snap.me, text, ...(path ? { image: path } : {}) }));
    await this.refresh();
  }
  async reply(id: string, text: string) { this.ok(await this.sb.from('replies').insert({ family_id: this.familyId, message_id: id, from_member: this.snap.me, text })); await this.refresh(); }
  async setMessage(id: string, patch: Partial<Message>) {
    // Lösen setzt die Uhr neu: die Nachricht bleibt danach noch die eingestellte Zeit stehen
    const p = patch.pinned === false ? { ...patch, created_at: new Date().toISOString() } : patch;
    this.ok(await this.sb.from('messages').update(p).eq('id', id)); await this.refresh();
  }
  // Avatar: rundes Foto im Speicher „board“ (Ordner der Familie); eigenes über set_my_avatar, andere als Admin.
  // „off:“ vor dem Pfad heißt: Foto bleibt gespeichert, wird aber nicht gezeigt (Häkchen „Avatar benutzen“ aus)
  private async writeAvatar(id: string, value: string | null) {
    if (id === this.snap.me) this.ok(await this.sb.rpc('set_my_avatar', { p_avatar: value }));
    else this.ok(await this.sb.from('members').update({ avatar: value }).eq('id', id));
  }
  async setAvatar(id: string, image: { type: string; data: string } | null) {
    const old = this.snap.members.find(m => m.id === id)?.avatar?.replace(/^off:/, '');
    let path: string | null = null;
    if (image) {
      const bytes = Uint8Array.from(atob(image.data), c => c.charCodeAt(0));
      path = `${this.familyId}/avatar-${crypto.randomUUID()}.jpg`;
      const up = await this.sb.storage.from('board').upload(path, new Blob([bytes], { type: image.type }), { contentType: image.type });
      if (up.error) throw new Error('Foto ließ sich nicht hochladen: ' + up.error.message);
    }
    await this.writeAvatar(id, path);
    if (old && !/^(data:|https?:)/.test(old)) await this.sb.storage.from('board').remove([old]);
    await this.refresh();
  }
  async useAvatar(id: string, on: boolean) {
    const cur = this.snap.members.find(m => m.id === id)?.avatar;
    if (!cur) return;
    const p = cur.replace(/^off:/, '');
    await this.writeAvatar(id, on ? p : 'off:' + p);
    await this.refresh();
  }
  async addMember(m: MemberInput) {
    const row = this.ok(await this.sb.from('members').insert({ ...m, family_id: this.familyId }).select('id').single()) as { id: string };
    await this.refresh(); return row.id;
  }
  async updateMember(id: string, patch: Partial<Member>) {
    if (id === this.snap.me && !('role' in patch) && !('name' in patch) && !('adult' in patch)) {
      const cur = this.snap.members.find(m => m.id === id)!;
      this.ok(await this.sb.rpc('update_my_member', { p_color: patch.color ?? cur.color, p_app_bg: patch.app_bg === undefined ? cur.app_bg : patch.app_bg }));
    } else this.ok(await this.sb.from('members').update(patch).eq('id', id));
    await this.refresh();
  }
  async removeMember(id: string) { this.ok(await this.sb.from('members').update({ active: false, user_id: null }).eq('id', id)); await this.refresh(); }
  async createInvite(memberId: string) { return this.ok(await this.sb.rpc('create_invite', { p_member: memberId })) as string; }
  async addBirthday({ owner, ...b }: Omit<Birthday, 'id'>) { this.ok(await this.sb.from('birthdays').insert({ ...b, ...(owner ? { owner } : {}), family_id: this.familyId })); await this.refresh(); }
  async removeBirthday(id: string) { this.ok(await this.sb.from('birthdays').delete().eq('id', id)); await this.refresh(); }
  // Ändern = neu eintragen, dann alten löschen (kommt ohne Update-Recht in der Datenbank aus; bei Fehler bleibt der alte)
  async updateBirthday(old: Birthday, { owner, ...b }: Omit<Birthday, 'id'>) {
    const keep = old.ext_id && old.owner === owner ? { ext_id: old.ext_id } : {};
    if (old.ext_id) this.ok(await this.sb.from('birthdays').delete().eq('id', old.id));
    this.ok(await this.sb.from('birthdays').insert({ ...b, ...keep, ...(owner ? { owner } : {}), family_id: this.familyId }));
    if (!old.ext_id) this.ok(await this.sb.from('birthdays').delete().eq('id', old.id));
    await this.refresh();
  }
  async updateSettings(patch: Partial<Settings>) {
    const settings = { ...this.snap.family!.settings, ...patch };
    this.ok(await this.sb.from('families').update({ settings }).eq('id', this.familyId)); await this.refresh();
  }
  async widgetToken() { return this.ok(await this.sb.rpc('my_widget_token', { fam: this.familyId })) as string; }
  async addDisplay(name: string) { this.ok(await this.sb.from('displays').insert({ family_id: this.familyId, name })); await this.refresh(); }
  async removeDisplay(id: string) { this.ok(await this.sb.from('displays').delete().eq('id', id)); await this.refresh(); }
  async setDisplayTouch(id: string, touch: boolean) { this.ok(await this.sb.from('displays').update({ touch }).eq('id', id)); await this.refresh(); }
  async displayFeed(token: string) {
    const { data, error } = await this.sb.rpc('display_feed', { p_token: token });
    if (error || !data) return null;
    const f = data as DisplayFeed;
    return { ...f, family: { ...f.family, settings: { ...DEFAULT_SETTINGS, ...f.family.settings } } };
  }
  async displayPost(token: string, member: string, text: string) { this.ok(await this.sb.rpc('display_post', { p_token: token, p_member: member, p_text: text })); }
  async displaySaveEvent(token: string, member: string, ev: NewEvent) { this.ok(await this.sb.rpc('display_save_event', { p_token: token, p_member: member, p: ev })); }
  async displayUpdateEvent(token: string, member: string, id: string, ev: Partial<NewEvent>) { this.ok(await this.sb.rpc('display_update_event', { p_token: token, p_member: member, p_id: id, p: ev })); }
  async displayDeleteEvent(token: string, member: string, id: string) { this.ok(await this.sb.rpc('display_delete_event', { p_token: token, p_member: member, p_id: id })); }
  async reset() { await this.sb.auth.signOut(); this.channel?.unsubscribe(); this.channel = null; this.emit(EMPTY); }
}

export const store: Store = supabase ? new SupabaseStore() : new LocalStore();

export function useSnapshot() {
  return useSyncExternalStore(store.subscribe, store.get);
}
export function useReady() {
  return useSyncExternalStore(store.subscribe, store.ready);
}
