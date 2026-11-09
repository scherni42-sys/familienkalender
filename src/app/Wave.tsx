import { useEffect, useRef, useState } from 'react';

const N = 32;

// Pegelbalken beim Sprechen: echte Lautstärke aus der Android-App („famto-speech-level“, 0…1),
// sonst eine ruhige Bewegung, damit man sieht, dass das Mikrofon läuft
export function Wave() {
  const [bars, setBars] = useState<number[]>(() => Array(N).fill(0.08));
  const lvl = useRef({ v: 0, at: 0 });
  const fake = useRef(0.2);

  useEffect(() => {
    const on = (e: Event) => { const v = Number((e as CustomEvent).detail); if (Number.isFinite(v)) lvl.current = { v: Math.max(0, Math.min(1, v)), at: Date.now() }; };
    window.addEventListener('famto-speech-level', on);
    const t = window.setInterval(() => {
      const real = Date.now() - lvl.current.at < 500;
      let v: number;
      if (real) v = 0.06 + lvl.current.v * 0.94;
      else { fake.current += (0.12 + Math.random() * 0.4 - fake.current) * 0.35; v = fake.current; }
      setBars(b => [...b.slice(1), v]);
    }, 70);
    return () => { window.removeEventListener('famto-speech-level', on); window.clearInterval(t); };
  }, []);

  return (
    <div className="wave" aria-label="Mikrofon hört zu" role="img">
      {bars.map((v, i) => <i key={i} style={{ height: `${Math.round(4 + v * 32)}px` }} />)}
    </div>
  );
}
