import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useRef, useState } from 'react';
import { store, useSnapshot } from '../lib/store';
import { BGS, ROLE, SWATCHES, upcoming, bdLabel } from '../lib/model';
import { hm, inDays, MON } from '../lib/dates';
import { Badge, cvar, Icon } from './ui';
import { fail, toast } from './toast';
import { micStart, setMicStart } from '../lib/micstart';
import { SUPA } from '../lib/supabase';
import { AvatarCrop } from './AvatarCrop';
import { native } from '../lib/native';
import { alarmOn, getAlarm, renameAlarm, setAlarm, setTone, toggleAlarm, useAlarm, useTones } from '../lib/bdalarm';
const MENU = [
    ['family', 'Familie & Mitglieder', 'people'], ['basic', 'Grundeinstellungen', 'gear'], ['colors', 'Personalisierung', 'palette'],
    ['bg', 'Hintergrund', 'palette'], ['bdays', 'Geburtstage', 'cake'], ['displays', 'Displays', 'screen']
];
export function Settings() {
    const snap = useSnapshot();
    const [sub, setSub] = useState(null);
    const [crop, setCrop] = useState(null);
    const me = snap.members.find(m => m.id === snap.me);
    const s = snap.family.settings;
    const isAdmin = me.role === 'admin';
    const upd = (p, msg) => store.updateSettings(p).then(() => toast(msg), fail);
    if (!sub) {
        const next = upcoming(snap.birthdays)[0];
        const info = {
            family: `${snap.members.length} Mitglieder · Admin: ${snap.members.filter(m => m.role === 'admin').map(m => m.name).join(', ')}`,
            basic: `Geburtstage ${s.bdLead ? `${s.bdLead} Tage vorher` : 'aus'} · Board ${s.ttlHours < 48 ? `${s.ttlHours} Std.` : `${s.ttlHours / 24} Tage`} · Fahrzeiten ${s.showTravel ? 'an' : 'aus'}`,
            colors: 'Farbe und Avatar jeder Person',
            bg: 'Unifarbener Hintergrund für App und Display',
            bdays: `${snap.birthdays.length} eingetragen${next ? ` · ${next.name} ${inDays(next.days)}` : ''}`,
            displays: `${snap.displays.length || 'Kein'} Display${snap.displays.length === 1 ? '' : 's'} · Board ${s.boardMode === 'fixed' ? 'fest' : 'dynamisch'}`
        };
        return _jsxs(_Fragment, { children: [_jsxs("div", { className: "mem", children: [_jsx(Badge, { m: me, size: 30 }), _jsxs("div", { children: [_jsx("div", { className: "nm", children: me.name }), _jsxs("div", { className: "sub", children: [ROLE[me.role], " \u00B7 ", snap.family.name] })] }), _jsx("span", {}), store.demo && _jsxs("div", { className: "acts", children: [_jsx("span", { className: "badge-demo", children: "Demo-Modus" }), _jsxs("label", { className: "note", children: ["Handy von ", _jsx("select", { value: snap.me, onChange: e => store.switchUser?.(e.target.value), children: snap.members.filter(m => m.role !== 'child').map(m => _jsx("option", { value: m.id, children: m.name }, m.id)) })] })] })] }), MENU.map(([k, l, ic]) => _jsxs("button", { type: "button", className: "menu-item", onClick: () => setSub(k), children: [_jsx("span", { className: "mi-ic", children: _jsx(Icon, { name: ic }) }), _jsxs("span", { children: [_jsx("b", { children: l }), _jsx("small", { children: info[k] })] }), _jsx("span", { className: "chev", children: "\u203A" })] }, k)), (native()?.appUpdate?.() ?? 0) > 0 && _jsxs("button", { type: "button", className: "menu-item upd", onClick: () => native().installUpdate?.(), children: [_jsx("span", { className: "mi-ic", children: _jsx(Icon, { name: "spark" }) }), _jsxs("span", { children: [_jsxs("b", { children: ["Neue Version ", native().appUpdate(), " installieren"] }), _jsx("small", { children: "Ein Tipp: l\u00E4dt und installiert die Android-App" })] }), _jsx("span", { className: "chev", children: "\u203A" })] }), native() && _jsxs("button", { type: "button", className: "menu-item", onClick: () => native().setup(), children: [_jsx("span", { className: "mi-ic", children: _jsx(Icon, { name: "gear" }) }), _jsxs("span", { children: [_jsx("b", { children: native().platform === 'ios' ? 'Widget' : 'Widget & Handy-Kalender' }), _jsx("small", { children: native().platform === 'ios' ? 'So legst du das FamTO-Widget auf den Startbildschirm' : 'Widget einrichten, Abgleich, Home-Modus, neue Version' })] }), _jsx("span", { className: "chev", children: "\u203A" })] }), me.role !== 'guest' && _jsx(MicStartRow, {}), me.role !== 'guest' && _jsx(ToneRow, { kind: "ev" }), _jsx("button", { type: "button", className: "small-btn danger", style: { justifySelf: 'start' }, onClick: () => { if (confirm(store.demo ? 'Alle Demo-Daten löschen?' : 'Auf diesem Handy abmelden? Zum Zurückkommen brauchst du einen neuen Einladungscode vom Admin.'))
                        void store.reset(); }, children: store.demo ? 'Demo zurücksetzen' : 'Abmelden' }), _jsxs("span", { className: "note", children: ["Version vom ", __BUILD__] })] });
    }
    const label = MENU.find(([k]) => k === sub)[1];
    const lock = !isAdmin && _jsxs("div", { className: "ai", children: [_jsx(Icon, { name: "lock" }), _jsx("div", { children: "\u00C4ndern kann nur der Admin." })] });
    let content = null;
    if (sub === 'family')
        content = _jsx(Family, {});
    if (sub === 'basic')
        content = _jsxs(_Fragment, { children: [lock, _jsx(Sel, { isAdmin: isAdmin, icon: "cake", text: "Geburtstags-Erinnerung", value: s.bdLead, opts: [[0, 'aus'], [3, '3 Tage vorher'], [7, '7 Tage vorher'], [14, '14 Tage vorher'], [21, '21 Tage vorher'], [30, '30 Tage vorher']], onPick: v => upd({ bdLead: v }, v ? `Geburtstage erscheinen ab ${v} Tage vorher.` : 'Geburtstags-Erinnerung aus.') }), _jsx(Sel, { isAdmin: isAdmin, icon: "board", text: "Board-Nachrichten verschwinden nach", value: s.ttlHours, opts: [[12, '12 Std.'], [24, '1 Tag'], [72, '3 Tagen'], [168, '1 Woche']], onPick: v => upd({ ttlHours: v }, 'Gespeichert.') }), _jsxs("label", { className: "setrow", children: [_jsxs("span", { children: [_jsx(Icon, { name: "car" }), " Fahrzeiten anzeigen"] }), isAdmin ? _jsx("input", { type: "checkbox", className: "sw", checked: s.showTravel, onChange: e => upd({ showTravel: e.target.checked }, e.target.checked ? 'Fahrzeiten werden angezeigt.' : 'Fahrzeiten ausgeblendet.') }) : _jsx("b", { children: s.showTravel ? 'ja' : 'nein' })] }), s.showTravel && _jsxs(_Fragment, { children: [_jsxs("label", { className: "setrow", children: [_jsxs("span", { children: [_jsx(Icon, { name: "home" }), " Zuhause (Start f\u00FCr Fahrten)"] }), isAdmin ? _jsx("input", { defaultValue: s.home, placeholder: "Stra\u00DFe Nr., PLZ Ort", onBlur: e => e.target.value.trim() !== s.home && upd({ home: e.target.value.trim() }, 'Zuhause-Adresse gespeichert.') }) : _jsx("b", { children: s.home || '–' })] }), _jsx(Sel, { isAdmin: isAdmin, icon: "clock", text: "Erinnerung an den Fahrer", value: s.remind, opts: [[0, 'aus'], [5, '5 Min. vor Abfahrt'], [10, '10 Min. vor Abfahrt'], [15, '15 Min. vor Abfahrt'], [20, '20 Min. vor Abfahrt'], [30, '30 Min. vor Abfahrt']], onPick: v => upd({ remind: v }, 'Gespeichert.') }), _jsx(Sel, { isAdmin: isAdmin, icon: "car", text: "Puffer vor Abfahrt", value: s.buffer, opts: [[0, 'keiner'], [5, '5 Min.'], [10, '10 Min.'], [15, '15 Min.']], onPick: v => upd({ buffer: v }, 'Gespeichert.') })] }), _jsx(Sel, { isAdmin: isAdmin, icon: "clock", text: "Vergangene Termine von heute", value: s.pastMode, opts: [['fade', 'blass zeigen'], ['hide', 'ausblenden']], onPick: v => upd({ pastMode: v }, 'Gespeichert.') }), _jsx(Sel, { isAdmin: isAdmin, icon: "week", text: "Display: Vorschau", value: s.ahead, opts: [1, 2, 3, 4, 5, 6, 7].map(v => [v, v === 1 ? 'nur morgen' : `${v} Tage`]), onPick: v => upd({ ahead: v }, 'Gespeichert.') }), _jsx(Sel, { isAdmin: isAdmin, icon: "clock", text: "Display: Vorschau ab", value: s.split, opts: [[0, 'immer zeigen'], ...[10, 11, 12, 13, 14, 15, 16, 17, 18].map(h => [h * 60, `${h}:00 Uhr`])], onPick: v => upd({ split: v }, 'Gespeichert.'), show: s.split ? `${hm(s.split)} Uhr` : 'immer' }), _jsx("span", { className: "note", children: "Vor dieser Uhrzeit zeigt das Display im Flur nur den heutigen Tag, gro\u00DF und gut lesbar." })] });
    if (sub === 'colors')
        content = _jsxs(_Fragment, { children: [_jsxs("p", { className: "note", children: ["Statt des Buchstabens kann jede Person ein Foto als Avatar haben, die Farbe bleibt als Ring drumherum. Die Farbe erscheint als Balken und zarte T\u00F6nung bei allen Terminen der Person, in der App und auf dem Display. ", isAdmin ? 'Als Admin kannst du alle Farben ändern.' : 'Du kannst deine eigene Farbe ändern.'] }), snap.members.map(m => {
                    const can = isAdmin || m.id === snap.me;
                    const twin = snap.members.filter(o => o.id !== m.id && o.color.toLowerCase() === m.color.toLowerCase()).map(o => o.name);
                    return _jsxs("div", { className: "colrow", children: [_jsxs("div", { className: "nm", children: [_jsx(Badge, { m: m, size: 36 }), " ", _jsx("b", { children: m.name }), twin.length > 0 && _jsxs("span", { className: "note", children: ["gleiche Farbe wie ", twin.join(', ')] })] }), can && _jsxs("div", { className: "sw", children: [SWATCHES.map(([h, l]) => _jsx("button", { type: "button", className: `swb${m.color.toLowerCase() === h ? ' on' : ''}`, style: cvar(h), "aria-label": l, title: l, onClick: () => store.updateMember(m.id, { color: h }).catch(fail) }, h)), _jsxs("label", { className: "swb own", title: "Eigene Farbe", style: cvar(m.color), children: [_jsx("input", { type: "color", value: m.color, onChange: e => store.updateMember(m.id, { color: e.target.value }).catch(fail), "aria-label": `Eigene Farbe für ${m.name}` }), "+"] })] }), can && _jsxs("div", { className: "av-row", children: [m.avatar && _jsxs("label", { className: "av-use", children: [_jsx("input", { type: "checkbox", checked: !m.avatar.startsWith('off:'), onChange: e => store.useAvatar(m.id, e.target.checked).catch(fail) }), " Avatar benutzen"] }), _jsxs("label", { className: "small-btn", children: [_jsx(Icon, { name: "camera" }), " ", m.avatar ? 'Anderes Foto' : 'Foto als Avatar', _jsx("input", { type: "file", accept: "image/*", hidden: true, onChange: e => { const f = e.target.files?.[0]; e.target.value = ''; if (f)
                                                    setCrop({ id: m.id, file: f }); } })] }), m.avatar && _jsx("button", { type: "button", className: "small-btn danger", onClick: () => { if (confirm('Foto löschen?'))
                                            store.setAvatar(m.id, null).then(() => toast('Foto gelöscht, wieder der Buchstabe.'), fail); }, children: "L\u00F6schen" })] })] }, m.id);
                })] });
    if (sub === 'bg')
        content = _jsxs(_Fragment, { children: [_jsxs("div", { className: "colrow", children: [_jsxs("div", { className: "nm", children: [_jsx("b", { children: "App" }), _jsx("span", { className: "note", children: "nur auf deinem Handy" })] }), _jsx(BgPick, { cur: me.app_bg ?? '', pick: h => store.updateMember(me.id, { app_bg: h || null }).catch(fail) })] }), _jsxs("div", { className: "colrow", children: [_jsxs("div", { className: "nm", children: [_jsx("b", { children: "Display im Flur" }), _jsx("span", { className: "note", children: isAdmin ? 'gilt für alle' : 'ändern kann nur der Admin' })] }), isAdmin && _jsx(BgPick, { cur: s.wbg, pick: h => upd({ wbg: h }, 'Display-Hintergrund gespeichert.') })] }), _jsx("p", { className: "note", children: "Display \u201EStandard\u201C ist dunkel wie das Widget. Eine helle Farbe schaltet das Display auf hell. Beim E-Ink-Display erscheint die Farbe als Grauton." })] });
    if (sub === 'bdays')
        content = _jsx(Bdays, {});
    if (sub === 'displays')
        content = _jsx(Displays, {});
    return _jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: "back", onClick: () => setSub(null), children: "\u2039 Einstellungen" }), _jsx("div", { className: "day-h", style: { marginTop: 0 }, children: _jsx("span", { style: { fontSize: 17, color: 'var(--ink)' }, children: label }) }), content, crop && _jsx(AvatarCrop, { file: crop.file, color: snap.members.find(m => m.id === crop.id)?.color ?? '#7a8590', close: () => setCrop(null), done: img => { const id = crop.id; setCrop(null); store.setAvatar(id, img).then(() => toast('Avatar gespeichert.'), fail); } })] });
}
function Sel({ isAdmin, icon, text, value, opts, onPick, show }) {
    return (_jsxs("label", { className: "setrow", children: [_jsxs("span", { children: [_jsx(Icon, { name: icon }), " ", text] }), isAdmin
                ? _jsx("select", { value: String(value), onChange: e => onPick((typeof value === 'number' ? Number(e.target.value) : e.target.value)), children: opts.map(([v, l]) => _jsx("option", { value: String(v), children: l }, String(v))) })
                : _jsx("b", { children: show ?? opts.find(([v]) => v === value)?.[1] })] }));
}
function BgPick({ cur, pick }) {
    return _jsxs("div", { className: "sw", children: [BGS.map(([h, l]) => _jsx("button", { type: "button", className: `swb bgs${cur === h ? ' on' : ''}`, style: cvar(h || '#ffffff'), "aria-label": l, title: l, onClick: () => pick(h), children: h ? '' : '–' }, l)), _jsxs("label", { className: "swb bgs own", title: "Eigene Farbe", style: cvar(cur || '#ffffff'), children: [_jsx("input", { type: "color", value: cur || '#ffffff', onChange: e => pick(e.target.value), "aria-label": "Eigene Hintergrundfarbe" }), "+"] })] });
}
function Family() {
    const snap = useSnapshot();
    const me = snap.members.find(m => m.id === snap.me);
    const isAdmin = me.role === 'admin';
    const [codes, setCodes] = useState({});
    const [name, setName] = useState(''), [role, setRole] = useState('member');
    const admins = snap.members.filter(m => m.role === 'admin').length;
    const invite = async (id) => { try {
        const c = await store.createInvite(id);
        setCodes({ ...codes, [id]: c });
    }
    catch (e) {
        fail(e);
    } };
    return _jsxs(_Fragment, { children: [!isAdmin && _jsxs("div", { className: "ai", children: [_jsx(Icon, { name: "lock" }), _jsx("div", { children: "Mitglieder hinzuf\u00FCgen und entfernen kann nur der Admin." })] }), snap.members.map(m => (_jsxs("div", { className: "mem", children: [_jsx(Badge, { m: m, size: 30 }), _jsxs("div", { children: [_jsxs("div", { className: "nm", children: [m.name, m.id === snap.me ? ' (du)' : ''] }), _jsxs("div", { className: "sub", children: [ROLE[m.role], m.role !== 'child' ? (m.linked ? ' · App verbunden' : ' · noch nicht verbunden') : ''] })] }), isAdmin && m.id !== snap.me ? _jsx("select", { "aria-label": `Rolle von ${m.name}`, value: m.role, onChange: e => {
                            const v = e.target.value;
                            if (m.role === 'admin' && v !== 'admin' && admins === 1) {
                                toast('Mindestens ein Admin muss bleiben.');
                                return;
                            }
                            store.updateMember(m.id, { role: v, adult: v === 'child' ? false : m.adult }).then(() => toast(`${m.name} ist jetzt: ${ROLE[v]}.`), fail);
                        }, children: Object.entries(ROLE).map(([k, l]) => _jsx("option", { value: k, children: l }, k)) }) : _jsx("span", {}), isAdmin && m.id !== snap.me && _jsxs("div", { className: "acts", children: [m.role !== 'child' && !m.linked && _jsx("button", { type: "button", className: "small-btn", onClick: () => void invite(m.id), children: "Einladungscode" }), m.role !== 'child' && m.linked && _jsx("button", { type: "button", className: "small-btn", onClick: () => void invite(m.id), children: "Neues Handy verbinden" }), _jsx("button", { type: "button", className: "small-btn danger", onClick: () => { if (confirm(`${m.name} aus der Familie entfernen?`))
                                    store.removeMember(m.id).then(() => toast(`${m.name} entfernt.`), fail); }, children: "Entfernen" }), codes[m.id] && _jsxs("div", { style: { width: '100%' }, children: [_jsx("div", { className: "codebox", children: codes[m.id] }), _jsxs("span", { className: "note", children: [m.name, " \u00F6ffnet die App, tippt \u201EIch habe einen Einladungscode\u201C und gibt den Code ein. G\u00FCltig 7 Tage."] })] })] })] }, m.id))), isAdmin && (_jsxs("form", { className: "addform", onSubmit: e => {
                    e.preventDefault();
                    if (!name.trim())
                        return;
                    const used = new Set(snap.members.map(m => m.color.toLowerCase()));
                    const color = SWATCHES.find(([h]) => !used.has(h))?.[0] ?? SWATCHES[snap.members.length % SWATCHES.length][0];
                    store.addMember({ name: name.trim(), role, color, adult: role !== 'child' }).then(() => { setName(''); toast(role === 'child' ? 'Hinzugefügt. Kinder ohne Handy sind sofort dabei.' : 'Hinzugefügt. Jetzt einen Einladungscode erzeugen.'); }, fail);
                }, children: [_jsx("b", { children: "Mitglied hinzuf\u00FCgen" }), _jsxs("div", { className: "two", children: [_jsx("input", { value: name, onChange: e => setName(e.target.value), placeholder: "Name", required: true }), _jsx("select", { value: role, onChange: e => setRole(e.target.value), children: Object.entries(ROLE).filter(([k]) => k !== 'admin').map(([k, l]) => _jsx("option", { value: k, children: l }, k)) })] }), _jsx("button", { className: "btn", children: "Hinzuf\u00FCgen" }), _jsx("span", { className: "note", children: "Mitglieder und G\u00E4ste verbinden ihr Handy mit einem Einladungscode. Kinder ohne Smartphone sind sofort dabei; Eltern tragen f\u00FCr sie ein." })] }))] });
}
// Formular „Geburtstag eintragen“ (Einstellungen und Geburtstagsübersicht, auch aus dem Widget)
export function BdayForm({ focus, edit, done }) {
    const snap = useSnapshot();
    // Tag und Monat Pflicht, Jahr freiwillig: ohne Jahr kein „wird …“
    const [n, setN] = useState(edit?.name ?? ''), [rel, setRel] = useState(edit?.rel ?? ''), [day, setDay] = useState(edit ? String(edit.day) : ''), [mon, setMon] = useState(edit ? String(edit.month) : ''), [year, setYear] = useState(edit?.year ? String(edit.year) : ''), [priv, setPriv] = useState(!!edit?.owner);
    const y = Number(year);
    const alarm = useAlarm();
    const [wake, setWake] = useState(!!alarm && !!edit && alarmOn(alarm, edit));
    return _jsxs("form", { className: "addform", onSubmit: e => {
            e.preventDefault();
            if (!n.trim() || !day || !mon)
                return;
            const b = { name: n.trim(), rel: rel.trim(), day: Number(day), month: Number(mon), year: y > 1900 && y <= new Date().getFullYear() ? y : null, owner: priv ? snap.me : null };
            const others = snap.birthdays.filter(x => x.id !== edit?.id);
            const wakeUp = () => { const a = getAlarm(); if (a && alarmOn(a, b) !== wake)
                toggleAlarm(b, wake, [...others, b]); };
            if (edit) {
                store.updateBirthday(edit, b).then(() => { if (alarm) {
                    renameAlarm(edit, b);
                    wakeUp();
                } toast('Geburtstag geändert.'); done?.(); }, fail);
                return;
            }
            store.addBirthday(b).then(() => { wakeUp(); setN(''); setRel(''); setDay(''); setMon(''); setYear(''); setPriv(false); setWake(false); toast(wake ? 'Geburtstag eingetragen, der Wecker klingelt.' : 'Geburtstag eingetragen.'); }, fail);
        }, children: [_jsx("b", { children: edit ? `${edit.name} bearbeiten` : 'Geburtstag eintragen' }), edit?.ext_id && _jsx("span", { className: "note", children: "Kommt aus deinem Handy-Kalender. \u00C4nderungen besser dort machen, sonst \u00FCberschreibt der n\u00E4chste Abgleich sie." }), _jsxs("div", { className: "two", children: [_jsx("input", { value: n, onChange: e => setN(e.target.value), placeholder: "Name", required: true, autoFocus: focus || !!edit }), _jsx("input", { value: rel, onChange: e => setRel(e.target.value), placeholder: "z. B. Patentante" })] }), _jsxs("div", { className: "bdate", children: [_jsxs("label", { className: "field", children: [_jsx("span", { children: "Tag" }), _jsxs("select", { value: day, onChange: e => setDay(e.target.value), required: true, children: [_jsx("option", { value: "", children: "\u2013" }), Array.from({ length: 31 }, (_, i) => _jsxs("option", { value: i + 1, children: [i + 1, "."] }, i))] })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Monat" }), _jsxs("select", { value: mon, onChange: e => setMon(e.target.value), required: true, children: [_jsx("option", { value: "", children: "\u2013" }), MON.map((m, i) => _jsx("option", { value: i + 1, children: m }, m))] })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Jahr (freiwillig)" }), _jsx("input", { type: "number", inputMode: "numeric", min: 1900, max: new Date().getFullYear(), value: year, onChange: e => setYear(e.target.value), placeholder: "unbekannt" })] })] }), _jsxs("label", { className: "setrow", children: [_jsxs("span", { children: [_jsx(Icon, { name: "lock" }), " Privat: nur ich sehe ihn (Freunde, Kollegen \u2026)"] }), _jsx("input", { type: "checkbox", checked: priv, onChange: e => setPriv(e.target.checked) })] }), alarm && _jsxs("label", { className: "setrow", children: [_jsxs("span", { children: [_jsx(Icon, { name: "alarm" }), " Wecker am Geburtstag um ", hm(alarm.min), " Uhr (dieses Handy)"] }), _jsx("input", { type: "checkbox", checked: wake, onChange: e => setWake(e.target.checked) })] }), edit ? _jsxs("div", { className: "btn-row", children: [_jsx("button", { type: "button", className: "btn ghost", onClick: done, children: "Abbrechen" }), _jsx("button", { className: "btn", children: "Speichern" })] }) : _jsx("button", { className: "btn", children: "Eintragen" })] });
}
// Lange drücken öffnet einen Geburtstag zum Bearbeiten
function BdayRow({ b, lead, canEdit, onEdit, wake, onWake }) {
    const timer = useRef(undefined);
    const press = () => { window.clearTimeout(timer.current); if (canEdit)
        timer.current = window.setTimeout(() => { navigator.vibrate?.(20); onEdit(); }, 550); };
    const release = () => window.clearTimeout(timer.current);
    return _jsxs("div", { className: `bdrow${lead && b.days <= lead ? ' soon' : ''}`, onPointerDown: press, onPointerUp: release, onPointerLeave: release, onPointerCancel: release, onContextMenu: x => { if (canEdit)
            x.preventDefault(); }, children: [_jsxs("div", { children: [_jsxs("b", { children: [b.owner ? _jsxs(_Fragment, { children: [_jsx(Icon, { name: "lock" }), " "] }) : '', b.name] }), _jsxs("small", { children: [b.owner ? 'privat · ' : '', b.rel ? `${b.rel} · ` : '', bdLabel(b), b.age ? ` · wird ${b.age}` : ''] })] }), _jsxs("span", { className: "dd", children: [inDays(b.days), " ", onWake && _jsx("button", { type: "button", className: `small-btn alarm-btn${wake ? ' on' : ''}`, "aria-pressed": wake, "aria-label": `Wecker für ${b.name} ${wake ? 'aus' : 'an'}`, title: "Geburtstags-Wecker", onPointerDown: x => x.stopPropagation(), onClick: onWake, children: _jsx(Icon, { name: "alarm" }) }), " ", canEdit && _jsx("button", { type: "button", className: "small-btn danger", "aria-label": `${b.name} entfernen`, onPointerDown: x => x.stopPropagation(), onClick: () => store.removeBirthday(b.id).catch(fail), children: "\u00D7" })] })] });
}
function Bdays() {
    const snap = useSnapshot();
    const me = snap.members.find(m => m.id === snap.me);
    const s = snap.family.settings;
    const [edit, setEdit] = useState(null);
    const can = me.role !== 'guest';
    const alarm = useAlarm();
    if (edit)
        return _jsx(BdayForm, { edit: edit, done: () => setEdit(null) }, edit.id);
    const t = alarm ? hm(alarm.min) : '';
    return _jsxs(_Fragment, { children: [alarm ? _jsxs("div", { className: "alarm-box", children: [_jsxs("b", { children: [_jsx(Icon, { name: "alarm" }), " Geburtstags-Wecker auf diesem Handy"] }), _jsxs("label", { className: "setrow", children: [_jsx("span", { children: "Klingelt am Geburtstag um" }), _jsx("input", { type: "time", value: t, onChange: e => { const [h, m] = e.target.value.split(':').map(Number); if (!isNaN(h) && !isNaN(m))
                                    setAlarm({ ...alarm, min: h * 60 + m }); } })] }), _jsxs("label", { className: "setrow", children: [_jsx("span", { children: "F\u00FCr alle Geburtstage" }), _jsx("input", { type: "checkbox", className: "sw", checked: alarm.all, onChange: e => { setAlarm({ ...alarm, all: e.target.checked, keys: [] }); toast(e.target.checked ? `Der Wecker klingelt an jedem Geburtstag um ${hm(alarm.min)} Uhr.` : 'Wecker für alle aus. Einzelne mit dem Wecker-Symbol einschalten.'); } })] }), _jsx(ToneRow, { kind: "bd" }), _jsxs("span", { className: "note", children: [alarm.all ? _jsxs(_Fragment, { children: ["Einzelne mit ", _jsx(Icon, { name: "alarm" }), " ausschalten."] }) : _jsxs(_Fragment, { children: ["Oder einzelne Geburtstage mit ", _jsx(Icon, { name: "alarm" }), " einschalten."] }), " Der Wecker klingelt mit Namen, bis du ihn ausschaltest."] })] }) : !store.demo && _jsx("p", { className: "note", children: "Einen Geburtstags-Wecker mit Namen kannst du in der Android-App von FamTO stellen." }), can && snap.birthdays.length > 0 && _jsx("p", { className: "note", children: "Zum \u00C4ndern einen Geburtstag lange dr\u00FCcken." }), _jsx("div", { children: upcoming(snap.birthdays).map(b => _jsx(BdayRow, { b: b, lead: s.bdLead, canEdit: can, onEdit: () => setEdit(snap.birthdays.find(x => x.id === b.id) ?? null), wake: alarm ? alarmOn(alarm, b) : undefined, onWake: alarm ? () => { const on = !alarmOn(alarm, b); toggleAlarm(b, on, snap.birthdays); toast(on ? `Wecker für ${b.name} an.` : `Wecker für ${b.name} aus.`); } : undefined }, b.id)) }), can && _jsx(BdayForm, {})] });
}
function Displays() {
    const snap = useSnapshot();
    const me = snap.members.find(m => m.id === snap.me);
    const s = snap.family.settings;
    const isAdmin = me.role === 'admin';
    const base = `${location.origin}${location.pathname}`;
    // Persönlicher Code: Widget zeigt Familientermine und die eigenen privaten Termine
    const widget = !store.demo && _jsxs("div", { className: "mem", children: [_jsx("span", { className: "b", style: cvar('var(--accent)'), children: "H" }), _jsxs("div", { children: [_jsx("div", { className: "nm", children: "Mein Handy-Widget" }), _jsx("div", { className: "sub", children: "Familientermine und meine privaten Termine" })] }), _jsx("span", {}), _jsx("div", { className: "acts", children: _jsx("button", { type: "button", className: "small-btn", onClick: () => store.widgetToken().then(t => navigator.clipboard?.writeText('FK1:' + btoa(JSON.stringify({ u: SUPA.url, k: SUPA.key, t, a: base })))).then(() => toast('Widget-Code kopiert. Jetzt in der Widget-App einfügen.'), fail), children: "Widget-Code f\u00FCr Android kopieren" }) })] });
    if (!isAdmin)
        return _jsxs(_Fragment, { children: [widget, _jsxs("div", { className: "ai", children: [_jsx(Icon, { name: "lock" }), _jsx("div", { children: "Displays verwaltet der Admin." })] })] });
    return _jsxs(_Fragment, { children: [widget, _jsx("p", { className: "note", children: "Jedes Display ruft die Familienseite unter einer eigenen, geheimen Adresse auf. Diese Adresse im WYSCREEN als Webseite eintragen. Entfernen macht die Adresse sofort ung\u00FCltig." }), snap.displays.map(d => {
                const tall = (s.tall ?? []).includes(d.id);
                const url = `${base}${tall ? '?v=hoch' : ''}#/display/${d.token}`;
                return _jsxs("div", { className: "mem", children: [_jsx("span", { className: "b", style: cvar('var(--muted)'), children: "W" }), _jsxs("div", { children: [_jsx("div", { className: "nm", children: d.name }), _jsxs("div", { className: "sub", children: ["nur Familientermine", d.touch ? ' · mit Eingabe' : ''] })] }), _jsx("span", {}), _jsxs("div", { className: "acts", style: { display: 'grid' }, children: [_jsxs("label", { className: "setrow", children: [_jsx("span", { children: "\uD83D\uDC46 Touch-Display: Termine und Board-Nachrichten direkt am Display eingeben" }), _jsx("input", { type: "checkbox", checked: !!d.touch, onChange: e => store.setDisplayTouch(d.id, e.target.checked).then(() => toast(e.target.checked ? 'Eingabe am Display eingeschaltet.' : 'Eingabe am Display ausgeschaltet.'), fail) })] }), _jsxs("label", { className: "setrow", children: [_jsx("span", { children: "\uD83D\uDCF1 Hochkant wie das Widget: Bildschirm h\u00E4ngt hochkant" }), _jsx("input", { type: "checkbox", checked: tall, onChange: e => { const on = e.target.checked; store.updateSettings({ tall: on ? [...(s.tall ?? []), d.id] : (s.tall ?? []).filter(x => x !== d.id) }).then(() => toast(on ? 'Hochkant-Ansicht an. Bitte die neue Adresse am Display eintragen.' : 'Hochkant-Ansicht aus. Bitte die neue Adresse am Display eintragen.'), fail); } })] }), _jsx("div", { className: "urlbox", children: url }), _jsxs("span", { className: "note", children: ["Varianten: ", _jsx("code", { children: "?v=bigme" }), ", ", _jsx("code", { children: "?v=qm" }), ", ", _jsx("code", { children: "?v=color" }), ", ", _jsx("code", { children: "?v=eink" }), ", ", _jsx("code", { children: "?v=hoch" }), " vor dem # anh\u00E4ngen. Ein hochkant h\u00E4ngender Bildschirm zeigt die Widget-Ansicht auch von selbst. ", _jsx("code", { children: "?r=5" }), " l\u00E4dt alle 5 Sekunden neu, beides zusammen mit ", _jsx("code", { children: "?v=qm&r=5" }), "."] }), _jsxs("div", { style: { display: 'flex', gap: 6, flexWrap: 'wrap' }, children: [_jsx("button", { type: "button", className: "small-btn", onClick: () => navigator.clipboard?.writeText(url).then(() => toast('Adresse kopiert.')), children: "Adresse kopieren" }), _jsx("a", { className: "small-btn", href: url, target: "_blank", rel: "noreferrer", children: "Ansehen" }), !store.demo && _jsx("button", { type: "button", className: "small-btn danger", onClick: () => { if (confirm('Display entfernen? Die Adresse funktioniert dann nicht mehr.'))
                                                store.removeDisplay(d.id).catch(fail); }, children: "Entfernen" })] })] })] }, d.id);
            }), !store.demo && _jsx("button", { type: "button", className: "small-btn", style: { justifySelf: 'start' }, onClick: () => store.addDisplay(`Display ${snap.displays.length + 1}`).then(() => toast('Neues Display angelegt.'), fail), children: "Weiteres Display anlegen" }), _jsxs("label", { className: "setrow", children: [_jsxs("span", { children: [_jsx(Icon, { name: "board" }), " Board am Display"] }), _jsxs("select", { value: s.boardMode, onChange: e => store.updateSettings({ boardMode: e.target.value }).catch(fail), children: [_jsx("option", { value: "dynamic", children: "dynamisch" }), _jsx("option", { value: "fixed", children: "fest: rechtes Drittel" })] })] }), _jsx("p", { className: "note", children: "Dynamisch: Das Board bekommt den Platz neben den Terminen. Fest: Das rechte Drittel geh\u00F6rt immer dem Board." })] });
}
// Klingelton der Wecker auf diesem Handy (Android-App)
export function ToneRow({ kind }) {
    const t = useTones();
    if (!t)
        return null;
    const cur = t[kind];
    return _jsxs("label", { className: "setrow", children: [_jsxs("span", { className: "tone-l", children: [_jsx(Icon, { name: "alarm" }), " ", kind === 'bd' ? 'Klingelton' : 'Klingelton für Termin-Wecker'] }), _jsxs("select", { value: cur.which, onChange: e => setTone(kind, e.target.value), children: [_jsx("option", { value: "birthday", children: "Happy Birthday" }), _jsx("option", { value: "beep", children: "Piepen" }), _jsx("option", { value: "alarm", children: "Weckton des Handys" }), cur.which === 'custom' && _jsx("option", { value: "custom", children: cur.title }), _jsx("option", { value: "pick", children: "Anderer Ton vom Handy \u2026" })] })] });
}
// Nur für dieses Handy: App öffnet direkt die Spracheingabe (praktisch mit der Samsung-Seitentaste)
function MicStartRow() {
    const [on, setOn] = useState(micStart());
    return _jsxs(_Fragment, { children: [_jsxs("label", { className: "setrow", children: [_jsxs("span", { children: [_jsx(Icon, { name: "mic" }), " Beim \u00D6ffnen sofort Spracheingabe"] }), _jsx("input", { type: "checkbox", className: "sw", checked: on, onChange: e => { setMicStart(e.target.checked); setOn(e.target.checked); toast(e.target.checked ? 'Die App startet jetzt direkt mit dem Mikrofon.' : 'Die App startet wieder normal.'); } })] }), _jsx("span", { className: "note", children: "Gilt nur f\u00FCr dieses Handy. Zusammen mit der Seitentaste ist das die schnellste Eingabe." })] });
}
