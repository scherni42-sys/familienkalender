declare const __BUILD__: string;
import { useRef, useState, type ReactNode } from 'react';
import { store, useSnapshot } from '../lib/store';
import type { Birthday, Role, Settings as S } from '../lib/types';
import { BGS, ROLE, SWATCHES, upcoming, bdLabel } from '../lib/model';
import { hm, inDays, MON } from '../lib/dates';
import { Badge, cvar, Icon, type IconName } from './ui';
import { fail, toast } from './toast';
import { micStart, setMicStart } from '../lib/micstart';
import { SUPA } from '../lib/supabase';
import { AvatarCrop } from './AvatarCrop';
import { native } from '../lib/native';
import { alarmOn, getAlarm, renameAlarm, setAlarm, setTone, toggleAlarm, useAlarm, useTones } from '../lib/bdalarm';

type Sub = 'family' | 'basic' | 'colors' | 'bg' | 'bdays' | 'displays' | null;
const MENU: [Exclude<Sub, null>, string, IconName][] = [
  ['family', 'Familie & Mitglieder', 'people'], ['basic', 'Grundeinstellungen', 'gear'], ['colors', 'Personalisierung', 'palette'],
  ['bg', 'Hintergrund', 'palette'], ['bdays', 'Geburtstage', 'cake'], ['displays', 'Displays', 'screen']
];

