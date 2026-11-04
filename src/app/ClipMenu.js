import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { Icon } from './ui';
// Büroklammer wie bei WhatsApp/Signal: Dokument (jede Datei, z. B. PDF, Word, Excel), Galerie, Kamera, im Chat auch Standort
export function ClipMenu({ image, doc, place, disabled }) {
    const [open, setOpen] = useState(false);
    const take = (fn) => (e) => { const f = e.target.files?.[0]; e.target.value = ''; setOpen(false); if (f)
        fn(f); };
    return (_jsxs("span", { className: "clip-m", children: [_jsx("button", { type: "button", className: "ch-i", "aria-label": "Anh\u00E4ngen", "aria-expanded": open, disabled: disabled, onClick: () => setOpen(o => !o), children: _jsx(Icon, { name: "clip" }) }), open && _jsxs(_Fragment, { children: [_jsx("span", { className: "clip-bg", onClick: () => setOpen(false) }), _jsxs("span", { className: "clip-pop", role: "menu", children: [_jsxs("label", { role: "menuitem", children: [_jsx("span", { className: "rnd", children: _jsx(Icon, { name: "camera" }) }), "Kamera", _jsx("input", { type: "file", accept: "image/*", capture: "environment", hidden: true, onChange: take(image) })] }), _jsxs("label", { role: "menuitem", children: [_jsx("span", { className: "rnd", children: _jsx(Icon, { name: "gallery" }) }), "Galerie", _jsx("input", { type: "file", accept: "image/*", hidden: true, onChange: take(image) })] }), _jsxs("label", { role: "menuitem", children: [_jsx("span", { className: "rnd", children: _jsx(Icon, { name: "clip" }) }), "Dokument", _jsx("input", { type: "file", hidden: true, onChange: take(doc) })] }), place && _jsxs("button", { type: "button", role: "menuitem", onClick: () => { setOpen(false); place(); }, children: [_jsx("span", { className: "rnd", children: _jsx(Icon, { name: "place" }) }), "Standort"] })] })] })] }));
}
