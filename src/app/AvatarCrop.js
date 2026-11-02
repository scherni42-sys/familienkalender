import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { Sheet, cvar } from './ui';
const S = 240; // Größe der runden Vorschau in px
const OUT = 256; // Größe des gespeicherten Avatars
// Avatar zurechtrücken: Foto verschieben (ziehen) und vergrößern (Regler), Vorschau ist schon rund
export function AvatarCrop({ file, color, close, done }) {
    const [bmp, setBmp] = useState(null);
    const [url, setUrl] = useState('');
    const [z, setZ] = useState(1);
    const [pos, setPos] = useState({ x: 0, y: 0 });
    const drag = useRef(null);
    useEffect(() => {
        const u = URL.createObjectURL(file);
        setUrl(u);
        createImageBitmap(file).then(setBmp, () => close());
        return () => URL.revokeObjectURL(u);
    }, [file]);
    const base = bmp ? S / Math.min(bmp.width, bmp.height) : 1;
    const w = (bmp?.width ?? S) * base * z, h = (bmp?.height ?? S) * base * z;
    const clamp = (p) => ({ x: Math.max(-(w - S) / 2, Math.min((w - S) / 2, p.x)), y: Math.max(-(h - S) / 2, Math.min((h - S) / 2, p.y)) });
    const cur = clamp(pos);
    const save = () => {
        if (!bmp)
            return;
        const k = OUT / S;
        const c = document.createElement('canvas');
        c.width = c.height = OUT;
        c.getContext('2d').drawImage(bmp, (S / 2 + cur.x - w / 2) * k, (S / 2 + cur.y - h / 2) * k, w * k, h * k);
        done({ type: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.85).split(',')[1] });
    };
    return (_jsxs(Sheet, { onClose: close, label: "Avatar zuschneiden", children: [_jsx("h2", { children: "Avatar zuschneiden" }), _jsx("p", { className: "note", style: { textAlign: 'center' }, children: "Foto mit dem Finger verschieben, mit dem Regler vergr\u00F6\u00DFern." }), _jsx("div", { className: "crop", style: { ...cvar(color), width: S, height: S }, onPointerDown: e => { e.target.setPointerCapture?.(e.pointerId); drag.current = { px: e.clientX, py: e.clientY, ...cur }; }, onPointerMove: e => { const d = drag.current; if (d)
                    setPos(clamp({ x: d.x + e.clientX - d.px, y: d.y + e.clientY - d.py })); }, onPointerUp: () => { drag.current = null; }, onPointerCancel: () => { drag.current = null; }, children: url && _jsx("img", { src: url, alt: "", draggable: false, style: { width: w, height: h, left: S / 2 + cur.x - w / 2, top: S / 2 + cur.y - h / 2 } }) }), _jsxs("label", { className: "crop-zoom", children: [_jsx("span", { children: "\uFF0D" }), _jsx("input", { type: "range", min: 1, max: 4, step: 0.01, value: z, onChange: e => setZ(Number(e.target.value)), "aria-label": "Vergr\u00F6\u00DFern" }), _jsx("span", { children: "\uFF0B" })] }), _jsxs("div", { className: "btn-row", children: [_jsx("button", { type: "button", className: "btn ghost", onClick: close, children: "Abbrechen" }), _jsx("button", { type: "button", className: "btn", disabled: !bmp, onClick: save, children: "Speichern" })] })] }));
}
