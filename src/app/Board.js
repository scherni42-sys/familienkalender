import { jsxs as _jsxs, jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { store, useSnapshot } from '../lib/store';
import { leftTxt, liveMsgs, nameOf, whenM } from '../lib/model';
import { Badge, Icon } from './ui';
import { fail, toast } from './toast';
import { shrinkPhoto } from '../lib/ai';
import { boardImg } from '../lib/supabase';
export function Board({ focus }) {
    const snap = useSnapshot();
    const s = snap.family.settings;
    const me = snap.members.find(m => m.id === snap.me);
    const canAct = me.role !== 'guest';
    const [replyTo, setReplyTo] = useState(null);
    const [editId, setEditId] = useState(null), [editTxt, setEditTxt] = useState('');
    const [text, setText] = useState(''), [reply, setReply] = useState('');
    const [photo, setPhoto] = useState(null), [sending, setSending] = useState(false);
    const pick = async (f) => { if (!f)
        return; try {
        setPhoto(await shrinkPhoto(f));
    }
    catch {
        toast('Das Foto ließ sich nicht öffnen.');
    } };
    const msgs = liveMsgs(snap.messages, s);
    const member = (id) => snap.members.find(m => m.id === id);
    // Aus dem Widget angetippte Nachricht ins Bild holen
    useEffect(() => { if (focus)
        document.getElementById(`msg-${focus}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, [focus]);
    const ttl = s.ttlHours < 48 ? `${s.ttlHours} Std.` : `${s.ttlHours / 24} Tagen`;
    const quick = async (id, t) => {
        try {
            if (t === 'Mach ich') {
                await store.setMessage(id, { taker: snap.me });
                toast('Alle sehen: du übernimmst das.');
            }
            await store.reply(id, t);
        }
        catch (e) {
            fail(e);
        }
    };
    return _jsxs(_Fragment, { children: [_jsxs("p", { className: "note", children: ["Kurze Nachrichten f\u00FCr alle, auch auf dem Display. Sie verschwinden nach ", ttl, ", sobald jemand sie abhakt, oder bleiben angeheftet stehen."] }), msgs.length === 0 && _jsxs("div", { className: "empty smile", children: [_jsx(Icon, { name: "smile" }), "Keine Nachrichten"] }), msgs.map(m => (_jsxs("div", { id: `msg-${m.id}`, className: `msg${m.pinned ? ' pinned' : ''}${focus === m.id ? ' isnew' : ''}`, children: [_jsxs("div", { className: "from", children: [_jsx(Badge, { m: member(m.from_member) }), " ", nameOf(snap.members, m.from_member), " \u00B7 ", whenM(m), m.via ? ` · ${m.via}` : ''] }), editId === m.id ? (_jsxs("form", { className: "compose", onSubmit: e => { e.preventDefault(); const v = editTxt.trim(); if (!v)
                            return; store.setMessage(m.id, { text: v }).then(() => { setEditId(null); toast('Nachricht geändert.'); }, fail); }, children: [_jsx("input", { autoFocus: true, value: editTxt, onChange: e => setEditTxt(e.target.value), maxLength: 500, "aria-label": "Nachricht bearbeiten" }), _jsx("button", { children: "Speichern" })] })) : _jsx("div", { children: m.image && m.text === '📷 Foto' ? null : m.text }), m.image && _jsx("a", { href: boardImg(m.image), target: "_blank", rel: "noreferrer", className: "msg-img", children: _jsx("img", { src: boardImg(m.image), alt: m.text, loading: "lazy" }) }), m.taker && _jsx("div", { className: "note", children: _jsxs("b", { children: ["\u00DCbernimmt: ", nameOf(snap.members, m.taker)] }) }), m.replies.length > 0 && _jsx("div", { className: "replies", children: m.replies.map(r => _jsxs("div", { className: "rp", children: [_jsx(Badge, { m: member(r.from_member) }), _jsx("span", { children: r.text })] }, r.id)) }), canAct && _jsxs("div", { className: "quick", children: [(m.image ? ['👍'] : ['👍', 'Mach ich', 'Nein']).map(q => _jsx("button", { type: "button", className: "chip", onClick: () => void quick(m.id, q), children: q }, q)), _jsx("button", { type: "button", className: "chip", onClick: () => { setReplyTo(replyTo === m.id ? null : m.id); setReply(''); }, children: "Antworten" })] }), _jsxs("div", { className: "macts", children: [canAct && _jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: "small-btn", onClick: () => store.setMessage(m.id, { done: true }).then(() => toast('Erledigt und von der Wand genommen.'), fail), children: "\u2713 Erledigt" }), (m.from_member === snap.me || me.role === 'admin') && _jsx("button", { type: "button", className: "small-btn", onClick: () => { if (editId === m.id) {
                                            setEditId(null);
                                            return;
                                        } setEditId(m.id); setEditTxt(m.text); }, children: editId === m.id ? 'Abbrechen' : 'Bearbeiten' }), _jsx("button", { type: "button", className: "small-btn", onClick: () => store.setMessage(m.id, { pinned: !m.pinned }).then(() => toast(m.pinned ? `Gelöst: verschwindet in ${ttl}.` : 'Angeheftet: bleibt stehen, bis jemand es löst.'), fail), children: m.pinned ? 'Lösen' : 'Anheften' }), (m.from_member === snap.me || me.role === 'admin') && _jsx("button", { type: "button", className: "small-btn", "aria-label": "Nachricht l\u00F6schen", title: "L\u00F6schen", onClick: () => store.deleteMessage(m.id).then(() => toast('Nachricht gelöscht.'), fail), children: _jsx(Icon, { name: "trash" }) })] }), _jsxs("span", { className: "left", children: [m.pinned && _jsx(Icon, { name: "pin" }), " ", leftTxt(m, s)] })] }), replyTo === m.id && (_jsxs("form", { className: "compose", onSubmit: e => { e.preventDefault(); const v = reply.trim(); if (!v)
                            return; store.reply(m.id, v).then(() => { setReplyTo(null); setReply(''); }, fail); }, children: [_jsx("input", { autoFocus: true, value: reply, onChange: e => setReply(e.target.value), placeholder: `Kurze Antwort an ${nameOf(snap.members, m.from_member)}`, maxLength: 300 }), _jsx("button", { children: "Senden" })] }))] }, m.id))), canAct && (_jsxs(_Fragment, { children: [photo && _jsxs("div", { className: "photo-prev", children: [_jsx("img", { src: `data:${photo.type};base64,${photo.data}`, alt: "Foto f\u00FCr das Board" }), _jsx("button", { type: "button", className: "small-btn", onClick: () => setPhoto(null), children: "Foto entfernen" })] }), _jsxs("form", { className: "compose", onSubmit: e => {
                            e.preventDefault();
                            const v = text.trim() || (photo ? '📷 Foto' : '');
                            if (!v || sending)
                                return;
                            setSending(true);
                            store.postMessage(v, photo ?? undefined).then(() => { setText(''); setPhoto(null); toast('Hängt jetzt am Board.'); }, fail).finally(() => setSending(false));
                        }, children: [_jsx("input", { value: text, onChange: e => setText(e.target.value), placeholder: photo ? 'Text zum Foto (freiwillig)' : 'Nachricht an die Familie', maxLength: 500 }), _jsx("button", { disabled: sending, children: sending ? '…' : 'Boarding' })] }), _jsxs("div", { className: "cam-row", children: [_jsxs("label", { className: "cam-big", children: [_jsx(Icon, { name: "camera" }), _jsx("span", { children: "Foto aufnehmen" }), _jsx("input", { type: "file", accept: "image/*", capture: "environment", hidden: true, onChange: e => { void pick(e.target.files?.[0]); e.target.value = ''; } })] }), _jsxs("label", { className: "cam-big", children: [_jsx(Icon, { name: "image" }), _jsx("span", { children: "Aus Galerie" }), _jsx("input", { type: "file", accept: "image/*", hidden: true, onChange: e => { void pick(e.target.files?.[0]); e.target.value = ''; } })] })] })] }))] });
}
