import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// base: './' damit die App auch in einem Unterordner (z. B. GitHub Pages) läuft
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Familienkalender',
        short_name: 'Familie',
        description: 'Gemeinsamer Familienkalender mit Spracheingabe und Flur-Display',
        lang: 'de',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#f3f6f4',
        theme_color: '#1d8657',
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
