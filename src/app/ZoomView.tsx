// Beleg im Vollbild: mit zwei Fingern zoomen, mit einem Finger verschieben, Doppeltipp vergrößert
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function ZoomView({ src, close }: { src: string; close: () => void }) {
  const [t, setT] = useState({ s: 1, x: 0, y: 0 });
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const start = useRef<{ d: number; s: number; cx: number; cy: number; x: number; y: number } | null>(null);
  const tap = useRef(0);
  const clamp = (s: number) => Math.min(6, Math.max(1, s));
  const down = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.current.size === 2) {
      const [a, b] = [...pts.current.values()];
      start.current = { d: Math.hypot(a.x - b.x, a.y - b.y), s: t.s, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, x: t.x, y: t.y };
    } else if (pts.current.size === 1) {
      const now = Date.now();
      if (now - tap.current < 300) { setT(o => o.s > 1 ? { s: 1, x: 0, y: 0 } : { s: 2.5, x: 0, y: 0 }); tap.current = 0; }
      else tap.current = now;
    }
  };
  const move = (e: React.PointerEvent) => {
    const old = pts.current.get(e.pointerId); if (!old) return;
    const p = { x: e.clientX, y: e.clientY }; pts.current.set(e.pointerId, p);
    if (pts.current.size >= 2 && start.current) {
      const [a, b] = [...pts.current.values()], st = start.current;
      const s = clamp(st.s * Math.hypot(a.x - b.x, a.y - b.y) / (st.d || 1));
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      setT({ s, x: st.x + (cx - st.cx), y: st.y + (cy - st.cy) });
    } else if (pts.current.size === 1) setT(o => o.s > 1 ? { ...o, x: o.x + p.x - old.x, y: o.y + p.y - old.y } : o);
  };
  const up = (e: React.PointerEvent) => {
    pts.current.delete(e.pointerId);
    if (pts.current.size < 2) start.current = null;
    if (!pts.current.size) setT(o => o.s <= 1.02 ? { s: 1, x: 0, y: 0 } : o);
  };
  const wheel = (e: React.WheelEvent) => setT(o => { const s = clamp(o.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); return s === 1 ? { s, x: 0, y: 0 } : { ...o, s }; });
  return createPortal(<div className="zoomview" role="dialog" aria-label="Beleg vergrößert" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel}>
    <img src={src} alt="Beleg" draggable={false} style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.s})` }} />
    <button type="button" className="zoomview-x" aria-label="Schließen" onPointerDown={e => e.stopPropagation()} onClick={close}>✕</button>
    {t.s === 1 && <p className="zoomview-tip">Mit zwei Fingern zoomen · Doppeltipp vergrößert</p>}
  </div>, document.body);
}
