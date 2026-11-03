import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { store, useSnapshot } from '../lib/store';
import { useFlight } from '../lib/flight';
import { alarmOn, evAlarm, hasEvAlarm, LEADS, setEvAlarm, toggleAlarm, useAlarm } from '../lib/bdalarm';
import { fail, toast } from './toast';
import { hm, nowMin, today } from '../lib/dates';
import { travelTime } from '../lib/ai';
import { bdLabel, depart, etaDriver, etaMin, isDriver, leg2, nameOf, target, travel, upcoming, visLabel, whenText } from '../lib/model';
import { inDays } from '../lib/dates';
import { Badges, cvar, Icon, Sheet } from './ui';
import { useEffect, useState } from 'react';
import { BdayForm } from './Settings';
import { AttachButton, FileList } from './Files';
// Links in Notizen anklickbar machen (z. B. Teams-Besprechung)
const linkify = (t) => t.split(/(https?:\/\/[^\s<>"]+)/g).map((p, i) => i % 2 ? _jsx("a", { href: p, target: "_blank", rel: "noopener noreferrer", children: /teams\.(microsoft|live)\.com/.test(p) ? 'Teams-Besprechung öffnen' : p }, i) : p);
// Termin als Entwurf zum Bearbeiten
export const eventDraft = (e) => ({
    id: e.id, title: e.title, date: e.date, end_date: e.end_date, all_day: e.all_day, start_min: e.start_min, end_min: e.end_min,
    persons: [...e.persons], driver: e.driver, trip: e.trip, driver2: e.driver2 ?? null, vis: e.vis === 'family' ? 'family' : 'private', busy: e.vis === 'busy', place: e.place, addr: e.addr,
    travel_min: e.travel_min, notes: e.notes, bring: [...e.bring], discreet: e.discreet, reason: '', suggested: e.vis === 'family' ? 'family' : 'private', timeFound: !e.all_day
});
const Row = ({ k, children }) => _jsxs("div", { className: "r", children: [_jsx("span", { children: k }), _jsx("div", { children: children })] });
export function DetailSheet({ id, day, add, close, edit }) {
    const snap = useSnapshot();
    const s = snap.family.settings;
    const e = snap.events.find(x => x.id === id);
    const [here, setHere] = useState(null);
    const [busy, setBusy] = useState(false);
    const [lead, setLead] = useState(() => evAlarm(e?.id));
    const fl = useFlight(e);
    // Fahrer öffnet den Termin am selben Tag: Fahrzeit vom aktuellen Standort automatisch berechnen
    const myTarget = e ? (e.driver === snap.me ? target(e) : e.end_min) : 0;
    const auto = !!e && !!(e.addr || e.place) && isDriver(e, snap.me) && !e.all_day && e.date === today() && myTarget > nowMin() && etaMin(e) === null;
    useEffect(() => {
        if (!auto || !e || !navigator.geolocation)
            return;
        let live = true;
        setBusy(true);
        navigator.geolocation.getCurrentPosition(p => travelTime(`${p.coords.latitude.toFixed(5)},${p.coords.longitude.toFixed(5)}`, e.addr || e.place).then(r => { if (live)
            setHere(r); }, () => { }).finally(() => { if (live)
            setBusy(false); }), () => { if (live)
            setBusy(false); }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 120000 });
        return () => { live = false; };
    }, [auto, e?.id, e?.addr, e?.place]); // eslint-disable-line react-hooks/exhaustive-deps
    // Zurück aus Google Maps: Ist man schon am Ziel, endet „Navigation läuft“ von selbst
    const navOn = !!e && isDriver(e, snap.me) && etaMin(e) !== null && !!(e.addr || e.place);
    useEffect(() => {
        if (!navOn || !e)
            return;
        const check = () => {
            if (document.visibilityState !== 'visible' || !navigator.geolocation)
                return;
            navigator.geolocation.getCurrentPosition(p => travelTime(`${p.coords.latitude.toFixed(5)},${p.coords.longitude.toFixed(5)}`, e.addr || e.place).then(r => {
                if (r.minutes <= 3)
                    store.setEta(e.id, null).then(() => toast('Angekommen. Die Familie sieht das.'), () => { });
            }, () => { }), () => { }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
        };
        document.addEventListener('visibilitychange', check);
        window.addEventListener('famto-resume', check);
        return () => { document.removeEventListener('visibilitychange', check); window.removeEventListener('famto-resume', check); };
    }, [navOn, e?.id]); // eslint-disable-line react-hooks/exhaustive-deps
    if (!e)
        return null;
    const me = snap.members.find(m => m.id === snap.me);
    const canEdit = me.role !== 'guest' && (e.owner === snap.me || e.vis === 'family');
    const tr = travel(e, s), dep = depart(e, s);
    const toDraft = () => eventDraft(e);
    const nav = `https://www.google.com/maps/dir/?api=1&travelmode=driving&dir_action=navigate&destination=${encodeURIComponent(e.addr || e.place)}`;
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
        navigator.geolocation?.getCurrentPosition(p => travelTime(`${p.coords.latitude.toFixed(5)},${p.coords.longitude.toFixed(5)}`, e.addr || e.place).then(r => set(r.minutes), () => { }), () => { }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 120000 });
    };
    const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([e.place, e.addr].filter(Boolean).join(', '))}`;
    return (_jsxs(Sheet, { onClose: close, label: "Termindetails", children: [_jsx("h2", { children: e.title }), _jsxs("div", { className: "dl", children: [_jsx(Row, { k: "Wann", children: whenText(e) }), _jsx(Row, { k: "Wer", children: e.persons.length ? _jsxs(_Fragment, { children: [_jsx(Badges, { ids: e.persons, members: snap.members }), " ", e.persons.map(p => nameOf(snap.members, p)).join(', ')] }) : 'Niemand bestimmtes' }), (e.driver || e.declined_by) && _jsxs(Row, { k: "Fahrdienst", children: [e.driver ? _jsxs(_Fragment, { children: [nm(e.driver), " ", e.trip === 'ab' ? 'holt ab' : e.trip === 'beides' ? 'bringt hin' : 'fährt', okMark(e.driver_ok)] }) : null, e.trip === 'beides' && e.driver2 ? _jsxs(_Fragment, { children: [_jsx("br", {}), nm(e.driver2), " holt ab", okMark(e.driver2_ok)] }) : null, e.declined_by && _jsxs("div", { className: "note", children: [nm(e.declined_by), " kann nicht fahren", e.driver ? '' : '. Bitte jemand anderen eintragen.'] }), askMe && _jsxs("div", { className: "nav-row one", style: { marginTop: 6 }, children: [_jsx("button", { type: "button", className: "btn sm", onClick: () => store.driverAnswer(e.id, true).then(() => toast('Danke, die Familie weiß Bescheid.'), fail), children: "Okay, mach ich" }), _jsx("button", { type: "button", className: "btn ghost sm", onClick: () => store.driverAnswer(e.id, false).then(() => toast('Abgesagt. Wer dich eingetragen hat, bekommt Bescheid.'), fail), children: "Kann nicht" })] })] }), (e.place || e.addr) && _jsx(Row, { k: "Ort", children: e.addr ? _jsxs(_Fragment, { children: [e.place, _jsx("a", { className: "addr", href: maps, target: "_blank", rel: "noreferrer", children: e.addr })] }) : _jsx("a", { className: "addr", href: maps, target: "_blank", rel: "noreferrer", children: e.place }) }), fl.flight && _jsx(Row, { k: "Flug", children: _jsxs("div", { className: "flight", children: [_jsxs("div", { children: [_jsx("b", { children: fl.flight.number }), fl.flight.airline ? ` · ${fl.flight.airline}` : '', fl.flight.status ? _jsxs(_Fragment, { children: [" \u00B7 ", _jsx("span", { className: fl.flight.canceled || (fl.flight.dep?.delay ?? 0) >= 15 ? 'fl-bad' : 'fl-ok', children: fl.flight.status })] }) : null] }), fl.flight.dep && _jsxs("div", { children: ["Abflug ", fl.flight.dep.airport, " ", _jsx("b", { children: fl.flight.dep.sched }), fl.flight.dep.revised && fl.flight.dep.revised !== fl.flight.dep.sched ? _jsxs(_Fragment, { children: [" \u2192 ", _jsx("b", { className: "fl-bad", children: fl.flight.dep.revised })] }) : null, fl.flight.dep.delay && fl.flight.dep.delay >= 5 ? ` (+${fl.flight.dep.delay} Min.)` : '', [fl.flight.dep.terminal && `Terminal ${fl.flight.dep.terminal}`, fl.flight.dep.gate && `Gate ${fl.flight.dep.gate}`, fl.flight.dep.checkIn && `Check-in ${fl.flight.dep.checkIn}`].filter(Boolean).map(x => _jsx("span", { className: "fl-chip", children: x }, x))] }), fl.flight.arr && _jsxs("div", { children: ["Ankunft ", fl.flight.arr.airport, " ", _jsx("b", { children: fl.flight.arr.sched }), fl.flight.arr.revised && fl.flight.arr.revised !== fl.flight.arr.sched ? _jsxs(_Fragment, { children: [" \u2192 ", _jsx("b", { children: fl.flight.arr.revised })] }) : null, fl.flight.arr.belt ? _jsxs("span", { className: "fl-chip", children: ["Gep\u00E4ckband ", fl.flight.arr.belt] }) : null] }), _jsx("button", { type: "button", className: "small-btn", onClick: fl.refresh, children: "Aktualisieren" }), _jsxs("span", { className: "note", children: ["Stand ", fl.flight.at ? new Date(fl.flight.at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '', " \u00B7 Angaben ohne Gew\u00E4hr"] })] }) }), tr > 0 && _jsx(Row, { k: "Fahrt", children: _jsx("div", { className: "route", style: cvar(snap.members.find(m => m.id === e.driver)?.color ?? '#7a8590'), children: eta !== null ? _jsxs("div", { className: "rt-times", children: [_jsx("span", { children: _jsxs("b", { children: [nm(etaDriver(e)), " f\u00E4hrt"] }) }), _jsxs("span", { children: ["Ankunft ca. ", _jsx("b", { children: hm(eta) })] })] }) : _jsxs(_Fragment, { children: [_jsxs("div", { className: "rt-bar", children: [_jsxs("span", { className: "rt-drive", style: { flex: tr }, children: [_jsx(Icon, { name: "car" }), " ", tr, " Min."] }), s.buffer > 0 && _jsx("span", { className: "rt-buf", style: { flex: Math.max(s.buffer, 4) }, children: s.buffer })] }), _jsxs("div", { className: "rt-times", children: [_jsxs("span", { children: [_jsx("b", { children: hm(dep) }), " ", e.trip === 'ab' ? 'zum Abholen los' : 'losfahren'] }), _jsxs("span", { children: [_jsx("b", { children: hm(target(e)) }), " ", e.trip === 'ab' ? 'Ende' : 'Beginn'] })] }), l2 && _jsxs("div", { className: "rt-times", children: [_jsxs("span", { children: [_jsx("b", { children: hm(l2.leave) }), " ", nm(l2.who), " zum Abholen los"] }), _jsxs("span", { children: [_jsx("b", { children: hm(l2.at) }), " Ende"] })] })] }) }) }), (e.addr || e.place) && (iDrive || (!e.driver && me.role !== 'child' && me.role !== 'guest')) && _jsxs(Row, { k: "Von hier", children: [busy && eta === null ? _jsx("span", { className: "note", children: "Fahrzeit vom Standort wird berechnet \u2026" }) : here && eta === null ? _jsxs(_Fragment, { children: [_jsxs("b", { children: [here.minutes, " Min."] }), " \u00B7 ", String(here.km).replace('.', ','), " km \u00B7 los sp\u00E4testens ", _jsx("b", { children: hm(myTarget - here.minutes - s.buffer) })] }) : null, _jsxs("div", { className: "nav-row one", style: { marginTop: (here || busy) && eta === null ? 6 : 0 }, children: [_jsxs("button", { type: "button", className: `btn sm nav-btn${iDrive && eta !== null ? " nav-on" : ""}`, onClick: startNav, children: [_jsx(Icon, { name: "car" }), " ", iDrive && eta !== null ? 'Navigation läuft' : 'Navigation starten'] }), iDrive && eta !== null && _jsx("button", { type: "button", className: "btn ghost sm", onClick: () => store.setEta(e.id, null).catch(fail), children: "Angekommen" })] }), eta !== null && _jsxs("div", { className: "note", style: { marginTop: 6 }, children: [nm(etaDriver(e)), " f\u00E4hrt \u00B7 Ankunft ca. ", _jsx("b", { children: hm(eta) }), iDrive ? ' (sieht die Familie auch auf dem Display)' : ''] })] }), e.bring.length > 0 && _jsx(Row, { k: "Mitbringen", children: _jsx("div", { className: "bring", children: e.bring.map(b => _jsx("span", { children: b }, b)) }) }), e.notes && _jsx(Row, { k: "Notiz", children: linkify(e.notes) }), (e.files?.length || canEdit) ? _jsxs(Row, { k: "Dokumente", children: [_jsx(FileList, { files: e.files, from: { event: e.id }, canEdit: canEdit }), canEdit && _jsx("div", { style: { marginTop: e.files?.length ? 8 : 0 }, children: _jsx(AttachButton, { to: { event: e.id } }) })] }) : null, hasEvAlarm() && !e.all_day && _jsx(Row, { k: "Wecker", children: _jsxs("select", { "aria-label": "Wecker auf diesem Handy", value: lead, onChange: x => { const v = Number(x.target.value); setLead(v); setEvAlarm({ id: e.id, lead: v, date: e.date, start: e.start_min, title: e.title }); toast(v ? `Wecker gestellt: ${LEADS.find(l => l[0] === v)?.[1]}.` : 'Wecker aus.'); }, children: [_jsx("option", { value: 0, children: "aus" }), LEADS.map(([v, l]) => _jsx("option", { value: v, children: l }, v))] }) }), _jsxs(Row, { k: "Sichtbar", children: [visLabel(e.vis), e.discreet ? ' · diskret' : ''] }), _jsx(Row, { k: "Angelegt von", children: nameOf(snap.members, e.owner) })] }), _jsxs("div", { className: "btn-row", children: [_jsx("button", { type: "button", className: "btn ghost", onClick: close, children: "Schlie\u00DFen" }), canEdit && _jsx("button", { type: "button", className: "btn", onClick: () => edit(toDraft()), children: "Bearbeiten" }), canEdit && _jsx("button", { type: "button", className: "btn ghost del-btn", "aria-label": "Termin l\u00F6schen", onClick: async () => {
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
export function BdaySheet({ close, adding, open: first }) {
    const snap = useSnapshot();
    const s = snap.family.settings;
    const [sel, setSel] = useState(first ?? null);
    const b = sel ? upcoming(snap.birthdays).find(x => x.id === sel) : undefined;
    if (b)
        return _jsx(BdayDetail, { b: b, back: () => setSel(null), close: close });
    return (_jsxs(Sheet, { onClose: close, label: "N\u00E4chste Geburtstage", children: [_jsx("h2", { children: "N\u00E4chste Geburtstage" }), _jsxs("p", { children: ["Erinnerung ", s.bdLead, " Tage vorher. \u00C4ndern kann das der Admin unter Einstellungen. Antippen zeigt Details, Dokumente und Wecker."] }), adding && snap.members.find(m => m.id === snap.me)?.role !== 'guest' && _jsx(BdayForm, { focus: true }), _jsx("div", { children: upcoming(snap.birthdays).map(x => _jsxs("button", { type: "button", className: `bdrow tap${x.days <= s.bdLead ? ' soon' : ''}`, onClick: () => setSel(x.id), children: [_jsxs("div", { children: [_jsxs("b", { children: [x.owner ? _jsxs(_Fragment, { children: [_jsx(Icon, { name: "lock" }), " "] }) : '', x.name, x.files?.length ? _jsxs(_Fragment, { children: [" ", _jsx(Icon, { name: "clip" })] }) : null] }), _jsxs("small", { children: [x.rel ? `${x.rel} · ` : '', bdLabel(x), x.age ? ` · wird ${x.age}` : ''] })] }), _jsx("span", { className: "dd", children: inDays(x.days) })] }, x.id)) }), _jsx("div", { className: "btn-row", children: _jsx("button", { type: "button", className: "btn ghost", onClick: close, children: "Schlie\u00DFen" }) })] }));
}
// Ein Geburtstag: Angaben, Dokumente (z. B. Einladungskarte), Wecker, Bearbeiten
function BdayDetail({ b, back, close }) {
    const snap = useSnapshot();
    const me = snap.members.find(m => m.id === snap.me);
    const can = me.role !== 'guest' && (!b.owner || b.owner === snap.me);
    const [edit, setEdit] = useState(false);
    const alarm = useAlarm();
    const raw = snap.birthdays.find(x => x.id === b.id);
    if (edit)
        return _jsx(Sheet, { onClose: close, label: `${b.name} bearbeiten`, children: _jsx(BdayForm, { edit: raw, done: () => setEdit(false) }, b.id) });
    return (_jsxs(Sheet, { onClose: close, label: `Geburtstag ${b.name}`, children: [_jsxs("h2", { children: ["\uD83C\uDF82 ", b.name] }), _jsxs("div", { className: "dl", children: [_jsxs(Row, { k: "Wann", children: [bdLabel(b), " \u00B7 ", inDays(b.days)] }), b.age ? _jsxs(Row, { k: "Alter", children: ["wird ", b.age] }) : null, b.rel && _jsx(Row, { k: "Wer", children: b.rel }), (raw.files?.length || can) ? _jsxs(Row, { k: "Dokumente", children: [_jsx(FileList, { files: raw.files, from: { birthday: b.id }, canEdit: can }), can && _jsx("div", { style: { marginTop: raw.files?.length ? 8 : 0 }, children: _jsx(AttachButton, { to: { birthday: b.id }, label: "Einladung oder Dokument anh\u00E4ngen" }) })] }) : null, alarm && _jsx(Row, { k: "Wecker", children: _jsx("label", { className: "alarm-pick", children: _jsxs("span", { className: "busyopt", children: [_jsx("input", { type: "checkbox", checked: alarmOn(alarm, b), onChange: e => { toggleAlarm(b, e.target.checked, snap.birthdays); toast(e.target.checked ? `Wecker für ${b.name} an.` : `Wecker für ${b.name} aus.`); } }), " ", _jsx(Icon, { name: "alarm" }), " um ", hm(alarm.min), " Uhr klingeln"] }) }) }), _jsx(Row, { k: "Sichtbar", children: b.owner ? _jsxs(_Fragment, { children: [_jsx(Icon, { name: "lock" }), " nur f\u00FCr ", nameOf(snap.members, b.owner)] }) : 'ganze Familie' }), raw.ext_id && _jsx(Row, { k: "Quelle", children: "aus dem Handy-Kalender" })] }), _jsxs("div", { className: "btn-row", children: [_jsx("button", { type: "button", className: "btn ghost", onClick: back, children: "Alle Geburtstage" }), can && _jsx("button", { type: "button", className: "btn", onClick: () => setEdit(true), children: "Bearbeiten" })] })] }));
}
