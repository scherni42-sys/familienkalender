import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { store, useSnapshot } from '../lib/store';
import { hm, today } from '../lib/dates';
import { shrinkPhoto } from '../lib/ai';
import { Badge, Icon, useLong } from './ui';
import { fail, toast } from './toast';
// Chat von Person zu Person, wie bei WhatsApp: links die Liste, ein Tipp öffnet den Verlauf.
// Nur Absender und Empfänger sehen die Nachrichten, nie das Display.
const dayOf = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const timeOf = (iso) => { const d = new Date(iso); return hm(d.getHours() * 60 + d.getMinutes()); };
const whenC = (iso) => {
    const d = dayOf(iso), t = today();
    if (d === t)
        return timeOf(iso);
    const y = new Date();
    y.setDate(y.getDate() - 1);
    if (d === dayOf(y.toISOString()))
        return 'gestern';
    return new Date(iso).toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric' });
};
export const chatPreview = (c) => c.kind === 'image' ? `📷 ${c.text || 'Foto'}` : c.kind === 'voice' ? `🎤 Sprachnachricht${c.dur ? ` (${c.dur} s)` : ''}` : c.kind === 'place' ? '📍 Standort' : c.text;
// Gesprächsliste: je Person die letzte Nachricht und wie viele ungelesen sind
export function chatThreads(chats, me) {
    const by = new Map();
    for (const c of chats) {
        const w = c.from_member === me ? c.to_member : c.from_member;
        const t = by.get(w) ?? { with: w, last: c, unread: 0 };
        if (c.created_at >= t.last.created_at)
            t.last = c;
        if (c.to_member === me && !c.read_at)
            t.unread++;
        by.set(w, t);
    }
    return [...by.values()].sort((a, b) => b.last.created_at.localeCompare(a.last.created_at));
}
function Media({ c }) {
    const [url, setUrl] = useState(null);
    useEffect(() => { if (c.media)
        store.chatUrl(c.media).then(setUrl, () => setUrl(null)); }, [c.media]);
    if (!c.media)
        return null;
    if (!url)
        return _jsx("div", { className: "ch-load", children: "L\u00E4dt \u2026" });
    return c.kind === 'voice' ? _jsx("audio", { controls: true, preload: "none", src: url }) : _jsx("a", { href: url, target: "_blank", rel: "noreferrer", className: "ch-img", children: _jsx("img", { src: url, alt: c.text || 'Foto', loading: "lazy" }) });
}
function Bubble({ c, mine, del }) {
    const l = useLong(() => { if (mine)
        del(); });
    const maps = c.lat != null && c.lon != null ? `https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lon}` : '';
    return (_jsxs("div", { className: `ch-b${mine ? ' me' : ''}`, ...l.on, children: [c.kind === 'place' ? _jsxs("a", { className: "ch-place", href: maps, target: "_blank", rel: "noreferrer", children: [_jsx(Icon, { name: "place" }), _jsxs("span", { children: [_jsx("b", { children: "Standort" }), _jsx("small", { children: "In Karte \u00F6ffnen" })] })] }) : null, c.kind === 'image' || c.kind === 'voice' ? _jsx(Media, { c: c }) : null, c.text && _jsx("div", { className: "ch-t", children: c.text }), _jsxs("small", { className: "ch-time", children: [timeOf(c.created_at), mine ? (c.read_at ? ' ✓✓' : ' ✓') : ''] })] }));
}
// Sprachnachricht: einmal tippen startet, Stopp sendet, ✕ verwirft
function useRecorder(send) {
    const [sec, setSec] = useState(null);
    const rec = useRef(null);
    const start = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg'].find(t => MediaRecorder.isTypeSupported?.(t));
            const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
            const cur = { r, parts: [], start: Date.now(), keep: true, tick: setInterval(() => setSec(Math.round((Date.now() - cur.start) / 1000)), 500) };
            r.ondataavailable = e => { if (e.data.size)
                cur.parts.push(e.data); };
            r.onstop = () => {
                clearInterval(cur.tick);
                stream.getTracks().forEach(t => t.stop());
                setSec(null);
                rec.current = null;
                const s = Math.max(1, Math.round((Date.now() - cur.start) / 1000));
                if (cur.keep && cur.parts.length)
                    send(new Blob(cur.parts, { type: (r.mimeType || 'audio/webm').split(';')[0] }), s);
            };
            rec.current = cur;
            r.start();
            setSec(0);
            // Nach 3 Minuten automatisch senden
            setTimeout(() => { if (rec.current === cur && r.state === 'recording')
                r.stop(); }, 180_000);
        }
        catch {
            toast('Kein Zugriff aufs Mikrofon. Bitte in den Handy-Einstellungen erlauben.');
        }
    };
    const stop = (keep) => { const c = rec.current; if (!c)
        return; c.keep = keep; c.r.stop(); };
    return { sec, start, stop };
}
function Thread({ w, back }) {
    const snap = useSnapshot();
    const me = snap.me;
    const list = (snap.chats ?? []).filter(c => (c.from_member === me && c.to_member === w.id) || (c.from_member === w.id && c.to_member === me));
    const [text, setText] = useState(''), [busy, setBusy] = useState(false);
    const end = useRef(null);
    const unread = list.some(c => c.to_member === me && !c.read_at);
    useEffect(() => { if (unread)
        void store.chatSeen(w.id).catch(() => { }); }, [unread, w.id]);
    useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [list.length]);
    const go = (p) => { setBusy(true); return p.catch(fail).finally(() => setBusy(false)); };
    const voice = useRecorder((b, sec) => void go(store.sendChat(w.id, { kind: 'voice', blob: b, dur: sec })));
    const photo = async (f) => {
        if (!f)
            return;
        try {
            const p = await shrinkPhoto(f);
            const blob = await (await fetch(`data:${p.type};base64,${p.data}`)).blob();
            await go(store.sendChat(w.id, { kind: 'image', blob, text: text.trim() }));
            setText('');
        }
        catch {
            toast('Das Foto ließ sich nicht öffnen.');
        }
    };
    const place = () => {
        if (!navigator.geolocation) {
            toast('Standort geht auf diesem Gerät nicht.');
            return;
        }
        setBusy(true);
        navigator.geolocation.getCurrentPosition(p => void go(store.sendChat(w.id, { kind: 'place', lat: +p.coords.latitude.toFixed(5), lon: +p.coords.longitude.toFixed(5) })).then(() => toast('Standort gesendet.')), () => { setBusy(false); toast('Standort nicht verfügbar. Bitte Standort am Handy einschalten.'); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
    };
    const days = snap.family.settings.chatDays ?? 7;
    let lastDay = '';
    return (_jsxs("div", { className: "ch-thread", children: [_jsxs("div", { className: "ch-head", children: [_jsx("button", { type: "button", className: "ch-back", "aria-label": "Zur\u00FCck zur Chatliste", onClick: back, children: _jsx(Icon, { name: "back" }) }), _jsx(Badge, { m: w, size: 34 }), _jsx("b", { children: w.name })] }), _jsxs("div", { className: "ch-list", children: [!list.length && _jsxs("div", { className: "ch-empty", children: ["Noch keine Nachrichten. Nur du und ", w.name, " sehen diesen Chat."] }), list.map(c => {
                        const d = dayOf(c.created_at), sep = d !== lastDay;
                        lastDay = d;
                        return _jsxs("div", { className: "ch-row", children: [sep && _jsx("div", { className: "ch-day", children: d === today() ? 'Heute' : whenC(c.created_at) }), _jsx(Bubble, { c: c, mine: c.from_member === me, del: () => { if (confirm('Diese Nachricht löschen?'))
                                        void store.deleteChat(c.id).catch(fail); } })] }, c.id);
                    }), _jsx("div", { ref: end })] }), _jsxs("div", { className: "ch-note", children: ["Verschwindet nach ", days === 1 ? '1 Tag' : `${days} Tagen`, "."] }), voice.sec !== null ? (_jsxs("div", { className: "ch-compose rec", children: [_jsx("button", { type: "button", className: "ch-i", "aria-label": "Aufnahme verwerfen", onClick: () => voice.stop(false), children: "\u2715" }), _jsxs("span", { className: "ch-rec", children: [_jsx("i", {}), "Aufnahme ", Math.floor(voice.sec / 60), ":", String(voice.sec % 60).padStart(2, '0')] }), _jsx("button", { type: "button", className: "ch-send", "aria-label": "Sprachnachricht senden", onClick: () => voice.stop(true), children: _jsx(Icon, { name: "send" }) })] })) : (_jsxs("form", { className: "ch-compose", onSubmit: e => { e.preventDefault(); const v = text.trim(); if (!v || busy)
                    return; void go(store.sendChat(w.id, { kind: 'text', text: v })).then(() => setText('')); }, children: [_jsxs("label", { className: "ch-i", "aria-label": "Foto senden", children: [_jsx(Icon, { name: "camera" }), _jsx("input", { type: "file", accept: "image/*", hidden: true, onChange: e => { void photo(e.target.files?.[0]); e.target.value = ''; } })] }), _jsx("button", { type: "button", className: "ch-i", "aria-label": "Standort senden", disabled: busy, onClick: place, children: _jsx(Icon, { name: "place" }) }), _jsx("input", { value: text, onChange: e => setText(e.target.value), placeholder: `Nachricht an ${w.name}`, maxLength: 2000, "aria-label": "Nachricht" }), text.trim() ? _jsx("button", { className: "ch-send", "aria-label": "Senden", disabled: busy, children: busy ? _jsx("span", { className: "spin" }) : _jsx(Icon, { name: "send" }) })
                        : _jsx("button", { type: "button", className: "ch-send", "aria-label": "Sprachnachricht aufnehmen", disabled: busy, onClick: () => void voice.start(), children: busy ? _jsx("span", { className: "spin" }) : _jsx(Icon, { name: "mic" }) })] }))] }));
}
// plus: zählt hoch, wenn unten das ＋ gedrückt wird; dann die Auswahl „Neuer Chat mit …“
export function Chat({ open, opened, plus = 0 }) {
    const snap = useSnapshot();
    const me = snap.members.find(m => m.id === snap.me);
    const [w, setW] = useState(open ?? null), [pick, setPick] = useState(false);
    useEffect(() => { if (open) {
        setW(open);
        opened?.();
    } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { if (plus) {
        setW(null);
        setPick(true);
    } }, [plus]);
    if (!me || me.role === 'guest')
        return _jsx("div", { className: "ch-empty", children: "G\u00E4ste k\u00F6nnen nicht chatten." });
    const people = snap.members.filter(m => m.id !== me.id && m.role !== 'guest');
    const who = people.find(m => m.id === w);
    if (who)
        return _jsx(Thread, { w: who, back: () => setW(null) });
    const threads = chatThreads(snap.chats ?? [], snap.me);
    const fresh = people.filter(p => !threads.some(t => t.with === p.id));
    return (_jsxs("div", { className: "ch-start", children: [threads.map(t => {
                const m = snap.members.find(x => x.id === t.with);
                return _jsxs("button", { type: "button", className: `ch-item${t.unread ? ' unread' : ''}`, onClick: () => setW(t.with), children: [_jsx(Badge, { m: m, size: 40 }), _jsxs("span", { className: "ch-mid", children: [_jsx("b", { children: m?.name ?? 'Unbekannt' }), _jsxs("small", { children: [t.last.from_member === snap.me ? 'Du: ' : '', chatPreview(t.last)] })] }), _jsxs("span", { className: "ch-side", children: [_jsx("small", { children: whenC(t.last.created_at) }), t.unread > 0 && _jsx("i", { children: t.unread })] })] }, t.with);
            }), !threads.length && !pick && _jsx("div", { className: "ch-empty", children: "Noch keine Chats. Mit \uFF0B unten rechts schreibst du jemandem aus der Familie." }), pick ? _jsxs("div", { className: "ch-pick", children: [_jsx("div", { className: "ch-pick-h", children: "Neuer Chat mit \u2026" }), [...fresh, ...people.filter(p => !fresh.includes(p))].map(p => _jsxs("button", { type: "button", className: "ch-item", onClick: () => { setPick(false); setW(p.id); }, children: [_jsx(Badge, { m: p, size: 40 }), _jsx("span", { className: "ch-mid", children: _jsx("b", { children: p.name }) })] }, p.id)), !people.length && _jsx("div", { className: "ch-empty", children: "In der Familie ist sonst noch niemand." }), _jsx("button", { type: "button", className: "ch-new", onClick: () => setPick(false), children: "Abbrechen" })] }) : null] }));
}
