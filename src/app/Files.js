import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useRef, useState } from 'react';
import { store } from '../lib/store';
import { native } from '../lib/native';
import { Icon } from './ui';
import { fail, toast } from './toast';
const kb = (n) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);
// Dokument öffnen: kurzlebiger Link vom Server; in der Android-App öffnet ihn das passende Programm (PDF-Ansicht, Browser)
export async function openFile(f) {
    const app = !!native();
    // Im Browser das Fenster sofort öffnen, sonst blockiert der Popup-Schutz nach dem Warten
    const w = app ? null : window.open('', '_blank');
    try {
        let url = await store.fileUrl(f);
        if (url.startsWith('data:')) {
            const b = await (await fetch(url)).blob();
            url = URL.createObjectURL(b);
        }
        if (w)
            w.location.href = url;
        else
            location.href = url;
    }
    catch (x) {
        w?.close();
        fail(x);
    }
}
// Büroklammer in der Terminliste: großer Tippbereich, öffnet das Dokument (bei mehreren den Termin)
export function Clip({ files, more }) {
    if (!files?.length)
        return null;
    return _jsxs("button", { type: "button", className: "clip", "aria-label": files.length === 1 ? `Dokument ${files[0].name} öffnen` : `${files.length} Dokumente`, onPointerDown: e => e.stopPropagation(), onClick: e => { e.stopPropagation(); if (files.length === 1)
            void openFile(files[0]);
        else
            more(); }, children: [_jsx(Icon, { name: "clip" }), files.length > 1 && _jsx("small", { children: files.length })] });
}
// Liste der angehängten Dokumente mit Öffnen und (wer darf) Entfernen
export function FileList({ files, from, canEdit }) {
    const [armed, setArmed] = useState(null);
    if (!files?.length)
        return null;
    return _jsx("div", { className: "files", children: files.map(f => (_jsxs("div", { className: "file", children: [_jsxs("button", { type: "button", className: "file-open", onClick: () => void openFile(f), children: [_jsx(Icon, { name: "clip" }), _jsxs("span", { children: [_jsx("b", { children: f.name }), _jsx("small", { children: kb(f.size) })] })] }), canEdit && (armed === f.path
                    ? _jsx("button", { type: "button", className: "file-x on", onClick: () => store.removeFile(f, from).then(() => toast('Dokument entfernt.'), fail), children: "Entfernen" })
                    : _jsx("button", { type: "button", className: "file-x", "aria-label": `${f.name} entfernen`, onClick: () => setArmed(f.path), children: "\u00D7" }))] }, f.path))) });
}
// „Dokument anhängen“: Datei auswählen und hochladen (an einen Termin oder als Board-Nachricht)
export function AttachButton({ to, label = 'Dokument anhängen', className = 'btn ghost sm', done, pick: keep }) {
    const input = useRef(null);
    const [busy, setBusy] = useState(false);
    const pick = async (file) => {
        if (!file)
            return;
        if (file.size > 15 * 1024 * 1024) {
            toast('Die Datei ist zu groß (höchstens 15 MB).');
            return;
        }
        setBusy(true);
        try {
            const data = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] ?? ''); r.onerror = () => no(r.error); r.readAsDataURL(file); });
            const f = { name: file.name, type: file.type || 'application/octet-stream', data };
            // Neuer Termin: Datei merken, hochgeladen wird nach dem Speichern
            if (keep) {
                keep(f);
                return;
            }
            await store.attachFile(f, to);
            toast(to.event || to.birthday ? 'Dokument angehängt.' : 'Dokument hängt jetzt am Board.');
            done?.();
        }
        catch (x) {
            fail(x);
        }
        finally {
            setBusy(false);
            if (input.current)
                input.current.value = '';
        }
    };
    return _jsxs(_Fragment, { children: [_jsx("input", { ref: input, type: "file", hidden: true, onChange: e => void pick(e.target.files?.[0]) }), _jsxs("button", { type: "button", className: className, disabled: busy, onClick: () => input.current?.click(), children: [_jsx(Icon, { name: "clip" }), _jsx("span", { children: busy ? 'Lädt hoch …' : label })] })] });
}
