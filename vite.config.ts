import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Precached so the logo is there on the sign-in screen offline, which is
      // where somebody with no signal meets the app for the first time.
      includeAssets: [
        'favicon-32.png',
        'apple-touch-icon.png',
        'qc2go-logo.png',
        'icon-192.png',
        'icon-512.png',
      ],
      manifest: {
        name: 'QC2GO — Quality in motion',
        short_name: 'QC2GO',
        description:
          'Quality in motion. Mobile quality control checklists for home performance, indoor air quality, and heat pump installations.',
        theme_color: '#1b5c7e',
        background_color: '#f8fafc',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
})