export function Settings() {
  const snap = useSnapshot();
  const [sub, setSub] = useState<Sub>(null);
  const [crop, setCrop] = useState<{ id: string; file: File } | null>(null);
  const me = snap.members.find(m => m.id === snap.me)!;
  const s = snap.family!.settings;
  const isAdmin = me.role === 'admin';
  const upd = (p: Partial<S>, msg: string) => store.updateSettings(p).then(() => toast(msg), fail);

  if (!sub) {
    const next = upcoming(snap.birthdays)[0];
    const info: Record<string, string> = {
      family: `${snap.members.length} Mitglieder · Admin: ${snap.members.filter(m => m.role === 'admin').map(m => m.name).join(', ')}`,
      basic: `Geburtstage ${s.bdLead ? `${s.bdLead} Tage vorher` : 'aus'} · Board ${s.ttlHours < 48 ? `${s.ttlHours} Std.` : `${s.ttlHours / 24} Tage`} · Fahrzeiten ${s.showTravel ? 'an' : 'aus'}`,
      colors: 'Farbe und Avatar jeder Person',
      bg: 'Unifarbener Hintergrund für App und Display',
      bdays: `${snap.birthdays.length} eingetragen${next ? ` · ${next.name} ${inDays(next.days)}` : ''}`,
      displays: `${snap.displays.length || 'Kein'} Display${snap.displays.length === 1 ? '' : 's'} · Board ${s.boardMode === 'fixed' ? 'fest' : 'dynamisch'}`
    };
    return <>
      <div className="mem"><Badge m={me} size={30} /><div><div className="nm">{me.name}</div><div className="sub">{ROLE[me.role]} · {snap.family!.name}</div></div><span />
        {store.demo && <div className="acts"><span className="badge-demo">Demo-Modus</span><label className="note">Handy von <select value={snap.me!} onChange={e => store.switchUser?.(e.target.value)}>{snap.members.filter(m => m.role !== 'child').map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label></div>}
      </div>
      {MENU.map(([k, l, ic]) => <button key={k} type="button" className="menu-item" onClick={() => setSub(k)}><span className="mi-ic"><Icon name={ic} /></span><span><b>{l}</b><small>{info[k]}</small></span><span className="chev">›</span></button>)}
      {native() && <button type="button" className="menu-item" onClick={() => native()!.setup()}><span className="mi-ic"><Icon name="gear" /></span><span><b>{native()!.platform === 'ios' ? 'Widget' : 'Widget & Handy-Kalender'}</b><small>{native()!.platform === 'ios' ? 'So legst du das FamTO-Widget auf den Startbildschirm' : 'Widget einrichten, Abgleich, Home-Modus, neue Version'}</small></span><span className="chev">›</span></button>}
      {me.role !== 'guest' && <MicStartRow />}
      {me.role !== 'guest' && <ToneRow kind="ev" />}
      <button type="button" className="small-btn danger" style={{ justifySelf: 'start' }} onClick={() => { if (confirm(store.demo ? 'Alle Demo-Daten löschen?' : 'Auf diesem Handy abmelden? Zum Zurückkommen brauchst du einen neuen Einladungscode vom Admin.')) void store.reset(); }}>{store.demo ? 'Demo zurücksetzen' : 'Abmelden'}</button>
      <span className="note">Version vom {__BUILD__}</span>
    </>;
  }

  const label = MENU.find(([k]) => k === sub)![1];
  const lock = !isAdmin && <div className="ai"><Icon name="lock" /><div>Ändern kann nur der Admin.</div></div>;

  let content: ReactNode = null;
  if (sub === 'family') content = <Family />;
  if (sub === 'basic') content = <>
    {lock}
    <Sel isAdmin={isAdmin} icon="cake" text="Geburtstags-Erinnerung" value={s.bdLead} opts={[[0, 'aus'], [3, '3 Tage vorher'], [7, '7 Tage vorher'], [14, '14 Tage vorher'], [21, '21 Tage vorher'], [30, '30 Tage vorher']]} onPick={v => upd({ bdLead: v }, v ? `Geburtstage erscheinen ab ${v} Tage vorher.` : 'Geburtstags-Erinnerung aus.')} />
    <Sel isAdmin={isAdmin} icon="board" text="Board-Nachrichten verschwinden nach" value={s.ttlHours} opts={[[12, '12 Std.'], [24, '1 Tag'], [72, '3 Tagen'], [168, '1 Woche']]} onPick={v => upd({ ttlHours: v }, 'Gespeichert.')} />
    <label className="setrow"><span><Icon name="car" /> Fahrzeiten anzeigen</span>{isAdmin ? <input type="checkbox" className="sw" checked={s.showTravel} onChange={e => upd({ showTravel: e.target.checked }, e.target.checked ? 'Fahrzeiten werden angezeigt.' : 'Fahrzeiten ausgeblendet.')} /> : <b>{s.showTravel ? 'ja' : 'nein'}</b>}</label>
    {s.showTravel && <>
      <label className="setrow"><span><Icon name="home" /> Zuhause (Start für Fahrten)</span>{isAdmin ? <input defaultValue={s.home} placeholder="Straße Nr., PLZ Ort" onBlur={e => e.target.value.trim() !== s.home && upd({ home: e.target.value.trim() }, 'Zuhause-Adresse gespeichert.')} /> : <b>{s.home || '–'}</b>}</label>
      <Sel isAdmin={isAdmin} icon="clock" text="Erinnerung an den Fahrer" value={s.remind} opts={[[0, 'aus'], [5, '5 Min. vor Abfahrt'], [10, '10 Min. vor Abfahrt'], [15, '15 Min. vor Abfahrt'], [20, '20 Min. vor Abfahrt'], [30, '30 Min. vor Abfahrt']]} onPick={v => upd({ remind: v }, 'Gespeichert.')} />
      <Sel isAdmin={isAdmin} icon="car" text="Puffer vor Abfahrt" value={s.buffer} opts={[[0, 'keiner'], [5, '5 Min.'], [10, '10 Min.'], [15, '15 Min.']]} onPick={v => upd({ buffer: v }, 'Gespeichert.')} />
    </>}
    <Sel isAdmin={isAdmin} icon="clock" text="Vergangene Termine von heute" value={s.pastMode} opts={[['fade', 'blass zeigen'], ['hide', 'ausblenden']]} onPick={v => upd({ pastMode: v }, 'Gespeichert.')} />
    <Sel isAdmin={isAdmin} icon="week" text="Display: Vorschau" value={s.ahead} opts={[1, 2, 3, 4, 5, 6, 7].map(v => [v, v === 1 ? 'nur morgen' : `${v} Tage`] as [number, string])} onPick={v => upd({ ahead: v }, 'Gespeichert.')} />
    <Sel isAdmin={isAdmin} icon="clock" text="Display: Vorschau ab" value={s.split} opts={[[0, 'immer zeigen'], ...[10, 11, 12, 13, 14, 15, 16, 17, 18].map(h => [h * 60, `${h}:00 Uhr`] as [number, string])]} onPick={v => upd({ split: v }, 'Gespeichert.')} show={s.split ? `${hm(s.split)} Uhr` : 'immer'} />
    <span className="note">Vor dieser Uhrzeit zeigt das Display im Flur nur den heutigen Tag, groß und gut lesbar.</span>
  </>;
  if (sub === 'colors') content = <>
    <p className="note">Statt des Buchstabens kann jede Person ein Foto als Avatar haben, die Farbe bleibt als Ring drumherum. Die Farbe erscheint als Balken und zarte Tönung bei allen Terminen der Person, in der App und auf dem Display. {isAdmin ? 'Als Admin kannst du alle Farben ändern.' : 'Du kannst deine eigene Farbe ändern.'}</p>
    {snap.members.map(m => {
      const can = isAdmin || m.id === snap.me;
      const twin = snap.members.filter(o => o.id !== m.id && o.color.toLowerCase() === m.color.toLowerCase()).map(o => o.name);
      return <div key={m.id} className="colrow"><div className="nm"><Badge m={m} size={36} /> <b>{m.name}</b>{twin.length > 0 && <span className="note">gleiche Farbe wie {twin.join(', ')}</span>}</div>
        {can && <div className="sw">{SWATCHES.map(([h, l]) => <button key={h} type="button" className={`swb${m.color.toLowerCase() === h ? ' on' : ''}`} style={cvar(h)} aria-label={l} title={l} onClick={() => store.updateMember(m.id, { color: h }).catch(fail)} />)}
          <label className="swb own" title="Eigene Farbe" style={cvar(m.color)}><input type="color" value={m.color} onChange={e => store.updateMember(m.id, { color: e.target.value }).catch(fail)} aria-label={`Eigene Farbe für ${m.name}`} />+</label></div>}
        {can && <div className="av-row">
          {m.avatar && <label className="av-use"><input type="checkbox" checked={!m.avatar.startsWith('off:')} onChange={e => store.useAvatar(m.id, e.target.checked).catch(fail)} /> Avatar benutzen</label>}
          <label className="small-btn"><Icon name="camera" /> {m.avatar ? 'Anderes Foto' : 'Foto als Avatar'}
            <input type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setCrop({ id: m.id, file: f }); }} /></label>
          {m.avatar && <button type="button" className="small-btn danger" onClick={() => { if (confirm('Foto löschen?')) store.setAvatar(m.id, null).then(() => toast('Foto gelöscht, wieder der Buchstabe.'), fail); }}>Löschen</button>}</div>}
      </div>;
    })}
  </>;
  if (sub === 'bg') content = <>
    <div className="colrow"><div className="nm"><b>App</b><span className="note">nur auf deinem Handy</span></div>
      <BgPick cur={me.app_bg ?? ''} pick={h => store.updateMember(me.id, { app_bg: h || null }).catch(fail)} /></div>
    <div className="colrow"><div className="nm"><b>Display im Flur</b><span className="note">{isAdmin ? 'gilt für alle' : 'ändern kann nur der Admin'}</span></div>
      {isAdmin && <BgPick cur={s.wbg} pick={h => upd({ wbg: h }, 'Display-Hintergrund gespeichert.')} />}</div>
    <p className="note">Display „Standard“ ist dunkel wie das Widget. Eine helle Farbe schaltet das Display auf hell. Beim E-Ink-Display erscheint die Farbe als Grauton.</p>
  </>;
  if (sub === 'bdays') content = <Bdays />;
  if (sub === 'displays') content = <Displays />;

  return <>
    <button type="button" className="back" onClick={() => setSub(null)}>‹ Einstellungen</button>
    <div className="day-h" style={{ marginTop: 0 }}><span style={{ fontSize: 17, color: 'var(--ink)' }}>{label}</span></div>
    {content}
    {crop && <AvatarCrop file={crop.file} color={snap.members.find(m => m.id === crop.id)?.color ?? '#7a8590'} close={() => setCrop(null)}
      done={img => { const id = crop.id; setCrop(null); store.setAvatar(id, img).then(() => toast('Avatar gespeichert.'), fail); }} />}
  </>;
}

