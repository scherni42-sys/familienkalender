import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { useSnapshot } from '../lib/store';
import { askClaude, parseSpoken } from '../lib/ai';
import { hm, shortDate } from '../lib/dates';
import { bdLabel, colorOf } from '../lib/model';
import { native } from '../lib/native';
import { eventDraft } from './DetailSheet';
import { cvar, Icon, Sheet } from './ui';
import { toast } from './toast';
const SR = window.SpeechRecognition
    ?? window.webkitSpeechRecognition;
const IDEAS = ['Wann treffe ich Tom das nächste Mal?', 'Alle Termine mit Oma', 'Wer fährt diese Woche?', 'Wann hat Opa Geburtstag?'];
// Zaubertaste: in eigenen Worten fragen oder etwas erledigen lassen
export function AskSheet({ close, open, edit, toDraft, bdays }) {
    const snap = useSnapshot();
    const [q, setQ] = useState(''), [busy, setBusy] = useState(false), [rec, setRec] = useState(false);
    const [res, setRes] = useState(null), [err, setErr] = useState('');
    const latest = useRef(q);
    latest.current = q;
    const input = useRef(null);
    const ask = async (text = latest.current) => {
        const v = text.trim();
        if (!v || busy)
            return;
        setBusy(true);
        setErr('');
        setRes(null);
        try {
            const r = await askClaude(v, snap.me, snap.members, snap.events, snap.birthdays);
            // Wünsche gleich ausführen: bearbeiten, neuer Termin, Geburtstage
            if (r.action === 'edit' && r.target && r.events.length <= 1) {
                edit(eventDraft(r.target));
                return;
            }
            if (r.action === 'open' && r.target && r.events.length <= 1) {
                open(r.target.id);
                return;
            }
            if (r.action === 'new' && r.newText) {
                toDraft(await parseSpoken(r.newText, snap.me, snap.members.filter(m => m.role !== 'guest')));
                return;
            }
            setRes(r);
        }
        catch (x) {
            setErr(x instanceof Error ? x.message : String(x));
        }
        finally {
            setBusy(false);
        }
    };
    // Android-App: Spracherkennung des Handys, danach gleich fragen
    useEffect(() => {
        const on = (e) => { const t = String(e.detail ?? '').trim(); setRec(false); if (t) {
            setQ(t);
            void ask(t);
        } };
        // Erkennung direkt in der App: Zwischenstand live ins Feld, Fehler als Hinweis
        const part = (e) => setQ(String(e.detail ?? ''));
        const bad = (e) => setErr(String(e.detail ?? ''));
        const st = (e) => { setRec(true); if (e.detail === 'listening')
            setErr(''); };
        window.addEventListener('famto-speech', on);
        window.addEventListener('famto-speech-partial', part);
        window.addEventListener('famto-speech-error', bad);
        window.addEventListener('famto-speech-state', st);
        return () => { window.removeEventListener('famto-speech', on); window.removeEventListener('famto-speech-partial', part); window.removeEventListener('famto-speech-error', bad); window.removeEventListener('famto-speech-state', st); };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    // Zaubertaste: Mikrofon geht sofort an; nach der Sprechpause fragt die App von selbst
    useEffect(() => {
        const t = setTimeout(() => { if (native()?.listen || SR)
            listen();
        else
            input.current?.focus(); }, 350);
        return () => clearTimeout(t);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    const listen = () => {
        const n = native();
        if (n?.listen) {
            if (rec && n.stopListen) {
                n.stopListen();
                return;
            }
            setRec(true);
            setErr('');
            n.listen();
            return;
        }
        if (!SR) {
            toast('Hier geht Sprache nur über das Mikrofon der Tastatur. Oder einfach tippen.');
            input.current?.focus();
            return;
        }
        const x = new SR();
        x.lang = 'de-DE';
        x.interimResults = true;
        x.continuous = false;
        let t = '';
        x.onresult = e => { t = Array.from(e.results).map(r => r[0].transcript).join(' '); setQ(t); };
        x.onend = () => { setRec(false); if (t.trim())
            void ask(t); };
        x.onerror = () => setRec(false);
        try {
            x.start();
            setRec(true);
        }
        catch {
            setRec(false);
        }
    };
    const nm = (id) => snap.members.find(m => m.id === id)?.name ?? '';
    return (_jsxs(Sheet, { onClose: close, label: "Claude fragen", children: [_jsx("h2", { children: "\u2728 Frag Claude" }), _jsx("p", { className: "note", children: "Frag nach Terminen, Personen oder Geburtstagen, oder sag, was du \u00E4ndern oder eintragen m\u00F6chtest." }), _jsxs("div", { className: "ask-in", children: [_jsx("textarea", { ref: input, rows: 2, value: q, placeholder: "z. B. Wann treffe ich Tom das n\u00E4chste Mal?", onChange: e => setQ(e.target.value), onKeyDown: e => { if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            void ask();
                        } }, "aria-label": "Deine Frage an Claude" }), _jsx("button", { type: "button", className: `btn ghost sm ask-mic${rec ? ' on' : ''}`, onClick: listen, "aria-label": "Frage sprechen", children: _jsx(Icon, { name: "mic" }) })] }), !res && !busy && !err && !rec && _jsx("div", { className: "ask-ideas", children: IDEAS.map(i => _jsx("button", { type: "button", onClick: () => { setQ(i); void ask(i); }, children: i }, i)) }), rec && !busy && _jsx("p", { className: "note ask-busy", children: "\uD83C\uDF99\uFE0F Ich h\u00F6re zu \u2026 sprich einfach los." }), busy && _jsx("p", { className: "note ask-busy", children: "Claude sieht im Kalender nach \u2026" }), err && _jsx("p", { className: "note", children: err }), res && _jsxs("div", { className: "ask-res", children: [_jsx("p", { children: res.answer }), res.events.length > 0 && _jsx("div", { className: "ask-list", children: res.events.map(e => (_jsxs("button", { type: "button", className: "ask-ev", style: cvar(colorOf(snap.members, e.persons[0])), onClick: () => open(e.id), children: [_jsxs("span", { className: "d", children: [shortDate(e.date), _jsx("small", { children: e.all_day ? 'ganztägig' : hm(e.start_min) })] }), _jsxs("span", { className: "t", children: [_jsx("b", { children: e.title }), _jsx("small", { children: [e.persons.map(nm).join(', '), e.place].filter(Boolean).join(' · ') })] }), res.action === 'edit' && _jsx("span", { className: "ask-edit", role: "button", tabIndex: 0, onClick: x => { x.stopPropagation(); edit(eventDraft(e)); }, children: "Bearbeiten" })] }, e.id))) }), res.birthdays.length > 0 && _jsx("div", { className: "ask-list", children: res.birthdays.map(b => (_jsxs("button", { type: "button", className: "ask-ev", onClick: bdays, children: [_jsx("span", { className: "d", children: "\uD83C\uDF82" }), _jsxs("span", { className: "t", children: [_jsx("b", { children: b.name }), _jsxs("small", { children: [bdLabel(b), b.year ? `, Jahrgang ${b.year}` : ''] })] })] }, b.id))) })] }), _jsxs("div", { className: "btn-row", children: [_jsx("button", { type: "button", className: "btn ghost", onClick: close, children: "Schlie\u00DFen" }), _jsx("button", { type: "button", className: "btn", disabled: busy || !q.trim(), onClick: () => void ask(), children: "Fragen" })] })] }));
}
