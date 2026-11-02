import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { avatarOf, boardImg } from '../lib/supabase';
import { useEffect, useLayoutEffect, useState } from 'react';
import './display.css';
import { store } from '../lib/store';
import { addDays, fromIso, hm, inDays, isoWeek, longDate, mondayOf, MON, nowMin, today, WD, WDS } from '../lib/dates';
import { bdOn, byTime, dayOfN, depart, etaMin, liveMsgs, onDay, travel, upcoming, whenM, whenText } from '../lib/model';
import { cvar, Icon } from '../app/ui';
import { DisplayInput } from './DisplayInput';
import { DisplayEdit } from './DisplayEdit';
const variant = () => {
    const v = new URLSearchParams(location.search).get('v');
    if (v === 'bigme' || v === 'color' || v === 'eink' || v === 'mini' || v === 'hoch' || v === 'qm')
        return v;
    // Ohne Angabe: hochkant aufgehängter Bildschirm bekommt die Widget-Ansicht
    return innerHeight > innerWidth * 1.15 ? 'hoch' : 'qm';
};
// ?r=Sekunden in der Adresse setzt den Abruf-Takt (mindestens 5 Sekunden)
const refreshMs = (v) => {
    const r = Number(new URLSearchParams(location.search).get('r'));
    return r > 0 ? Math.max(5, r) * 1000 : v === 'eink' || v === 'bigme' ? 300000 : 60000;
};
// Das Flur-Display: lädt die Familiendaten über das geheime Token und aktualisiert sich jede Minute (oder nach ?r=)
export function Display({ token }) {
    const [feed, setFeed] = useState(undefined);
    const [now, setNow] = useState(nowMin());
    const [day, setDay] = useState(today());
    const [detail, setDetail] = useState(null);
    const [bdOpen, setBdOpen] = useState(false);
    const [input, setInput] = useState(null);
    const [editing, setEditing] = useState(null);
    const [note, setNote] = useState('');
    // Pinnwand zeigt so viele Nachrichten, wie in die Spalte passen; der Rest wird als „+N weitere“ gezählt
    const [fitN, setFitN] = useState(99);
    const [wk, setWk] = useState(0);
    const [, setTick] = useState(0);
    // Nach dem Blättern kehrt die Ansicht nach einer Minute zu heute zurück
    useEffect(() => { if (!wk)
        return; const t = setTimeout(() => setWk(0), 60000); return () => clearTimeout(t); }, [wk]);
    useLayoutEffect(() => { setFitN(99); }, [feed]);
    useLayoutEffect(() => {
        const list = document.querySelector('.wys .w-msgs');
        const boxes = [list?.closest('.w-sec'), list?.closest('.w-col, .w-board, .t-board')].filter(Boolean);
        const count = document.querySelectorAll('.wys .w-msgs .w-msg').length;
        if (count > 1 && boxes.some(b => b.scrollHeight > b.clientHeight + 2))
            setFitN(count - 1);
    });
    useEffect(() => { const r = () => { setFitN(99); setTick(t => t + 1); }; addEventListener('resize', r); return () => removeEventListener('resize', r); }, []);
    const v = variant();
    useEffect(() => {
        document.title = 'FamTO · Display';
        const load = () => store.displayFeed(token).then(f => setFeed(f));
        void load();
        const t1 = setInterval(() => { setNow(nowMin()); setDay(today()); }, 20000);
        const t2 = setInterval(load, refreshMs(v));
        const off = store.demo ? store.subscribe(() => void load()) : () => { };
        return () => { clearInterval(t1); clearInterval(t2); off(); };
    }, [token, v]);
    if (feed === undefined)
        return _jsx("div", { className: "wys full", children: _jsx("div", { className: "w-empty", style: { padding: '4cqw' }, children: "L\u00E4dt \u2026" }) });
    if (feed === null)
        return _jsx("div", { className: "wys full", children: _jsx("div", { className: "w-empty", style: { padding: '4cqw' }, children: "Dieses Display ist nicht (mehr) verbunden. Bitte die Adresse in der App unter Einstellungen \u2192 Displays pr\u00FCfen." }) });
    if (v === 'mini')
        return _jsx(Mini, { feed: feed, day: day, now: now });
    const s = feed.family.settings;
    const qm = v === 'qm' || v === 'bigme', big = v === 'bigme', eink = v === 'eink';
    const members = feed.members;
    const color = (id) => members.find(m => m.id === id)?.color ?? '#7a8590';
    const ini = (id) => (members.find(m => m.id === id)?.name.replace(/^(Oma|Opa)\s+/, '')[0] ?? '?').toUpperCase();
    const nm = (id) => members.find(m => m.id === id)?.name ?? '';
    const dayOf = (n) => addDays(day, n);
    const list = (d) => feed.events.filter(e => onDay(e, d)).sort(byTime);
    const morning = s.split > 0 && now < s.split;
    const fixed = s.boardMode === 'fixed';
    const hidePast = (e) => s.pastMode === 'hide' && !e.all_day && e.end_min <= now;
    const msgs = liveMsgs(feed.messages, s);
    const av = (id) => avatarOf(members.find(m => m.id === id));
    const sb = (id) => { const a = av(id); return _jsx("span", { className: `b${a ? ' av' : ''}`, style: cvar(color(id)), children: a ? _jsx("img", { src: a, alt: "" }) : ini(id) }, id); };
    const ad = (e, d) => _jsxs("div", { className: "w-ad", style: cvar(e.persons.length ? color(e.persons[0]) : '#7a8590'), onClick: () => setDetail(e), role: "button", tabIndex: 0, children: [_jsx("b", { children: e.title }), _jsxs("span", { className: "lbl", children: ["ganzt\u00E4gig", e.end_date > e.date ? ` · ${dayOfN(e, d)}` : ''] })] }, e.id);
    const row = (e, past, noGo = false) => (_jsxs("div", { className: `w-ev${past ? ' past' : ''}`, style: cvar(e.persons.length ? color(e.persons[0]) : '#7a8590'), onClick: () => setDetail(e), role: "button", tabIndex: 0, children: [_jsx("time", { children: hm(e.start_min) }), _jsxs("div", { children: [_jsx("div", { className: "tt", children: e.title }), e.driver && _jsxs("div", { className: "dr", children: [_jsx(Icon, { name: "car" }), " ", nm(e.driver), " ", etaMin(e) !== null ? _jsxs(_Fragment, { children: ["f\u00E4hrt \u00B7 ", _jsxs("b", { children: ["Ankunft ", hm(etaMin(e))] })] }) : _jsxs(_Fragment, { children: ["f\u00E4hrt", travel(e, s) && !noGo ? _jsxs(_Fragment, { children: [" \u00B7 ", _jsxs("b", { children: ["los ", hm(depart(e, s))] })] }) : null] }), e.place ? ` · ${e.place}` : ''] })] }), _jsx("span", { className: "wb", children: e.persons.map(sb) })] }, e.id));
    const bdRow = (d) => bdOn(feed.birthdays, d).map(b => _jsxs("div", { className: "w-bd", onClick: () => setBdOpen(true), role: "button", tabIndex: 0, children: [_jsx(Icon, { name: "cake" }), _jsxs("span", { children: [_jsx("b", { children: b.name }), " hat Geburtstag", b.age ? ` und wird ${b.age}` : ''] })] }, b.id));
    // Heute mit Jetzt-Linie und Abfahrtszeilen
    const todayList = (() => {
        const l = list(day), out = [...bdRow(day), ...l.filter(e => e.all_day).map(e => ad(e, day))];
        let placed = false;
        for (const e of l.filter(x => !x.all_day && !hidePast(x))) {
            const past = e.end_min <= now;
            if (!past && !placed) {
                out.push(_jsxs("div", { className: "nowline", children: ["Jetzt ", eink ? '' : hm(now)] }, "now"));
                placed = true;
            }
            const eta = etaMin(e);
            if (eta !== null && e.start_min + 30 > now) {
                out.push(_jsxs("div", { className: "w-go soon", style: cvar(color(e.driver)), children: [_jsx("time", { children: hm(eta) }), _jsxs("div", { className: "w-go-bar", style: { ['--p']: '100%' }, children: [_jsx(Icon, { name: "car" }), _jsxs("span", { children: [nm(e.driver), " f\u00E4hrt \u00B7 Ankunft"] })] })] }, `go${e.id}`));
            }
            else if (travel(e, s) && e.start_min > now) {
                const dep = depart(e, s), gone = dep <= now;
                out.push(_jsxs("div", { className: `w-go${gone ? ' gone' : dep - now <= 30 ? ' soon' : ''}`, style: cvar(color(e.driver)), children: [_jsx("time", { children: hm(dep) }), _jsxs("div", { className: "w-go-bar", style: { ['--p']: `${Math.round(100 * travel(e, s) / (travel(e, s) + s.buffer))}%` }, children: [_jsx(Icon, { name: "car" }), _jsxs("span", { children: [nm(e.driver), " ", gone ? 'ist unterwegs' : 'fährt los', " \u00B7 ", travel(e, s), " Min."] })] })] }, `go${e.id}`));
            }
            out.push(row(e, past, true));
        }
        const hidden = l.filter(hidePast).length;
        if (!l.length && !bdOn(feed.birthdays, day).length)
            return [_jsx("div", { className: "w-empty", children: "Heute keine Familientermine" }, "e")];
        if (hidden && hidden === l.length && !bdOn(feed.birthdays, day).length)
            return [_jsx("div", { className: "w-empty", children: "Heute keine weiteren Familientermine" }, "e")];
        return out;
    })();
    const dayList = (d) => { const l = list(d); return [...bdRow(d), ...(l.length ? l.map(e => e.all_day ? ad(e, d) : row(e, false)) : [_jsx("div", { className: "w-empty", children: "Frei" }, "f")])]; };
    const compact = (from, to) => {
        const out = [];
        for (let n = from; n <= to; n++) {
            const d = dayOf(n), l = list(d).filter(e => !(e.all_day && e.date < d)), x = fromIso(d);
            out.push(_jsxs("div", { children: [_jsxs("b", { children: [WDS[x.getDay()], " ", x.getDate(), "."] }), _jsx("span", { children: l.length ? l.map(e => `${e.all_day ? '' : hm(e.start_min) + ' '}${e.title}${e.all_day || !e.persons.length ? '' : ` (${e.persons.map(ini).join('')})`}`).join(' · ') : '–' })] }, d));
        }
        return out;
    };
    const board = (_max) => {
        const n = fitN;
        const shown = msgs.slice(0, n);
        const head = _jsxs("h3", { children: ["Board", msgs.length > n && _jsxs("span", { className: "w-more", children: ["+", msgs.length - n, " weitere"] })] });
        const body = shown.length ? shown.map(m => _jsxs("div", { className: "w-msg", children: [sb(m.from_member), _jsxs("span", { children: [m.text, m.image && _jsx("img", { className: "w-img", src: boardImg(m.image), alt: "" }), m.taker ? _jsxs("b", { children: [" \u00B7 \u00FCbernimmt ", nm(m.taker)] }) : m.replies.length ? _jsxs("b", { children: [" \u00B7 ", nm(m.replies.at(-1).from_member), ": ", m.replies.at(-1).text] }) : null] }), m.pinned ? _jsx("small", { className: "pinned", title: "angeheftet", children: _jsx(Icon, { name: "pin" }) }) : _jsx("small", { children: whenM(m) })] }, m.id)) : _jsx("div", { className: "w-empty", children: "Keine Nachrichten" });
        return _jsxs("div", { className: "w-sec", children: [head, _jsx("div", { className: "w-msgs", children: body })] });
    };
    // Hinweis oben: nächste Abfahrt oder nächster Termin
    let next = _jsx("div", {});
    const today0 = list(day);
    const onWay = today0.find(e => etaMin(e) !== null && e.start_min + 30 > now);
    const goNext = today0.find(e => etaMin(e) === null && travel(e, s) && depart(e, s) > now && depart(e, s) - now <= 45);
    const nx = today0.find(e => !e.all_day && e.start_min > now);
    if (onWay)
        next = _jsxs("div", { className: "w-next go", children: [_jsx(Icon, { name: "car" }), _jsxs("div", { children: [_jsxs("strong", { children: [nm(onWay.driver), " f\u00E4hrt:"] }), " ", onWay.title, " \u00B7 Ankunft ca. ", hm(etaMin(onWay))] })] });
    else if (goNext)
        next = _jsxs("div", { className: "w-next go", children: [_jsx(Icon, { name: "car" }), _jsxs("div", { children: [_jsxs("strong", { children: [eink ? `Um ${hm(depart(goNext, s))}` : `In ${depart(goNext, s) - now} Min.`, " losfahren:"] }), " ", nm(goNext.driver), " f\u00E4hrt", goNext.persons.length ? ` ${goNext.persons.map(nm).join(', ')}` : '', " \u00B7 ", goNext.title, " \u00B7 ", travel(goNext, s), " Min. Fahrt"] })] });
    else if (nx && nx.start_min - now <= 90)
        next = _jsxs("div", { className: "w-next", children: [_jsx(Icon, { name: "clock" }), _jsxs("div", { children: [_jsxs("strong", { children: [eink ? `Um ${hm(nx.start_min)}` : `In ${nx.start_min - now} Min.`, ":"] }), " ", nx.persons.length ? `${nx.persons.map(nm).join(', ')} · ` : '', nx.title, nx.driver ? _jsxs(_Fragment, { children: [" \u00B7 ", _jsxs("strong", { children: [nm(nx.driver), " f\u00E4hrt"] })] }) : null] })] });
    const cakes = s.bdLead > 0 ? upcoming(feed.birthdays).filter(b => b.days <= s.bdLead) : [];
    const H = (n) => `${n === 0 ? 'Heute' : n === 1 ? 'Morgen' : 'Übermorgen'} · ${WD[fromIso(dayOf(n)).getDay()]}`;
    let main;
    if (morning) {
        main = _jsxs("div", { className: `w-main morning${qm ? ' qm' : ''}`, children: [_jsx("div", { className: "w-col", children: _jsxs("div", { className: "w-sec", children: [_jsx("h3", { children: H(0) }), _jsx("div", { className: "w-list", children: todayList })] }) }), _jsxs("div", { className: "w-col", children: [board(qm ? 5 : 3), _jsxs("div", { className: "w-later", children: [_jsx(Icon, { name: "clock" }), _jsxs("span", { children: ["Ab ", hm(s.split), " Uhr: ", s.ahead === 1 ? 'Vorschau auf morgen' : `Vorschau auf ${s.ahead} Tage`] })] })] })] });
    }
    else if (fixed) {
        const n = qm && s.ahead > 1 ? 3 : 2;
        main = _jsxs("div", { className: `w-main fixboard${qm ? ' qm' : ''}`, children: [_jsxs("div", { className: "w-days", children: [_jsxs("div", { className: `w-dcols c${n}`, children: [_jsx("div", { className: "w-col", children: _jsxs("div", { className: "w-sec", children: [_jsx("h3", { children: H(0) }), _jsx("div", { className: "w-list", children: todayList })] }) }), Array.from({ length: n - 1 }, (_, i) => _jsx("div", { className: "w-col", children: _jsxs("div", { className: "w-sec", children: [_jsx("h3", { children: H(i + 1) }), _jsx("div", { className: "w-list", children: dayList(dayOf(i + 1)) })] }) }, i))] }), s.ahead >= n && _jsx("div", { className: "w-strip", children: compact(n, Math.min(s.ahead, n + 3)).map((x, i) => _jsx("div", { children: x }, i)) })] }), _jsx("div", { className: "w-board", children: board(6) })] });
    }
    else if (qm) {
        const three = s.ahead > 1;
        main = _jsxs("div", { className: `w-main qm ${three ? 'days3' : 'days2'}`, children: [_jsx("div", { className: "w-col", children: _jsxs("div", { className: "w-sec", children: [_jsx("h3", { children: H(0) }), _jsx("div", { className: "w-list", children: todayList })] }) }), _jsx("div", { className: "w-col", children: _jsxs("div", { className: "w-sec", children: [_jsx("h3", { children: H(1) }), _jsx("div", { className: "w-list", children: dayList(dayOf(1)) })] }) }), three && _jsx("div", { className: "w-col", children: _jsxs("div", { className: "w-sec", children: [_jsx("h3", { children: H(2) }), _jsx("div", { className: "w-list", children: dayList(dayOf(2)) })] }) }), _jsxs("div", { className: "w-col side", children: [s.ahead >= 3 && _jsxs("div", { className: "w-sec", children: [_jsx("h3", { children: "Weitere Tage" }), _jsx("div", { className: "w-week", children: compact(3, s.ahead) })] }), board(big ? 2 : s.ahead > 6 ? 2 : 3)] })] });
    }
    else {
        main = _jsxs("div", { className: "w-main days2", children: [_jsx("div", { className: "w-col", children: _jsxs("div", { className: "w-sec", children: [_jsx("h3", { children: H(0) }), _jsx("div", { className: "w-list", children: todayList })] }) }), _jsx("div", { className: "w-col", children: _jsxs("div", { className: "w-sec", children: [_jsx("h3", { children: H(1) }), _jsx("div", { className: "w-list", children: dayList(dayOf(1)) })] }) }), _jsxs("div", { className: "w-col side", children: [s.ahead >= 2 && _jsxs("div", { className: "w-sec", children: [_jsx("h3", { children: "N\u00E4chste Tage" }), _jsx("div", { className: "w-week", children: compact(2, Math.min(s.ahead, 4)) })] }), board(s.ahead > 3 ? 1 : 2)] })] });
    }
    const overlays = _jsxs(_Fragment, { children: [input && _jsx(DisplayInput, { token: token, feed: feed, mode: input, close: () => setInput(null), saved: m => { setInput(null); setNote(m); setTimeout(() => setNote(''), 4000); void store.displayFeed(token).then(f => setFeed(f)); } }), note && _jsx("div", { className: "w-toast", children: note }), detail && _jsx("div", { className: "w-ov", onClick: e => { if (e.target === e.currentTarget)
                    setDetail(null); }, children: _jsxs("div", { className: "w-card", style: cvar(color(detail.persons[0])), role: "dialog", "aria-label": "Termindetails", children: [_jsx("h4", { children: detail.title }), _jsxs("div", { className: "r", children: [_jsx("span", { children: "Wann" }), _jsx("div", { children: whenText(detail) })] }), detail.persons.length > 0 && _jsxs("div", { className: "r", children: [_jsx("span", { children: "Wer" }), _jsxs("div", { children: [_jsx("span", { className: "wb", children: detail.persons.map(sb) }), " ", detail.persons.map(nm).join(', ')] })] }), detail.driver && _jsxs("div", { className: "r", children: [_jsx("span", { children: "Fahrdienst" }), _jsxs("div", { children: [nm(detail.driver), " ", etaMin(detail) !== null ? `fährt · Ankunft ca. ${hm(etaMin(detail))}` : `fährt${travel(detail, s) ? ` · los um ${hm(depart(detail, s))}` : ''}`] })] }), (detail.place || detail.addr) && _jsxs("div", { className: "r", children: [_jsx("span", { children: "Ort" }), _jsxs("div", { children: [detail.place, detail.place && detail.addr ? _jsx("br", {}) : null, detail.addr && _jsx("small", { style: { color: 'var(--screen-muted)' }, children: detail.addr })] })] }), detail.bring.length > 0 && _jsxs("div", { className: "r", children: [_jsx("span", { children: "Mitbringen" }), _jsx("div", { children: detail.bring.join(', ') })] }), detail.notes && _jsxs("div", { className: "r", children: [_jsx("span", { children: "Notiz" }), _jsx("div", { children: detail.notes })] }), _jsxs("div", { className: "w-card-btns", children: [feed.touch && _jsx("button", { type: "button", className: "w-edit-btn", onClick: () => { setEditing(detail); setDetail(null); }, children: "Bearbeiten" }), _jsx("button", { type: "button", onClick: () => setDetail(null), children: "Schlie\u00DFen" })] })] }) }), editing && _jsx(DisplayEdit, { token: token, feed: feed, ev: editing, close: () => setEditing(null), saved: m => { setEditing(null); setNote(m); setTimeout(() => setNote(''), 4000); void store.displayFeed(token).then(f => setFeed(f)); } }), bdOpen && _jsx("div", { className: "w-ov", onClick: e => { if (e.target === e.currentTarget)
                    setBdOpen(false); }, children: _jsxs("div", { className: "w-card", style: cvar('#c9640f'), role: "dialog", "aria-label": "N\u00E4chste Geburtstage", children: [_jsx("h4", { children: "N\u00E4chste Geburtstage" }), _jsx("div", { className: "bdl", children: upcoming(feed.birthdays).slice(0, 5).map(b => _jsxs("div", { className: `bdr${b.days <= s.bdLead ? ' soon' : ''}`, children: [_jsxs("div", { children: [_jsx("b", { children: b.name }), _jsxs("small", { children: [b.day, ". ", MON[b.month - 1], b.age ? ` · wird ${b.age}` : ''] })] }), _jsx("span", { className: "dd", children: inDays(b.days) })] }, b.id)) }), _jsx("button", { type: "button", onClick: () => setBdOpen(false), children: "Schlie\u00DFen" })] }) })] });
    const tall = v === 'hoch';
    if (tall) {
        // Hochkant wie das Handy-Widget: Tage untereinander, Board, unten Geburtstage, Kalenderwoche und Eingabe
        const start = wk === 0 ? day : addDays(mondayOf(day), 7 * wk);
        const n = wk === 0 ? Math.max(3, Math.min(s.ahead + 1, 7)) : 7;
        const lbl = (d) => { const k = d === day ? 'Heute' : d === addDays(day, 1) ? 'Morgen' : d === addDays(day, 2) ? 'Übermorgen' : ''; const x = fromIso(d); return k ? `${k} · ${WD[x.getDay()]}` : `${WD[x.getDay()]} ${x.getDate()}. ${MON[x.getMonth()]}`; };
        const tev = (e, d) => {
            const past = d === day && !e.all_day && e.end_min <= now;
            if (d === day && hidePast(e))
                return null;
            return _jsxs("div", { className: `t-ev${past ? ' past' : ''}`, style: cvar(e.persons.length ? color(e.persons[0]) : '#7a8590'), onClick: () => setDetail(e), role: "button", tabIndex: 0, children: [_jsx("time", { children: e.all_day ? 'ganzt.' : hm(e.start_min) }), _jsxs("div", { className: "tt", children: [_jsx("b", { children: e.title }), e.driver ? _jsxs("small", { children: [" \u00B7 ", nm(e.driver), " ", etaMin(e) !== null ? `fährt · Ankunft ${hm(etaMin(e))}` : `fährt${travel(e, s) && d === day && !past ? ` · los ${hm(depart(e, s))}` : ''}`] }) : e.place ? _jsxs("small", { children: [" \u00B7 ", e.place] }) : null] }), _jsx("span", { className: "wb", children: e.persons.map(sb) })] }, e.id + d);
        };
        const days = Array.from({ length: n }, (_, i) => addDays(start, i)).map(d => {
            const l = list(d), bds = bdOn(feed.birthdays, d), rows = l.map(e => tev(e, d)).filter(Boolean);
            if (!rows.length && !bds.length && d !== day && wk === 0 && d !== addDays(day, 1))
                return null;
            if (!rows.length && !bds.length && wk !== 0)
                return _jsx("div", { className: "t-day free", children: _jsxs("h3", { children: [lbl(d), " ", _jsx("span", { children: "frei" })] }) }, d);
            return _jsxs("div", { className: "t-day", children: [_jsx("h3", { children: lbl(d) }), bds.map(b => _jsxs("div", { className: "t-ev bd", style: cvar('#c2477a'), onClick: () => setBdOpen(true), role: "button", tabIndex: 0, children: [_jsx("time", { children: _jsx(Icon, { name: "cake" }) }), _jsxs("div", { className: "tt", children: [_jsx("b", { children: b.name }), _jsxs("small", { children: [" hat Geburtstag", b.age ? ` · wird ${b.age}` : ''] })] })] }, b.id)), rows.length ? rows : !bds.length && _jsx("div", { className: "w-empty", children: d === day && l.length ? 'Keine weiteren Familientermine' : 'Keine Familientermine' })] }, d);
        });
        const shown = msgs.slice(0, fitN);
        const touch = feed.touch;
        return (_jsxs("div", { className: `wys full tall${!s.wbg ? ' dark' : ''}`, style: s.wbg ? { background: s.wbg } : undefined, children: [_jsxs("div", { className: "t-head", children: [_jsx("h2", { children: longDate(day) }), _jsx("div", { className: "clock", children: hm(now) })] }), _jsx("div", { className: "t-days", children: days }), _jsx("div", { className: "t-board", children: _jsxs("div", { className: "w-sec", children: [_jsxs("h3", { children: ["Board", msgs.length > fitN && _jsxs("span", { className: "w-more", children: ["+", msgs.length - fitN, " weitere"] })] }), _jsx("div", { className: "w-msgs", children: shown.length ? shown.map(m => _jsxs("div", { className: "w-msg", children: [sb(m.from_member), _jsxs("span", { children: [m.pinned && _jsx(Icon, { name: "pin" }), " ", m.text, m.taker ? _jsxs("b", { children: [" \u00B7 \u00FCbernimmt ", nm(m.taker)] }) : m.replies.length ? _jsxs("b", { children: [" \u00B7 ", nm(m.replies.at(-1).from_member), ": ", m.replies.at(-1).text] }) : null] }), _jsxs("small", { children: [nm(m.from_member), " \u00B7 ", whenM(m)] })] }, m.id)) : _jsx("div", { className: "w-empty", children: "Keine Nachrichten" }) })] }) }), _jsxs("div", { className: "t-bar", children: [_jsx("button", { type: "button", className: "t-ring b", onClick: () => setBdOpen(true), "aria-label": "Geburtstage", children: "B" }), _jsxs("div", { className: "t-kw", children: [_jsx("button", { type: "button", onClick: () => setWk(w => w - 1), "aria-label": "Woche zur\u00FCck", children: "\u25C0" }), _jsxs("button", { type: "button", className: "t-ring kw", onClick: () => setWk(0), "aria-label": "Zur\u00FCck zu heute", children: ["KW ", isoWeek(wk === 0 ? day : start)] }), _jsx("button", { type: "button", onClick: () => setWk(w => w + 1), "aria-label": "Woche vor", children: "\u25B6" })] }), touch ? _jsxs("div", { className: "t-kw", children: [_jsx("button", { type: "button", className: "t-ring", onClick: () => setInput('board'), "aria-label": "Board-Nachricht", children: "\u270E" }), _jsx("button", { type: "button", className: "t-ring", onClick: () => setInput('event'), "aria-label": "Neuer Termin", children: "\uFF0B" })] }) : _jsx("span", { className: "t-ring ghost" })] }), overlays] }));
    }
    return (_jsxs("div", { className: `wys full${!eink && !big && !s.wbg ? ' dark' : ''}${eink ? ' eink' : ''}${qm ? ' qm' : ''}${big ? ' kal' : ''}`, style: s.wbg ? { background: s.wbg } : undefined, children: [_jsxs("div", { className: "w-head", children: [_jsx("h2", { children: longDate(day) }), cakes.length > 0 && _jsx("div", { className: "w-cakes", children: cakes.map(b => _jsxs("button", { type: "button", className: "w-cake", onClick: () => setBdOpen(true), children: [b.days === 0 ? 'Heute' : b.days, _jsx(Icon, { name: "cake" }), _jsx("small", { children: b.name })] }, b.id)) }), _jsxs("div", { children: [_jsx("div", { className: "clock", children: eink ? '' : hm(now) }), _jsx("div", { className: "sub", children: feed.family.name })] })] }), next, main, _jsxs("div", { className: "w-foot", children: [feed.touch && !eink ? _jsxs("span", { className: "w-add", children: [_jsx("button", { type: "button", className: "w-addbtn", onClick: () => setInput('event'), children: "\uFF0B Termin" }), _jsx("button", { type: "button", className: "w-addbtn board", onClick: () => setInput('board'), children: "\u270E Board" })] }) : _jsx("span", { children: "Termin antippen f\u00FCr Details" }), _jsxs("span", { children: ["Nur Familientermine", morning ? ' · Tagesansicht' : ''] })] }), overlays] }));
}
// Kleine Ansicht für Handy-Widgets (z. B. über eine Web-Widget-App): heutige Familientermine und Pinnwand
function Mini({ feed, day, now }) {
    const s = feed.family.settings;
    const members = feed.members;
    const color = (id) => members.find(m => m.id === id)?.color ?? '#7a8590';
    const nm = (id) => members.find(m => m.id === id)?.name ?? '';
    const evs = feed.events.filter(e => onDay(e, day)).sort(byTime).filter(e => !(s.pastMode === 'hide' && !e.all_day && e.end_min <= now));
    const msgs = liveMsgs(feed.messages, s);
    const d = fromIso(day);
    return (_jsxs("div", { className: "mini", children: [_jsxs("div", { className: "mini-h", children: [_jsx("b", { children: "Heute" }), _jsxs("span", { children: [WDS[d.getDay()], " ", d.getDate(), ". ", MON[d.getMonth()]] })] }), evs.length === 0 && _jsx("div", { className: "mini-empty", children: "Keine Familientermine" }), evs.map(e => (_jsxs("div", { className: `mini-ev${!e.all_day && e.end_min <= now ? ' past' : ''}`, style: cvar(e.persons.length ? color(e.persons[0]) : '#7a8590'), children: [_jsx("time", { children: e.all_day ? 'ganzt.' : hm(e.start_min) }), _jsxs("span", { className: "t", children: [e.title, e.driver ? _jsxs("small", { children: [" \u00B7 ", nm(e.driver), " f\u00E4hrt"] }) : null] })] }, e.id))), _jsxs("div", { className: "mini-h board", children: [_jsx("b", { children: "Board" }), msgs.length > 0 && _jsx("span", { children: msgs.length })] }), msgs.length === 0 && _jsx("div", { className: "mini-empty", children: "Keine Nachrichten" }), msgs.map(m => (_jsxs("div", { className: "mini-msg", style: cvar(color(m.from_member)), children: [m.pinned && _jsx(Icon, { name: "pin" }), _jsxs("span", { children: [m.text, m.image && _jsx("img", { className: "w-img", src: boardImg(m.image), alt: "" })] }), _jsx("small", { children: nm(m.from_member) })] }, m.id)))] }));
}