function Sel<T extends string | number>({ isAdmin, icon, text, value, opts, onPick, show }: { isAdmin: boolean; icon: IconName; text: string; value: T; opts: [T, string][]; onPick: (v: T) => void; show?: string }) {
  return (
    <label className="setrow"><span><Icon name={icon} /> {text}</span>{isAdmin
      ? <select value={String(value)} onChange={e => onPick((typeof value === 'number' ? Number(e.target.value) : e.target.value) as T)}>{opts.map(([v, l]) => <option key={String(v)} value={String(v)}>{l}</option>)}</select>
      : <b>{show ?? opts.find(([v]) => v === value)?.[1]}</b>}</label>
  );
}

function BgPick({ cur, pick }: { cur: string; pick: (h: string) => void }) {
  return <div className="sw">{BGS.map(([h, l]) => <button key={l} type="button" className={`swb bgs${cur === h ? ' on' : ''}`} style={cvar(h || '#ffffff')} aria-label={l} title={l} onClick={() => pick(h)}>{h ? '' : '–'}</button>)}
    <label className="swb bgs own" title="Eigene Farbe" style={cvar(cur || '#ffffff')}><input type="color" value={cur || '#ffffff'} onChange={e => pick(e.target.value)} aria-label="Eigene Hintergrundfarbe" />+</label></div>;
}

