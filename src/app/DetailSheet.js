import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { store, useSnapshot } from '../lib/store';
import { fail, toast } from './toast';
import { hm, today } from '../lib/dates';
import { travelTime } from '../lib/ai';
import { bdLabel, depart, etaMin, nameOf, travel, upcoming, visLabel, whenText } from '../lib/model';
import { inDays } from '../lib/dates';
import { Badges, cvar, Icon, Sheet } from './ui';
import { useState } from 'react';
import { BdayForm } from './Settings';
// Links in Notizen anklickbar machen (z. B. Teams-Besprechung)
const linkify = (t) => t.split(/(https?:\/\/[^\s<>"]+)/g).map((p, i) => i % 2 ? _jsx("a", { href: p, target: "_blank", rel: "noopener noreferrer", children: /teams\.(microsoft|live)\.com/.test(p) ? 'Teams-Besprechung öffnen' : p }, i) : p);
const Row = ({ k, children }) => _jsxs("div", { className: "r", children: [_jsx("span", { children: k }), _jsx("div", { children: children })] });
export function DetailSheet({ id, day, add, close, edit }) {
    const snap = useSnapshot();
    const s = snap.family.settings;
    const e = snap.events.find(x => x.id === id);
    const [here, setHere] = useState(null);
    const [busy, setBusy] = useState(false);
    if (!e)
        return null;
    const me = snap.members.find(m => m.id === snap.me);
    const canEdit = me.role !== 'guest' && (e.owner === snap.me || e.vis === 'family');
    const tr = travel(e, s), dep = depart(e, s);
    const toDraft = () => ({
        id: e.id, title: e.title, date: e.date, end_date: e.end_date, all_day: e.all_day, start_min: e.start_min, end_min: e.end_min,
        persons: [...e.persons], driver: e.driver, vis: e.vis === 'family' ? 'family' : 'private', busy: e.vis === 'busy', place: e.place, addr: e.addr,
        travel_min: e.travel_min, notes: e.notes, bring: [...e.bring], discreet: e.discreet, reason: '', suggested: e.vis === 'family' ? 'family' : 'private', timeFound: !e.all_day
    });
    const nav = `https://www.google.com/maps/dir/?api=1&travelmode=driving&dir_action=navigate&destination=${encodeURIComponent(e.addr)}`;
    const iDrive = e.driver === snap.me;
    const eta = etaMin(e);
    // Navigation starten: Google Maps öffnen; fährt man selbst, sieht die Familie „unterwegs“ mit Ankunftszeit
    const startNav = () => {
        window.open(nav, '_blank');
        if (!iDrive)
            return;
        const set = (min) => store.setEta(e.id, new Date(Date.now() + min * 60000).toISOString()).catch(() => { });
        if (here) {
            void set(here.minutes);
            return;
        }
        navigator.geolocation?.getCurrentPosition(p => travelTime(`${p.coords.latitude.toFixed(5)},${p.coords.longitude.toFixed(5)}`, e.addr).then(r => set(r.minutes), () => { }), () => { }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 120000 });
    };
    const fromHere = () => {
        if (!navigator.geolocation) {
            toast('Standort ist auf diesem Gerät nicht verfügbar.');
            return;
        }
        setBusy(true);
        navigator.geolocation.getCurrentPosition(p => travelTime(`${p.coords.latitude.toFixed(5)},${p.coords.longitude.toFixed(5)}`, e.addr).then(setHere, fail).finally(() => setBusy(false)), () => { setBusy(false); toast('Standort nicht freigegeben. Bitte in den Einstellungen des Handys erlauben.'); }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 120000 });
    };
    const maps = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(e.addr)}${s.home ? `&origin=${encodeURIComponent(s.home)}` : ''}`;
    return (_jsxs(Sheet, { onClose: close, label: "Termindetails", children: [_jsx("h2", { children: e.title }), _jsxs("div", { className: "dl", children: [_jsx(Row, { k: "Wann", children: whenText(e) }), _jsx(Row, { k: "Wer", children: e.persons.length ? _jsxs(_Fragment, { children: [_jsx(Badges, { ids: e.persons, members: snap.members }), " ", e.persons.map(p => nameOf(snap.members, p)).join(', ')] }) : 'Niemand bestimmtes' }), e.driver && _jsxs(Row, { k: "Fahrdienst", children: [nameOf(snap.members, e.driver), " f\u00E4hrt"] }), (e.place || e.addr) && _jsxs(Row, { k: "Ort", children: [e.place, e.addr && _jsx("small", { className: "addr", children: e.addr })] }), tr > 0 && _jsx(Row, { k: "Fahrt", children: _jsxs("div", { className: "route", style: cvar(snap.members.find(m => m.id === e.driver)?.color ?? '#7a8590'), children: [_jsxs("div", { className: "rt-bar", children: [_jsxs("span", { className: "rt-drive", style: { flex: tr }, children: [_jsx(Icon, { name: "car" }), " ", tr, " Min."] }), s.buffer > 0 && _jsx("span", { className: "rt-buf", style: { flex: Math.max(s.buffer, 4) }, children: s.buffer })] }), _jsxs("div", { className: "rt-times", children: [_jsxs("span", { children: [_jsx("b", { children: hm(dep) }), " losfahren"] }), _jsxs("span", { children: [_jsx("b", { children: hm(e.start_min) }), " Beginn"] })] }), e.addr && _jsx("a", { className: "btn ghost sm", href: maps, target: "_blank", rel: "noreferrer", children: "Route von zu Hause" })] }) }), e.addr && _jsxs(Row, { k: "Von hier", children: [here ? _jsxs(_Fragment, { children: [_jsxs("b", { children: [here.minutes, " Min."] }), " \u00B7 ", String(here.km).replace('.', ','), " km", !e.all_day && e.date === today() ? _jsxs(_Fragment, { children: [" \u00B7 los sp\u00E4testens ", _jsx("b", { children: hm(e.start_min - here.minutes - s.buffer) })] }) : null] }) : null, _jsxs("div", { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: here ? 6 : 0 }, children: [_jsx("button", { type: "button", className: "btn ghost sm", disabled: busy, onClick: fromHere, children: busy ? 'Suche Standort …' : here ? 'Neu berechnen' : 'Fahrzeit von hier' }), _jsxs("button", { type: "button", className: "btn sm", onClick: startNav, children: [_jsx(Icon, { name: "car" }), " Navigation starten"] }), iDrive && eta !== null && _jsx("button", { type: "button", className: "btn ghost sm", onClick: () => store.setEta(e.id, null).catch(fail), children: "Angekommen" })] }), eta !== null && _jsxs("div", { className: "note", style: { marginTop: 6 }, children: [nameOf(snap.members, e.driver), " ist unterwegs, Ankunft ca. ", _jsx("b", { children: hm(eta) }), iDrive ? ' (sieht die Familie auch auf dem Display)' : ''] })] }), e.bring.length > 0 && _jsx(Row, { k: "Mitbringen", children: _jsx("div", { className: "bring", children: e.bring.map(b => _jsx("span", { children: b }, b)) }) }), e.notes && _jsx(Row, { k: "Notiz", children: linkify(e.notes) }), _jsxs(Row, { k: "Sichtbar", children: [visLabel(e.vis), e.discreet ? ' · diskret' : ''] }), _jsx(Row, { k: "Angelegt von", children: nameOf(snap.members, e.owner) })] }), _jsxs("div", { className: "btn-row", children: [_jsx("button", { type: "button", className: "btn ghost", onClick: close, children: "Schlie\u00DFen" }), canEdit && _jsx("button", { type: "button", className: "btn", onClick: () => edit(toDraft()), children: "Bearbeiten" }), canEdit && _jsx("button", { type: "button", className: "btn ghost del-btn", "aria-label": "Termin l\u00F6schen", onClick: async () => {
                            try {
                                await store.deleteEvent(e.id);
                                toast(e.ext_id ? 'Gelöscht. Im Handy-Kalender bleibt er, beim nächsten Abgleich kommt er wieder.' : 'Termin gelöscht.');
                                close();
                            }
                            catch (x) {
                                fail(x);
                            }
                        }, children: _jsx(Icon, { name: "trash" }) })] }), add && me.role !== 'guest' && _jsx("button", { type: "button", className: "btn ghost", style: { width: '100%', marginTop: 8 }, onClick: () => add(day ?? e.date), children: "\uFF0B Weiterer Termin an diesem Tag" })] }));
}
export function BdaySheet({ close, adding }) {
    const snap = useSnapshot();
    const s = snap.family.settings;
    return (_jsxs(Sheet, { onClose: close, label: "N\u00E4chste Geburtstage", children: [_jsx("h2", { children: "N\u00E4chste Geburtstage" }), _jsxs("p", { children: ["Erinnerung ", s.bdLead, " Tage vorher. \u00C4ndern kann das der Admin unter Einstellungen."] }), adding && snap.members.find(m => m.id === snap.me)?.role !== 'guest' && _jsx(BdayForm, { focus: true }), _jsx("div", { children: upcoming(snap.birthdays).map(b => _jsxs("div", { className: `bdrow${b.days <= s.bdLead ? ' soon' : ''}`, children: [_jsxs("div", { children: [_jsxs("b", { children: [b.owner ? '🔒 ' : '', b.name] }), _jsxs("small", { children: [b.rel ? `${b.rel} · ` : '', bdLabel(b), b.age ? ` · wird ${b.age}` : ''] })] }), _jsx("span", { className: "dd", children: inDays(b.days) })] }, b.id)) }), _jsx("div", { className: "btn-row", children: _jsx("button", { type: "button", className: "btn ghost", onClick: close, children: "Schlie\u00DFen" }) })] }));
}
