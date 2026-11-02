import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { store } from '../lib/store';
import { avatarOf } from '../lib/supabase';
import { hm, toMin } from '../lib/dates';
import { cvar } from '../app/ui';
import { joinAddr, splitAddr } from '../app/EventSheet';
// Termin am Touch-Display bearbeiten oder löschen: erst antippen, wer man ist, dann ändern
export function DisplayEdit({ token, feed, ev, close, saved }) {
    const people = feed.members.filter(m => m.role !== 'guest');
    const [who, setWho] = useState(null);
    const [d, setD] = useState({ title: ev.title, date: ev.date, all_day: ev.all_day, start: hm(ev.start_min), end: hm(ev.end_min), persons: [...ev.persons], driver: ev.driver ?? '', place: ev.place, addr: ev.addr, notes: ev.notes });
    const [busy, setBusy] = useState(false), [err, setErr] = useState(''), [del, setDel] = useState(false);
    const set = (p) => setD(x => ({ ...x, ...p }));
    const [street, town] = splitAddr(d.addr);
    const run = async (f, msg) => {
        if (!who) {
            setErr('Bitte oben antippen, wer du bist.');
            return;
        }
        setBusy(true);
        setErr('');
        try {
            await f();
            saved(msg);
        }
        catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
        }
        finally {
            setBusy(false);
        }
    };
    const save = () => {
        const s = toMin(d.start), e = toMin(d.end);
        if (!d.title.trim()) {
            setErr('Bitte einen Titel eingeben.');
            return;
        }
        if (!d.all_day && e <= s) {
            setErr('Das Ende muss nach dem Beginn liegen.');
            return;
        }
        const addr = d.addr.replace(/^,\s*/, '').trim();
        void run(() => store.displayUpdateEvent(token, who, ev.id, {
            title: d.title.trim(), date: d.date, end_date: ev.end_date > d.date && ev.date === d.date ? ev.end_date : d.date, all_day: d.all_day,
            start_min: d.all_day ? 0 : s, end_min: d.all_day ? 1440 : e, persons: d.persons, driver: d.driver || null,
            place: d.place.trim(), addr, travel_min: addr === ev.addr ? ev.travel_min : null, notes: d.notes.trim()
        }), `Gespeichert: ${d.title.trim()}`);
    };
    return (_jsx("div", { className: "w-ov", onClick: e => { if (e.target === e.currentTarget)
            close(); }, children: _jsxs("div", { className: "w-card w-in w-edit", role: "dialog", "aria-label": "Termin bearbeiten", children: [_jsx("h4", { children: "Termin bearbeiten" }), _jsx("div", { className: "w-in-lbl", children: "Wer bist du?" }), _jsx("div", { className: "w-who", children: people.map(m => {
                        const a = avatarOf(m);
                        return (_jsxs("button", { type: "button", className: `w-p${who === m.id ? ' on' : ''}`, style: cvar(m.color), onClick: () => setWho(m.id), children: [_jsx("span", { className: `b${a ? ' av' : ''}`, children: a ? _jsx("img", { src: a, alt: "" }) : m.name[0] }), _jsx("small", { children: m.name })] }, m.id));
                    }) }), _jsxs("label", { className: "w-f", children: [_jsx("span", { children: "Titel" }), _jsx("input", { value: d.title, onChange: e => set({ title: e.target.value }) })] }), _jsxs("div", { className: "w-f2", children: [_jsxs("label", { className: "w-f", children: [_jsx("span", { children: "Datum" }), _jsx("input", { type: "date", value: d.date, onChange: e => set({ date: e.target.value }) })] }), _jsxs("label", { className: "w-f chk", children: [_jsx("input", { type: "checkbox", checked: d.all_day, onChange: e => set({ all_day: e.target.checked }) }), _jsx("span", { children: "Ganzt\u00E4gig" })] })] }), !d.all_day && _jsxs("div", { className: "w-f2", children: [_jsxs("label", { className: "w-f", children: [_jsx("span", { children: "Beginn" }), _jsx("input", { type: "time", value: d.start, onChange: e => set({ start: e.target.value }) })] }), _jsxs("label", { className: "w-f", children: [_jsx("span", { children: "Ende" }), _jsx("input", { type: "time", value: d.end, onChange: e => set({ end: e.target.value }) })] })] }), _jsx("div", { className: "w-in-lbl", children: "Wer ist dabei?" }), _jsx("div", { className: "w-tog", children: people.map(m => _jsx("button", { type: "button", style: cvar(m.color), "aria-pressed": d.persons.includes(m.id), onClick: () => set({ persons: d.persons.includes(m.id) ? d.persons.filter(x => x !== m.id) : [...d.persons, m.id] }), children: m.name }, m.id)) }), _jsxs("label", { className: "w-f", children: [_jsx("span", { children: "Wer f\u00E4hrt?" }), _jsxs("select", { value: d.driver, onChange: e => set({ driver: e.target.value }), children: [_jsx("option", { value: "", children: "Niemand n\u00F6tig" }), people.filter(m => m.role !== 'child').map(m => _jsx("option", { value: m.id, children: m.name }, m.id))] })] }), _jsxs("label", { className: "w-f", children: [_jsx("span", { children: "Name des Ortes" }), _jsx("input", { value: d.place, onChange: e => set({ place: e.target.value }) })] }), _jsxs("div", { className: "w-f2", children: [_jsxs("label", { className: "w-f", children: [_jsx("span", { children: "Stra\u00DFe und Hausnummer" }), _jsx("input", { value: street, onChange: e => set({ addr: joinAddr(e.target.value, town) }) })] }), _jsxs("label", { className: "w-f", children: [_jsx("span", { children: "PLZ und Ort" }), _jsx("input", { value: town, onChange: e => set({ addr: joinAddr(street, e.target.value) }) })] })] }), _jsxs("label", { className: "w-f", children: [_jsx("span", { children: "Notiz" }), _jsx("textarea", { value: d.notes, onChange: e => set({ notes: e.target.value }) })] }), err && _jsx("div", { className: "w-in-err", children: err }), _jsx("div", { className: "w-in-btns", children: del ? _jsxs(_Fragment, { children: [_jsx("span", { className: "w-in-lbl", style: { marginRight: 'auto' }, children: "Wirklich l\u00F6schen?" }), _jsx("button", { type: "button", className: "w-btn ghost", onClick: () => setDel(false), children: "Nein" }), _jsx("button", { type: "button", className: "w-btn danger", disabled: busy, onClick: () => void run(() => store.displayDeleteEvent(token, who, ev.id), `Gelöscht: ${ev.title}`), children: "Ja, l\u00F6schen" })] }) : _jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: "w-btn ghost danger-t", style: { marginRight: 'auto' }, onClick: () => setDel(true), children: "L\u00F6schen" }), _jsx("button", { type: "button", className: "w-btn ghost", onClick: close, children: "Abbrechen" }), _jsx("button", { type: "button", className: "w-btn", disabled: busy, onClick: save, children: busy ? 'Einen Moment …' : 'Speichern' })] }) })] }) }));
}
