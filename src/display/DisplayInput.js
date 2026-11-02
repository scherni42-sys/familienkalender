import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { store } from '../lib/store';
import { parseSpoken } from '../lib/ai';
import { native } from '../lib/native';
import { avatarOf } from '../lib/supabase';
import { whenText } from '../lib/model';
import { cvar, Icon } from '../app/ui';
const SR = window.SpeechRecognition
    ?? window.webkitSpeechRecognition;
// Eingabe am Touch-Display: wer bin ich (Avatar antippen), dann sprechen oder tippen, bei Terminen erst bestätigen
export function DisplayInput({ token, feed, mode, close, saved }) {
    const people = feed.members.filter(m => m.role !== 'guest');
    const [who, setWho] = useState(null);
    const [text, setText] = useState('');
    const [rec, setRec] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState('');
    const [draft, setDraft] = useState(null);
    const r = useRef(null);
    const join = (a, b) => [a.trim(), b.trim()].filter(Boolean).join(' ');
    useEffect(() => {
        const on = (e) => { const t = String(e.detail ?? '').trim(); setRec(false); if (t)
            setText(x => join(x, t)); };
        window.addEventListener('famto-speech', on);
        return () => { window.removeEventListener('famto-speech', on); r.current?.stop(); };
    }, []);
    const listen = () => {
        const n = native();
        if (n?.listen) {
            setRec(true);
            n.listen();
            return;
        }
        if (!SR) {
            setErr('Spracheingabe gibt es in diesem Browser nicht. Bitte tippen.');
            return;
        }
        if (rec) {
            r.current?.stop();
            return;
        }
        const x = new SR();
        x.lang = 'de-DE';
        x.interimResults = false;
        x.continuous = false;
        x.onresult = e => { const t = Array.from(e.results).map(res => res[0].transcript).join(' '); setText(v => join(v, t)); };
        x.onend = () => setRec(false);
        x.onerror = () => setRec(false);
        r.current = x;
        try {
            x.start();
            setRec(true);
        }
        catch {
            setRec(false);
        }
    };
    const go = async () => {
        const v = text.trim();
        if (!v || !who)
            return;
        setBusy(true);
        setErr('');
        try {
            if (mode === 'board') {
                await store.displayPost(token, who, v);
                saved('Hängt jetzt am Board.');
                return;
            }
            const p = await parseSpoken(v, who, people.map(m => ({ id: m.id, name: m.name, role: m.role ?? 'member' })), undefined, token);
            setDraft({ ...p, vis: 'family' });
        }
        catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
        }
        finally {
            setBusy(false);
        }
    };
    const save = async () => {
        if (!draft || !who)
            return;
        setBusy(true);
        setErr('');
        try {
            const { id: _id, reason: _r, suggested: _s, timeFound: _t, busy: _b, ...ev } = draft;
            await store.displaySaveEvent(token, who, { ...ev, vis: 'family' });
            saved(`Familientermin gespeichert: ${draft.title}, ${whenText(draft)}`);
        }
        catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
        }
        finally {
            setBusy(false);
        }
    };
    const nm = (id) => people.find(m => m.id === id)?.name ?? '';
    return (_jsx("div", { className: "w-ov", onClick: e => { if (e.target === e.currentTarget)
            close(); }, children: _jsxs("div", { className: "w-card w-in", role: "dialog", "aria-label": mode === 'board' ? 'Nachricht ans Board' : 'Neuer Familientermin', children: [_jsx("h4", { children: mode === 'board' ? '✎ Nachricht ans Board' : '＋ Neuer Familientermin' }), !draft && _jsxs(_Fragment, { children: [_jsx("div", { className: "w-in-lbl", children: "Wer bist du?" }), _jsx("div", { className: "w-who", children: people.map(m => {
                                const a = avatarOf(m);
                                return (_jsxs("button", { type: "button", className: `w-p${who === m.id ? ' on' : ''}`, style: cvar(m.color), onClick: () => setWho(m.id), children: [_jsx("span", { className: `b${a ? ' av' : ''}`, children: a ? _jsx("img", { src: a, alt: "" }) : m.name[0] }), _jsx("small", { children: m.name })] }, m.id));
                            }) }), _jsxs("div", { className: "w-in-row", children: [_jsx("button", { type: "button", className: `w-mic${rec ? ' rec' : ''}`, onClick: listen, "aria-label": "Sprechen", children: _jsx(Icon, { name: "mic" }) }), _jsx("textarea", { value: text, onChange: e => setText(e.target.value), placeholder: mode === 'board' ? 'Nachricht sprechen oder tippen' : 'z. B. „Freitag 16 Uhr Zahnarzt mit Ben, Anna fährt“', maxLength: 500 })] }), err && _jsx("div", { className: "w-in-err", children: err }), _jsxs("div", { className: "w-in-btns", children: [_jsx("button", { type: "button", className: "w-btn ghost", onClick: close, children: "Abbrechen" }), _jsx("button", { type: "button", className: "w-btn", disabled: busy || !text.trim() || !who, onClick: () => void go(), children: busy ? 'Einen Moment …' : !who ? 'Erst oben antippen, wer du bist' : mode === 'board' ? 'Ans Board' : 'Weiter' })] })] }), draft && _jsxs(_Fragment, { children: [_jsxs("div", { className: "r", children: [_jsx("span", { children: "Was" }), _jsx("div", { children: _jsx("b", { children: draft.title }) })] }), _jsxs("div", { className: "r", children: [_jsx("span", { children: "Wann" }), _jsx("div", { children: whenText(draft) })] }), draft.persons.length > 0 && _jsxs("div", { className: "r", children: [_jsx("span", { children: "Wer" }), _jsx("div", { children: draft.persons.map(nm).join(', ') })] }), draft.driver && _jsxs("div", { className: "r", children: [_jsx("span", { children: "Fahrdienst" }), _jsxs("div", { children: [nm(draft.driver), " f\u00E4hrt"] })] }), draft.place && _jsxs("div", { className: "r", children: [_jsx("span", { children: "Ort" }), _jsx("div", { children: draft.place })] }), err && _jsx("div", { className: "w-in-err", children: err }), _jsxs("div", { className: "w-in-btns", children: [_jsx("button", { type: "button", className: "w-btn ghost", onClick: () => setDraft(null), children: "\u00C4ndern" }), _jsx("button", { type: "button", className: "w-btn", disabled: busy, onClick: () => void save(), children: busy ? 'Speichert …' : 'Speichern' })] })] })] }) }));
}
