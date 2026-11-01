import { jsx as _jsx } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { store, useReady, useSnapshot } from '../lib/store';
import { Onboarding } from './Onboarding';
import { Shell } from './Shell';
import { Display } from '../display/Display';
const route = () => location.hash.match(/^#\/display\/([\w-]+)/)?.[1] ?? null;
export function Root() {
    const [token, setToken] = useState(route());
    useEffect(() => {
        const f = () => setToken(route());
        addEventListener('hashchange', f);
        return () => removeEventListener('hashchange', f);
    }, []);
    useEffect(() => { void store.init(); }, []);
    if (token)
        return _jsx(Display, { token: token });
    return _jsx(AppMain, {});
}
function AppMain() {
    const ready = useReady();
    const snap = useSnapshot();
    if (!ready)
        return _jsx("div", { className: "onb", children: _jsx("p", { children: "L\u00E4dt \u2026" }) });
    if (!snap.family || !snap.me)
        return _jsx(Onboarding, {});
    return _jsx(Shell, {});
}
