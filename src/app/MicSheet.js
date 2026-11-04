import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { store, useSnapshot } from '../lib/store';
import { parseSpoken, shrinkPhoto } from '../lib/ai';
import { ClipMenu } from './ClipMenu';
import { Icon, Sheet } from './ui';
import { fail, toast } from './toast';
import { native } from '../lib/native';
const SR = window.SpeechRecognition
    ?? window.webkitSpeechRecognition;
// Stichwort am Satzanfang: „Privat …“, „Familie …“ oder „Board …“ speichert ohne Rückfrage
const PREFIX = /^\s*(privat|familie|pinnwand|board|bord)\b[\s,.:;!-]*/i;
const PAUSE = 3000; // so lange darf man schweigen, bevor die Aufnahme endet
const FIRST = 7000; // Zeit bis zum ersten Wort
export function MicSheet({ auto, quick, preset, photoFirst, close, toDraft, posted }) {
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
    // In der Android-App: Spracherkennung des Handys, der Text landet im Feld (gespeichert wird erst mit Weiter)
    useEffect(() => {
        const on = (e) => { const t = String(e.detail ?? '').trim(); setRec(false); if (t)
            setText(x => join(x, t)); };
        window.addEventListener('famto-speech', on);
        return () => window.removeEventListener('famto-speech', on);
    }, []);
    const listen = (quiet = false) => {
        const n = native();
        if (n?.listen) {
            setRec(true);
            n.listen();
            return;
        }
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
            // Nie automatisch speichern: immer erst zur Bestätigung
            toDraft({ ...parsed, vis: m, busy: m === 'private' && parsed.busy });
        }
        catch (e) {
            fail(e);
        }
        finally {
            setBusy(false);
        }
    };
    // Büroklammer beim Board: Dokument (PDF, Word, …) als Board-Nachricht, der Text dazu ist freiwillig
    const attach = async (file) => {
        if (file.size > 15 * 1024 * 1024) {
            toast('Die Datei ist zu groß (höchstens 15 MB).');
            return;
        }
        setBusy(true);
        try {
            const data = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] ?? ''); r.onerror = () => no(r.error); r.readAsDataURL(file); });
            await store.attachFile({ name: file.name, type: file.type || 'application/octet-stream', data }, { text: latest.current.text.trim() || undefined });
            toast('Dokument hängt jetzt am Board.');
            posted();
        }
        catch (x) {
            fail(x);
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
    return (_jsxs(Sheet, { onClose: close, label: "Sprechen", children: [_jsx("h2", { children: "Neuer Eintrag" }), photoFirst && !store.demo && _jsxs("label", { className: `photobig${busy ? ' busy' : ''}`, children: [_jsx(Icon, { name: "camera" }), busy ? 'Claude liest das Foto …' : 'Foto aufnehmen', _jsx("input", { type: "file", accept: "image/*", capture: "environment", hidden: true, disabled: busy, onChange: e => { void photo(e.target.files?.[0]); e.target.value = ''; } })] }), _jsxs("div", { className: "visbig three", role: "group", "aria-label": "Art", children: [_jsxs("button", { type: "button", className: "private", "aria-pressed": mode === 'private', onClick: () => setMode('private'), children: [_jsx(Icon, { name: "lock" }), "Privat", _jsx("small", { children: "nur ich" })] }), _jsxs("button", { type: "button", className: "family", "aria-pressed": mode === 'family', onClick: () => setMode('family'), children: [_jsx(Icon, { name: "home" }), "Familie", _jsx("small", { children: "alle + Display" })] }), _jsxs("button", { type: "button", className: "board", "aria-pressed": mode === 'board', onClick: () => setMode('board'), children: [_jsx(Icon, { name: "board" }), "Board", _jsx("small", { children: "Nachricht" })] })] }), _jsxs("div", { className: "listen", children: [_jsx("button", { type: "button", className: `mic${rec ? ' rec' : ''}`, onClick: () => listen(), "aria-label": rec ? 'Aufnahme beenden' : 'Sprechen', children: _jsx(Icon, { name: "mic" }) }), !store.demo && !photoFirst && _jsxs("label", { className: `photo left${busy ? ' busy' : ''}`, "aria-label": "Termin aus einem Bild der Galerie", children: [_jsx("span", { className: "rnd", children: _jsx(Icon, { name: "gallery" }) }), _jsx("span", { children: "Galerie" }), _jsx("input", { type: "file", accept: "image/*", hidden: true, disabled: busy, onChange: e => { void photo(e.target.files?.[0]); e.target.value = ''; } })] }), !store.demo && !photoFirst && _jsxs("label", { className: `photo${busy ? ' busy' : ''}`, "aria-label": "Termin vom Foto", children: [_jsx("span", { className: "rnd", children: _jsx(Icon, { name: "camera" }) }), _jsx("span", { children: "Foto" }), _jsx("input", { type: "file", accept: "image/*", capture: "environment", hidden: true, disabled: busy, onChange: e => { void photo(e.target.files?.[0]); e.target.value = ''; } })] })] }), _jsx("p", { style: { textAlign: 'center' }, children: rec ? 'Ich höre zu … Kurze Pausen sind kein Problem.' : busy ? 'Einen Moment, Claude liest …' : 'Tippe aufs Mikrofon und sprich, schreib den Satz, fotografiere einen Zettel oder nimm ein Bild aus der Galerie.' }), _jsx("textarea", { value: text, onChange: e => setText(e.target.value), placeholder: mode === 'board' ? 'Nachricht sprechen oder tippen' : 'Termin sprechen oder tippen', maxLength: 500 }), mode === 'board' && _jsxs("div", { className: "mic-clip", children: [_jsx(ClipMenu, { image: f => void photo(f), doc: f => void attach(f), disabled: busy }), _jsx("span", { children: "Foto oder Dokument anh\u00E4ngen" })] }), _jsx("p", { className: "note", children: "Tipp: Beginnst du mit \u201EPrivat\u201C, \u201EFamilie\u201C oder \u201EBoard\u201C, wird die Art gleich umgestellt." }), _jsxs("div", { className: "btn-row", children: [_jsx("button", { type: "button", className: "btn ghost", onClick: close, children: "Abbrechen" }), _jsx("button", { type: "button", className: "btn", disabled: busy || !text.trim(), onClick: () => void go(), children: busy ? _jsx("span", { className: "spin" }) : mode === 'board' ? 'Boarding' : 'Weiter' })] })] }));
}
