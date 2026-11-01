import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { store, useSnapshot } from '../lib/store';
import { parseSpoken, shrinkPhoto } from '../lib/ai';
import { Icon, Sheet } from './ui';
import { toNewEvent } from './EventSheet';
import { whenText } from '../lib/model';
import { fail, toast } from './toast';
const SR = window.SpeechRecognition
    ?? window.webkitSpeechRecognition;
// Stichwort am Satzanfang: „Privat …“, „Familie …“ oder „Board …“ speichert ohne Rückfrage
const PREFIX = /^\s*(privat|familie|pinnwand|board|bord)\b[\s,.:;!-]*/i;
const PAUSE = 3000; // so lange darf man schweigen, bevor die Aufnahme endet
const FIRST = 7000; // Zeit bis zum ersten Wort
export function MicSheet({ auto, quick, preset, photoFirst, close, toDraft, posted, saved }) {
    const snap = useSnapshot();
    // Seitentaste: ohne Stichwort „Privat“/„Familie“ landet das Gesprochene auf der Pinnwand
    const [mode, setMode] = useState(preset ?? (quick ? 'board' : 'family'));
    const [text, setText] = useState('');
    const [rec, setRec] = useState(false), [busy, setBusy] = useState(false);
    const r = useRef(null);
    // Aufnahme-Zustand: Android beendet die Erkennung nach kurzer Stille, wir starten sie bis zur echten Pause neu
    const sess = useRef({ base: '', cur: '', last: 0, first: true, stop: false });
    const latest = useRef({ text, mode });
    latest.current = { text, mode };
    useEffect(() => () => { sess.current.stop = true; r.current?.stop(); }, []);
    // Schnellstart: Aufnahme gleich beginnen; lehnt der Browser ohne Antippen ab, bleibt der Knopf
    useEffect(() => { if (auto && SR) {
        const t = setTimeout(() => listen(true), 300);
        return () => clearTimeout(t);
    } }, []);
    const join = (a, b) => [a.trim(), b.trim()].filter(Boolean).join(' ');
    const startRec = (quiet) => {
        const x = new SR();
        x.lang = 'de-DE';
        x.interimResults = true;
        x.continuous = false;
        x.onresult = e => {
            const st = sess.current;
            st.cur = Array.from(e.results).map(res => res[0].transcript).join(' ');
            st.last = Date.now();
            st.first = false;
            setText(join(st.base, st.cur));
        };
        x.onend = () => {
            const st = sess.current;
            st.base = join(st.base, st.cur);
            st.cur = '';
            const quietFor = Date.now() - st.last;
            if (!st.stop && quietFor < (st.first ? FIRST : PAUSE)) {
                startRec(true);
                return;
            }
            setRec(false);
            // Nach der Pause geht es ohne weiteres Antippen weiter: mit Stichwort direkt speichern, sonst zur Bestätigung
            if (!st.stop && st.base)
                void go(st.base);
        };
        x.onerror = e => {
            if (e.error === 'no-speech' || e.error === 'aborted')
                return; // onend entscheidet
            sess.current.stop = true;
            setRec(false);
            if (e.error === 'not-allowed' && !quiet)
                toast('Bitte erlaube den Zugriff auf das Mikrofon.');
        };
        r.current = x;
        try {
            x.start();
            setRec(true);
        }
        catch {
            sess.current.stop = true;
            setRec(false);
        }
    };
    const listen = (quiet = false) => {
        if (!SR) {
            toast('Dieser Browser kann keine Sprache erkennen. Tippe den Satz einfach ein.');
            return;
        }
        if (rec) {
            sess.current.stop = true;
            r.current?.stop();
            return;
        }
        sess.current = { base: latest.current.text.trim(), cur: '', last: Date.now(), first: true, stop: false };
        startRec(quiet);
    };
    const go = async (spoken) => {
        let v = (spoken ?? latest.current.text).trim();
        if (!v)
            return;
        let m = latest.current.mode;
        const pre = v.match(PREFIX);
        // Stichwort oder Schnellknopf im Widget: ohne Rückfrage speichern, solange die Art nicht umgestellt wurde
        const direct = !!pre || (!!preset && m === preset);
        if (pre) {
            const k = pre[1].toLowerCase();
            m = k === 'privat' ? 'private' : k === 'familie' ? 'family' : 'board';
            v = v.slice(pre[0].length).trim();
            setMode(m);
            if (!v)
                return;
            v = v.charAt(0).toUpperCase() + v.slice(1);
        }
        setBusy(true);
        try {
            if (m === 'board') {
                await store.postMessage(v);
                toast('Hängt jetzt am Board.');
                posted();
                return;
            }
            const parsed = await parseSpoken(v, snap.me, snap.members.filter(x => x.role !== 'guest'));
            const d = { ...parsed, vis: m, busy: m === 'private' && parsed.busy };
            if (direct && d.title.trim()) {
                const id = await store.saveEvent(toNewEvent(d));
                toast(`${m === 'family' ? 'Familientermin' : 'Privater Termin'} gespeichert: ${d.title}, ${whenText(d)}`);
                saved(id);
                return;
            }
            toDraft(d);
        }
        catch (e) {
            fail(e);
        }
        finally {
            setBusy(false);
        }
    };
    // Foto von Zettel, Brief oder Einladung: Claude liest den Termin, danach wie gewohnt bestätigen
    const photo = async (file) => {
        if (!file)
            return;
        setBusy(true);
        try {
            const img = await shrinkPhoto(file);
            const m = latest.current.mode;
            const typed = latest.current.text.trim();
            // Board gewählt: Foto direkt ans Board hängen
            if (m === 'board') {
                await store.postMessage(typed || '📷 Foto', img);
                toast('Foto hängt jetzt am Board.');
                posted();
                return;
            }
            const parsed = await parseSpoken(typed, snap.me, snap.members.filter(x => x.role !== 'guest'), img);
            // Kein Termin auf dem Foto: anbieten, es ans Board zu hängen
            if (parsed.source !== 'ai' || parsed.found === false) {
                const why = parsed.source !== 'ai' ? `Das Foto konnte nicht gelesen werden${parsed.why ? ` (${parsed.why})` : ''}.` : 'Auf dem Foto steht kein Termin.';
                if (window.confirm(`${why}\n\nSoll das Foto stattdessen ans Board?`)) {
                    await store.postMessage(typed || '📷 Foto', img);
                    toast('Foto hängt jetzt am Board.');
                    posted();
                }
                return;
            }
            toDraft({ ...parsed, vis: m, busy: m === 'private' && parsed.busy });
        }
        catch (e) {
            fail(e);
        }
        finally {
            setBusy(false);
        }
    };
    return (_jsxs(Sheet, { onClose: close, label: "Sprechen", children: [_jsx("h2", { children: mode === 'board' ? 'Nachricht ans Board' : 'Neuer Termin' }), photoFirst && !store.demo && _jsxs("label", { className: `photobig${busy ? ' busy' : ''}`, children: [_jsx(Icon, { name: "camera" }), busy ? 'Claude liest das Foto …' : 'Foto aufnehmen', _jsx("input", { type: "file", accept: "image/*", capture: "environment", hidden: true, disabled: busy, onChange: e => { void photo(e.target.files?.[0]); e.target.value = ''; } })] }), _jsxs("div", { className: "visbig three", role: "group", "aria-label": "Art", children: [_jsxs("button", { type: "button", className: "private", "aria-pressed": mode === 'private', onClick: () => setMode('private'), children: [_jsx(Icon, { name: "lock" }), "Privat", _jsx("small", { children: "nur ich" })] }), _jsxs("button", { type: "button", className: "family", "aria-pressed": mode === 'family', onClick: () => setMode('family'), children: [_jsx(Icon, { name: "home" }), "Familie", _jsx("small", { children: "alle + Display" })] }), _jsxs("button", { type: "button", className: "board", "aria-pressed": mode === 'board', onClick: () => setMode('board'), children: [_jsx(Icon, { name: "board" }), "Board", _jsx("small", { children: "Nachricht" })] })] }), _jsxs("div", { className: "listen", children: [_jsx("button", { type: "button", className: `mic${rec ? ' rec' : ''}`, onClick: () => listen(), "aria-label": rec ? 'Aufnahme beenden' : 'Sprechen', children: _jsx(Icon, { name: "mic" }) }), !store.demo && _jsxs("label", { className: `photo${busy ? ' busy' : ''}`, "aria-label": "Termin vom Foto", children: [_jsx(Icon, { name: "camera" }), _jsx("span", { children: "Foto" }), _jsx("input", { type: "file", accept: "image/*", capture: "environment", hidden: true, disabled: busy, onChange: e => { void photo(e.target.files?.[0]); e.target.value = ''; } })] })] }), _jsx("p", { style: { textAlign: 'center' }, children: rec ? 'Ich höre zu … Kurze Pausen sind kein Problem.' : busy ? 'Einen Moment, Claude liest …' : 'Tippe aufs Mikrofon und sprich, schreib den Satz oder fotografiere einen Zettel.' }), _jsx("textarea", { value: text, onChange: e => setText(e.target.value), placeholder: mode === 'board' ? 'Nachricht sprechen oder tippen' : 'Termin sprechen oder tippen', maxLength: 500 }), _jsx("p", { className: "note", children: "Tipp: Beginnst du mit \u201EPrivat\u201C, \u201EFamilie\u201C oder \u201EBoard\u201C, wird ohne R\u00FCckfrage gespeichert." }), _jsxs("div", { className: "btn-row", children: [_jsx("button", { type: "button", className: "btn ghost", onClick: close, children: "Abbrechen" }), _jsx("button", { type: "button", className: "btn", disabled: busy || !text.trim(), onClick: () => void go(), children: busy ? _jsx("span", { className: "spin" }) : mode === 'board' ? 'Boarding' : 'Weiter' })] })] }));
}
