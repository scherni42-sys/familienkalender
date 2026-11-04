import { jsxs as _jsxs, jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
import { hm, today } from '../lib/dates';
import { bdOn, colorOf, depart, driveDone, isOnline, etaDriver, etaMin, liveMsgs, nameOf, target, travel, visibleOnDay, whenM } from '../lib/model';
import { flightShort, useFlight } from '../lib/flight';
import { Badge, Badges, cvar, Icon } from './ui';
// Geburtstagsfarbe wie im Widget: private in der Farbe des Besitzers, gemeinsame in Torten-Gold
const bdColor = (snap, b) => b.owner ? colorOf(snap.members, b.owner) : '#D9A441';
function Flight({ e }) {
    const { flight } = useFlight(e);
    const txt = flight ? flightShort(flight) : '';
    return txt ? _jsxs("div", { className: `wv-sub${flight.canceled || (flight.dep?.delay ?? 0) >= 15 ? ' bad' : ''}`, children: ["\u2708 ", txt] }) : null;
}
function Row({ e, d, snap, now, go }) {
    const s = snap.family.settings;
    const isToday = d === today();
    const past = isToday && !e.all_day && e.end_min <= now;
    const nm = (id) => nameOf(snap.members, id ?? '');
    const eta = e.driver || e.driver2 ? etaMin(e) : null;
    const arrived = eta === null && (driveDone(e) || past);
    const tr = travel(e, s), dep = depart(e, s);
    let drive = '', soon = false;
    if (eta !== null)
        drive = `${nm(etaDriver(e))} fährt · Ankunft ${hm(eta)}`;
    else if (e.driver && !arrived) {
        const go = isToday && !e.all_day && tr > 0 && target(e) > now;
        soon = go && dep > now && dep - now <= 30;
        drive = `${nm(e.driver)} ${e.trip === 'ab' ? 'holt ab' : e.trip === 'beides' ? 'bringt' : 'fährt'}${go ? ` · los ${hm(dep)}` : ''}${e.trip === 'beides' && e.driver2 ? ` · ${nm(e.driver2)} holt ab` : ''}`;
    }
    // Heute ausführlich: Zeitspanne, Personen, Ort mit Adresse, Fahrt, Mitbringen, Notiz, Dokumente
    const where = [e.place, isOnline(e) ? '' : e.addr].filter(Boolean).join(' · ');
    const left = !e.all_day && !past && e.start_min > now ? e.start_min - now : null;
    return (_jsxs("div", { className: `wv-row big${past ? ' past' : ''}`, style: cvar(colorOf(snap.members, e.persons[0] ?? e.owner)), role: "button", tabIndex: 0, onClick: () => go.open(e.id, d), onKeyDown: k => { if (k.key === 'Enter')
            go.open(e.id, d); }, children: [_jsx("i", { className: "wv-bar" }), _jsxs("time", { children: [e.all_day ? 'ganzt.' : hm(e.start_min), !e.all_day && _jsx("small", { children: hm(e.end_min) })] }), _jsxs("div", { className: "wv-txt", children: [_jsxs("div", { className: "wv-t wrap", children: [e.vis !== 'family' && _jsx(Icon, { name: "lock" }), _jsx("span", { children: e.title })] }), e.persons.length > 0 && _jsxs("div", { className: "wv-sub who", children: [_jsx(Badges, { ids: e.persons, members: snap.members }), " ", e.persons.map(p => nm(p)).join(', ')] }), where && _jsxs("div", { className: "wv-sub wrap", children: [_jsx(Icon, { name: "pin" }), " ", where] }), isOnline(e) && _jsx("div", { className: "wv-sub", children: "Online-Besprechung" }), _jsx(Flight, { e: e }), drive && _jsxs("div", { className: `wv-sub${soon ? ' soon' : ''}`, children: [_jsx(Icon, { name: "car" }), " ", soon ? `In ${dep - now} Min. losfahren · ` : '', drive, tr && !eta ? ` · ${tr} Min. Fahrt` : ''] }), e.bring.length > 0 && _jsxs("div", { className: "wv-sub wrap", children: ["Mitbringen: ", e.bring.join(', ')] }), e.notes && _jsx("div", { className: "wv-sub wrap note", children: e.notes }), e.files?.length ? _jsxs("div", { className: "wv-sub", children: [_jsx(Icon, { name: "clip" }), " ", e.files.length === 1 ? e.files[0].name : `${e.files.length} Dokumente`] }) : null, left !== null && left <= 120 && _jsxs("div", { className: "wv-sub soon", children: ["in ", left >= 60 ? `${Math.floor(left / 60)} Std. ${left % 60 ? `${left % 60} Min.` : ''}` : `${left} Min.`] })] })] }));
}
function Day({ d, snap, filter, now, go }) {
    const s = snap.family.settings;
    const isToday = d === today();
    const { ev } = visibleOnDay(snap.events, snap.busy, d, snap.me, filter);
    const list = ev.filter(e => !(s.pastMode === 'hide' && isToday && !e.all_day && e.end_min <= now))
        .sort((a, b) => a.all_day === b.all_day ? a.start_min - b.start_min : a.all_day ? -1 : 1);
    const bds = bdOn(snap.birthdays, d);
    return _jsxs(_Fragment, { children: [bds.map(b => _jsxs("div", { className: "wv-row", style: cvar(bdColor(snap, b)), role: "button", tabIndex: 0, onClick: () => go.bday(b.id), children: [_jsx("i", { className: "wv-bar" }), _jsx("time", { children: "Geb." }), _jsx("div", { className: "wv-txt", children: _jsxs("div", { className: "wv-t", children: [_jsx(Icon, { name: "cake" }), b.owner && _jsx(Icon, { name: "lock" }), _jsxs("span", { children: [b.name, b.age ? ` wird ${b.age}` : ''] })] }) })] }, b.id)), list.map(e => _jsx(Row, { e: e, d: d, snap: snap, now: now, go: go }, e.id)), !list.length && !bds.length && _jsxs("button", { type: "button", className: "wv-note", onClick: () => go.add(d), children: [isToday ? 'Keine Termine mehr' : 'Keine Termine', " \u00B7 ", _jsx("b", { children: "\uFF0B Termin" })] })] });
}
export function WidgetView({ snap, filter, now, go }) {
    const t = today();
    const s = snap.family.settings;
    const msgs = liveMsgs(snap.messages, s);
    const m = (id) => snap.members.find(x => x.id === id);
    return (_jsxs("div", { className: "wv", children: [_jsx(Day, { d: t, snap: snap, filter: filter, now: now, go: go }), _jsx("div", { className: "wv-sec", children: "Board" }), !msgs.length && _jsx("div", { className: "wv-note", children: "Keine Nachrichten" }), msgs.map(x => {
                const last = x.replies.at(-1);
                return _jsxs("div", { className: "wv-msg", role: "button", tabIndex: 0, onClick: () => go.msg(x.id), children: [_jsx(Badge, { m: m(x.from_member), size: 26 }), _jsxs("div", { className: "wv-txt", children: [_jsxs("div", { className: "wv-t", children: [x.pinned && _jsx(Icon, { name: "pin" }), _jsxs("span", { children: [x.image && !x.text.startsWith('📷') ? '📷 ' : '', x.text] })] }), x.taker ? _jsxs("div", { className: "wv-sub ok", children: ["\u2713 ", nameOf(snap.members, x.taker), " \u00FCbernimmt das"] })
                                    : last ? _jsxs("div", { className: "wv-sub", children: [nameOf(snap.members, last.from_member), ": ", last.text] }) : null] }), _jsxs("small", { children: [nameOf(snap.members, x.from_member), _jsx("br", {}), x.pinned ? '' : whenM(x)] })] }, x.id);
            })] }));
}
