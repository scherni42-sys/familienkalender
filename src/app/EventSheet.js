import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { store, useSnapshot } from '../lib/store';
import { dayLabel, hm, toMin } from '../lib/dates';
import { conflicts, nameOf, whenText } from '../lib/model';
import { Badge, cvar, Icon, Sheet } from './ui';
import { fail, toast } from './toast';
import { travelTime } from '../lib/ai';
// Adresse in zwei Feldern: „Straße Nr“ und „PLZ Ort“, gespeichert als „Straße Nr, PLZ Ort“ (eindeutig für Route und Fahrzeit)
export const splitAddr = (a) => { const k = a.lastIndexOf(','); return k < 0 ? [a, ''] : [a.slice(0, k), a.slice(k + 1).trimStart()]; };
export const joinAddr = (street, town) => street.replace(/,/g, ' ') + (town ? `, ${town}` : '');
// Entwurf in einen speicherbaren Termin umwandeln (auch für die Direkteingabe ohne Bestätigung)
export const toNewEvent = (d, bringTxt = d.bring.join(', ')) => ({
    title: d.title.trim(), date: d.date, end_date: d.all_day ? (d.end_date < d.date ? d.date : d.end_date) : d.date,
    all_day: d.all_day, start_min: d.all_day ? 0 : d.start_min, end_min: d.all_day ? 1440 : d.end_min,
    persons: d.persons, driver: d.driver, vis: d.vis === 'family' ? 'family' : d.busy ? 'busy' : 'private',
    place: d.place.trim(), addr: d.addr.trim().replace(/^,\s*/, ''), travel_min: d.driver && d.travel_min ? d.travel_min : null,
    notes: d.notes.trim(), bring: bringTxt.split(',').map(x => x.trim()).filter(Boolean), discreet: d.vis === 'family' && d.discreet
});
export function EventSheet({ draft, fresh, close, back, saved }) {
    const snap = useSnapshot();
    const s = snap.family.settings;
    const [calc, setCalc] = useState(false);
    const [d, setD] = useState(draft);
    const [busy, setBusy] = useState(false);
    const [bringTxt, setBringTxt] = useState(draft.bring.join(', '));
    const set = (p) => setD(x => ({ ...x, ...p }));
    const people = snap.members.filter(m => m.role !== 'guest');
    const drivers = snap.members.filter(m => m.adult && m.role !== 'guest');
    const cf = conflicts(snap.events, snap.busy, d, snap.members, d.id);
    const others = d.persons.filter(id => id !== snap.me);
    const visText = d.vis === 'family'
        ? 'Alle in der Familie sehen den Termin, und er erscheint auf dem Display im Flur.'
        : d.busy ? 'Nur du siehst den Termin. Trägt jemand etwas zur selben Zeit ein, warnt die App: „belegt“.' : 'Nur du siehst diesen Termin. Er erscheint nicht auf dem Display.';
    const save = async () => {
        if (!d.title.trim()) {
            toast('Bitte einen Titel eingeben.');
            return;
        }
        if (!d.all_day && d.end_min <= d.start_min) {
            toast('Das Ende muss nach dem Beginn liegen.');
            return;
        }
        setBusy(true);
        try {
            const id = await store.saveEvent(toNewEvent(d, bringTxt), d.id);
            toast(d.vis === 'family' ? 'Gespeichert. Steht jetzt auch auf dem Display.' : 'Gespeichert, nur für dich.');
            saved(id);
        }
        catch (e) {
            fail(e);
        }
        finally {
            setBusy(false);
        }
    };
    const remove = async () => {
        if (!d.id || !confirm('Termin wirklich löschen?'))
            return;
        try {
            await store.deleteEvent(d.id);
            toast('Termin gelöscht.');
            close();
        }
        catch (e) {
            fail(e);
        }
    };
    return (_jsxs(Sheet, { onClose: close, label: "Termin best\u00E4tigen", children: [_jsx("h2", { children: fresh ? (d.reason ? 'Stimmt das so?' : 'Neuer Termin') : 'Termin bearbeiten' }), fresh && d.reason && _jsxs("div", { className: "ai", children: [_jsx(Icon, { name: "spark" }), _jsxs("div", { children: [d.suggested === d.vis ? _jsxs(_Fragment, { children: [_jsxs("b", { children: ["Passt: ", d.vis === 'family' ? 'Familie' : 'Privat'] }), ", weil ", d.reason, "."] })
                                : _jsxs(_Fragment, { children: [_jsx("b", { children: "Hinweis:" }), " Du hast ", d.vis === 'family' ? 'Familie' : 'Privat', " gew\u00E4hlt. Ich h\u00E4tte ", d.suggested === 'family' ? 'Familie' : 'Privat', " vorgeschlagen, weil ", d.reason, "."] }), d.timeFound ? '' : ' Keine Uhrzeit genannt, daher ganztägig.', d.source && _jsx("span", { className: "note", style: { display: 'block' }, children: d.source === 'ai' ? 'Erkannt von Claude' : `Einfache Erkennung (ohne KI${d.why ? ': ' + d.why : ''})` })] })] }), _jsxs("div", { className: "visbig", role: "group", "aria-label": "Sichtbarkeit", children: [_jsxs("button", { type: "button", className: "private", "aria-pressed": d.vis === 'private', onClick: () => set({ vis: 'private' }), children: [_jsx(Icon, { name: "lock" }), "Privat", _jsx("small", { children: "nur ich" })] }), _jsxs("button", { type: "button", className: "family", "aria-pressed": d.vis === 'family', onClick: () => set({ vis: 'family' }), children: [_jsx(Icon, { name: "home" }), "Familie", _jsx("small", { children: "alle + Display" })] })] }), d.vis === 'private' && _jsxs("label", { className: "busyopt", children: [_jsx("input", { type: "checkbox", checked: d.busy, onChange: e => set({ busy: e.target.checked }) }), " Familie bei \u00DCberschneidung warnen (\u201Ebelegt\u201C)"] }), _jsx("p", { children: visText }), d.vis === 'private' && others.length > 0 && _jsxs("div", { className: "warnbox", children: ["Achtung: ", others.map(id => nameOf(snap.members, id)).join(', '), " sieht diesen privaten Termin nicht."] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Titel" }), _jsx("input", { value: d.title, onChange: e => set({ title: e.target.value }), maxLength: 80 })] }), _jsxs("div", { className: "row2", children: [_jsxs("label", { className: "busyopt wide", children: [_jsx("input", { type: "checkbox", checked: d.all_day, onChange: e => set(e.target.checked ? { all_day: true } : { all_day: false, start_min: 18 * 60, end_min: 19 * 60 }) }), " Ganzt\u00E4gig"] }), d.all_day ? _jsxs(_Fragment, { children: [_jsxs("label", { className: "field", children: [_jsx("span", { children: "Von" }), _jsx("input", { type: "date", value: d.date, onChange: e => e.target.value && set({ date: e.target.value, end_date: d.end_date < e.target.value ? e.target.value : d.end_date }) })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Bis" }), _jsx("input", { type: "date", value: d.end_date < d.date ? d.date : d.end_date, min: d.date, onChange: e => e.target.value && set({ end_date: e.target.value }) })] }), _jsx("span", { className: "note wide", children: whenText({ ...d, end_date: d.end_date < d.date ? d.date : d.end_date }) })] }) : _jsxs(_Fragment, { children: [_jsxs("label", { className: "field wide", children: [_jsxs("span", { children: ["Datum \u00B7 ", dayLabel(d.date)] }), _jsx("input", { type: "date", value: d.date, onChange: e => e.target.value && set({ date: e.target.value, end_date: e.target.value }) })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Beginn" }), _jsx("input", { type: "time", value: hm(d.start_min), onChange: e => { if (!e.target.value)
                                            return; const n = toMin(e.target.value), len = d.end_min - d.start_min; set({ start_min: n, end_min: Math.min(n + Math.max(len, 15), 1439) }); } })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Ende" }), _jsx("input", { type: "time", value: hm(d.end_min), onChange: e => e.target.value && set({ end_min: toMin(e.target.value) }) })] })] })] }), _jsxs("div", { className: "field", children: [_jsx("span", { children: "Wer ist dabei?" }), _jsx("div", { className: "ptoggle", children: people.map(m => _jsxs("button", { type: "button", style: cvar(m.color), "aria-pressed": d.persons.includes(m.id), onClick: () => set({ persons: d.persons.includes(m.id) ? d.persons.filter(x => x !== m.id) : [...d.persons, m.id] }), children: [_jsx(Badge, { m: m }), m.name] }, m.id)) }), d.persons.length === 0 && _jsx("span", { className: "note", children: "Niemand ausgew\u00E4hlt: Der Termin steht ohne Namen im Kalender, z. B. f\u00FCr Handwerker oder M\u00FCllabfuhr." })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Wer f\u00E4hrt?" }), _jsxs("select", { value: d.driver ?? '', onChange: e => set({ driver: e.target.value || null }), children: [_jsx("option", { value: "", children: "Niemand n\u00F6tig" }), drivers.map(m => _jsx("option", { value: m.id, children: m.name }, m.id))] })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Name des Ortes" }), _jsx("input", { value: d.place, onChange: e => set({ place: e.target.value }), placeholder: "z. B. Sportplatz Nord" })] }), _jsxs("div", { className: "row2", children: [_jsxs("label", { className: "field", children: [_jsx("span", { children: "Stra\u00DFe und Hausnummer" }), _jsx("input", { value: splitAddr(d.addr)[0], onChange: e => set({ addr: joinAddr(e.target.value, splitAddr(d.addr)[1]) }), placeholder: "z. B. Projensdorfer Str. 300", autoComplete: "street-address" })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "PLZ und Ort" }), _jsx("input", { value: splitAddr(d.addr)[1], onChange: e => set({ addr: joinAddr(splitAddr(d.addr)[0], e.target.value) }), placeholder: "z. B. 24106 Kiel" })] })] }), d.driver && s.showTravel && !d.all_day && (_jsxs("div", { className: "row2", children: [_jsxs("label", { className: "field", children: [_jsx("span", { children: "Fahrzeit (Min.)" }), _jsx("input", { type: "number", inputMode: "numeric", min: 0, max: 240, value: d.travel_min ?? '', onChange: e => set({ travel_min: e.target.value ? Math.max(0, Math.min(240, Number(e.target.value))) : null }), placeholder: "z. B. 15" })] }), _jsxs("div", { className: "note", style: { alignSelf: 'end' }, children: [d.addr.replace(/^,\s*/, '').trim() && _jsx("button", { type: "button", className: "small-btn", style: { marginBottom: 6 }, disabled: calc, onClick: () => {
                                    if (!s.home) {
                                        toast('Bitte zuerst unter Einstellungen → Allgemein die Zuhause-Adresse eintragen.');
                                        return;
                                    }
                                    setCalc(true);
                                    travelTime(s.home, d.addr.replace(/^,\s*/, '')).then(r => { set({ travel_min: r.minutes }); toast(`${r.minutes} Min. Fahrt (${String(r.km).replace('.', ',')} km) von zu Hause.`); }, fail).finally(() => setCalc(false));
                                }, children: calc ? 'Rechne …' : 'Fahrzeit berechnen' }), _jsx("br", {}), d.travel_min ? _jsxs(_Fragment, { children: ["Los um ", _jsx("b", { children: hm(d.start_min - d.travel_min - s.buffer) }), s.buffer ? ` (mit ${s.buffer} Min. Puffer)` : ''] }) : 'Mit Fahrzeit zeigt die App, wann es losgeht.'] })] })), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Mitbringen (mit Komma trennen)" }), _jsx("input", { value: bringTxt, onChange: e => setBringTxt(e.target.value), placeholder: "z. B. Trinkflasche, Schienbeinschoner" })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Notiz" }), _jsx("textarea", { value: d.notes, onChange: e => set({ notes: e.target.value }), placeholder: "z. B. Abholen am Vereinsheim" })] }), d.vis === 'family' && _jsxs("label", { className: "busyopt", children: [_jsx("input", { type: "checkbox", checked: d.discreet, onChange: e => set({ discreet: e.target.checked }) }), " Diskret: im G\u00E4ste-Modus nur \u201ETermin\u201C zeigen"] }), cf.length > 0 && _jsxs("div", { className: "warnbox", children: [_jsx("b", { children: "Achtung, \u00DCberschneidung" }), cf.map(c => _jsx("span", { children: c }, c))] }), _jsxs("div", { className: "btn-row", children: [fresh ? _jsx("button", { type: "button", className: "btn ghost", onClick: back, children: "Neu sprechen" })
                        : d.id ? _jsx("button", { type: "button", className: "btn ghost", onClick: () => void remove(), children: "L\u00F6schen" })
                            : _jsx("button", { type: "button", className: "btn ghost", onClick: close, children: "Abbrechen" }), _jsx("button", { type: "button", className: "btn", disabled: busy, onClick: () => void save(), children: "Speichern" })] })] }));
}