function Family() {
  const snap = useSnapshot();
  const me = snap.members.find(m => m.id === snap.me)!;
  const isAdmin = me.role === 'admin';
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [name, setName] = useState(''), [role, setRole] = useState<Role>('member');
  const admins = snap.members.filter(m => m.role === 'admin').length;
  const invite = async (id: string) => { try { const c = await store.createInvite(id); setCodes({ ...codes, [id]: c }); } catch (e) { fail(e); } };
  return <>
    {!isAdmin && <div className="ai"><Icon name="lock" /><div>Mitglieder hinzufügen und entfernen kann nur der Admin.</div></div>}
    {snap.members.map(m => (
      <div key={m.id} className="mem"><Badge m={m} size={30} />
        <div><div className="nm">{m.name}{m.id === snap.me ? ' (du)' : ''}</div><div className="sub">{ROLE[m.role]}{m.role !== 'child' ? (m.linked ? ' · App verbunden' : ' · noch nicht verbunden') : ''}</div></div>
        {isAdmin && m.id !== snap.me ? <select aria-label={`Rolle von ${m.name}`} value={m.role} onChange={e => {
          const v = e.target.value as Role;
          if (m.role === 'admin' && v !== 'admin' && admins === 1) { toast('Mindestens ein Admin muss bleiben.'); return; }
          store.updateMember(m.id, { role: v, adult: v === 'child' ? false : m.adult }).then(() => toast(`${m.name} ist jetzt: ${ROLE[v]}.`), fail);
        }}>{Object.entries(ROLE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select> : <span />}
        {isAdmin && m.id !== snap.me && <div className="acts">
          {m.role !== 'child' && !m.linked && <button type="button" className="small-btn" onClick={() => void invite(m.id)}>Einladungscode</button>}
          {m.role !== 'child' && m.linked && <button type="button" className="small-btn" onClick={() => void invite(m.id)}>Neues Handy verbinden</button>}
          <button type="button" className="small-btn danger" onClick={() => { if (confirm(`${m.name} aus der Familie entfernen?`)) store.removeMember(m.id).then(() => toast(`${m.name} entfernt.`), fail); }}>Entfernen</button>
          {codes[m.id] && <div style={{ width: '100%' }}><div className="codebox">{codes[m.id]}</div><span className="note">{m.name} öffnet die App, tippt „Ich habe einen Einladungscode“ und gibt den Code ein. Gültig 7 Tage.</span></div>}
        </div>}
      </div>
    ))}
    {isAdmin && (
      <form className="addform" onSubmit={e => { e.preventDefault(); if (!name.trim()) return;
        const used = new Set(snap.members.map(m => m.color.toLowerCase()));
        const color = SWATCHES.find(([h]) => !used.has(h))?.[0] ?? SWATCHES[snap.members.length % SWATCHES.length][0];
        store.addMember({ name: name.trim(), role, color, adult: role !== 'child' }).then(() => { setName(''); toast(role === 'child' ? 'Hinzugefügt. Kinder ohne Handy sind sofort dabei.' : 'Hinzugefügt. Jetzt einen Einladungscode erzeugen.'); }, fail); }}>
        <b>Mitglied hinzufügen</b>
        <div className="two"><input value={name} onChange={e => setName(e.target.value)} placeholder="Name" required />
          <select value={role} onChange={e => setRole(e.target.value as Role)}>{Object.entries(ROLE).filter(([k]) => k !== 'admin').map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <button className="btn">Hinzufügen</button>
        <span className="note">Mitglieder und Gäste verbinden ihr Handy mit einem Einladungscode. Kinder ohne Smartphone sind sofort dabei; Eltern tragen für sie ein.</span>
      </form>
    )}
  </>;
}

// Formular „Geburtstag eintragen“ (Einstellungen und Geburtstagsübersicht, auch aus dem Widget)
export function BdayForm({ focus, edit, done }: { focus?: boolean; edit?: Birthday; done?: () => void }) {
  const snap = useSnapshot();
  // Tag und Monat Pflicht, Jahr freiwillig: ohne Jahr kein „wird …“
  const [n, setN] = useState(edit?.name ?? ''), [rel, setRel] = useState(edit?.rel ?? ''), [day, setDay] = useState(edit ? String(edit.day) : ''), [mon, setMon] = useState(edit ? String(edit.month) : ''), [year, setYear] = useState(edit?.year ? String(edit.year) : ''), [priv, setPriv] = useState(!!edit?.owner);
  const y = Number(year);
  const alarm = useAlarm();
  const [wake, setWake] = useState(!!alarm && !!edit && alarmOn(alarm, edit));
  return <form className="addform" onSubmit={e => { e.preventDefault(); if (!n.trim() || !day || !mon) return;
        const b = { name: n.trim(), rel: rel.trim(), day: Number(day), month: Number(mon), year: y > 1900 && y <= new Date().getFullYear() ? y : null, owner: priv ? snap.me : null };
        const others = snap.birthdays.filter(x => x.id !== edit?.id);
        const wakeUp = () => { const a = getAlarm(); if (a && alarmOn(a, b) !== wake) toggleAlarm(b, wake, [...others, b]); };
        if (edit) { store.updateBirthday(edit, b).then(() => { if (alarm) { renameAlarm(edit, b); wakeUp(); } toast('Geburtstag geändert.'); done?.(); }, fail); return; }
        store.addBirthday(b).then(() => { wakeUp(); setN(''); setRel(''); setDay(''); setMon(''); setYear(''); setPriv(false); setWake(false); toast(wake ? 'Geburtstag eingetragen, der Wecker klingelt.' : 'Geburtstag eingetragen.'); }, fail); }}>
        <b>{edit ? `${edit.name} bearbeiten` : 'Geburtstag eintragen'}</b>
        {edit?.ext_id && <span className="note">Kommt aus deinem Handy-Kalender. Änderungen besser dort machen, sonst überschreibt der nächste Abgleich sie.</span>}
        <div className="two"><input value={n} onChange={e => setN(e.target.value)} placeholder="Name" required autoFocus={focus || !!edit} /><input value={rel} onChange={e => setRel(e.target.value)} placeholder="z. B. Patentante" /></div>
        <div className="bdate">
          <label className="field"><span>Tag</span><select value={day} onChange={e => setDay(e.target.value)} required><option value="">–</option>{Array.from({ length: 31 }, (_, i) => <option key={i} value={i + 1}>{i + 1}.</option>)}</select></label>
          <label className="field"><span>Monat</span><select value={mon} onChange={e => setMon(e.target.value)} required><option value="">–</option>{MON.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
          <label className="field"><span>Jahr (freiwillig)</span><input type="number" inputMode="numeric" min={1900} max={new Date().getFullYear()} value={year} onChange={e => setYear(e.target.value)} placeholder="unbekannt" /></label>
        </div>
        <label className="setrow"><span><Icon name="lock" /> Privat: nur ich sehe ihn (Freunde, Kollegen …)</span><input type="checkbox" checked={priv} onChange={e => setPriv(e.target.checked)} /></label>
        {alarm && <label className="setrow"><span><Icon name="alarm" /> Wecker am Geburtstag um {hm(alarm.min)} Uhr (dieses Handy)</span><input type="checkbox" checked={wake} onChange={e => setWake(e.target.checked)} /></label>}
        {edit ? <div className="btn-row"><button type="button" className="btn ghost" onClick={done}>Abbrechen</button><button className="btn">Speichern</button></div> : <button className="btn">Eintragen</button>}
      </form>;
}

// Lange drücken öffnet einen Geburtstag zum Bearbeiten
function BdayRow({ b, lead, canEdit, onEdit, wake, onWake }: { b: ReturnType<typeof upcoming>[number]; lead: number; canEdit: boolean; onEdit: () => void; wake?: boolean; onWake?: () => void }) {
  const timer = useRef<number | undefined>(undefined);
  const press = () => { window.clearTimeout(timer.current); if (canEdit) timer.current = window.setTimeout(() => { navigator.vibrate?.(20); onEdit(); }, 550); };
  const release = () => window.clearTimeout(timer.current);
  return <div className={`bdrow${lead && b.days <= lead ? ' soon' : ''}`} onPointerDown={press} onPointerUp={release} onPointerLeave={release} onPointerCancel={release} onContextMenu={x => { if (canEdit) x.preventDefault(); }}>
    <div><b>{b.owner ? <><Icon name="lock" /> </> : ''}{b.name}</b><small>{b.owner ? 'privat · ' : ''}{b.rel ? `${b.rel} · ` : ''}{bdLabel(b)}{b.age ? ` · wird ${b.age}` : ''}</small></div>
    <span className="dd">{inDays(b.days)} {onWake && <button type="button" className={`small-btn alarm-btn${wake ? ' on' : ''}`} aria-pressed={wake} aria-label={`Wecker für ${b.name} ${wake ? 'aus' : 'an'}`} title="Geburtstags-Wecker" onPointerDown={x => x.stopPropagation()} onClick={onWake}><Icon name="alarm" /></button>} {canEdit && <button type="button" className="small-btn danger" aria-label={`${b.name} entfernen`} onPointerDown={x => x.stopPropagation()} onClick={() => store.removeBirthday(b.id).catch(fail)}>×</button>}</span></div>;
}

function Bdays() {
  const snap = useSnapshot();
  const me = snap.members.find(m => m.id === snap.me)!;
  const s = snap.family!.settings;
  const [edit, setEdit] = useState<Birthday | null>(null);
  const can = me.role !== 'guest';
  const alarm = useAlarm();
  if (edit) return <BdayForm key={edit.id} edit={edit} done={() => setEdit(null)} />;
  const t = alarm ? hm(alarm.min) : '';
  return <>
    {alarm ? <div className="alarm-box">
      <b><Icon name="alarm" /> Geburtstags-Wecker auf diesem Handy</b>
      <label className="setrow"><span>Klingelt am Geburtstag um</span><input type="time" value={t} onChange={e => { const [h, m] = e.target.value.split(':').map(Number); if (!isNaN(h) && !isNaN(m)) setAlarm({ ...alarm, min: h * 60 + m }); }} /></label>
      <label className="setrow"><span>Für alle Geburtstage</span><input type="checkbox" className="sw" checked={alarm.all} onChange={e => { setAlarm({ ...alarm, all: e.target.checked, keys: [] }); toast(e.target.checked ? `Der Wecker klingelt an jedem Geburtstag um ${hm(alarm.min)} Uhr.` : 'Wecker für alle aus. Einzelne mit dem Wecker-Symbol einschalten.'); }} /></label>
      <ToneRow kind="bd" />
      <span className="note">{alarm.all ? <>Einzelne mit <Icon name="alarm" /> ausschalten.</> : <>Oder einzelne Geburtstage mit <Icon name="alarm" /> einschalten.</>} Der Wecker klingelt mit Namen, bis du ihn ausschaltest.</span>
    </div> : !store.demo && <p className="note">Einen Geburtstags-Wecker mit Namen kannst du in der Android-App von FamTO stellen.</p>}
    {can && snap.birthdays.length > 0 && <p className="note">Zum Ändern einen Geburtstag lange drücken.</p>}
    <div>{upcoming(snap.birthdays).map(b => <BdayRow key={b.id} b={b} lead={s.bdLead} canEdit={can} onEdit={() => setEdit(snap.birthdays.find(x => x.id === b.id) ?? null)}
      wake={alarm ? alarmOn(alarm, b) : undefined} onWake={alarm ? () => { const on = !alarmOn(alarm, b); toggleAlarm(b, on, snap.birthdays); toast(on ? `Wecker für ${b.name} an.` : `Wecker für ${b.name} aus.`); } : undefined} />)}</div>
    {can && <BdayForm />}
  </>;
}

function Displays() {
  const snap = useSnapshot();
  const me = snap.members.find(m => m.id === snap.me)!;
  const s = snap.family!.settings;
  const isAdmin = me.role === 'admin';
  const base = `${location.origin}${location.pathname}`;
  // Persönlicher Code: Widget zeigt Familientermine und die eigenen privaten Termine
  const widget = !store.demo && <div className="mem"><span className="b" style={cvar('var(--accent)')}>H</span><div><div className="nm">Mein Handy-Widget</div><div className="sub">Familientermine und meine privaten Termine</div></div><span />
    <div className="acts"><button type="button" className="small-btn" onClick={() => store.widgetToken().then(t => navigator.clipboard?.writeText('FK1:' + btoa(JSON.stringify({ u: SUPA.url, k: SUPA.key, t, a: base })))).then(() => toast('Widget-Code kopiert. Jetzt in der Widget-App einfügen.'), fail)}>Widget-Code für Android kopieren</button></div></div>;
  if (!isAdmin) return <>{widget}<div className="ai"><Icon name="lock" /><div>Displays verwaltet der Admin.</div></div></>;
  return <>
    {widget}
    <p className="note">Jedes Display ruft die Familienseite unter einer eigenen, geheimen Adresse auf. Diese Adresse im WYSCREEN als Webseite eintragen. Entfernen macht die Adresse sofort ungültig.</p>
    {snap.displays.map(d => {
      const tall = (s.tall ?? []).includes(d.id);
      const url = `${base}${tall ? '?v=hoch' : ''}#/display/${d.token}`;
      return <div key={d.id} className="mem"><span className="b" style={cvar('var(--muted)')}>W</span><div><div className="nm">{d.name}</div><div className="sub">nur Familientermine{d.touch ? ' · mit Eingabe' : ''}</div></div><span />
        <div className="acts" style={{ display: 'grid' }}>
          <label className="setrow"><span>👆 Touch-Display: Termine und Board-Nachrichten direkt am Display eingeben</span><input type="checkbox" checked={!!d.touch} onChange={e => store.setDisplayTouch(d.id, e.target.checked).then(() => toast(e.target.checked ? 'Eingabe am Display eingeschaltet.' : 'Eingabe am Display ausgeschaltet.'), fail)} /></label>
          <label className="setrow"><span>📱 Hochkant wie das Widget: Bildschirm hängt hochkant</span><input type="checkbox" checked={tall} onChange={e => { const on = e.target.checked; store.updateSettings({ tall: on ? [...(s.tall ?? []), d.id] : (s.tall ?? []).filter(x => x !== d.id) }).then(() => toast(on ? 'Hochkant-Ansicht an. Bitte die neue Adresse am Display eintragen.' : 'Hochkant-Ansicht aus. Bitte die neue Adresse am Display eintragen.'), fail); }} /></label>
          <div className="urlbox">{url}</div>
          <span className="note">Varianten: <code>?v=bigme</code>, <code>?v=qm</code>, <code>?v=color</code>, <code>?v=eink</code>, <code>?v=hoch</code> vor dem # anhängen. Ein hochkant hängender Bildschirm zeigt die Widget-Ansicht auch von selbst. <code>?r=5</code> lädt alle 5 Sekunden neu, beides zusammen mit <code>?v=qm&amp;r=5</code>.</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className="small-btn" onClick={() => navigator.clipboard?.writeText(url).then(() => toast('Adresse kopiert.'))}>Adresse kopieren</button>
            <a className="small-btn" href={url} target="_blank" rel="noreferrer">Ansehen</a>
            {!store.demo && <button type="button" className="small-btn danger" onClick={() => { if (confirm('Display entfernen? Die Adresse funktioniert dann nicht mehr.')) store.removeDisplay(d.id).catch(fail); }}>Entfernen</button>}
          </div>
        </div></div>;
    })}
    {!store.demo && <button type="button" className="small-btn" style={{ justifySelf: 'start' }} onClick={() => store.addDisplay(`Display ${snap.displays.length + 1}`).then(() => toast('Neues Display angelegt.'), fail)}>Weiteres Display anlegen</button>}
    <label className="setrow"><span><Icon name="board" /> Board am Display</span>
      <select value={s.boardMode} onChange={e => store.updateSettings({ boardMode: e.target.value as 'dynamic' | 'fixed' }).catch(fail)}><option value="dynamic">dynamisch</option><option value="fixed">fest: rechtes Drittel</option></select></label>
    <p className="note">Dynamisch: Das Board bekommt den Platz neben den Terminen. Fest: Das rechte Drittel gehört immer dem Board.</p>
  </>;
}

// Klingelton der Wecker auf diesem Handy (Android-App)
export function ToneRow({ kind }: { kind: 'bd' | 'ev' }) {
  const t = useTones();
  if (!t) return null;
  const cur = t[kind];
  return <label className="setrow"><span>🔔 {kind === 'bd' ? 'Klingelton' : 'Klingelton für Termin-Wecker'}</span>
    <select value={cur.which} onChange={e => setTone(kind, e.target.value)}>
      <option value="birthday">Happy Birthday</option>
      <option value="beep">Piepen</option>
      <option value="alarm">Weckton des Handys</option>
      {cur.which === 'custom' && <option value="custom">{cur.title}</option>}
      <option value="pick">Anderer Ton vom Handy …</option>
    </select></label>;
}

// Nur für dieses Handy: App öffnet direkt die Spracheingabe (praktisch mit der Samsung-Seitentaste)
function MicStartRow() {
  const [on, setOn] = useState(micStart());
  return <>
    <label className="setrow"><span><Icon name="mic" /> Beim Öffnen sofort Spracheingabe</span>
      <input type="checkbox" className="sw" checked={on} onChange={e => { setMicStart(e.target.checked); setOn(e.target.checked); toast(e.target.checked ? 'Die App startet jetzt direkt mit dem Mikrofon.' : 'Die App startet wieder normal.'); }} /></label>
    <span className="note">Gilt nur für dieses Handy. Zusammen mit der Seitentaste ist das die schnellste Eingabe.</span>
  </>;
}
