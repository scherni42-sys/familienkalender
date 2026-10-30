import { useState, type ReactNode } from 'react';
import { store, useSnapshot } from '../lib/store';
import type { Role, Settings as S } from '../lib/types';
import { BGS, ROLE, SWATCHES, upcoming, bdLabel } from '../lib/model';
import { hm, inDays } from '../lib/dates';
import { Badge, cvar, Icon, type IconName } from './ui';
import { fail, toast } from './toast';

type Sub = 'family' | 'basic' | 'colors' | 'bg' | 'bdays' | 'displays' | null;
const MENU: [Exclude<Sub, null>, string, IconName][] = [
  ['family', 'Familie & Mitglieder', 'people'], ['basic', 'Grundeinstellungen', 'gear'], ['colors', 'Farben der Personen', 'palette'],
  ['bg', 'Hintergrund', 'palette'], ['bdays', 'Geburtstage', 'cake'], ['displays', 'Displays', 'screen']
];

export function Settings() {
  const snap = useSnapshot();
  const [sub, setSub] = useState<Sub>(null);
  const me = snap.members.find(m => m.id === snap.me)!;
  const s = snap.family!.settings;
  const isAdmin = me.role === 'admin';
  const upd = (p: Partial<S>, msg: string) => store.updateSettings(p).then(() => toast(msg), fail);

  if (!sub) {
    const next = upcoming(snap.birthdays)[0];
    const info: Record<string, string> = {
      family: `${snap.members.length} Mitglieder · Admin: ${snap.members.filter(m => m.role === 'admin').map(m => m.name).join(', ')}`,
      basic: `Geburtstage ${s.bdLead ? `${s.bdLead} Tage vorher` : 'aus'} · Pinnwand ${s.ttlHours < 48 ? `${s.ttlHours} Std.` : `${s.ttlHours / 24} Tage`} · Fahrzeiten ${s.showTravel ? 'an' : 'aus'}`,
      colors: 'Jede Person hat ihre eigene Farbe',
      bg: 'Unifarbener Hintergrund für App und Display',
      bdays: `${snap.birthdays.length} eingetragen${next ? ` · ${next.name} ${inDays(next.days)}` : ''}`,
      displays: `${snap.displays.length || 'Kein'} Display${snap.displays.length === 1 ? '' : 's'} · Pinnwand ${s.boardMode === 'fixed' ? 'fest' : 'dynamisch'}`
    };
    return <>
      <div className="mem"><Badge m={me} size={30} /><div><div className="nm">{me.name}</div><div className="sub">{ROLE[me.role]} · {snap.family!.name}</div></div><span />
        {store.demo && <div className="acts"><span className="badge-demo">Demo-Modus</span><label className="note">Handy von <select value={snap.me!} onChange={e => store.switchUser?.(e.target.value)}>{snap.members.filter(m => m.role !== 'child').map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label></div>}
      </div>
      {MENU.map(([k, l, ic]) => <button key={k} type="button" className="menu-item" onClick={() => setSub(k)}><span className="mi-ic"><Icon name={ic} /></span><span><b>{l}</b><small>{info[k]}</small></span><span className="chev">›</span></button>)}
      <button type="button" className="small-btn danger" style={{ justifySelf: 'start' }} onClick={() => { if (confirm(store.demo ? 'Alle Demo-Daten löschen?' : 'Auf diesem Handy abmelden? Zum Zurückkommen brauchst du einen neuen Einladungscode vom Admin.')) void store.reset(); }}>{store.demo ? 'Demo zurücksetzen' : 'Abmelden'}</button>
    </>;
  }

  const label = MENU.find(([k]) => k === sub)![1];
  const lock = !isAdmin && <div className="ai"><Icon name="lock" /><div>Ändern kann nur der Admin.</div></div>;

  let content: ReactNode = null;
  if (sub === 'family') content = <Family />;
  if (sub === 'basic') content = <>
    {lock}
    <Sel isAdmin={isAdmin} icon="cake" text="Geburtstags-Erinnerung" value={s.bdLead} opts={[[0, 'aus'], [3, '3 Tage vorher'], [7, '7 Tage vorher'], [14, '14 Tage vorher'], [21, '21 Tage vorher'], [30, '30 Tage vorher']]} onPick={v => upd({ bdLead: v }, v ? `Geburtstage erscheinen ab ${v} Tage vorher.` : 'Geburtstags-Erinnerung aus.')} />
    <Sel isAdmin={isAdmin} icon="board" text="Pinnwand-Nachrichten verschwinden nach" value={s.ttlHours} opts={[[12, '12 Std.'], [24, '1 Tag'], [72, '3 Tagen'], [168, '1 Woche']]} onPick={v => upd({ ttlHours: v }, 'Gespeichert.')} />
    <label className="setrow"><span><Icon name="car" /> Fahrzeiten anzeigen</span>{isAdmin ? <input type="checkbox" className="sw" checked={s.showTravel} onChange={e => upd({ showTravel: e.target.checked }, e.target.checked ? 'Fahrzeiten werden angezeigt.' : 'Fahrzeiten ausgeblendet.')} /> : <b>{s.showTravel ? 'ja' : 'nein'}</b>}</label>
    {s.showTravel && <>
      <label className="setrow"><span><Icon name="home" /> Zuhause (Start für Fahrten)</span>{isAdmin ? <input defaultValue={s.home} placeholder="Straße, Ort" onBlur={e => e.target.value.trim() !== s.home && upd({ home: e.target.value.trim() }, 'Zuhause-Adresse gespeichert.')} /> : <b>{s.home || '–'}</b>}</label>
      <Sel isAdmin={isAdmin} icon="clock" text="Erinnerung an den Fahrer" value={s.remind} opts={[[0, 'aus'], [5, '5 Min. vor Abfahrt'], [10, '10 Min. vor Abfahrt'], [15, '15 Min. vor Abfahrt'], [20, '20 Min. vor Abfahrt'], [30, '30 Min. vor Abfahrt']]} onPick={v => upd({ remind: v }, 'Gespeichert.')} />
      <Sel isAdmin={isAdmin} icon="car" text="Puffer vor Abfahrt" value={s.buffer} opts={[[0, 'keiner'], [5, '5 Min.'], [10, '10 Min.'], [15, '15 Min.']]} onPick={v => upd({ buffer: v }, 'Gespeichert.')} />
    </>}
    <Sel isAdmin={isAdmin} icon="clock" text="Vergangene Termine von heute" value={s.pastMode} opts={[['fade', 'blass zeigen'], ['hide', 'ausblenden']]} onPick={v => upd({ pastMode: v }, 'Gespeichert.')} />
    <Sel isAdmin={isAdmin} icon="week" text="Display: Vorschau" value={s.ahead} opts={[1, 2, 3, 4, 5, 6, 7].map(v => [v, v === 1 ? 'nur morgen' : `${v} Tage`] as [number, string])} onPick={v => upd({ ahead: v }, 'Gespeichert.')} />
    <Sel isAdmin={isAdmin} icon="clock" text="Display: Vorschau ab" value={s.split} opts={[[0, 'immer zeigen'], ...[10, 11, 12, 13, 14, 15, 16, 17, 18].map(h => [h * 60, `${h}:00 Uhr`] as [number, string])]} onPick={v => upd({ split: v }, 'Gespeichert.')} show={s.split ? `${hm(s.split)} Uhr` : 'immer'} />
    <span className="note">Vor dieser Uhrzeit zeigt das Display im Flur nur den heutigen Tag, groß und gut lesbar.</span>
  </>;
  if (sub === 'colors') content = <>
    <p className="note">Die Farbe erscheint als Balken und zarte Tönung bei allen Terminen der Person, in der App und auf dem Display. {isAdmin ? 'Als Admin kannst du alle Farben ändern.' : 'Du kannst deine eigene Farbe ändern.'}</p>
    {snap.members.map(m => {
      const can = isAdmin || m.id === snap.me;
      const twin = snap.members.filter(o => o.id !== m.id && o.color.toLowerCase() === m.color.toLowerCase()).map(o => o.name);
      return <div key={m.id} className="colrow"><div className="nm"><Badge m={m} /> <b>{m.name}</b>{twin.length > 0 && <span className="note">gleiche Farbe wie {twin.join(', ')}</span>}</div>
        {can && <div className="sw">{SWATCHES.map(([h, l]) => <button key={h} type="button" className={`swb${m.color.toLowerCase() === h ? ' on' : ''}`} style={cvar(h)} aria-label={l} title={l} onClick={() => store.updateMember(m.id, { color: h }).catch(fail)} />)}
          <label className="swb own" title="Eigene Farbe" style={cvar(m.color)}><input type="color" value={m.color} onChange={e => store.updateMember(m.id, { color: e.target.value }).catch(fail)} aria-label={`Eigene Farbe für ${m.name}`} />+</label></div>}
      </div>;
    })}
  </>;
  if (sub === 'bg') content = <>
    <div className="colrow"><div className="nm"><b>App</b><span className="note">nur auf deinem Handy</span></div>
      <BgPick cur={me.app_bg ?? ''} pick={h => store.updateMember(me.id, { app_bg: h || null }).catch(fail)} /></div>
    <div className="colrow"><div className="nm"><b>Display im Flur</b><span className="note">{isAdmin ? 'gilt für alle' : 'ändern kann nur der Admin'}</span></div>
      {isAdmin && <BgPick cur={s.wbg} pick={h => upd({ wbg: h }, 'Display-Hintergrund gespeichert.')} />}</div>
    <p className="note">Helle Töne halten Termine und Schrift gut lesbar. Beim E-Ink-Display erscheint die Farbe als Grauton.</p>
  </>;
  if (sub === 'bdays') content = <Bdays />;
  if (sub === 'displays') content = <Displays />;

  return <>
    <button type="button" className="back" onClick={() => setSub(null)}>‹ Einstellungen</button>
    <div className="day-h" style={{ marginTop: 0 }}><span style={{ fontSize: 17, color: 'var(--ink)' }}>{label}</span></div>
    {content}
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

function Bdays() {
  const snap = useSnapshot();
  const me = snap.members.find(m => m.id === snap.me)!;
  const s = snap.family!.settings;
  const [n, setN] = useState(''), [rel, setRel] = useState(''), [date, setDate] = useState('');
  return <>
    <div>{upcoming(snap.birthdays).map(b => <div key={b.id} className={`bdrow${s.bdLead && b.days <= s.bdLead ? ' soon' : ''}`}>
      <div><b>{b.name}</b><small>{b.rel} · {bdLabel(b)}{b.age ? ` · wird ${b.age}` : ''}</small></div>
      <span className="dd">{inDays(b.days)} {me.role !== 'guest' && <button type="button" className="small-btn danger" aria-label={`${b.name} entfernen`} onClick={() => store.removeBirthday(b.id).catch(fail)}>×</button>}</span></div>)}</div>
    {me.role !== 'guest' && (
      <form className="addform" onSubmit={e => { e.preventDefault(); if (!n.trim() || !date) return; const [y, mo, d] = date.split('-').map(Number);
        store.addBirthday({ name: n.trim(), rel: rel.trim(), day: d, month: mo, year: y > 1900 ? y : null }).then(() => { setN(''); setRel(''); setDate(''); toast('Geburtstag eingetragen.'); }, fail); }}>
        <b>Geburtstag eintragen</b>
        <div className="two"><input value={n} onChange={e => setN(e.target.value)} placeholder="Name" required /><input value={rel} onChange={e => setRel(e.target.value)} placeholder="z. B. Patentante" /></div>
        <label className="field"><span>Geburtsdatum (Jahr für „wird …“)</span><input type="date" value={date} onChange={e => setDate(e.target.value)} required /></label>
        <button className="btn">Eintragen</button>
      </form>
    )}
  </>;
}

function Displays() {
  const snap = useSnapshot();
  const me = snap.members.find(m => m.id === snap.me)!;
  const s = snap.family!.settings;
  const isAdmin = me.role === 'admin';
  const base = `${location.origin}${location.pathname}`;
  if (!isAdmin) return <div className="ai"><Icon name="lock" /><div>Displays verwaltet der Admin.</div></div>;
  return <>
    <p className="note">Jedes Display ruft die Familienseite unter einer eigenen, geheimen Adresse auf. Diese Adresse im WYSCREEN als Webseite eintragen. Entfernen macht die Adresse sofort ungültig.</p>
    {snap.displays.map(d => {
      const url = `${base}#/display/${d.token}`;
      return <div key={d.id} className="mem"><span className="b" style={cvar('var(--muted)')}>W</span><div><div className="nm">{d.name}</div><div className="sub">nur Familientermine</div></div><span />
        <div className="acts" style={{ display: 'grid' }}>
          <div className="urlbox">{url}</div>
          <span className="note">Varianten: <code>?v=bigme</code>, <code>?v=qm</code>, <code>?v=color</code>, <code>?v=eink</code> vor dem # anhängen.</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className="small-btn" onClick={() => navigator.clipboard?.writeText(url).then(() => toast('Adresse kopiert.'))}>Adresse kopieren</button>
            <a className="small-btn" href={url} target="_blank" rel="noreferrer">Ansehen</a>
            {!store.demo && <button type="button" className="small-btn danger" onClick={() => { if (confirm('Display entfernen? Die Adresse funktioniert dann nicht mehr.')) store.removeDisplay(d.id).catch(fail); }}>Entfernen</button>}
          </div>
        </div></div>;
    })}
    {!store.demo && <button type="button" className="small-btn" style={{ justifySelf: 'start' }} onClick={() => store.addDisplay(`Display ${snap.displays.length + 1}`).then(() => toast('Neues Display angelegt.'), fail)}>Weiteres Display anlegen</button>}
    <label className="setrow"><span><Icon name="board" /> Pinnwand am Display</span>
      <select value={s.boardMode} onChange={e => store.updateSettings({ boardMode: e.target.value as 'dynamic' | 'fixed' }).catch(fail)}><option value="dynamic">dynamisch</option><option value="fixed">fest: rechtes Drittel</option></select></label>
    <p className="note">Dynamisch: Die Pinnwand bekommt den Platz neben den Terminen. Fest: Das rechte Drittel gehört immer der Pinnwand.</p>
  </>;
}
