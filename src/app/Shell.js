import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { demoLink, store, useSnapshot } from '../lib/store';
import { micStart } from '../lib/micstart';
import { native } from '../lib/native';
import { SUPA } from '../lib/supabase';
import { addDays, dayLabel, fromIso, hm, isoWeek, longDate, MON, mondayOf, nowMin, today, WDS } from '../lib/dates';
import { bdOn, colorOf, depart, driveDone, etaDriver, etaMin, leg2, nameOf, target, travel, upcoming, visibleOnDay } from '../lib/model';
import { Badge, Badges, cvar, Icon } from './ui';
import { fail, toast, useToast } from './toast';
import { Board } from './Board';
import { Settings } from './Settings';
import { MicSheet } from './MicSheet';
import { AskSheet } from './AskSheet';
import { Clip } from './Files';
import { EventSheet } from './EventSheet';
import { DetailSheet, BdaySheet } from './DetailSheet';
import { flightShort, useFlight } from '../lib/flight';
import { PushBanner } from './PushBanner';
import { WidgetView } from './WidgetView';
const savedFilter = () => { try {
    const v = localStorage.getItem('fk-filter');
    return v === 'family' || v === 'home' ? v : 'all';
}
catch {
    return 'all';
} };
// Widget-Schnellknöpfe: ?mic=private|family|board legt die Art fest, das Mikrofon startet man selbst (Seitentaste ?mic=1 startet sofort)
const micPreset = (v) => v === 'private' || v === 'family' || v === 'board' ? v : undefined;
// Uhr, die jede Minute neu zeichnet (für „vorbei“, „los in X Min.“)
export function useMinute() {
    const [, set] = useState(0);
    useEffect(() => { const t = setInterval(() => set(x => x + 1), 30000); return () => clearInterval(t); }, []);
    return nowMin();
}
export function Shell() {
    const snap = useSnapshot();
    const [tab, setTab] = useState('today');
    const [filter, setFilter] = useState(savedFilter);
    const [sheet, setSheet] = useState(null);
    const [nonce, setNonce] = useState(0);
    const snapRef = useRef(snap);
    snapRef.current = snap;
    const [flash, setFlash] = useState(null);
    const [focusMsg, setFocusMsg] = useState(null);
    const [replyMsg, setReplyMsg] = useState(null);
    // Sprung aus dem Android-Widget: ?open=event:<id> oder ?open=msg:<id>
    const deep = useRef(new URLSearchParams(location.search).get('open'));
    const toastMsg = useToast();
    const now = useMinute();
    const me = snap.members.find(m => m.id === snap.me);
    const s = snap.family.settings;
    const next = upcoming(snap.birthdays)[0];
    const cake = next && s.bdLead > 0 && next.days <= s.bdLead ? next : null;
    const titles = { today: 'Heute', week: 'Kalender', board: 'Board', settings: 'Einstellungen' };
    const open = (id) => setSheet({ kind: 'detail', id });
    // Leerer Termin an einem Tag (aus dem Widget oder „Weiterer Termin“ im Termin)
    const newOn = (date) => setSheet({ kind: 'edit', fresh: true, draft: { title: '', date, end_date: date, all_day: false, start_min: 600, end_min: 660, persons: [me.id], driver: null, vis: 'family', busy: false, place: '', addr: '', travel_min: null, notes: '', bring: [], discreet: false, reason: '', suggested: 'family', timeFound: true } });
    const saved = (id) => { setFlash(id); setTimeout(() => setFlash(null), 4000); };
    // iPhone-App: persönlichen Widget-Code einmal an die App geben, damit das Widget die Familiendaten laden kann
    useEffect(() => {
        const n = native();
        if (!n?.setCode || n.code() || store.demo || me.role === 'guest')
            return;
        store.widgetToken().then(t => n.setCode('FK1:' + btoa(JSON.stringify({ u: SUPA.url, k: SUPA.key, t, a: `${location.origin}${location.pathname}` }))), () => { });
    }, [me.id]);
    // Schnellstart: ?mic=1 (Verknüpfung) oder Geräte-Einstellung öffnet beim Start und beim Zurückkehren sofort die Spracheingabe
    useEffect(() => {
        // Aus dem Widget (oder einer Benachrichtigung): erst alles Offene schließen, dann das Gewünschte zeigen
        const go = (o) => {
            setSheet(null);
            setNonce(n => n + 1);
            const [k, id] = o.split(':');
            if (k === 'event' && snapRef.current.events.some(e => e.id === id))
                setSheet({ kind: 'detail', id, day: o.split(':')[2] });
            if (k === 'bdays')
                setSheet({ kind: 'bdays' });
            if (k === 'bday' && id)
                setSheet({ kind: 'bdays', open: id });
            if (k === 'bdadd')
                setSheet({ kind: 'bdays', adding: true });
            // Tag im Widget angetippt: leerer Termin an diesem Datum
            if (k === 'new' && /^\d{4}-\d{2}-\d{2}$/.test(id))
                newOn(id);
            if (k === 'settings')
                setTab('settings');
            if (k === 'home')
                setTab('today');
            if (k === 'ask' && me.role !== 'guest')
                setSheet({ kind: 'ask' });
            if (k === 'msg') {
                setTab('board');
                setFocusMsg(id);
                if (o.split(':')[2] === 'reply')
                    setReplyMsg(id);
                setTimeout(() => setFocusMsg(null), 4000);
            }
        };
        const o = deep.current;
        if (o) {
            history.replaceState(null, '', location.pathname + location.hash);
            go(o);
        }
        const onOpen = (e) => { const v = String(e.detail ?? ''); if (v)
            go(v); };
        window.addEventListener('famto-open', onOpen);
        window.__famtoOpen = go;
        if (me.role === 'guest')
            return;
        const q = new URLSearchParams(location.search);
        if (q.has('mic')) {
            history.replaceState(null, '', location.pathname + location.hash);
            {
                const v = q.get('mic'), preset = micPreset(v);
                if (v !== 'photo' && native())
                    setSheet({ kind: 'mic', preset });
                else
                    setSheet(v === 'photo' ? { kind: 'mic', photo: true } : { kind: 'mic', auto: !preset, quick: true, preset });
            }
        }
        else if (micStart() && !o)
            setSheet({ kind: 'mic', auto: true, quick: true });
        // Falls Chrome die laufende App nur nach vorn holt: Startadresse über die Launch-Queue auswerten
        window.launchQueue
            ?.setConsumer(p => { const m = p.targetURL ? new URL(p.targetURL).searchParams : null; if (m?.has('mic')) {
            const v = m.get('mic'), preset = micPreset(v);
            setSheet(v === 'photo' ? { kind: 'mic', photo: true } : { kind: 'mic', auto: !preset, quick: true, preset });
        } });
        const onShow = () => { if (document.visibilityState === 'visible' && micStart())
            setSheet(x => x ?? { kind: 'mic', auto: true, quick: true }); };
        document.addEventListener('visibilitychange', onShow);
        // Android-App schon offen: ＋ im Widget öffnet das Fenster ohne Neuladen
        const onMic = (e) => { const v = String(e.detail ?? ''); setSheet(v === 'photo' ? { kind: 'mic', photo: true } : { kind: 'mic', preset: micPreset(v) }); };
        window.addEventListener('famto-mic', onMic);
        return () => { document.removeEventListener('visibilitychange', onShow); window.removeEventListener('famto-mic', onMic); window.removeEventListener('famto-open', onOpen); };
    }, [me.role]);
    return (_jsxs("div", { className: "screen", style: me.app_bg ? { background: me.app_bg } : undefined, children: [_jsxs("div", { className: "ph-head", children: [_jsxs("div", { children: [_jsx("small", { children: snap.family.name }), _jsx("strong", { children: titles[tab] })] }), _jsxs("span", { className: "head-r", children: [cake && _jsxs("button", { type: "button", className: "cake", onClick: () => setSheet({ kind: 'bdays' }), "aria-label": `Nächster Geburtstag ${cake.days === 0 ? 'heute' : `in ${cake.days} Tagen`}`, children: [cake.days === 0 ? 'Heute' : cake.days, _jsx(Icon, { name: "cake" })] }), _jsx("span", { className: "me", children: _jsx(Badge, { m: me }) })] })] }), demoLink && _jsx("div", { className: "demo-bar", children: "Testversion mit Beispielfamilie. Was du \u00E4nderst, bleibt nur in diesem Browser." }), (tab === 'today' || tab === 'week') && (_jsx("div", { className: "seg filter", role: "group", "aria-label": "Filter", children: [['all', 'Alle'], ['family', 'Familie'], ['home', '🏠 Home']].map(([k, l]) => _jsx("button", { type: "button", "aria-pressed": filter === k, onClick: () => { setFilter(k); try {
                        localStorage.setItem('fk-filter', k);
                    }
                    catch { /* egal */ } }, children: l }, k)) })), _jsxs("div", { className: `ph-body${tab === 'today' ? ' today' : ''}`, children: [tab === 'today' && _jsx(WidgetView, { snap: snap, filter: filter, now: now, go: { open: (id, day) => setSheet({ kind: 'detail', id, day }), bday: id => setSheet({ kind: 'bdays', open: id }), add: newOn, msg: id => { setTab('board'); setFocusMsg(id); setTimeout(() => setFocusMsg(null), 4000); } } }), tab === 'week' && _jsx(CalendarTab, { snap: snap, filter: filter, now: now, open: open, flash: flash }), tab === 'board' && _jsx(Board, { focus: focusMsg, reply: replyMsg }), tab === 'settings' && _jsx(Settings, {}, nonce)] }), me.role !== 'guest' && _jsx("button", { type: "button", className: "magic fab", onClick: () => setSheet({ kind: 'ask' }), "aria-label": "Claude fragen", children: "\u2728" }), _jsxs("nav", { className: "tabs", "aria-label": "Bereiche", children: [_jsx(TabBtn, { on: tab === 'today', icon: "today", label: "Heute", go: () => setTab('today') }), _jsx(TabBtn, { on: tab === 'week', icon: "week", label: "Kalender", go: () => setTab('week') }), me.role === 'guest'
                        ? _jsx("span", {})
                        : _jsx("button", { type: "button", className: "mic", "aria-label": "Termin oder Nachricht sprechen", onClick: () => setSheet({ kind: 'mic' }), children: _jsx(Icon, { name: "mic" }) }), _jsx(TabBtn, { on: tab === 'board', icon: "board", label: "Board", go: () => setTab('board') }), _jsx(TabBtn, { on: tab === 'settings', icon: "gear", label: "Einstellungen", go: () => setTab('settings') })] }), sheet?.kind === 'mic' && _jsx(MicSheet, { auto: sheet.auto, quick: sheet.quick, preset: sheet.preset, photoFirst: sheet.photo, close: () => setSheet(null), toDraft: (draft) => setSheet({ kind: 'edit', draft, fresh: true }), posted: () => { setSheet(null); setTab('board'); }, saved: (id) => { setSheet(null); saved(id); } }), sheet?.kind === 'edit' && _jsx(EventSheet, { draft: sheet.draft, fresh: sheet.fresh, close: () => setSheet(null), back: () => setSheet({ kind: 'mic' }), saved: (id) => { setSheet(null); saved(id); } }), sheet?.kind === 'detail' && _jsx(DetailSheet, { id: sheet.id, day: sheet.day, add: newOn, close: () => setSheet(null), edit: (draft) => setSheet({ kind: 'edit', draft, fresh: false }) }), sheet?.kind === 'ask' && _jsx(AskSheet, { close: () => setSheet(null), open: id => setSheet({ kind: 'detail', id }), edit: draft => setSheet({ kind: 'edit', draft, fresh: false }), toDraft: draft => setSheet({ kind: 'edit', draft, fresh: true }), bdays: () => setSheet({ kind: 'bdays' }) }), sheet?.kind === 'bdays' && _jsx(BdaySheet, { adding: sheet.adding, open: sheet.open, close: () => setSheet(null) }, sheet.open ?? ''), _jsx(PushBanner, { now: now }), toastMsg && _jsx("div", { className: "toast", role: "status", children: toastMsg })] }));
}
function TabBtn({ on, icon, label, go }) {
    return _jsxs("button", { type: "button", "aria-pressed": on, onClick: go, children: [_jsx(Icon, { name: icon }), label] });
}
/* ---------- Terminkarte ---------- */
// Flugstatus unter dem Termin (nur rund um den Flugtag)
function FlightLine({ e }) {
    const { flight } = useFlight(e);
    if (!flight)
        return null;
    const txt = flightShort(flight);
    return txt ? _jsxs("div", { className: `fl-line${flight.canceled || (flight.dep?.delay ?? 0) >= 15 ? ' bad' : ''}`, children: ["\u2708 ", txt] }) : null;
}
export function EvCard({ e, d, snap, now, open, flash }) {
    const s = snap.family.settings;
    const isToday = d === today();
    const past = isToday && !e.all_day && e.end_min <= now;
    const tag = e.vis === 'family' ? _jsxs("span", { className: "vis-tag family", children: [_jsx(Icon, { name: "home" }), " Familie"] })
        : e.vis === 'busy' ? _jsxs("span", { className: "vis-tag busy", children: [_jsx(Icon, { name: "lock" }), " Privat", e.ext_id ? ' · aus Handy-Kalender' : ''] })
            : _jsxs("span", { className: "vis-tag private", children: [_jsx(Icon, { name: "lock" }), " Privat"] });
    const tr = travel(e, s), dep = depart(e, s);
    const soon = tr && isToday && dep > now && dep - now <= 30;
    const eta = e.driver || e.driver2 ? etaMin(e) : null;
    const l2 = leg2(e, s);
    const soon2 = !!l2 && isToday && l2.leave > now && l2.leave - now <= 30;
    // Lange drücken: Papierkorb erscheint, ein Tipp darauf löscht sofort
    const [armed, setArmed] = useState(false);
    const timer = useRef(undefined);
    const longed = useRef(false);
    const mayDelete = e.owner === snap.me || e.vis === 'family';
    const press = () => { longed.current = false; window.clearTimeout(timer.current); if (mayDelete)
        timer.current = window.setTimeout(() => { longed.current = true; setArmed(true); navigator.vibrate?.(20); }, 550); };
    const release = () => window.clearTimeout(timer.current);
    const del = async (ev) => {
        ev.stopPropagation();
        try {
            await store.deleteEvent(e.id);
            toast(e.ext_id ? 'Gelöscht. Im Handy-Kalender bleibt er, beim nächsten Abgleich kommt er wieder.' : 'Termin gelöscht.');
        }
        catch (x) {
            fail(x);
            setArmed(false);
        }
    };
    return (_jsxs("div", { className: `ev${e.files?.length ? ' has-clip' : ''}${e.vis === 'family' ? '' : ' private'}${past ? ' past' : ''}${flash === e.id ? ' isnew' : ''}${armed ? ' armed' : ''}`, style: cvar(colorOf(snap.members, e.persons[0] ?? e.owner)), "data-ev": true, role: "button", tabIndex: 0, onPointerDown: press, onPointerUp: release, onPointerLeave: release, onPointerCancel: release, onContextMenu: x => { if (mayDelete)
            x.preventDefault(); }, onClick: () => { if (longed.current) {
            longed.current = false;
            return;
        } if (armed) {
            setArmed(false);
            return;
        } open(e.id); }, onKeyDown: k => { if (k.key === 'Enter')
            open(e.id); if (k.key === 'Delete' && mayDelete)
            setArmed(true); }, "aria-label": `${e.title}, Details öffnen, lange drücken zum Löschen`, children: [armed && _jsx("button", { type: "button", className: "ev-del", onClick: del, "aria-label": `${e.title} löschen`, children: _jsx(Icon, { name: "trash" }) }), _jsx(Time, { e: e, d: d }), _jsxs("div", { style: { minWidth: 0 }, children: [_jsx("div", { className: "t", children: _jsx("span", { children: e.title }) }), _jsxs("div", { className: "meta", children: [e.persons.length > 0 && _jsx(Badges, { ids: e.persons, members: snap.members }), tag, e.driver && !(eta === null && driveDone(e)) && _jsxs("span", { children: [_jsx(Icon, { name: "car" }), " ", nameOf(snap.members, e.driver), " ", e.trip === 'ab' ? 'holt ab' : e.trip === 'beides' ? 'bringt' : 'fährt'] }), e.trip === 'beides' && e.driver2 && _jsxs("span", { children: [_jsx(Icon, { name: "car" }), " ", nameOf(snap.members, e.driver2), " holt ab"] }), e.place && _jsx("span", { className: "pl", children: e.place })] }), _jsx(FlightLine, { e: e }), eta !== null ? (_jsxs("div", { className: "go", children: [_jsx(Icon, { name: "car" }), _jsxs("b", { children: [nameOf(snap.members, etaDriver(e)), " f\u00E4hrt \u00B7 Ankunft ca. ", hm(eta)] })] })) : tr > 0 && !(isToday && target(e) <= now) ? (_jsxs("div", { className: `go${soon ? ' soon' : ''}`, children: [_jsx(Icon, { name: "car" }), _jsx("b", { children: soon ? `In ${dep - now} Min. ${e.trip === 'ab' ? 'zum Abholen ' : ''}losfahren` : `${e.trip === 'ab' ? 'Zum Abholen los' : 'Los'} um ${hm(dep)}` }), _jsxs("span", { children: ["ca. ", tr, " Min. Fahrt", s.buffer ? ` + ${s.buffer} Min. Puffer` : ''] })] })) : l2 && !(isToday && l2.at <= now) ? (_jsxs("div", { className: `go${soon2 ? ' soon' : ''}`, children: [_jsx(Icon, { name: "car" }), _jsxs("b", { children: [nameOf(snap.members, l2.who), ": ", soon2 ? `in ${l2.leave - now} Min. zum Abholen los` : `zum Abholen los um ${hm(l2.leave)}`] }), _jsxs("span", { children: ["ca. ", tr, " Min. Fahrt"] })] })) : null] }), _jsx(Clip, { files: e.files, more: () => open(e.id) })] }));
}
function Time({ e, d }) {
    if (e.all_day)
        return _jsxs("time", { className: "ad", children: ["ganz\u00ADt\u00E4gig", e.end_date > e.date ? _jsx("span", { children: `Tag ${Math.round((fromIso(d).getTime() - fromIso(e.date).getTime()) / 864e5) + 1}/${Math.round((fromIso(e.end_date).getTime() - fromIso(e.date).getTime()) / 864e5) + 1}` }) : null] });
    return _jsxs("time", { children: [hm(e.start_min), _jsx("span", { children: hm(e.end_min) })] });
}
function BusyCard({ b, d, snap, now }) {
    const past = d === today() && !b.all_day && b.end_min <= now;
    return (_jsxs("div", { className: `ev busy${past ? ' past' : ''}`, children: [_jsx(Time, { e: b, d: d }), _jsxs("div", { children: [_jsxs("div", { className: "t", children: [_jsx(Badge, { m: snap.members.find(m => m.id === b.owner) }), _jsxs("span", { children: [nameOf(snap.members, b.owner), " ist belegt"] })] }), _jsxs("div", { className: "meta", children: [_jsxs("span", { className: "vis-tag busy", children: [_jsx(Icon, { name: "lock" }), " belegt"] }), _jsx("span", { children: "Details privat" })] })] })] }));
}
function DayList({ snap, d, filter, now, open, flash, empty }) {
    const s = snap.family.settings;
    const { ev, busy } = visibleOnDay(snap.events, snap.busy, d, snap.me, filter);
    const isToday = d === today();
    const hide = (x) => s.pastMode === 'hide' && isToday && !x.all_day && x.end_min <= now;
    const items = [
        ...ev.filter(e => !hide(e)).map(e => ({ k: 'e', e })), ...busy.filter(b => !hide(b)).map(b => ({ k: 'b', b }))
    ].sort((a, b) => {
        const x = a.k === 'e' ? a.e : a.b, y = b.k === 'e' ? b.e : b.b;
        return x.all_day === y.all_day ? x.start_min - y.start_min : x.all_day ? -1 : 1;
    });
    const bds = bdOn(snap.birthdays, d);
    return _jsxs(_Fragment, { children: [bds.map(b => _jsxs("div", { className: "bd-line", children: [_jsx(Icon, { name: "cake" }), _jsxs("span", { children: [_jsx("b", { children: b.name }), " hat Geburtstag", b.age ? ` und wird ${b.age}` : ''] })] }, b.id)), items.length ? items.map(it => it.k === 'e'
                ? _jsx(EvCard, { e: it.e, d: d, snap: snap, now: now, open: open, flash: flash }, it.e.id)
                : _jsx(BusyCard, { b: it.b, d: d, snap: snap, now: now }, it.b.id))
                : empty === 'big'
                    ? _jsxs("div", { className: "free", children: [_jsx(Icon, { name: "smile" }), _jsx("b", { children: "Frei" }), _jsx("span", { children: isToday ? 'Heute steht nichts mehr an.' : 'Nichts geplant.' })] })
                    : _jsxs("div", { className: "empty smile", children: [_jsx(Icon, { name: "smile" }), "Frei"] })] });
}
function CalendarTab({ snap, filter, now, open, flash }) {
    const [view, setView] = useState('week');
    const [wk, setWk] = useState(0), [mo, setMo] = useState(0);
    const [sel, setSel] = useState(today());
    const t = today();
    const seg = _jsx("div", { className: "seg", role: "group", "aria-label": "Ansicht", children: [['week', 'Woche'], ['month', 'Monat']].map(([k, l]) => _jsx("button", { type: "button", "aria-pressed": view === k, onClick: () => setView(k), children: l }, k)) });
    if (view === 'week') {
        const mon = addDays(mondayOf(t), wk * 7), sun = addDays(mon, 6);
        const days = Array.from({ length: 7 }, (_, i) => addDays(mon, i)).filter(d => wk !== 0 || d >= t);
        return _jsxs(_Fragment, { children: [seg, _jsxs("div", { className: "calnav", children: [_jsx("button", { type: "button", className: "nav", "aria-label": "Vorige Woche", onClick: () => setWk(wk - 1), children: "\u2039" }), _jsxs("div", { className: "ttl", children: ["KW ", isoWeek(mon), _jsxs("small", { children: [fromIso(mon).getDate(), ". ", MON[fromIso(mon).getMonth()].slice(0, 3), " \u2013 ", fromIso(sun).getDate(), ". ", MON[fromIso(sun).getMonth()].slice(0, 3)] })] }), _jsx("button", { type: "button", className: "nav", "aria-label": "N\u00E4chste Woche", onClick: () => setWk(wk + 1), children: "\u203A" })] }), wk !== 0 && _jsx("button", { type: "button", className: "todaybtn", onClick: () => setWk(0), children: "Diese Woche" }), days.map(d => _jsxs("div", { style: { display: 'grid', gap: 8 }, children: [_jsx("div", { className: "day-h", children: _jsx("span", { children: dayLabel(d) }) }), _jsx(DayList, { snap: snap, d: d, filter: filter, now: now, open: open, flash: flash, empty: "small" })] }, d))] });
    }
    const first = fromIso(t);
    first.setDate(1);
    first.setMonth(first.getMonth() + mo);
    const y = first.getFullYear(), m = first.getMonth();
    const start = (first.getDay() + 6) % 7, len = new Date(y, m + 1, 0).getDate();
    const iso0 = `${y}-${String(m + 1).padStart(2, '0')}-`;
    return _jsxs(_Fragment, { children: [seg, _jsxs("div", { className: "calnav", children: [_jsx("button", { type: "button", className: "nav", "aria-label": "Voriger Monat", onClick: () => setMo(mo - 1), children: "\u2039" }), _jsxs("div", { className: "ttl", children: [MON[m], " ", y] }), _jsx("button", { type: "button", className: "nav", "aria-label": "N\u00E4chster Monat", onClick: () => setMo(mo + 1), children: "\u203A" })] }), _jsxs("div", { className: "mgrid", children: [[1, 2, 3, 4, 5, 6, 0].map(i => _jsx("div", { className: "wd", children: WDS[i] }, i)), Array.from({ length: start }, (_, i) => _jsx("div", {}, `x${i}`)), Array.from({ length: len }, (_, i) => {
                        const d = iso0 + String(i + 1).padStart(2, '0');
                        const { ev, busy } = visibleOnDay(snap.events, snap.busy, d, snap.me, filter);
                        const dots = [...ev.map(e => colorOf(snap.members, e.persons[0] ?? e.owner)), ...busy.map(() => 'var(--line)')].slice(0, 3);
                        return _jsxs("button", { type: "button", className: `cell${d === t ? ' today' : ''}${d === sel ? ' sel' : ''}${d < t ? ' past' : ''}`, onClick: () => setSel(d), "aria-label": `${longDate(d)}, ${ev.length} Termine`, children: [i + 1, _jsxs("span", { className: "dots", children: [dots.map((c, j) => _jsx("i", { style: cvar(c) }, j)), bdOn(snap.birthdays, d).length > 0 && _jsx("i", { className: "bdot" })] })] }, d);
                    })] }), _jsx("div", { className: "day-h", children: _jsx("span", { children: dayLabel(sel) }) }), _jsx(DayList, { snap: snap, d: sel, filter: filter, now: now, open: open, flash: flash, empty: "small" })] });
}
