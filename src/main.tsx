import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './styles.css';
import { Root } from './app/Root';

// Updates selbst suchen: das Flur-Display läuft tagelang ohne Neuladen, neue Versionen laden dann von allein
registerSW({ immediate: true, onRegisteredSW: (_url, r) => { if (r) setInterval(() => void r.update(), 30 * 60 * 1000); } });

createRoot(document.getElementById('root')!).render(<StrictMode><Root /></StrictMode>);
