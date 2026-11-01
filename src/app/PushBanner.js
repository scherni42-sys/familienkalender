import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { useSnapshot } from '../lib/store';
import { depart, travel } from '../lib/model';
import { hm, today } from '../lib/dates';
import { cvar, Icon } from './ui';
// Erinnerung an den Fahrer, solange die App offen ist. Echte Push-Nachrichten im Hintergrund sind der nächste Ausbauschritt.
export function PushBanner({ now }) {
    const snap = useSnapshot();
    const s = snap.family.settings;
    const [seen, setSeen] = useState([]);
    if (!s.remind)
        return null;
    const e = snap.events.find(x => x.driver === snap.me && x.date === today() && travel(x, s) && now >= depart(x, s) - s.remind && now < depart(x, s) && !seen.includes(x.id));
    if (!e)
        return null;
    const dep = depart(e, s);
    const color = snap.members.find(m => m.id === e.driver)?.color ?? '#7a8590';
    return (_jsxs("div", { className: "push", role: "alert", style: cvar(color), children: [_jsxs("div", { className: "ph", children: [_jsxs("span", { className: "app", children: [_jsx(Icon, { name: "today" }), " Familienkalender"] }), _jsx("span", { children: "jetzt" })] }), _jsxs("b", { children: [_jsx(Icon, { name: "car" }), " In ", dep - now, " Min. losfahren (", hm(dep), ")"] }), _jsxs("div", { children: [e.title, " um ", hm(e.start_min), " \u00B7 ca. ", travel(e, s), " Min. Fahrt", e.bring.length ? ` · Mitbringen: ${e.bring.join(', ')}` : ''] }), _jsxs("div", { className: "pa", children: [e.addr && _jsx("button", { type: "button", onClick: () => open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(e.addr)}`, '_blank'), children: "Route starten" }), _jsx("button", { type: "button", onClick: () => setSeen([...seen, e.id]), children: "OK" })] })] }));
}
