import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
// base: './' damit die App auch in einem Unterordner (z. B. GitHub Pages) läuft
export default defineConfig({
    base: './',
    // Bauzeit als Versionsstempel, sichtbar in den Einstellungen
    define: { __BUILD__: JSON.stringify(new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short' })) },
    plugins: [
        react(),
        VitePWA({
            registerType: 'autoUpdate',
            includeAssets: ['icon.svg'],
            manifest: {
                name: 'FamTO',
                short_name: 'FamTO',
                description: 'FamTO: gemeinsamer Familienkalender mit Spracheingabe und Flur-Display',
                lang: 'de',
                start_url: './',
                scope: './',
                display: 'standalone',
                // Läuft die App schon, lädt ein Start über Seitentaste/Widget sie mit der neuen Adresse (?mic=1, ?open=…)
                launch_handler: { client_mode: 'navigate-existing' },
                background_color: '#f3f6f4',
                theme_color: '#1d8657',
                shortcuts: [{ name: 'Neuer Termin', short_name: 'Termin', url: './?mic=1', icons: [{ src: 'icon-192.png', sizes: '192x192' }] }],
                icons: [
                    { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
                    { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
                    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
                ]
            },
            workbox: { navigateFallback: 'index.html' }
        })
    ]
});
