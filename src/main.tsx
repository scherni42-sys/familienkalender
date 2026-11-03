import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './styles.css';
import { Root } from './app/Root';

// Updates selbst suchen: das Flur-Display läuft tagelang ohne Neuladen, neue Versionen laden dann von allein
// Neue Version nie mitten in der Bedienung einspielen (sonst springt ein offenes Fenster weg):
// am Flur-Display sofort, in der App erst, wenn sie im Hintergrund ist oder 5 Minuten niemand etwas tippt.
let last = Date.now();
for (const ev of ['pointerdown', 'keydown', 'input']) addEventListener(ev, () => { last = Date.now(); }, true);
const update = registerSW({
  immediate: true,
  onRegisteredSW: (_url, r) => { if (r) setInterval(() => void r.update(), 30 * 60 * 1000); },
  onNeedRefresh: () => {
    const go = () => void update(true);
    if (location.hash.startsWith('#/display')) { go(); return; }
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') go(); });
    addEventListener('famto-pause', go);
    setInterval(() => { if (Date.now() - last > 5 * 60_000 && !document.querySelector('[role=dialog]')) go(); }, 60_000);
  }
});

createRoot(document.getElementById('root')!).render(<StrictMode><Root /></StrictMode>);
