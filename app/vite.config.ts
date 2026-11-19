import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// En local la app vive en "/"; en GitHub Pages en "/GUVA/" (la Action define BASE_PATH).
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icono.svg'],
      manifest: {
        name: 'GUVA · Distribución y control',
        short_name: 'GUVA',
        description: 'Ventas en ruta, bodega, inventario y control financiero de GUVA',
        lang: 'es-MX',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'any',
        background_color: '#faf7f2',
        theme_color: '#3b2418',
        icons: [
          { src: 'icono.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icono-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icono-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icono-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        // La app (HTML, JS, CSS) queda en caché para abrir sin señal.
        // Los datos NO se cachean aquí: la copia para vender sin señal y la cola de
        // ventas, cobros y gastos viven en src/lib/datosRuta.ts y src/lib/cola.ts.
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        navigateFallback: `${base}index.html`
      }
    })
  ]
});
