import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { store, useSnapshot } from '../lib/store';
import { fail, toast } from './toast';
import { hm, nowMin, today } from '../lib/dates';
import { travelTime } from '../lib/ai';
import { bdLabel, depart, etaDriver, etaMin, isDriver, leg2, nameOf, target, travel, upcoming, visLabel, whenText } from '../lib/model';
import { inDays } from '../lib/dates';
import { Badges, cvar, Icon, Sheet } from './ui';
import { useEffect, useState } from 'react';
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
    // Fahrer öffnet den Termin am selben Tag: Fahrzeit vom aktuellen Standort automatisch berechnen
    const myTarget = e ? (e.driver === snap.me ? target(e) : e.end_min) : 0;
    const auto = !!e && !!e.addr && isDriver(e, snap.me) && !e.all_day && e.date === today() && myTarget > nowMin() && etaMin(e) === null;
    useEffect(() => {
        if (!auto || !e || !navigator.geolocation)
            return;
        let live = true;
        setBusy(true);
        navigator.geolocation.getCurrentPosition(p => travelTime(`${p.coords.latitude.toFixed(5)},${p.coords.longitude.toFixed(5)}`, e.addr).then(r => { if (live)
            setHere(r); }, () => { }).finally(() => { if (live)
            setBusy(false); }), () => { if (live)
            setBusy(false); }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 120000 });
        return () => { live = false; };
    }, [auto, e?.id, e?.addr]); // eslint-disable-line react-hooks/exhaustive-deps
    if (!e)
        return null;
    const me = snap.members.find(m => m.id === snap.me);
    const canEdit = me.role !== 'guest' && (e.owner === snap.me || e.vis === 'family');
    const tr = travel(e, s), dep = depart(e, s);
    const toDraft = () => ({
        id: e.id, title: e.title, date: e.date, end_date: e.end_date, all_day: e.all_day, start_min: e.start_min, end_min: e.end_min,
        persons: [...e.persons], driver: e.driver, trip: e.trip, driver2: e.driver2 ?? null, vis: e.vis === 'family' ? 'family' : 'private', busy: e.vis === 'busy', place: e.place, addr: e.addr,
        travel_min: e.travel_min, notes: e.notes, bring: [...e.bring], discreet: e.discreet, reason: '', suggested: e.vis === 'family' ? 'family' : 'private', timeFound: !e.all_day
    });
    const nav = `https://www.google.com/maps/dir/?api=1&travelmode=driving&dir_action=navigate&destination=${encodeURIComponent(e.addr)}`;
    const iDrive = isDriver(e, snap.me);
    const l2 = leg2(e, s);
    const nm = (id) => nameOf(snap.members, id ?? null);
    const askMe = (e.driver === snap.me && e.driver_ok == null && !!e.driver_by && e.driver_by !== snap.me) || (e.driver2 === snap.me && e.driver2_ok == null && !!e.driver_by && e.driver_by !== snap.me);
    const okMark = (ok) => ok ? ' ✓' : ok === null && e.driver_by ? ' (wartet auf Zusage)' : '';
    const eta = etaMin(e);
    // Navigation starten: Google Maps öffnen; fährt man selbst, sieht die Familie „unterwegs“ mit Ankunftszeit
    const startNav = () => {
        // Erst die Ankunftszeit losschicken, dann Google Maps öffnen: In der Android-App pausiert die Seite, sobald Maps vorne ist
        eta0();
        window.open(nav, '_blank');
    };
    const eta0 = () => {
        // Ohne eingetragenen Fahrer wird, wer die Navigation startet, zum Fahrer (Kinder und Gäste nicht)
        const meM = snap.members.find(m => m.id === snap.me);
        const takeOver = !e.driver && !!meM && meM.role !== 'child' && meM.role !== 'guest';
        if (!iDrive && !takeOver)
            return;
        const set = (min) => store.setEta(e.id, new Date(Date.now() + min * 60000).toISOString(), takeOver ? snap.me : undefined).catch(() => { });
        if (here) {
            void set(here.minutes);
            return;
        }
        // Sofort eine vorläufige Ankunftszeit mit der Fahrzeit von zu Hause, danach genauer vom Standort
        if (e.travel_min)
            void set(e.travel_min);
        navigator.geolocation?.getCurrentPosition(p => travelTime(`${p.coords.latitude.toFixed(5)},${p.coords.longitude.toFixed(5)}`, e.addr).then(r => set(r.minutes), () => { }), () => { }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 120000 });
    };
    const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([e.place, e.addr].filter(Boolean).join(', '))}`;
    return (_jsxs(Sheet, { onClose: close, label: "Termindetails", children: [_jsx("h2", { children: e.title }), _jsxs("div", { className: "dl", children: [_jsx(Row, { k: "Wann", children: whenText(e) }), _jsx(Row, { k: "Wer", children: e.persons.length ? _jsxs(_Fragment, { children: [_jsx(Badges, { ids: e.persons, members: snap.members }), " ", e.persons.map(p => nameOf(snap.members, p)).join(', ')] }) : 'Niemand bestimmtes' }), (e.driver || e.declined_by) && _jsxs(Row, { k: "Fahrdienst", children: [e.driver ? _jsxs(_Fragment, { children: [nm(e.driver), " ", e.trip === 'ab' ? 'holt ab' : e.trip === 'beides' ? 'bringt hin' : 'fährt', okMark(e.driver_ok)] }) : null, e.trip === 'beides' && e.driver2 ? _jsxs(_Fragment, { children: [_jsx("br", {}), nm(e.driver2), " holt ab", okMark(e.driver2_ok)] }) : null, e.declined_by && _jsxs("div", { className: "note", children: [nm(e.declined_by), " kann nicht fahren", e.driver ? '' : '. Bitte jemand anderen eintragen.'] }), askMe && _jsxs("div", { className: "nav-row one", style: { marginTop: 6 }, children: [_jsx("button", { type: "button", className: "btn sm", onClick: () => store.driverAnswer(e.id, true).then(() => toast('Danke, die Familie weiß Bescheid.'), fail), children: "Okay, mach ich" }), _jsx("button", { type: "button", className: "btn ghost sm", onClick: () => store.driverAnswer(e.id, false).then(() => toast('Abgesagt. Wer dich eingetragen hat, bekommt Bescheid.'), fail), children: "Kann nicht" })] })] }), (e.place || e.addr) && _jsxs(Row, { k: "Ort", children: [e.place, e.addr && _jsx("a", { className: "addr", href: maps, target: "_blank", rel: "noreferrer", children: e.addr })] }), tr > 0 && _jsx(Row, { k: "Fahrt", children: _jsx("div", { className: "route", style: cvar(snap.members.find(m => m.id === e.driver)?.color ?? '#7a8590'), children: eta !== null ? _jsxs("div", { className: "rt-times", children: [_jsx("span", { children: _jsxs("b", { children: [nm(etaDriver(e)), " f\u00E4hrt"] }) }), _jsxs("span", { children: ["Ankunft ca. ", _jsx("b", { children: hm(eta) })] })] }) : _jsxs(_Fragment, { children: [_jsxs("div", { className: "rt-bar", children: [_jsxs("span", { className: "rt-drive", style: { flex: tr }, children: [_jsx(Icon, { name: "car" }), " ", tr, " Min."] }), s.buffer > 0 && _jsx("span", { className: "rt-buf", style: { flex: Math.max(s.buffer, 4) }, children: s.buffer })] }), _jsxs("div", { className: "rt-times", children: [_jsxs("span", { children: [_jsx("b", { children: hm(dep) }), " ", e.trip === 'ab' ? 'zum Abholen los' : 'losfahren'] }), _jsxs("span", { children: [_jsx("b", { children: hm(target(e)) }), " ", e.trip === 'ab' ? 'Ende' : 'Beginn'] })] }), l2 && _jsxs("div", { className: "rt-times", children: [_jsxs("span", { children: [_jsx("b", { children: hm(l2.leave) }), " ", nm(l2.who), " zum Abholen los"] }), _jsxs("span", { children: [_jsx("b", { children: hm(l2.at) }), " Ende"] })] })] }) }) }), e.addr && (iDrive || (!e.driver && me.role !== 'child' && me.role !== 'guest')) && _jsxs(Row, { k: "Von hier", children: [busy && eta === null ? _jsx("span", { className: "note", children: "Fahrzeit vom Standort wird berechnet \u2026" }) : here && eta === null ? _jsxs(_Fragment, { children: [_jsxs("b", { children: [here.minutes, " Min."] }), " \u00B7 ", String(here.km).replace('.', ','), " km \u00B7 los sp\u00E4testens ", _jsx("b", { children: hm(myTarget - here.minutes - s.buffer) })] }) : null, _jsxs("div", { className: "nav-row one", style: { marginTop: (here || busy) && eta === null ? 6 : 0 }, children: [_jsxs("button", { type: "button", className: `btn sm nav-btn${iDrive && eta !== null ? " nav-on" : ""}`, onClick: startNav, children: [_jsx(Icon, { name: "car" }), " ", iDrive && eta !== null ? 'Navigation läuft' : 'Navigation starten'] }), iDrive && eta !== null && _jsx("button", { type: "button", className: "btn ghost sm", onClick: () => store.setEta(e.id, null).catch(fail), children: "Angekommen" })] }), eta !== null && _jsxs("div", { className: "note", style: { marginTop: 6 }, children: [nm(etaDriver(e)), " f\u00E4hrt \u00B7 Ankunft ca. ", _jsx("b", { children: hm(eta) }), iDrive ? ' (sieht die Familie auch auf dem Display)' : ''] })] }), e.bring.length > 0 && _jsx(Row, { k: "Mitbringen", children: _jsx("div", { className: "bring", children: e.bring.map(b => _jsx("span", { children: b }, b)) }) }), e.notes && _jsx(Row, { k: "Notiz", children: linkify(e.notes) }), _jsxs(Row, { k: "Sichtbar", children: [visLabel(e.vis), e.discreet ? ' · diskret' : ''] }), _jsx(Row, { k: "Angelegt von", children: nameOf(snap.members, e.owner) })] }), _jsxs("div", { className: "btn-row", children: [_jsx("button", { type: "button", className: "btn ghost", onClick: close, children: "Schlie\u00DFen" }), canEdit && _jsx("button", { type: "button", className: "btn", onClick: () => edit(toDraft()), children: "Bearbeiten" }), canEdit && _jsx("button", { type: "button", className: "btn ghost del-btn", "aria-label": "Termin l\u00F6schen", onClick: async () => {
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
