import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { store } from '../lib/store';
import { SWATCHES } from '../lib/model';
import { cvar } from './ui';
export function Onboarding() {
    const [mode, setMode] = useState('start');
    const [fam, setFam] = useState(''), [name, setName] = useState(''), [code, setCode] = useState('');
    const [color, setColor] = useState(SWATCHES[6][0]);
    const [busy, setBusy] = useState(false), [err, setErr] = useState('');
    const run = async (f) => {
        setBusy(true);
        setErr('');
        try {
            await f();
        }
        catch (e) {
            setErr(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
        }
        finally {
            setBusy(false);
        }
    };
    return (_jsxs("main", { className: "onb", children: [_jsx("img", { className: "logo", src: "icon.svg", alt: "" }), _jsx("h1", { children: "Familienkalender" }), _jsx("p", { children: "Termine per Sprache eintragen, privat oder f\u00FCr die Familie. Familientermine erscheinen auf dem Display im Flur." }), store.demo && _jsxs("p", { children: [_jsx("span", { className: "badge-demo", children: "Demo-Modus" }), " Ohne Datenbank: Alles bleibt in diesem Browser."] }), mode === 'start' && _jsxs(_Fragment, { children: [_jsx("button", { className: "btn", onClick: () => setMode('create'), children: "Neue Familie anlegen" }), _jsx("button", { className: "btn ghost", onClick: () => setMode('join'), children: "Ich habe einen Einladungscode" }), store.demo && _jsx("button", { className: "btn ghost", disabled: busy, onClick: () => run(() => store.loadExample()), children: "Beispielfamilie ansehen" })] }), mode === 'create' && (_jsxs("form", { className: "card", onSubmit: e => { e.preventDefault(); void run(() => store.createFamily(fam.trim(), name.trim(), color)); }, children: [_jsx("h2", { children: "Neue Familie" }), _jsx("p", { className: "note", children: "Du wirst Admin und kannst danach die anderen einladen." }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Name der Familie" }), _jsx("input", { required: true, value: fam, onChange: e => setFam(e.target.value), placeholder: "z. B. Familie Schmidt" })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Dein Vorname" }), _jsx("input", { required: true, value: name, onChange: e => setName(e.target.value), placeholder: "z. B. Jan" })] }), _jsxs("div", { className: "field", children: [_jsx("span", { children: "Deine Farbe" }), _jsx("div", { className: "sw", style: { display: 'flex', gap: 6, flexWrap: 'wrap' }, children: SWATCHES.map(([h, l]) => _jsx("button", { type: "button", className: `swb${color === h ? ' on' : ''}`, style: cvar(h), "aria-label": l, title: l, onClick: () => setColor(h) }, h)) })] }), err && _jsx("div", { className: "err", children: err }), _jsxs("div", { className: "btn-row", children: [_jsx("button", { type: "button", className: "btn ghost", onClick: () => setMode('start'), children: "Zur\u00FCck" }), _jsx("button", { className: "btn", disabled: busy, children: "Anlegen" })] })] })), mode === 'join' && (_jsxs("form", { className: "card", onSubmit: e => { e.preventDefault(); void run(() => store.joinWithCode(code)); }, children: [_jsx("h2", { children: "Mit Code beitreten" }), _jsx("p", { className: "note", children: "Den Code bekommst du vom Admin deiner Familie (Einstellungen \u2192 Familie & Mitglieder)." }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Einladungscode" }), _jsx("input", { required: true, value: code, onChange: e => setCode(e.target.value.toUpperCase()), placeholder: "z. B. K7P2QX", autoCapitalize: "characters", maxLength: 8 })] }), err && _jsx("div", { className: "err", children: err }), _jsxs("div", { className: "btn-row", children: [_jsx("button", { type: "button", className: "btn ghost", onClick: () => setMode('start'), children: "Zur\u00FCck" }), _jsx("button", { className: "btn", disabled: busy, children: "Beitreten" })] })] }))] }));
}
